"""Clean Silver Line observed bus data into event/headway-ready tables."""

from __future__ import annotations

from pathlib import Path
from typing import Dict, Optional, Tuple

import pandas as pd

from stops_lookup import find_stops_lookup, load_stop_lookup
from time_periods import classify_time_period

SILVER_ROUTE_IDS = {"SL1", "SL2", "SL3", "SL4", "SL5", "SLW", "741", "742", "743", "746", "749", "751"}
SILVER_ROUTE_ALIAS = {
    "741": "SL1",
    "742": "SL2",
    "743": "SL3",
    "751": "SL4",
    "749": "SL5",
    "746": "SLW",
}


def _parse_time_like_to_seconds(series: pd.Series) -> pd.Series:
    dt = pd.to_datetime(series, errors="coerce", utc=True)
    # ArcGIS timestamps use a synthetic 1900-01-01/02 date; day offset captures post-midnight times.
    day_offset = (dt.dt.day - 1).clip(lower=0)
    seconds = dt.dt.hour * 3600 + dt.dt.minute * 60 + dt.dt.second + day_offset * 86400
    return pd.to_numeric(seconds, errors="coerce")


def _normalize_direction(value: object) -> Tuple[str, object]:
    text = str(value or "").strip()
    upper = text.upper()
    if upper == "INBOUND":
        return text or "Inbound", 1
    if upper == "OUTBOUND":
        return text or "Outbound", 0
    if upper in {"0", "1"}:
        return text, int(upper)
    return text, pd.NA


def clean_silver_bus_observations(
    source_csv: Path,
    events_destination_parquet: Path,
    headways_destination_parquet: Path,
    events_destination_csv: Optional[Path] = None,
    headways_destination_csv: Optional[Path] = None,
    *,
    raw_dir: Optional[Path] = None,
    year: Optional[int] = None,
    stops_lookup_path: Optional[Path] = None,
) -> Dict[str, object]:
    if not source_csv.exists():
        raise FileNotFoundError(f"Missing Silver bus source file: {source_csv}")

    df = pd.read_csv(source_csv, low_memory=False)
    rows_input = int(len(df))

    for col in [
        "service_date",
        "route_id",
        "direction_id",
        "half_trip_id",
        "stop_id",
        "standard_type",
        "scheduled",
        "actual",
        "scheduled_headway",
        "headway",
    ]:
        if col not in df.columns:
            df[col] = pd.NA

    df["route_id"] = df["route_id"].astype(str).str.strip().str.upper()
    df["source_route_id"] = df["route_id"]
    silver_mask = df["route_id"].isin(SILVER_ROUTE_IDS)
    work = df.loc[silver_mask].copy()
    rows_after_route_filter = int(len(work))

    if work.empty:
        empty_events = pd.DataFrame(
            columns=[
                "service_date",
                "route_id",
                "stop_id",
                "trip_id",
                "event_type",
                "event_time_sec",
                "schedule_deviation_sec",
                "direction",
                "direction_id",
                "canonical_stop_name",
                "source_route_id",
            ]
        )
        empty_headways = pd.DataFrame(
            columns=[
                "service_date",
                "route_id",
                "stop_id",
                "trip_id",
                "prev_trip_id",
                "headway_trunk_sec",
                "headway_branch_sec",
                "benchmark_headway_sec",
                "event_time_sec",
                "direction",
                "direction_id",
                "source_route_id",
            ]
        )
        events_destination_parquet.parent.mkdir(parents=True, exist_ok=True)
        headways_destination_parquet.parent.mkdir(parents=True, exist_ok=True)
        empty_events.to_parquet(events_destination_parquet, index=False)
        empty_headways.to_parquet(headways_destination_parquet, index=False)
        if events_destination_csv is not None:
            events_destination_csv.parent.mkdir(parents=True, exist_ok=True)
            empty_events.to_csv(events_destination_csv, index=False)
        if headways_destination_csv is not None:
            headways_destination_csv.parent.mkdir(parents=True, exist_ok=True)
            empty_headways.to_csv(headways_destination_csv, index=False)
        return {
            "rows_input": rows_input,
            "rows_after_route_filter": 0,
            "rows_events_output": 0,
            "rows_headways_output": 0,
            "output_events_parquet": str(events_destination_parquet),
            "output_headways_parquet": str(headways_destination_parquet),
            "output_events_csv": str(events_destination_csv) if events_destination_csv else None,
            "output_headways_csv": str(headways_destination_csv) if headways_destination_csv else None,
            "stops_lookup_path": None,
        }

    work["route_id"] = work["route_id"].map(lambda v: SILVER_ROUTE_ALIAS.get(v, v))
    work["service_date"] = pd.to_datetime(work["service_date"], errors="coerce").dt.normalize()
    work["stop_id"] = work["stop_id"].astype(str).str.strip()
    raw_trip_id = work["half_trip_id"].astype(str).str.strip()
    raw_trip_id = raw_trip_id.where(~raw_trip_id.isin({"", "nan", "None"}), pd.NA)

    direction = work["direction_id"].map(_normalize_direction)
    work["direction"] = direction.map(lambda t: t[0])
    work["direction_id_numeric"] = direction.map(lambda t: t[1]).astype("Int64")

    scheduled_sec = _parse_time_like_to_seconds(work["scheduled"])
    actual_sec = _parse_time_like_to_seconds(work["actual"])
    event_time_sec = actual_sec.fillna(scheduled_sec)
    schedule_deviation_sec = actual_sec - scheduled_sec
    synthetic_trip_basis = (
        work["route_id"].astype(str)
        + "|"
        + work["direction"].astype(str)
        + "|"
        + work["stop_id"].astype(str)
        + "|"
        + work["service_date"].dt.strftime("%Y-%m-%d").fillna("")
        + "|"
        + pd.to_numeric(event_time_sec, errors="coerce").round(0).fillna(-1).astype("int64").astype(str)
    )
    synthetic_trip_id = "silver_" + pd.util.hash_pandas_object(synthetic_trip_basis, index=False).astype(str)
    work["trip_id"] = raw_trip_id.fillna(synthetic_trip_id)

    resolved_stops_path = None
    if raw_dir is not None and year is not None:
        resolved_stops_path = find_stops_lookup(raw_dir=raw_dir, year=year, explicit_path=stops_lookup_path)
    elif stops_lookup_path is not None and stops_lookup_path.exists():
        resolved_stops_path = stops_lookup_path
    stop_lookup = load_stop_lookup(resolved_stops_path)

    events = work.copy()
    events["event_time_sec"] = pd.to_numeric(event_time_sec, errors="coerce")
    events["schedule_deviation_sec"] = pd.to_numeric(schedule_deviation_sec, errors="coerce")
    events["event_type"] = events["standard_type"].astype(str).str.strip().str.upper().map(
        lambda value: "ARR" if value == "SCHEDULE" else "DEP"
    )
    events["canonical_stop_name"] = events["stop_id"].map(stop_lookup).fillna(events["stop_id"])
    valid_event_mask = events["service_date"].notna() & events["event_time_sec"].notna()
    rows_event_time_null = int((events["event_time_sec"].isna()).sum())
    events = events[valid_event_mask].copy()
    events["event_time_sec"] = events["event_time_sec"].astype("int64")
    events = events[
        [
            "service_date",
            "route_id",
            "stop_id",
            "trip_id",
            "event_type",
            "event_time_sec",
            "schedule_deviation_sec",
            "direction",
            "direction_id_numeric",
            "canonical_stop_name",
            "source_route_id",
        ]
    ].rename(columns={"direction_id_numeric": "direction_id"})

    headways = work.copy()
    headways["event_time_sec"] = pd.to_numeric(event_time_sec, errors="coerce")
    headways["headway_trunk_sec"] = pd.to_numeric(headways["headway"], errors="coerce")
    headways["benchmark_headway_sec"] = pd.to_numeric(headways["scheduled_headway"], errors="coerce")
    headways["headway_branch_sec"] = pd.NA
    headways["prev_trip_id"] = pd.NA
    headways["time_period"] = classify_time_period(headways["event_time_sec"].fillna(0).astype("int64"))

    # Scheduled headway is often missing in this feed; use route+direction+period medians as a stable fallback.
    fallback = headways.groupby(["route_id", "direction", "time_period"])["headway_trunk_sec"].transform("median")
    headways["benchmark_headway_sec"] = headways["benchmark_headway_sec"].fillna(fallback)

    headways = headways[
        headways["service_date"].notna()
        & headways["event_time_sec"].notna()
        & headways["headway_trunk_sec"].notna()
        & (headways["headway_trunk_sec"] >= 0)
    ].copy()
    headways["event_time_sec"] = headways["event_time_sec"].astype("int64")
    headways = headways[
        [
            "service_date",
            "route_id",
            "stop_id",
            "trip_id",
            "prev_trip_id",
            "headway_trunk_sec",
            "headway_branch_sec",
            "benchmark_headway_sec",
            "event_time_sec",
            "direction",
            "direction_id_numeric",
            "source_route_id",
            "time_period",
        ]
    ].rename(columns={"direction_id_numeric": "direction_id"})

    events_destination_parquet.parent.mkdir(parents=True, exist_ok=True)
    headways_destination_parquet.parent.mkdir(parents=True, exist_ok=True)
    events.to_parquet(events_destination_parquet, index=False)
    headways.to_parquet(headways_destination_parquet, index=False)

    if events_destination_csv is not None:
        events_destination_csv.parent.mkdir(parents=True, exist_ok=True)
        events.to_csv(events_destination_csv, index=False)
    if headways_destination_csv is not None:
        headways_destination_csv.parent.mkdir(parents=True, exist_ok=True)
        headways.to_csv(headways_destination_csv, index=False)

    metrics = {
        "rows_input": rows_input,
        "rows_after_route_filter": rows_after_route_filter,
        "rows_events_output": int(len(events)),
        "rows_headways_output": int(len(headways)),
        "rows_dropped_event_time_null": rows_event_time_null,
        "rows_with_null_schedule_deviation": int(events["schedule_deviation_sec"].isna().sum()),
        "rows_with_null_headway_benchmark": int(headways["benchmark_headway_sec"].isna().sum()),
        "stops_lookup_path": str(resolved_stops_path) if resolved_stops_path else None,
        "output_events_parquet": str(events_destination_parquet),
        "output_headways_parquet": str(headways_destination_parquet),
        "output_events_csv": str(events_destination_csv) if events_destination_csv else None,
        "output_headways_csv": str(headways_destination_csv) if headways_destination_csv else None,
    }
    return metrics
