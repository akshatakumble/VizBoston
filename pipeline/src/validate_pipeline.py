"""Validation checks for pipeline orchestration (Epic 3.6)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Tuple

import pandas as pd

from common import DATASETS
from metric_aggregations import METRIC_FILENAMES


class PipelineValidationError(RuntimeError):
    """Raised when a validation check fails."""


def _null_rate(series: pd.Series) -> float:
    if len(series) == 0:
        return 0.0
    return round(float(series.isna().mean()), 6)


def validate_ingest(year: int, raw_dir: Path) -> Tuple[Dict[str, int], Dict[str, float]]:
    row_counts: Dict[str, int] = {}
    null_rates: Dict[str, float] = {}

    for dataset in DATASETS:
        csv_path = raw_dir / f"{dataset}_{year}.csv"
        if not csv_path.exists():
            raise PipelineValidationError(f"Missing ingested file for {dataset}: {csv_path}")

        df = pd.read_csv(csv_path, low_memory=False)
        row_counts[dataset] = int(len(df))

        key_col = {
            "rapid_transit_events": "event_time_sec",
            "rapid_transit_headways": "headway_trunk_sec",
            "rapid_transit_travel_times": "travel_time_sec",
            "gtfs_schedules": "stop_id",
        }[dataset]

        if key_col in df.columns:
            null_rates[f"{dataset}.{key_col}"] = _null_rate(df[key_col])
        else:
            null_rates[f"{dataset}.{key_col}"] = 1.0

    return row_counts, null_rates


def validate_clean(year: int, processed_dir: Path) -> Tuple[Dict[str, int], Dict[str, float]]:
    row_counts: Dict[str, int] = {}
    null_rates: Dict[str, float] = {}

    # Events checks
    events_path = processed_dir / f"clean_rapid_transit_events_{year}.parquet"
    if not events_path.exists():
        raise PipelineValidationError(f"Missing cleaned parquet: {events_path}")
    events = pd.read_parquet(events_path)
    row_counts["rapid_transit_events"] = int(len(events))
    null_rates["rapid_transit_events.event_time_sec"] = _null_rate(events.get("event_time_sec", pd.Series(dtype="float64")))
    if null_rates["rapid_transit_events.event_time_sec"] > 0:
        raise PipelineValidationError("Validation failed: clean events contains null event_time_sec values")

    # Headways checks
    headways_path = processed_dir / f"clean_rapid_transit_headways_{year}.parquet"
    if not headways_path.exists():
        raise PipelineValidationError(f"Missing cleaned parquet: {headways_path}")
    headways = pd.read_parquet(headways_path)
    row_counts["rapid_transit_headways"] = int(len(headways))
    trunk = pd.to_numeric(headways.get("headway_trunk_sec", pd.Series(dtype="float64")), errors="coerce")
    null_rates["rapid_transit_headways.headway_trunk_sec"] = _null_rate(trunk)
    if trunk.isna().any() or (trunk < 0).any():
        raise PipelineValidationError("Validation failed: clean headways has null/negative headway_trunk_sec")

    # Travel times checks
    travel_path = processed_dir / f"clean_rapid_transit_travel_times_{year}.parquet"
    if not travel_path.exists():
        raise PipelineValidationError(f"Missing cleaned parquet: {travel_path}")
    travel = pd.read_parquet(travel_path)
    row_counts["rapid_transit_travel_times"] = int(len(travel))
    tsec = pd.to_numeric(travel.get("travel_time_sec", pd.Series(dtype="float64")), errors="coerce")
    null_rates["rapid_transit_travel_times.travel_time_sec"] = _null_rate(tsec)
    if tsec.isna().any():
        raise PipelineValidationError("Validation failed: clean travel times contains null travel_time_sec")
    if "segment_id" not in travel.columns or travel["segment_id"].isna().any():
        raise PipelineValidationError("Validation failed: clean travel times has missing segment_id")

    # GTFS + derived references checks
    gtfs_path = processed_dir / f"clean_gtfs_schedules_{year}.parquet"
    if not gtfs_path.exists():
        raise PipelineValidationError(f"Missing cleaned parquet: {gtfs_path}")
    gtfs = pd.read_parquet(gtfs_path)
    row_counts["gtfs_schedules"] = int(len(gtfs))
    null_rates["gtfs_schedules.stop_id"] = _null_rate(gtfs.get("stop_id", pd.Series(dtype="object")))

    schedule_ref = processed_dir / f"schedule_reference_{year}.parquet"
    station_ref = processed_dir / f"station_reference_{year}.parquet"
    geojson_path = processed_dir / f"mbta_transit_geography_{year}.geojson"
    if not schedule_ref.exists():
        raise PipelineValidationError(f"Missing schedule reference output: {schedule_ref}")
    if not station_ref.exists():
        raise PipelineValidationError(f"Missing station reference output: {station_ref}")
    if not geojson_path.exists():
        raise PipelineValidationError(f"Missing station geography output: {geojson_path}")

    return row_counts, null_rates


def validate_transform(year: int, processed_dir: Path) -> Tuple[Dict[str, int], Dict[str, float]]:
    summary_path = processed_dir / f"summary_{year}.json"
    if not summary_path.exists():
        raise PipelineValidationError(f"Missing transform summary: {summary_path}")

    payload = json.loads(summary_path.read_text(encoding="utf-8"))
    row_counts = payload.get("row_counts", {})

    missing = [dataset for dataset in DATASETS if dataset not in row_counts]
    if missing:
        raise PipelineValidationError(
            "Validation failed: transform summary missing dataset row counts for " + ", ".join(missing)
        )

    normalized = {k: int(v) for k, v in row_counts.items()}

    metric_artifacts = payload.get("metric_artifacts", {})
    for key in METRIC_FILENAMES:
        meta = metric_artifacts.get(key)
        if not isinstance(meta, dict):
            raise PipelineValidationError(f"Validation failed: missing metric artifact metadata for {key}")
        artifact_path = Path(str(meta.get("path", "")))
        if not artifact_path.exists():
            raise PipelineValidationError(f"Validation failed: missing metric artifact output for {key}: {artifact_path}")

    return normalized, {}


def validate_export(year: int, web_data_dir: Path) -> Tuple[Dict[str, int], Dict[str, float]]:
    export_path = web_data_dir / f"dashboard_summary_{year}.json"
    if not export_path.exists():
        raise PipelineValidationError(f"Missing export output: {export_path}")

    payload = json.loads(export_path.read_text(encoding="utf-8"))
    row_counts = payload.get("row_counts", {})

    manifest_path = web_data_dir / f"data_manifest_{year}.json"
    if not manifest_path.exists():
        raise PipelineValidationError(f"Missing export manifest: {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    files = manifest.get("files", [])
    if not isinstance(files, list) or not files:
        raise PipelineValidationError("Validation failed: export manifest has no file entries")

    for entry in files:
        if not isinstance(entry, dict):
            continue
        rel_path = str(entry.get("path", ""))
        if not rel_path:
            continue
        file_path = web_data_dir / rel_path
        if not file_path.exists():
            raise PipelineValidationError(f"Validation failed: manifest file missing on disk: {file_path}")

        fmt = str(entry.get("format", "")).lower()
        if fmt in {"json", "topojson"}:
            gz_path = Path(str(file_path) + ".gz")
            if not gz_path.exists():
                raise PipelineValidationError(f"Validation failed: missing gzip artifact for {file_path}")
            if gz_path.stat().st_size > 2 * 1024 * 1024:
                raise PipelineValidationError(f"Validation failed: gzip artifact exceeds 2MB: {gz_path}")

    budget = manifest.get("performance_budget", {})
    est = budget.get("estimated_full_dashboard_load_seconds_4g")
    if isinstance(est, (float, int)) and est >= 3.0:
        raise PipelineValidationError(
            f"Validation failed: estimated dashboard load exceeds budget (>=3s): {est}"
        )

    return {k: int(v) for k, v in row_counts.items()}, {}
