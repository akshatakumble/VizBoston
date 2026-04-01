"""Cleaning logic for MBTA rapid transit travel times dataset (Epic 3.3)."""

from __future__ import annotations

from pathlib import Path
from typing import Dict, Optional

import pandas as pd

from stops_lookup import find_stops_lookup, load_stop_id_set, load_stop_lookup
from time_periods import classify_time_period

SLOW_ZONE_DEVIATION_THRESHOLD_SEC = 60.0


def _parse_hhmmss_to_seconds(series: pd.Series) -> pd.Series:
    parts = series.astype(str).str.strip().str.split(":", expand=True)
    if parts.shape[1] < 2:
        return pd.Series(float("nan"), index=series.index, dtype="float64")

    hh = pd.to_numeric(parts[0], errors="coerce")
    mm = pd.to_numeric(parts[1], errors="coerce")
    ss = pd.to_numeric(parts[2], errors="coerce") if parts.shape[1] >= 3 else 0
    return hh * 3600 + mm * 60 + ss


def _infer_trip_time_from_gtfs(raw_dir: Optional[Path], year: Optional[int]) -> pd.Series:
    if raw_dir is None or year is None:
        return pd.Series(dtype="float64")

    gtfs_path = raw_dir / f"gtfs_schedules_{year}.csv"
    if not gtfs_path.exists():
        return pd.Series(dtype="float64")

    gtfs = pd.read_csv(gtfs_path, low_memory=False)
    if "trip_id" not in gtfs.columns:
        return pd.Series(dtype="float64")

    dep = _parse_hhmmss_to_seconds(gtfs.get("departure_time", pd.Series(pd.NA, index=gtfs.index)))
    arr = _parse_hhmmss_to_seconds(gtfs.get("arrival_time", pd.Series(pd.NA, index=gtfs.index)))
    time_sec = dep.fillna(arr)
    inferred = pd.DataFrame({"trip_id": gtfs["trip_id"].astype(str).str.strip(), "event_time_sec": time_sec})
    inferred = inferred.dropna(subset=["trip_id", "event_time_sec"])
    if inferred.empty:
        return pd.Series(dtype="float64")

    return inferred.groupby("trip_id")["event_time_sec"].median()


def _resolve_time_seconds(df: pd.DataFrame) -> pd.Series:
    if "event_time_sec" in df.columns:
        return pd.to_numeric(df["event_time_sec"], errors="coerce")

    for col in ["departure_time", "arrival_time"]:
        if col in df.columns:
            parts = df[col].astype(str).str.split(":", expand=True)
            if parts.shape[1] >= 2:
                hh = pd.to_numeric(parts[0], errors="coerce")
                mm = pd.to_numeric(parts[1], errors="coerce")
                ss = pd.to_numeric(parts[2], errors="coerce") if parts.shape[1] >= 3 else 0
                return hh * 3600 + mm * 60 + ss

    return pd.Series(float("nan"), index=df.index, dtype="float64")


def clean_travel_times_dataset(
    source_csv: Path,
    destination_parquet: Path,
    destination_csv: Optional[Path] = None,
    *,
    raw_dir: Optional[Path] = None,
    year: Optional[int] = None,
    stops_lookup_path: Optional[Path] = None,
    slow_zone_threshold_sec: float = SLOW_ZONE_DEVIATION_THRESHOLD_SEC,
) -> Dict[str, object]:
    if not source_csv.exists():
        raise FileNotFoundError(f"Missing travel times source file: {source_csv}")

    df = pd.read_csv(source_csv, low_memory=False)
    rows_input = int(len(df))

    for col in ["service_date", "from_stop_id", "to_stop_id", "travel_time_sec", "benchmark_travel_time_sec"]:
        if col not in df.columns:
            df[col] = pd.NA

    df["service_date"] = pd.to_datetime(df["service_date"], errors="coerce").dt.normalize()
    df["from_stop_id"] = df["from_stop_id"].astype(str).str.strip()
    df["to_stop_id"] = df["to_stop_id"].astype(str).str.strip()

    travel_time = pd.to_numeric(df["travel_time_sec"], errors="coerce")
    benchmark = pd.to_numeric(df["benchmark_travel_time_sec"], errors="coerce")

    null_travel_before = int(travel_time.isna().sum())

    keep_mask = travel_time.notna()
    cleaned = df.loc[keep_mask].copy()
    travel_time = travel_time.loc[keep_mask].astype("float64")
    benchmark = benchmark.loc[keep_mask].astype("float64")

    rows_after_drop = int(len(cleaned))
    rows_dropped_null_travel_time = rows_input - rows_after_drop

    cleaned["travel_time_sec"] = travel_time
    cleaned["benchmark_travel_time_sec"] = benchmark
    cleaned["travel_time_deviation_sec"] = cleaned["travel_time_sec"] - cleaned["benchmark_travel_time_sec"]

    if raw_dir is not None and year is not None:
        resolved_stops = find_stops_lookup(raw_dir=raw_dir, year=year, explicit_path=stops_lookup_path)
    else:
        resolved_stops = stops_lookup_path

    stop_lookup = load_stop_lookup(resolved_stops)
    stop_ids = load_stop_id_set(resolved_stops)

    if stop_ids:
        cleaned["from_stop_valid"] = cleaned["from_stop_id"].isin(stop_ids)
        cleaned["to_stop_valid"] = cleaned["to_stop_id"].isin(stop_ids)
        stop_validation_available = True
    else:
        # If no canonical lookup is available, avoid marking every row invalid.
        cleaned["from_stop_valid"] = True
        cleaned["to_stop_valid"] = True
        stop_validation_available = False

    cleaned["segment_stops_valid"] = cleaned["from_stop_valid"] & cleaned["to_stop_valid"]
    cleaned["same_origin_destination"] = cleaned["from_stop_id"] == cleaned["to_stop_id"]

    # Guarantee a non-null segment identifier for every retained row.
    cleaned["segment_id"] = cleaned["from_stop_id"].fillna("UNKNOWN") + "-" + cleaned["to_stop_id"].fillna("UNKNOWN")

    if stop_lookup:
        cleaned["from_stop_name"] = cleaned["from_stop_id"].map(stop_lookup).fillna(cleaned["from_stop_id"])
        cleaned["to_stop_name"] = cleaned["to_stop_id"].map(stop_lookup).fillna(cleaned["to_stop_id"])
    else:
        cleaned["from_stop_name"] = cleaned["from_stop_id"]
        cleaned["to_stop_name"] = cleaned["to_stop_id"]

    segment_medians = cleaned.groupby("segment_id")["travel_time_deviation_sec"].median()
    slow_zone_segments = segment_medians[segment_medians > slow_zone_threshold_sec].index
    cleaned["slow_zone_candidate"] = cleaned["segment_id"].isin(slow_zone_segments)

    event_time_sec = _resolve_time_seconds(cleaned)
    inferred_event_rows = 0
    if event_time_sec.isna().any() and "trip_id" in cleaned.columns:
        inferred_by_trip = _infer_trip_time_from_gtfs(raw_dir=raw_dir, year=year)
        if not inferred_by_trip.empty:
            trip_ids = cleaned["trip_id"].astype(str).str.strip()
            inferred_values = trip_ids.map(inferred_by_trip)
            fill_mask = event_time_sec.isna() & inferred_values.notna()
            inferred_event_rows = int(fill_mask.sum())
            event_time_sec = event_time_sec.where(~fill_mask, inferred_values)

    cleaned["event_time_sec"] = pd.to_numeric(event_time_sec, errors="coerce").astype("Int64")
    cleaned["hour_of_day"] = ((pd.to_numeric(event_time_sec, errors="coerce") // 3600) % 24).astype("Int64")

    cleaned["time_period"] = "Unknown"
    has_time = cleaned["event_time_sec"].notna()
    if has_time.any():
        cleaned.loc[has_time, "time_period"] = classify_time_period(
            cleaned.loc[has_time, "event_time_sec"].astype("int64")
        )

    destination_parquet.parent.mkdir(parents=True, exist_ok=True)
    cleaned.to_parquet(destination_parquet, index=False)

    if destination_csv is not None:
        destination_csv.parent.mkdir(parents=True, exist_ok=True)
        cleaned.to_csv(destination_csv, index=False)

    metrics: Dict[str, object] = {
        "rows_input": rows_input,
        "rows_after_drop": rows_after_drop,
        "rows_dropped_null_travel_time": rows_dropped_null_travel_time,
        "null_travel_time_before": null_travel_before,
        "null_travel_time_after": int(cleaned["travel_time_sec"].isna().sum()),
        "inferred_event_time_rows": inferred_event_rows,
        "unknown_time_period_rows": int((cleaned["time_period"] == "Unknown").sum()),
        "missing_benchmark_rows": int(cleaned["benchmark_travel_time_sec"].isna().sum()),
        "same_origin_destination_rows": int(cleaned["same_origin_destination"].sum()),
        "invalid_stop_rows": int((~cleaned["segment_stops_valid"]).sum()),
        "stop_validation_available": stop_validation_available,
        "slow_zone_threshold_sec": slow_zone_threshold_sec,
        "slow_zone_segment_count": int(len(set(slow_zone_segments))),
        "slow_zone_rows": int(cleaned["slow_zone_candidate"].sum()),
        "output_parquet": str(destination_parquet),
        "output_csv": str(destination_csv) if destination_csv else None,
        "stops_lookup_path": str(resolved_stops) if resolved_stops else None,
    }
    return metrics
