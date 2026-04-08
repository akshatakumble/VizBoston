"""Cleaning logic for MBTA rapid transit travel times dataset (Epic 3.3)."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, Optional

import pandas as pd

from stops_lookup import find_stops_lookup, load_stop_id_set, load_stop_lookup
from time_periods import classify_time_period

SLOW_ZONE_DEVIATION_THRESHOLD_SEC = 60.0
DEFAULT_TRAVEL_CHUNKSIZE = 250_000
DEFAULT_TRAVEL_MAX_OUTPUT_ROWS = int(os.getenv("MBTA_TRAVEL_MAX_OUTPUT_ROWS", "3000000"))
DEFAULT_TRAVEL_MAX_ROWS_PER_LINE_MONTH = int(os.getenv("MBTA_TRAVEL_MAX_ROWS_PER_LINE_MONTH", "50000"))


def _line_id_from_route_series(route_id: pd.Series) -> pd.Series:
    route = route_id.astype(str).str.strip()
    line = route.where(~route.str.startswith("Green"), "Green")
    silver_mask = (
        line.str.startswith("SL")
        | line.isin({"741", "742", "743", "746", "749", "751"})
        | line.eq("Silver")
    )
    return line.where(~silver_mask, "Silver")


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

    for col in ["from_stop_departure_sec", "to_stop_arrival_sec", "stop_departure_sec"]:
        if col in df.columns:
            parsed = pd.to_numeric(df[col], errors="coerce")
            if parsed.notna().any():
                return parsed

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
    chunksize: int = DEFAULT_TRAVEL_CHUNKSIZE,
    max_output_rows: int = DEFAULT_TRAVEL_MAX_OUTPUT_ROWS,
    max_rows_per_line_month: int = DEFAULT_TRAVEL_MAX_ROWS_PER_LINE_MONTH,
) -> Dict[str, object]:
    if not source_csv.exists():
        raise FileNotFoundError(f"Missing travel times source file: {source_csv}")

    if raw_dir is not None and year is not None:
        resolved_stops = find_stops_lookup(raw_dir=raw_dir, year=year, explicit_path=stops_lookup_path)
    else:
        resolved_stops = stops_lookup_path

    stop_lookup = load_stop_lookup(resolved_stops)
    stop_ids = load_stop_id_set(resolved_stops)
    stop_validation_available = bool(stop_ids)

    inferred_by_trip = _infer_trip_time_from_gtfs(raw_dir=raw_dir, year=year)

    rows_input = 0
    rows_after_drop = 0
    rows_dropped_null_travel_time = 0
    null_travel_before = 0
    inferred_event_rows = 0
    unknown_time_period_rows = 0
    missing_benchmark_rows = 0
    same_origin_destination_rows = 0
    invalid_stop_rows = 0
    line_month_kept: Dict[str, int] = {}
    cleaned_parts = []
    cleaned_rows_kept = 0

    for chunk in pd.read_csv(source_csv, chunksize=chunksize, low_memory=False):
        rows_input += int(len(chunk))

        for col in ["service_date", "from_stop_id", "to_stop_id", "travel_time_sec", "benchmark_travel_time_sec"]:
            if col not in chunk.columns:
                chunk[col] = pd.NA

        chunk["service_date"] = pd.to_datetime(chunk["service_date"], errors="coerce").dt.normalize()
        chunk["from_stop_id"] = chunk["from_stop_id"].astype(str).str.strip()
        chunk["to_stop_id"] = chunk["to_stop_id"].astype(str).str.strip()
        chunk["route_id"] = chunk.get("route_id", pd.Series(pd.NA, index=chunk.index)).astype(str).str.strip()
        chunk["line_id"] = _line_id_from_route_series(chunk["route_id"])
        chunk["month"] = chunk["service_date"].dt.to_period("M").astype(str)

        travel_time = pd.to_numeric(chunk["travel_time_sec"], errors="coerce")
        benchmark = pd.to_numeric(chunk["benchmark_travel_time_sec"], errors="coerce")
        null_travel_before += int(travel_time.isna().sum())

        if benchmark.isna().all():
            baseline_keys = [col for col in ["route_id", "direction_id", "from_stop_id", "to_stop_id"] if col in chunk.columns]
            if baseline_keys:
                benchmark = benchmark.where(
                    benchmark.notna(),
                    travel_time.groupby([chunk[key] for key in baseline_keys]).transform("median"),
                )
            benchmark = benchmark.where(benchmark.notna(), travel_time)

        keep_mask = travel_time.notna()
        cleaned = chunk.loc[keep_mask].copy()
        travel_time = travel_time.loc[keep_mask].astype("float64")
        benchmark = benchmark.loc[keep_mask].astype("float64")

        rows_after_drop += int(len(cleaned))
        rows_dropped_null_travel_time += int((~keep_mask).sum())

        cleaned["travel_time_sec"] = travel_time
        cleaned["benchmark_travel_time_sec"] = benchmark
        cleaned["travel_time_deviation_sec"] = cleaned["travel_time_sec"] - cleaned["benchmark_travel_time_sec"]

        if stop_validation_available:
            cleaned["from_stop_valid"] = cleaned["from_stop_id"].isin(stop_ids)
            cleaned["to_stop_valid"] = cleaned["to_stop_id"].isin(stop_ids)
        else:
            cleaned["from_stop_valid"] = True
            cleaned["to_stop_valid"] = True

        cleaned["segment_stops_valid"] = cleaned["from_stop_valid"] & cleaned["to_stop_valid"]
        invalid_stop_rows += int((~cleaned["segment_stops_valid"]).sum())
        cleaned["same_origin_destination"] = cleaned["from_stop_id"] == cleaned["to_stop_id"]
        same_origin_destination_rows += int(cleaned["same_origin_destination"].sum())

        cleaned["segment_id"] = cleaned["from_stop_id"].fillna("UNKNOWN") + "-" + cleaned["to_stop_id"].fillna("UNKNOWN")

        if stop_lookup:
            cleaned["from_stop_name"] = cleaned["from_stop_id"].map(stop_lookup).fillna(cleaned["from_stop_id"])
            cleaned["to_stop_name"] = cleaned["to_stop_id"].map(stop_lookup).fillna(cleaned["to_stop_id"])
        else:
            cleaned["from_stop_name"] = cleaned["from_stop_id"]
            cleaned["to_stop_name"] = cleaned["to_stop_id"]

        event_time_sec = _resolve_time_seconds(cleaned)
        if event_time_sec.isna().any() and "trip_id" in cleaned.columns and not inferred_by_trip.empty:
            trip_ids = cleaned["trip_id"].astype(str).str.strip()
            inferred_values = trip_ids.map(inferred_by_trip)
            fill_mask = event_time_sec.isna() & inferred_values.notna()
            inferred_event_rows += int(fill_mask.sum())
            event_time_sec = event_time_sec.where(~fill_mask, inferred_values)

        cleaned["event_time_sec"] = pd.to_numeric(event_time_sec, errors="coerce").astype("Int64")
        cleaned["hour_of_day"] = ((pd.to_numeric(event_time_sec, errors="coerce") // 3600) % 24).astype("Int64")
        cleaned["time_period"] = "Unknown"
        has_time = cleaned["event_time_sec"].notna()
        if has_time.any():
            cleaned.loc[has_time, "time_period"] = classify_time_period(
                cleaned.loc[has_time, "event_time_sec"].astype("int64")
            )
        unknown_time_period_rows += int((cleaned["time_period"] == "Unknown").sum())
        missing_benchmark_rows += int(cleaned["benchmark_travel_time_sec"].isna().sum())

        if max_rows_per_line_month > 0:
            cleaned["_line_month_key"] = cleaned["line_id"].astype(str) + "|" + cleaned["month"].astype(str)
            kept_groups = []
            for key, group in cleaned.groupby("_line_month_key", sort=False):
                used = line_month_kept.get(key, 0)
                remaining = max_rows_per_line_month - used
                if remaining <= 0:
                    continue
                take = group.head(remaining)
                line_month_kept[key] = used + int(len(take))
                kept_groups.append(take)
            if kept_groups:
                cleaned = pd.concat(kept_groups, ignore_index=True)
            else:
                cleaned = cleaned.iloc[0:0].copy()
            cleaned = cleaned.drop(columns=["_line_month_key"], errors="ignore")

        if max_output_rows > 0:
            remaining_total = max_output_rows - cleaned_rows_kept
            if remaining_total <= 0:
                break
            if len(cleaned) > remaining_total:
                cleaned = cleaned.head(remaining_total).copy()

        if not cleaned.empty:
            cleaned_parts.append(cleaned)
            cleaned_rows_kept += int(len(cleaned))

        if max_output_rows > 0 and cleaned_rows_kept >= max_output_rows:
            break

    if cleaned_parts:
        cleaned = pd.concat(cleaned_parts, ignore_index=True)
    else:
        cleaned = pd.DataFrame(
            columns=[
                "service_date",
                "route_id",
                "line_id",
                "from_stop_id",
                "to_stop_id",
                "travel_time_sec",
                "benchmark_travel_time_sec",
                "travel_time_deviation_sec",
                "segment_id",
                "from_stop_name",
                "to_stop_name",
                "from_stop_valid",
                "to_stop_valid",
                "segment_stops_valid",
                "same_origin_destination",
                "event_time_sec",
                "hour_of_day",
                "time_period",
            ]
        )

    segment_medians = cleaned.groupby("segment_id")["travel_time_deviation_sec"].median() if not cleaned.empty else pd.Series(dtype="float64")
    slow_zone_segments = segment_medians[segment_medians > slow_zone_threshold_sec].index
    if "segment_id" in cleaned.columns:
        cleaned["slow_zone_candidate"] = cleaned["segment_id"].isin(slow_zone_segments)
    else:
        cleaned["slow_zone_candidate"] = False

    destination_parquet.parent.mkdir(parents=True, exist_ok=True)
    cleaned.to_parquet(destination_parquet, index=False)

    if destination_csv is not None:
        destination_csv.parent.mkdir(parents=True, exist_ok=True)
        cleaned.to_csv(destination_csv, index=False)

    metrics: Dict[str, object] = {
        "rows_input": rows_input,
        "rows_after_drop": int(len(cleaned)),
        "rows_dropped_null_travel_time": rows_dropped_null_travel_time,
        "null_travel_time_before": null_travel_before,
        "null_travel_time_after": int(cleaned["travel_time_sec"].isna().sum()),
        "inferred_event_time_rows": inferred_event_rows,
        "unknown_time_period_rows": unknown_time_period_rows,
        "missing_benchmark_rows": missing_benchmark_rows,
        "same_origin_destination_rows": same_origin_destination_rows,
        "invalid_stop_rows": invalid_stop_rows,
        "stop_validation_available": stop_validation_available,
        "chunksize": chunksize,
        "max_output_rows": max_output_rows,
        "max_rows_per_line_month": max_rows_per_line_month,
        "slow_zone_threshold_sec": slow_zone_threshold_sec,
        "slow_zone_segment_count": int(len(set(slow_zone_segments))),
        "slow_zone_rows": int(cleaned["slow_zone_candidate"].sum()),
        "output_parquet": str(destination_parquet),
        "output_csv": str(destination_csv) if destination_csv else None,
        "stops_lookup_path": str(resolved_stops) if resolved_stops else None,
    }
    return metrics
