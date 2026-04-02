from pathlib import Path
import json
import sys

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from metric_aggregations import METRIC_FILENAMES  # noqa: E402
from transform import run_transform  # noqa: E402


def test_transform_computes_epic4_metrics_aggregates(tmp_path: Path) -> None:
    year = 2025
    processed_dir = tmp_path / "processed"
    processed_dir.mkdir(parents=True)

    events = pd.DataFrame(
        [
            {
                "service_date": "2025-01-01",
                "route_id": "Red",
                "stop_id": "s1",
                "canonical_stop_name": "Stop One",
                "event_time_sec": 25200,
                "schedule_deviation_sec": 0,
            },
            {
                "service_date": "2025-01-01",
                "route_id": "Red",
                "stop_id": "s1",
                "canonical_stop_name": "Stop One",
                "event_time_sec": 25260,
                "schedule_deviation_sec": -80,
            },
            {
                "service_date": "2025-01-01",
                "route_id": "Red",
                "stop_id": "s1",
                "canonical_stop_name": "Stop One",
                "event_time_sec": 25320,
                "schedule_deviation_sec": 420,
            },
            {
                "service_date": "2025-01-01",
                "route_id": "Green-B",
                "stop_id": "s2",
                "canonical_stop_name": "Stop Two",
                "event_time_sec": 28800,
                "schedule_deviation_sec": 10,
            },
            {
                "service_date": "2025-02-01",
                "route_id": "Mattapan",
                "stop_id": "s3",
                "canonical_stop_name": "Stop Three",
                "event_time_sec": 30000,
                "schedule_deviation_sec": 120,
            },
        ]
    )
    events.to_parquet(processed_dir / f"clean_rapid_transit_events_{year}.parquet", index=False)
    silver_events = pd.DataFrame(
        [
            {
                "service_date": "2025-01-01",
                "route_id": "SL1",
                "stop_id": "s4",
                "trip_id": "silver_t1",
                "event_type": "DEP",
                "event_time_sec": 26100,
                "schedule_deviation_sec": 45,
                "canonical_stop_name": "Silver Stop",
            }
        ]
    )
    silver_events.to_parquet(processed_dir / f"clean_silver_line_events_{year}.parquet", index=False)

    headways = pd.DataFrame(
        [
            {
                "service_date": "2025-01-01",
                "route_id": "Red",
                "stop_id": "s1",
                "headway_trunk_sec": 300,
                "benchmark_headway_sec": 300,
                "time_period": "AM Peak",
            },
            {
                "service_date": "2025-01-01",
                "route_id": "Red",
                "stop_id": "s1",
                "headway_trunk_sec": 600,
                "benchmark_headway_sec": 300,
                "time_period": "AM Peak",
            },
            {
                "service_date": "2025-01-01",
                "route_id": "Green-B",
                "stop_id": "s2",
                "headway_trunk_sec": 120,
                "benchmark_headway_sec": 300,
                "time_period": "PM Peak",
            },
            {
                "service_date": "2025-01-01",
                "route_id": "Green-C",
                "stop_id": "s2",
                "headway_trunk_sec": 180,
                "benchmark_headway_sec": 300,
                "time_period": "PM Peak",
            },
            {
                "service_date": "2025-01-04",
                "route_id": "Orange",
                "stop_id": "s3",
                "headway_trunk_sec": 400,
                "benchmark_headway_sec": 350,
                "time_period": "Evening",
            },
        ]
    )
    headways.to_parquet(processed_dir / f"clean_rapid_transit_headways_{year}.parquet", index=False)
    silver_headways = pd.DataFrame(
        [
            {
                "service_date": "2025-01-01",
                "route_id": "SL1",
                "stop_id": "s4",
                "headway_trunk_sec": 540,
                "benchmark_headway_sec": 600,
                "time_period": "AM Peak",
                "event_time_sec": 26100,
            }
        ]
    )
    silver_headways.to_parquet(processed_dir / f"clean_silver_line_headways_{year}.parquet", index=False)

    travel = pd.DataFrame(
        [
            {
                "service_date": "2025-01-10",
                "route_id": "Red",
                "from_stop_id": "s1",
                "to_stop_id": "s2",
                "travel_time_sec": 300,
                "benchmark_travel_time_sec": 150,
                "time_period": "AM Peak",
            },
            {
                "service_date": "2025-02-10",
                "route_id": "Red",
                "from_stop_id": "s1",
                "to_stop_id": "s2",
                "travel_time_sec": 315,
                "benchmark_travel_time_sec": 150,
                "time_period": "AM Peak",
            },
            {
                "service_date": "2025-03-10",
                "route_id": "Red",
                "from_stop_id": "s1",
                "to_stop_id": "s2",
                "travel_time_sec": 330,
                "benchmark_travel_time_sec": 150,
                "time_period": "AM Peak",
            },
            {
                "service_date": "2025-01-10",
                "route_id": "Red",
                "from_stop_id": "s2",
                "to_stop_id": "s3",
                "travel_time_sec": 180,
                "benchmark_travel_time_sec": 170,
                "time_period": "AM Peak",
            },
        ]
    )
    travel.to_parquet(processed_dir / f"clean_rapid_transit_travel_times_{year}.parquet", index=False)
    gtfs = pd.DataFrame(
        [
            {"service_date": "2025-01-01", "route_id": "Red", "trip_id": "g1", "stop_id": "s1"},
            {"service_date": "2025-01-01", "route_id": "Red", "trip_id": "g2", "stop_id": "s1"},
            {"service_date": "2025-01-02", "route_id": "Red", "trip_id": "g3", "stop_id": "s2"},
        ]
    )
    gtfs.to_parquet(processed_dir / f"clean_gtfs_schedules_{year}.parquet", index=False)

    station_ref = pd.DataFrame(
        [
            {"stop_id": "s1", "stop_name": "Stop One", "latitude": 42.1, "longitude": -71.1},
            {"stop_id": "s2", "stop_name": "Stop Two", "latitude": 42.2, "longitude": -71.2},
            {"stop_id": "s3", "stop_name": "Stop Three", "latitude": 42.3, "longitude": -71.3},
        ]
    )
    station_ref.to_parquet(processed_dir / f"station_reference_{year}.parquet", index=False)

    schedule_reference = pd.DataFrame(
        [
            {
                "season": "Fall 2022",
                "route_id": "Red",
                "time_period": "AM Peak",
                "scheduled_headway_sec": 300,
                "headway_samples": 120,
            },
            {
                "season": "Fall 2023",
                "route_id": "Red",
                "time_period": "AM Peak",
                "scheduled_headway_sec": 360,
                "headway_samples": 110,
            },
            {
                "season": "Fall 2024",
                "route_id": "Red",
                "time_period": "AM Peak",
                "scheduled_headway_sec": 420,
                "headway_samples": 100,
            },
            {
                "season": "Winter 2025",
                "route_id": "Red",
                "time_period": "AM Peak",
                "scheduled_headway_sec": 330,
                "headway_samples": 130,
            },
        ]
    )
    schedule_reference.to_parquet(processed_dir / f"schedule_reference_{year}.parquet", index=False)

    summary_path = run_transform(year=year, processed_dir=processed_dir)
    assert summary_path.exists()

    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    artifacts = summary.get("metric_artifacts", {})
    assert set(METRIC_FILENAMES.keys()).issubset(set(artifacts.keys()))

    for key, meta in artifacts.items():
        p = Path(meta["path"])
        assert p.exists()
        assert p.stat().st_size < 2 * 1024 * 1024

    otp_daily_payload = json.loads(
        Path(artifacts["otp_line_daily"]["path"]).read_text(encoding="utf-8")
    )
    red_day = next(
        r
        for r in otp_daily_payload["records"]
        if r["service_date"] == "2025-01-01" and r["line_id"] == "Red"
    )
    assert red_day["total_events"] == 3
    assert red_day["on_time_events"] == 1
    assert red_day["otp_pct"] == 33.33
    silver_day = next(
        r
        for r in otp_daily_payload["records"]
        if r["service_date"] == "2025-01-01" and r["line_id"] == "Silver"
    )
    assert silver_day["total_events"] == 1
    assert silver_day["otp_pct"] == 100.0

    system_daily_payload = json.loads(
        Path(artifacts["otp_system_daily"]["path"]).read_text(encoding="utf-8")
    )
    system_day = next(r for r in system_daily_payload["records"] if r["service_date"] == "2025-01-01")
    assert system_day["total_events"] == 5
    assert system_day["reliability_score_pct"] == 60.0

    headway_payload = json.loads(
        Path(artifacts["headway_station_time_month"]["path"]).read_text(encoding="utf-8")
    )
    red_headway = next(
        r
        for r in headway_payload["records"]
        if r["month"] == "2025-01"
        and r["line_id"] == "Red"
        and r["route_id"] == "Red"
        and r["stop_id"] == "s1"
        and r["time_period"] == "AM Peak"
        and r["day_type"] == "Weekday"
    )
    assert red_headway["sample_count"] == 2
    assert red_headway["avg_headway_sec"] == 450.0
    assert red_headway["excess_wait_time_sec"] == 150.0
    assert red_headway["bunching_rate_pct"] == 0.0
    silver_headway = next(
        r
        for r in headway_payload["records"]
        if r["line_id"] == "Silver" and r["route_id"] == "SL1"
    )
    assert silver_headway["avg_headway_sec"] == 540.0

    green_branch_payload = json.loads(
        Path(artifacts["headway_green_branch_month"]["path"]).read_text(encoding="utf-8")
    )
    routes = {row["route_id"] for row in green_branch_payload["records"]}
    assert {"Green-B", "Green-C"}.issubset(routes)

    travel_payload = json.loads(
        Path(artifacts["travel_time_segment_time_period_month"]["path"]).read_text(encoding="utf-8")
    )
    slow_segment_month = next(
        r
        for r in travel_payload["records"]
        if r["segment_id"] == "s1-s2" and r["month"] == "2025-01" and r["time_period"] == "AM Peak"
    )
    assert slow_segment_month["travel_time_index"] > 1.5
    assert slow_segment_month["buffer_time_sec"] >= 0
    assert slow_segment_month["from_latitude"] is not None
    assert slow_segment_month["to_longitude"] is not None

    slow_zone_payload = json.loads(
        Path(artifacts["travel_time_slow_zones"]["path"]).read_text(encoding="utf-8")
    )
    slow_zone = next(r for r in slow_zone_payload["records"] if r["segment_id"] == "s1-s2")
    assert slow_zone["slow_zone_candidate"] is True
    assert slow_zone["longest_consecutive_months"] >= 3

    sched_vs_actual_payload = json.loads(
        Path(artifacts["scheduled_vs_actual_line_time_period_season"]["path"]).read_text(encoding="utf-8")
    )
    seasons = {r["season"] for r in sched_vs_actual_payload["records"] if r["line_id"] == "Red"}
    assert {"Fall 2022", "Fall 2023", "Fall 2024"}.issubset(seasons)
    assert any(r["schedule_change_direction"] != "No Change" for r in sched_vs_actual_payload["records"])

    delivery_payload = json.loads(
        Path(artifacts["service_delivery_line_season"]["path"]).read_text(encoding="utf-8")
    )
    delivery_rows = [r for r in delivery_payload["records"] if r["line_id"] == "Red"]
    delivery_seasons = {r["season"] for r in delivery_rows}
    assert {"Fall 2022", "Fall 2023", "Fall 2024"}.issubset(delivery_seasons)
    assert all(r["service_delivery_rate"] is not None for r in delivery_rows)
