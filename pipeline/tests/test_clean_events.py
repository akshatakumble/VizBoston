from pathlib import Path
import sys

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from clean_events import clean_events_dataset  # noqa: E402


def test_clean_events_transforms_and_flags_expected_fields(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    processed_dir = tmp_path / "processed"
    raw_dir.mkdir(parents=True)
    processed_dir.mkdir(parents=True)

    year = 2025
    events_path = raw_dir / f"rapid_transit_events_{year}.csv"
    events_path.write_text(
        "service_date,route_id,stop_id,trip_id,event_type,event_time_sec,schedule_deviation_sec\n"
        "2025-01-01,Red,place-dwnxg,t1,ARR,3600,12\n"
        "2025-01-01,Orange,place-pktrm,t2,DEP,,5\n"
        "2025-01-01,Purple,place-unknown,t3,BAD,7200,0\n"
        "2025-01-01,Orange,place-pktrm,t4,DEP,90000,15\n",
        encoding="utf-8",
    )

    stops_lookup = raw_dir / f"gtfs_stops_{year}.csv"
    stops_lookup.write_text(
        "stop_id,stop_name\n"
        "place-dwnxg,Downtown Crossing\n"
        "place-pktrm,Park Street\n",
        encoding="utf-8",
    )

    output_parquet = processed_dir / f"clean_rapid_transit_events_{year}.parquet"
    output_csv = processed_dir / f"clean_rapid_transit_events_{year}.csv"

    metrics = clean_events_dataset(
        source_csv=events_path,
        destination_parquet=output_parquet,
        destination_csv=output_csv,
        raw_dir=raw_dir,
        year=year,
    )

    assert output_parquet.exists()
    assert output_csv.exists()

    cleaned = pd.read_parquet(output_parquet)

    # Row with null event_time_sec is dropped.
    assert len(cleaned) == 3
    assert cleaned["event_time_sec"].isna().sum() == 0

    # Event/route validation flags are present and accurate.
    assert int((~cleaned["event_type_valid"]).sum()) == 1
    assert int((~cleaned["route_valid"]).sum()) == 1

    # Overnight handling and datetime derivation.
    overnight_row = cleaned.loc[cleaned["trip_id"] == "t4"].iloc[0]
    assert bool(overnight_row["overnight_service"]) is True
    assert str(overnight_row["event_datetime"]) == "2025-01-02 01:00:00"
    assert int(overnight_row["hour_of_day"]) == 1

    # Stop lookup standardization.
    t1_row = cleaned.loc[cleaned["trip_id"] == "t1"].iloc[0]
    assert t1_row["canonical_stop_name"] == "Downtown Crossing"
    t3_row = cleaned.loc[cleaned["trip_id"] == "t3"].iloc[0]
    assert t3_row["canonical_stop_name"] == "place-unknown"

    # Metrics logging fields.
    assert metrics["rows_input"] == 4
    assert metrics["rows_after_drop"] == 3
    assert metrics["rows_dropped_event_time_null"] == 1
    assert metrics["null_event_time_before"] == 1
    assert metrics["null_event_time_after"] == 0
    assert metrics["null_rate_before"] == 0.25
    assert metrics["null_rate_after"] == 0.0


def test_clean_events_uses_gtfs_schedule_as_stop_lookup_fallback(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    processed_dir = tmp_path / "processed"
    raw_dir.mkdir(parents=True)
    processed_dir.mkdir(parents=True)

    year = 2025
    events_path = raw_dir / f"rapid_transit_events_{year}.csv"
    events_path.write_text(
        "service_date,route_id,stop_id,trip_id,event_type,event_time_sec\n"
        "2025-01-01,Red,stop_001,t1,ARR,3600\n"
        "2025-01-01,Orange,stop_002,t2,DEP,4200\n",
        encoding="utf-8",
    )

    # No stops.txt/gtfs_stops file provided.
    (raw_dir / f"gtfs_schedules_{year}.csv").write_text(
        "service_date,route_id,trip_id,stop_id,arrival_time,departure_time,stop_sequence\n"
        "2025-01-01,Red,t1,stop_001,01:00:00,01:01:00,1\n"
        "2025-01-01,Orange,t2,stop_002,01:10:00,01:11:00,2\n",
        encoding="utf-8",
    )

    output_parquet = processed_dir / f"clean_rapid_transit_events_{year}.parquet"
    metrics = clean_events_dataset(
        source_csv=events_path,
        destination_parquet=output_parquet,
        raw_dir=raw_dir,
        year=year,
    )

    assert metrics["stops_lookup_path"] is not None
    assert str(metrics["stops_lookup_path"]).endswith(f"gtfs_schedules_{year}.csv")
    assert metrics["stop_lookup_found_rows"] == 2
