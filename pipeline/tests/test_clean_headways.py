from pathlib import Path
import sys

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from clean_headways import clean_headways_dataset  # noqa: E402


def test_clean_headways_applies_validation_flags_and_time_periods(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    processed_dir = tmp_path / "processed"
    raw_dir.mkdir(parents=True)
    processed_dir.mkdir(parents=True)

    year = 2025
    headways_path = raw_dir / f"rapid_transit_headways_{year}.csv"
    headways_path.write_text(
        "service_date,route_id,stop_id,trip_id,prev_trip_id,headway_trunk_sec,headway_branch_sec,benchmark_headway_sec,event_time_sec\n"
        "2025-01-01,Red,s1,t1,p0,300,280,240,25200\n"           # AM Peak
        "2025-01-01,Orange,s2,t2,p1,420,,360,36000\n"          # Midday, branch null expected for Orange
        "2025-01-01,Blue,s3,t3,p2,3701,,300,68400\n"           # Evening outlier
        "2025-01-01,Green-B,s4,t4,p3,500,,480,83400\n"         # Late Night, missing expected branch
        "2025-01-01,Blue,s5,t5,p4,300,120,250,21600\n"         # Non-branch route with unexpected branch present
        "2025-01-01,Red,s6,t6,p5,-10,50,60,28800\n"            # Negative trunk -> drop
        "2025-01-01,Orange,s7,t7,p6,,40,60,30600\n"            # Null trunk -> drop
        "2025-01-01,Red,s8,t8,p7,600,580,700,7200\n",          # 02:00 -> Other
        encoding="utf-8",
    )

    output_parquet = processed_dir / f"clean_rapid_transit_headways_{year}.parquet"
    output_csv = processed_dir / f"clean_rapid_transit_headways_{year}.csv"

    metrics = clean_headways_dataset(
        source_csv=headways_path,
        destination_parquet=output_parquet,
        destination_csv=output_csv,
    )

    assert output_parquet.exists()
    assert output_csv.exists()

    cleaned = pd.read_parquet(output_parquet)

    # Trunk null/negative rows are dropped.
    assert len(cleaned) == 6
    assert cleaned["headway_trunk_sec"].isna().sum() == 0
    assert int((cleaned["headway_trunk_sec"] < 0).sum()) == 0

    # Preserve both trunk and branch fields.
    assert "headway_trunk_sec" in cleaned.columns
    assert "headway_branch_sec" in cleaned.columns

    # Branch handling and documentation flags.
    assert int(cleaned["headway_branch_sec"].isna().sum()) == 3
    assert int(cleaned["branch_headway_missing_when_expected"].sum()) == 1
    assert int(cleaned["branch_headway_unexpected_present"].sum()) == 1

    orange_row = cleaned.loc[cleaned["trip_id"] == "t2"].iloc[0]
    assert pd.isna(orange_row["headway_branch_sec"])
    assert float(orange_row["headway_branch_sec_filled"]) == 420.0

    # Outliers are flagged, not dropped.
    outlier_row = cleaned.loc[cleaned["trip_id"] == "t3"].iloc[0]
    assert bool(outlier_row["headway_trunk_outlier"]) is True

    # Deviation and time period classification.
    red_row = cleaned.loc[cleaned["trip_id"] == "t1"].iloc[0]
    assert float(red_row["headway_deviation_sec"]) == 60.0
    assert red_row["time_period"] == "AM Peak"

    assert cleaned.loc[cleaned["trip_id"] == "t2", "time_period"].iloc[0] == "Midday"
    assert cleaned.loc[cleaned["trip_id"] == "t3", "time_period"].iloc[0] == "Evening"
    assert cleaned.loc[cleaned["trip_id"] == "t4", "time_period"].iloc[0] == "Late Night"
    assert cleaned.loc[cleaned["trip_id"] == "t8", "time_period"].iloc[0] == "Other"

    # Metrics include documented branch nulls and outliers.
    assert metrics["rows_input"] == 8
    assert metrics["rows_after_drop"] == 6
    assert metrics["rows_dropped_invalid_trunk"] == 2
    assert metrics["branch_headway_null_rows"] == 3
    assert metrics["outlier_rows"] == 1
