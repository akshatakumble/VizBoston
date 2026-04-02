"""Cleaning logic for MBTA rapid transit events dataset (Epic 3.1)."""

from __future__ import annotations

from pathlib import Path
from typing import Dict, Optional

import pandas as pd

from stops_lookup import find_stops_lookup, load_stop_lookup

VALID_EVENT_TYPES = {"ARR", "DEP"}
VALID_ROUTES = {
    "Red",
    "Orange",
    "Blue",
    "Green-B",
    "Green-C",
    "Green-D",
    "Green-E",
    "Mattapan",
}


def _parse_hhmmss_to_seconds(series: pd.Series) -> pd.Series:
    parts = series.astype(str).str.strip().str.split(":", expand=True)
    if parts.shape[1] < 2:
        return pd.Series(float("nan"), index=series.index, dtype="float64")
    hh = pd.to_numeric(parts[0], errors="coerce")
    mm = pd.to_numeric(parts[1], errors="coerce")
    ss = pd.to_numeric(parts[2], errors="coerce") if parts.shape[1] >= 3 else 0
    return hh * 3600 + mm * 60 + ss


def _infer_schedule_deviation_from_gtfs(
    *,
    raw_dir: Optional[Path],
    year: Optional[int],
    events: pd.DataFrame,
) -> pd.Series:
    if raw_dir is None or year is None:
        return pd.Series(float("nan"), index=events.index, dtype="float64")

    stop_time_paths = sorted(p for p in raw_dir.rglob("stop_times.txt") if str(year) in p.as_posix())
    if not stop_time_paths:
        stop_time_paths = sorted(raw_dir.rglob("stop_times.txt"))
    if not stop_time_paths:
        return pd.Series(float("nan"), index=events.index, dtype="float64")

    reference_frames = []
    for path in stop_time_paths:
        try:
            st = pd.read_csv(
                path,
                usecols=lambda c: c in {"trip_id", "stop_id", "arrival_time", "departure_time"},
                low_memory=False,
            )
        except Exception:
            continue
        if "trip_id" not in st.columns or "stop_id" not in st.columns:
            continue
        st["trip_id"] = st["trip_id"].astype(str).str.strip()
        st["stop_id"] = st["stop_id"].astype(str).str.strip()
        st["scheduled_arrival_sec"] = _parse_hhmmss_to_seconds(st.get("arrival_time", pd.Series(pd.NA, index=st.index)))
        st["scheduled_departure_sec"] = _parse_hhmmss_to_seconds(
            st.get("departure_time", pd.Series(pd.NA, index=st.index))
        )
        reference_frames.append(st[["trip_id", "stop_id", "scheduled_arrival_sec", "scheduled_departure_sec"]])

    if not reference_frames:
        return pd.Series(float("nan"), index=events.index, dtype="float64")

    schedule_ref = pd.concat(reference_frames, ignore_index=True)
    schedule_ref = (
        schedule_ref.groupby(["trip_id", "stop_id"], as_index=False)
        .agg(
            scheduled_arrival_sec=("scheduled_arrival_sec", "median"),
            scheduled_departure_sec=("scheduled_departure_sec", "median"),
        )
    )

    merged = events[["trip_id", "stop_id", "event_type", "event_time_sec"]].copy()
    merged["trip_id"] = merged["trip_id"].astype(str).str.strip()
    merged["stop_id"] = merged["stop_id"].astype(str).str.strip()
    merged = merged.merge(schedule_ref, on=["trip_id", "stop_id"], how="left")

    scheduled_sec = merged["scheduled_departure_sec"].where(
        merged["event_type"].eq("DEP"), merged["scheduled_arrival_sec"]
    )
    scheduled_sec = scheduled_sec.where(
        scheduled_sec.notna(),
        merged["scheduled_departure_sec"].fillna(merged["scheduled_arrival_sec"]),
    )
    return pd.to_numeric(merged["event_time_sec"], errors="coerce") - pd.to_numeric(
        scheduled_sec, errors="coerce"
    )

def clean_events_dataset(
    source_csv: Path,
    destination_parquet: Path,
    destination_csv: Optional[Path] = None,
    *,
    raw_dir: Optional[Path] = None,
    year: Optional[int] = None,
    stops_lookup_path: Optional[Path] = None,
) -> Dict[str, object]:
    if not source_csv.exists():
        raise FileNotFoundError(f"Missing events source file: {source_csv}")

    df = pd.read_csv(source_csv, low_memory=False)

    rows_input = int(len(df))

    if "service_date" not in df.columns:
        df["service_date"] = pd.NA
    if "event_time_sec" not in df.columns:
        df["event_time_sec"] = pd.NA
    if "event_type" not in df.columns:
        df["event_type"] = pd.NA
    if "route_id" not in df.columns:
        df["route_id"] = pd.NA
    if "stop_id" not in df.columns:
        df["stop_id"] = pd.NA

    service_date_parsed = pd.to_datetime(df["service_date"], errors="coerce").dt.normalize()
    event_time_numeric = pd.to_numeric(df["event_time_sec"], errors="coerce")

    null_event_time_before = int(event_time_numeric.isna().sum())
    null_rate_before = round((null_event_time_before / rows_input), 6) if rows_input else 0.0

    keep_mask = event_time_numeric.notna()
    cleaned = df.loc[keep_mask].copy()
    service_date_parsed = service_date_parsed.loc[keep_mask]
    event_time_numeric = event_time_numeric.loc[keep_mask].astype("int64")

    rows_after_drop = int(len(cleaned))
    rows_dropped_event_time_null = rows_input - rows_after_drop

    cleaned["service_date"] = service_date_parsed
    cleaned["event_time_sec"] = event_time_numeric

    cleaned["event_type"] = cleaned["event_type"].astype(str).str.strip().str.upper()
    cleaned["event_type_valid"] = cleaned["event_type"].isin(VALID_EVENT_TYPES)

    cleaned["route_id"] = cleaned["route_id"].astype(str).str.strip()
    cleaned["route_valid"] = cleaned["route_id"].isin(VALID_ROUTES)

    cleaned["overnight_service"] = cleaned["event_time_sec"] > 86400
    cleaned["event_datetime"] = cleaned["service_date"] + pd.to_timedelta(cleaned["event_time_sec"], unit="s")
    cleaned["hour_of_day"] = ((cleaned["event_time_sec"] // 3600) % 24).astype("int64")

    if "schedule_deviation_sec" not in cleaned.columns:
        cleaned["schedule_deviation_sec"] = pd.NA
    schedule_deviation = pd.to_numeric(cleaned["schedule_deviation_sec"], errors="coerce")
    inferred_schedule_rows = 0
    if schedule_deviation.isna().all() and {"trip_id", "stop_id", "event_type"}.issubset(cleaned.columns):
        inferred = _infer_schedule_deviation_from_gtfs(raw_dir=raw_dir, year=year, events=cleaned)
        fill_mask = schedule_deviation.isna() & inferred.notna()
        inferred_schedule_rows = int(fill_mask.sum())
        schedule_deviation = schedule_deviation.where(~fill_mask, inferred)
    cleaned["schedule_deviation_sec"] = pd.to_numeric(schedule_deviation, errors="coerce")

    stop_lookup = {}
    resolved_stops_path = None
    if raw_dir is not None and year is not None:
        resolved_stops_path = find_stops_lookup(raw_dir=raw_dir, year=year, explicit_path=stops_lookup_path)
    elif stops_lookup_path is not None and stops_lookup_path.exists():
        resolved_stops_path = stops_lookup_path

    stop_lookup = load_stop_lookup(resolved_stops_path)

    cleaned["stop_id"] = cleaned["stop_id"].astype(str).str.strip()
    if stop_lookup:
        cleaned["canonical_stop_name"] = cleaned["stop_id"].map(stop_lookup)
        cleaned["stop_lookup_reference_found"] = cleaned["canonical_stop_name"].notna()
        cleaned["canonical_stop_name"] = cleaned["canonical_stop_name"].fillna(cleaned["stop_id"])
        cleaned["stop_lookup_found"] = cleaned["canonical_stop_name"].notna()
    else:
        cleaned["canonical_stop_name"] = cleaned["stop_id"]
        cleaned["stop_lookup_reference_found"] = False
        cleaned["stop_lookup_found"] = cleaned["canonical_stop_name"].notna()

    destination_parquet.parent.mkdir(parents=True, exist_ok=True)
    cleaned.to_parquet(destination_parquet, index=False)

    if destination_csv is not None:
        destination_csv.parent.mkdir(parents=True, exist_ok=True)
        cleaned.to_csv(destination_csv, index=False)

    null_event_time_after = int(cleaned["event_time_sec"].isna().sum())
    null_rate_after = round((null_event_time_after / len(cleaned)), 6) if len(cleaned) else 0.0

    metrics: Dict[str, object] = {
        "rows_input": rows_input,
        "rows_after_drop": int(len(cleaned)),
        "rows_dropped_event_time_null": rows_dropped_event_time_null,
        "null_event_time_before": null_event_time_before,
        "null_event_time_after": null_event_time_after,
        "null_rate_before": null_rate_before,
        "null_rate_after": null_rate_after,
        "event_type_invalid_rows": int((~cleaned["event_type_valid"]).sum()),
        "route_invalid_rows": int((~cleaned["route_valid"]).sum()),
        "overnight_rows": int(cleaned["overnight_service"].sum()),
        "stop_lookup_found_rows": int(cleaned["stop_lookup_found"].sum()),
        "stop_lookup_missing_rows": int((~cleaned["stop_lookup_found"]).sum()),
        "stop_lookup_reference_missing_rows": int((~cleaned["stop_lookup_reference_found"]).sum()),
        "stops_lookup_path": str(resolved_stops_path) if resolved_stops_path else None,
        "inferred_schedule_deviation_rows": inferred_schedule_rows,
        "null_schedule_deviation_rows": int(cleaned["schedule_deviation_sec"].isna().sum()),
        "output_parquet": str(destination_parquet),
        "output_csv": str(destination_csv) if destination_csv else None,
    }
    return metrics
