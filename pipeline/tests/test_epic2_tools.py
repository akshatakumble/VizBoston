from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import create_samples  # noqa: E402
import eda  # noqa: E402


def _write_raw_fixture(path: Path, header: list[str], rows: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        f.write(",".join(header) + "\n")
        for row in rows:
            f.write(",".join(row) + "\n")


def test_create_samples_filters_month_and_routes(tmp_path: Path) -> None:
    year = 2025
    raw_dir = tmp_path / "raw"
    sample_dir = tmp_path / "samples"

    fixtures = {
        "rapid_transit_events": (
            [
                "service_date",
                "route_id",
                "stop_id",
                "trip_id",
                "event_type",
                "event_time_sec",
                "schedule_deviation_sec",
            ],
            [
                ["2025-01-05", "Red", "A", "t1", "ARR", "100", "0"],
                ["2025-01-06", "Orange", "B", "t2", "DEP", "200", "5"],
                ["2025-02-01", "Blue", "C", "t3", "ARR", "300", "10"],
            ],
        ),
        "rapid_transit_headways": (
            [
                "service_date",
                "route_id",
                "stop_id",
                "trip_id",
                "prev_trip_id",
                "headway_trunk_sec",
                "headway_branch_sec",
                "benchmark_headway_sec",
            ],
            [
                ["2025-01-05", "Red", "A", "t1", "p1", "300", "", "300"],
                ["2025-01-06", "Orange", "B", "t2", "p2", "320", "", "300"],
                ["2025-02-01", "Blue", "C", "t3", "p3", "340", "", "300"],
            ],
        ),
        "rapid_transit_travel_times": (
            [
                "service_date",
                "route_id",
                "trip_id",
                "from_stop_id",
                "to_stop_id",
                "travel_time_sec",
                "benchmark_travel_time_sec",
            ],
            [
                ["2025-01-05", "Red", "t1", "A", "B", "240", "220"],
                ["2025-01-06", "Orange", "t2", "B", "C", "260", "220"],
                ["2025-02-01", "Blue", "t3", "C", "D", "500", "220"],
            ],
        ),
        "gtfs_schedules": (
            [
                "service_date",
                "route_id",
                "trip_id",
                "stop_id",
                "arrival_time",
                "departure_time",
                "stop_sequence",
            ],
            [
                ["2025-01-05", "Red", "t1", "A", "08:00:00", "08:01:00", "1"],
                ["2025-01-06", "Orange", "t2", "B", "09:00:00", "09:01:00", "2"],
                ["2025-02-01", "Blue", "t3", "C", "10:00:00", "10:01:00", "3"],
            ],
        ),
    }

    for dataset, (header, rows) in fixtures.items():
        _write_raw_fixture(raw_dir / f"{dataset}_{year}.csv", header, rows)

    manifest_path = create_samples.create_samples(
        year=year,
        raw_dir=raw_dir,
        sample_dir=sample_dir,
        month=1,
        routes=["Red", "Orange"],
        target_rows=10,
        chunksize=2,
    )

    assert manifest_path.exists()
    events_sample = (sample_dir / f"rapid_transit_events_{year}.csv").read_text(encoding="utf-8")
    assert "Blue" not in events_sample


def test_eda_generates_notebooks_and_report(tmp_path: Path) -> None:
    year = 2025
    sample_dir = tmp_path / "samples"
    notebook_dir = tmp_path / "notebooks"
    report_path = tmp_path / "report.md"

    sample_dir.mkdir(parents=True)
    for dataset in [
        "rapid_transit_events",
        "rapid_transit_headways",
        "rapid_transit_travel_times",
        "gtfs_schedules",
    ]:
        (sample_dir / f"{dataset}_{year}.csv").write_text(
            "service_date,route_id,trip_id,direction,direction_id,stop_id,event_type,event_time_sec,schedule_deviation_sec,headway_trunk_sec,headway_branch_sec,travel_time_sec,from_stop_id,to_stop_id,benchmark_headway_sec,benchmark_travel_time_sec,stop_sequence\n"
            "2025-01-01,Red,t1,Outbound,0,A,ARR,100,0,300,,250,A,B,300,240,1\n",
            encoding="utf-8",
        )

    profiles = eda.run_eda(
        year=year,
        raw_dir=tmp_path / "raw",
        sample_dir=sample_dir,
        notebook_dir=notebook_dir,
        report_path=report_path,
        source="samples",
        max_rows=None,
    )

    assert len(profiles) == 4
    assert report_path.exists()
    assert (notebook_dir / f"rapid_transit_events_{year}_eda.ipynb").exists()
