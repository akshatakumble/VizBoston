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
        cleaned["stop_lookup_found"] = cleaned["canonical_stop_name"].notna()
        cleaned["canonical_stop_name"] = cleaned["canonical_stop_name"].fillna(cleaned["stop_id"])
    else:
        cleaned["canonical_stop_name"] = cleaned["stop_id"]
        cleaned["stop_lookup_found"] = False

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
        "stops_lookup_path": str(resolved_stops_path) if resolved_stops_path else None,
        "output_parquet": str(destination_parquet),
        "output_csv": str(destination_csv) if destination_csv else None,
    }
    return metrics
