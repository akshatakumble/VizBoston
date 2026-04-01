"""Shared helpers and constants for the MBTA pipeline."""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path
from typing import Any, Dict, Iterable

DATASETS = {
    "rapid_transit_events": [
        "service_date",
        "route_id",
        "stop_id",
        "trip_id",
        "event_type",
        "event_time_sec",
        "schedule_deviation_sec",
    ],
    "rapid_transit_headways": [
        "service_date",
        "route_id",
        "stop_id",
        "trip_id",
        "prev_trip_id",
        "headway_trunk_sec",
        "headway_branch_sec",
        "benchmark_headway_sec",
    ],
    "rapid_transit_travel_times": [
        "service_date",
        "route_id",
        "trip_id",
        "from_stop_id",
        "to_stop_id",
        "travel_time_sec",
        "benchmark_travel_time_sec",
    ],
    "gtfs_schedules": [
        "service_date",
        "route_id",
        "trip_id",
        "stop_id",
        "arrival_time",
        "departure_time",
        "stop_sequence",
    ],
}


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def row_count(csv_path: Path) -> int:
    if not csv_path.exists() or csv_path.stat().st_size == 0:
        return 0
    with csv_path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader, None)
        count = 0
        for _ in reader:
            count += 1
    return count


def write_csv_header(path: Path, header: Iterable[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(list(header))


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


def read_json(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            hasher.update(chunk)
    return hasher.hexdigest()
