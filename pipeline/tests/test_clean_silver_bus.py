from pathlib import Path
import sys

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from clean_silver_bus import clean_silver_bus_observations  # noqa: E402


def test_clean_silver_bus_outputs_events_and_headways(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    processed_dir = tmp_path / "processed"
    raw_dir.mkdir(parents=True)
    processed_dir.mkdir(parents=True)

    year = 2025
    source_csv = raw_dir / f"silver_line_bus_observations_{year}.csv"
    source_csv.write_text(
        "service_date,route_id,direction_id,half_trip_id,stop_id,time_point_id,time_point_order,point_type,standard_type,scheduled,actual,scheduled_headway,headway\n"
        "2025-01-01,SL1,Inbound,,74611,tp1,1,Startpoint,Headway,1900-01-01T08:00:00Z,1900-01-01T08:02:00Z,,600\n"
        "2025-01-01,749,Outbound,h2,74612,tp2,1,Midpoint,Schedule,1900-01-01T09:00:00Z,1900-01-01T08:58:00Z,,\n"
        "2025-01-01,57,Outbound,h3,900,tp3,1,Midpoint,Headway,1900-01-01T10:00:00Z,1900-01-01T10:01:00Z,,500\n",
        encoding="utf-8",
    )

    (raw_dir / f"gtfs_stops_{year}.csv").write_text(
        "stop_id,stop_name\n74611,South Station\n74612,Courthouse\n",
        encoding="utf-8",
    )

    events_parquet = processed_dir / f"clean_silver_line_events_{year}.parquet"
    headways_parquet = processed_dir / f"clean_silver_line_headways_{year}.parquet"
    metrics = clean_silver_bus_observations(
        source_csv=source_csv,
        events_destination_parquet=events_parquet,
        headways_destination_parquet=headways_parquet,
        raw_dir=raw_dir,
        year=year,
    )

    assert metrics["rows_input"] == 3
    assert metrics["rows_after_route_filter"] == 2
    assert metrics["rows_events_output"] == 2
    assert metrics["rows_headways_output"] == 1
    assert metrics["rows_with_null_schedule_deviation"] == 0

    events = pd.read_parquet(events_parquet)
    assert set(events["route_id"]) == {"SL1", "SL5"}
    assert set(events["canonical_stop_name"]) == {"South Station", "Courthouse"}
    assert events["trip_id"].str.len().min() > 0
    assert events.loc[events["route_id"] == "SL1", "trip_id"].iloc[0].startswith("silver_")
    assert int(events.loc[events["route_id"] == "SL1", "event_time_sec"].iloc[0]) == 28920
    assert int(events.loc[events["route_id"] == "SL5", "schedule_deviation_sec"].iloc[0]) == -120

    headways = pd.read_parquet(headways_parquet)
    assert len(headways) == 1
    assert headways.iloc[0]["route_id"] == "SL1"
    assert int(headways.iloc[0]["headway_trunk_sec"]) == 600
    assert int(headways.iloc[0]["event_time_sec"]) == 28920

