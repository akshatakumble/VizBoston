from pathlib import Path
import sys

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from clean_travel_times import clean_travel_times_dataset  # noqa: E402


def test_clean_travel_times_flags_slow_zones_and_edge_cases(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    processed_dir = tmp_path / "processed"
    raw_dir.mkdir(parents=True)
    processed_dir.mkdir(parents=True)

    year = 2025
    src = raw_dir / f"rapid_transit_travel_times_{year}.csv"
    src.write_text(
        "service_date,route_id,trip_id,from_stop_id,to_stop_id,travel_time_sec,benchmark_travel_time_sec,event_time_sec\n"
        "2025-01-01,Orange,t1,stop_a,stop_b,400,300,25200\n"  # dev +100 (AM Peak)
        "2025-01-01,Orange,t2,stop_a,stop_b,420,300,25800\n"  # dev +120 (AM Peak)
        "2025-01-01,Orange,t3,stop_b,stop_c,250,260,36000\n"  # dev -10 (Midday)
        "2025-01-01,Orange,t4,stop_x,stop_y,,200,36600\n"     # dropped null travel_time
        "2025-01-01,Orange,t5,stop_c,stop_c,300,,84600\n"     # same origin/destination + missing benchmark
        "2025-01-01,Orange,t6,stop_a,stop_z,200,150,7200\n",   # invalid to_stop + Other
        encoding="utf-8",
    )

    # GTFS stop validation lookup
    (raw_dir / f"gtfs_stops_{year}.csv").write_text(
        "stop_id,stop_name\n"
        "stop_a,Stop A\n"
        "stop_b,Stop B\n"
        "stop_c,Stop C\n",
        encoding="utf-8",
    )

    out_parquet = processed_dir / f"clean_rapid_transit_travel_times_{year}.parquet"
    out_csv = processed_dir / f"clean_rapid_transit_travel_times_{year}.csv"

    metrics = clean_travel_times_dataset(
        source_csv=src,
        destination_parquet=out_parquet,
        destination_csv=out_csv,
        raw_dir=raw_dir,
        year=year,
    )

    assert out_parquet.exists()
    cleaned = pd.read_parquet(out_parquet)

    # Drop null travel_time rows.
    assert len(cleaned) == 5
    assert cleaned["travel_time_sec"].isna().sum() == 0

    # Every row has segment_id.
    assert cleaned["segment_id"].isna().sum() == 0
    assert (cleaned["segment_id"].str.len() > 0).all()

    # Slow zone detection: stop_a-stop_b median deviation = +110 -> flagged.
    slow_zone_rows = cleaned.loc[cleaned["segment_id"] == "stop_a-stop_b", "slow_zone_candidate"]
    assert slow_zone_rows.all()

    # Edge cases requested in acceptance criteria.
    same_stop_row = cleaned.loc[cleaned["trip_id"] == "t5"].iloc[0]
    assert bool(same_stop_row["same_origin_destination"]) is True
    assert pd.isna(same_stop_row["travel_time_deviation_sec"])  # missing benchmark

    # Time period classification same as headways.
    assert cleaned.loc[cleaned["trip_id"] == "t1", "time_period"].iloc[0] == "AM Peak"
    assert cleaned.loc[cleaned["trip_id"] == "t3", "time_period"].iloc[0] == "Midday"
    assert cleaned.loc[cleaned["trip_id"] == "t5", "time_period"].iloc[0] == "Late Night"
    assert cleaned.loc[cleaned["trip_id"] == "t6", "time_period"].iloc[0] == "Other"

    # Stop validation coverage.
    invalid_row = cleaned.loc[cleaned["trip_id"] == "t6"].iloc[0]
    assert bool(invalid_row["segment_stops_valid"]) is False

    assert metrics["rows_input"] == 6
    assert metrics["rows_after_drop"] == 5
    assert metrics["rows_dropped_null_travel_time"] == 1
    assert metrics["slow_zone_segment_count"] == 1
    assert metrics["same_origin_destination_rows"] == 1
    assert metrics["missing_benchmark_rows"] == 1
