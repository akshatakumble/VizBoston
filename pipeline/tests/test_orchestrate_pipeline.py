from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from orchestrate import run_pipeline  # noqa: E402
from validate_pipeline import PipelineValidationError  # noqa: E402
from metric_aggregations import METRIC_FILENAMES  # noqa: E402


def _sha(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _prepare_minimal_pipeline_fixture(base: Path, year: int) -> tuple[Path, Path, Path, Path, Path]:
    raw_dir = base / "raw"
    sample_dir = base / "samples"
    processed_dir = base / "processed"
    web_data_dir = base / "web_data"
    log_dir = base / "logs"

    raw_dir.mkdir(parents=True, exist_ok=True)
    sample_dir.mkdir(parents=True, exist_ok=True)
    processed_dir.mkdir(parents=True, exist_ok=True)
    web_data_dir.mkdir(parents=True, exist_ok=True)
    log_dir.mkdir(parents=True, exist_ok=True)

    # Stops lookup kept in raw dir so clean steps can validate stop ids.
    _write(
        raw_dir / f"stops_{year}.csv",
        "stop_id,stop_name,stop_lat,stop_lon\n"
        "s1,Stop One,42.1,-71.1\n"
        "s2,Stop Two,42.2,-71.2\n",
    )

    _write(
        sample_dir / f"rapid_transit_events_{year}.csv",
        "service_date,route_id,stop_id,trip_id,event_type,event_time_sec,schedule_deviation_sec\n"
        "2025-01-01,Red,s1,e1,ARR,25200,0\n",
    )
    _write(
        sample_dir / f"rapid_transit_headways_{year}.csv",
        "service_date,route_id,stop_id,trip_id,prev_trip_id,headway_trunk_sec,headway_branch_sec,benchmark_headway_sec,event_time_sec\n"
        "2025-01-01,Orange,s1,h1,h0,300,,240,25200\n",
    )
    _write(
        sample_dir / f"rapid_transit_travel_times_{year}.csv",
        "service_date,route_id,trip_id,from_stop_id,to_stop_id,travel_time_sec,benchmark_travel_time_sec,event_time_sec\n"
        "2025-01-01,Orange,t1,s1,s2,300,240,25200\n",
    )
    _write(
        sample_dir / f"gtfs_schedules_{year}.csv",
        "service_date,route_id,trip_id,stop_id,arrival_time,departure_time,stop_sequence,direction_id\n"
        "2025-01-01,Orange,g1,s1,08:00:00,08:00:00,1,0\n"
        "2025-01-01,Orange,g2,s1,08:05:00,08:05:00,1,0\n"
        "2025-01-01,Orange,g1,s2,08:06:00,08:06:00,2,0\n"
        "2025-01-01,Orange,g2,s2,08:11:00,08:11:00,2,0\n",
    )

    return raw_dir, sample_dir, processed_dir, web_data_dir, log_dir


def test_pipeline_all_is_idempotent_for_core_outputs(tmp_path: Path) -> None:
    year = 2025
    raw_dir, sample_dir, processed_dir, web_data_dir, log_dir = _prepare_minimal_pipeline_fixture(tmp_path, year)

    run_pipeline(
        step="all",
        year=year,
        raw_dir=raw_dir,
        sample_dir=sample_dir,
        processed_dir=processed_dir,
        web_data_dir=web_data_dir,
        use_samples=True,
        log_dir=log_dir,
        timeout_sec=60,
    )

    tracked = [
        processed_dir / f"clean_rapid_transit_events_{year}.parquet",
        processed_dir / f"clean_rapid_transit_headways_{year}.parquet",
        processed_dir / f"clean_rapid_transit_travel_times_{year}.parquet",
        processed_dir / f"clean_gtfs_schedules_{year}.parquet",
        processed_dir / f"schedule_reference_{year}.parquet",
        processed_dir / f"station_reference_{year}.parquet",
        processed_dir / f"mbta_transit_geography_{year}.geojson",
        processed_dir / f"summary_{year}.json",
        web_data_dir / f"dashboard_summary_{year}.json",
    ]
    tracked.extend(processed_dir / name.format(year=year) for name in METRIC_FILENAMES.values())
    tracked.extend(web_data_dir / name.format(year=year) for name in METRIC_FILENAMES.values())

    first_hashes = {str(p): _sha(p) for p in tracked}

    run_pipeline(
        step="all",
        year=year,
        raw_dir=raw_dir,
        sample_dir=sample_dir,
        processed_dir=processed_dir,
        web_data_dir=web_data_dir,
        use_samples=True,
        log_dir=log_dir,
        timeout_sec=60,
    )

    second_hashes = {str(p): _sha(p) for p in tracked}
    assert first_hashes == second_hashes


def test_validation_failure_halts_pipeline_with_clear_error(tmp_path: Path) -> None:
    year = 2025
    raw_dir = tmp_path / "raw"
    sample_dir = tmp_path / "samples"
    processed_dir = tmp_path / "processed"
    web_data_dir = tmp_path / "web_data"
    log_dir = tmp_path / "logs"

    raw_dir.mkdir(parents=True)
    sample_dir.mkdir(parents=True)
    processed_dir.mkdir(parents=True)
    web_data_dir.mkdir(parents=True)
    log_dir.mkdir(parents=True)

    # Intentionally omit rapid_transit_events_{year}.csv so clean validation fails.
    _write(raw_dir / f"rapid_transit_headways_{year}.csv", "service_date\n2025-01-01\n")
    _write(raw_dir / f"rapid_transit_travel_times_{year}.csv", "service_date\n2025-01-01\n")
    _write(raw_dir / f"gtfs_schedules_{year}.csv", "service_date\n2025-01-01\n")

    try:
        run_pipeline(
            step="clean",
            year=year,
            raw_dir=raw_dir,
            sample_dir=sample_dir,
            processed_dir=processed_dir,
            web_data_dir=web_data_dir,
            use_samples=False,
            log_dir=log_dir,
            timeout_sec=60,
        )
        raise AssertionError("Expected validation failure")
    except PipelineValidationError as exc:
        assert "Missing cleaned parquet" in str(exc)

    log_path = log_dir / "pipeline_steps.jsonl"
    assert log_path.exists()
    last = json.loads(log_path.read_text(encoding="utf-8").strip().splitlines()[-1])
    assert last["status"] == "failed"
    assert "Missing cleaned parquet" in last["error"]
