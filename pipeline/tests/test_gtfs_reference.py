from pathlib import Path
import sys
import json

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from gtfs_reference import build_gtfs_schedule_reference_and_geography  # noqa: E402


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_gtfs_reference_and_station_geography_outputs(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    processed_dir = tmp_path / "processed"
    raw_dir.mkdir(parents=True)
    processed_dir.mkdir(parents=True)

    year = 2025

    # Stops lookup for station metadata + queryability by stop_name.
    _write(
        raw_dir / f"stops_{year}.csv",
        "stop_id,stop_name,stop_lat,stop_lon\n"
        "oakgrov,Oak Grove,42.436,-71.071\n"
        "dwnxg,Downtown Crossing,42.355,-71.060\n"
        "forhll,Forest Hills,42.300,-71.114\n"
        "pkstrt,Park Street,42.356,-71.062\n",
    )

    # Fall 2023 GTFS snapshot.
    gtfs_2023 = raw_dir / "gtfs_fall_2023"
    _write(
        gtfs_2023 / "trips.txt",
        "route_id,service_id,trip_id,direction_id\n"
        "Orange,WKD,o1,0\n"
        "Orange,WKD,o2,0\n"
        "Red,WKD,r1,0\n",
    )
    _write(
        gtfs_2023 / "stop_times.txt",
        "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
        "o1,08:00:00,08:00:00,oakgrov,1\n"
        "o1,08:05:00,08:05:00,dwnxg,2\n"
        "o1,08:12:00,08:12:00,forhll,3\n"
        "o2,08:06:00,08:06:00,oakgrov,1\n"
        "o2,08:11:00,08:11:00,dwnxg,2\n"
        "o2,08:18:00,08:18:00,forhll,3\n"
        "r1,08:02:00,08:02:00,pkstrt,1\n"
        "r1,08:06:00,08:06:00,dwnxg,2\n",
    )

    # Fall 2024 GTFS snapshot to validate multi-season handling.
    gtfs_2024 = raw_dir / "gtfs_fall_2024"
    _write(
        gtfs_2024 / "trips.txt",
        "route_id,service_id,trip_id,direction_id\n"
        "Orange,WKD,o3,0\n"
        "Orange,WKD,o4,0\n",
    )
    _write(
        gtfs_2024 / "stop_times.txt",
        "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
        "o3,08:10:00,08:10:00,oakgrov,1\n"
        "o3,08:16:00,08:16:00,dwnxg,2\n"
        "o4,08:22:00,08:22:00,oakgrov,1\n"
        "o4,08:28:00,08:28:00,dwnxg,2\n",
    )

    metrics = build_gtfs_schedule_reference_and_geography(
        raw_dir=raw_dir,
        processed_dir=processed_dir,
        year=year,
    )

    ref_parquet = Path(metrics["schedule_reference_parquet"])
    station_parquet = Path(metrics["station_reference_parquet"])
    geojson_path = Path(metrics["geography_geojson"])

    assert ref_parquet.exists()
    assert station_parquet.exists()
    assert geojson_path.exists()

    ref = pd.read_parquet(ref_parquet)
    station = pd.read_parquet(station_parquet)

    # Join keys required by acceptance criteria.
    assert {"route_id", "stop_id", "direction_id"}.issubset(ref.columns)

    # Query example: Orange + Downtown Crossing + AM Peak + Fall 2023.
    query = ref[
        (ref["route_id"] == "Orange")
        & (ref["stop_name"] == "Downtown Crossing")
        & (ref["time_period"] == "AM Peak")
        & (ref["season"] == "Fall 2023")
    ]
    assert not query.empty
    assert float(query["scheduled_headway_sec"].iloc[0]) > 0

    # Multi-season coverage.
    seasons = set(str(s) for s in ref["season"].dropna().unique())
    assert "Fall 2023" in seasons
    assert "Fall 2024" in seasons

    # Transfer station flag for Downtown Crossing (served by Orange + Red in fixture).
    dtx = station[station["stop_id"] == "dwnxg"]
    assert not dtx.empty
    assert bool(dtx["is_transfer_station"].any()) is True

    # Geography GeoJSON includes station points and line paths.
    geo = json.loads(geojson_path.read_text(encoding="utf-8"))
    feature_types = {f.get("properties", {}).get("feature_type") for f in geo.get("features", [])}
    assert "station_point" in feature_types
    assert "line_path" in feature_types


def test_gtfs_reference_synthesizes_geography_when_stop_coords_missing(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    processed_dir = tmp_path / "processed"
    raw_dir.mkdir(parents=True)
    processed_dir.mkdir(parents=True)

    year = 2025
    _write(
        raw_dir / f"gtfs_schedules_{year}.csv",
        "service_date,route_id,trip_id,stop_id,arrival_time,departure_time,stop_sequence,direction_id\n"
        "2025-01-01,Red,t1,stop_001,08:00:00,08:01:00,1,0\n"
        "2025-01-01,Red,t1,stop_002,08:05:00,08:06:00,2,0\n"
        "2025-01-01,Red,t2,stop_001,08:10:00,08:11:00,1,0\n"
        "2025-01-01,Red,t2,stop_002,08:15:00,08:16:00,2,0\n",
    )

    metrics = build_gtfs_schedule_reference_and_geography(
        raw_dir=raw_dir,
        processed_dir=processed_dir,
        year=year,
    )

    assert metrics["station_point_features"] > 0
    assert metrics["line_features"] > 0
    assert metrics["synthetic_coordinate_rows"] > 0
