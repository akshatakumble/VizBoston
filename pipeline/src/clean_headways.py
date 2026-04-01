"""Cleaning logic for MBTA rapid transit headways dataset (Epic 3.2)."""

from __future__ import annotations

from pathlib import Path
from typing import Dict, Optional

import pandas as pd

from time_periods import classify_time_period

VALID_ROUTES = {
    "Red",
    "Orange",
    "Blue",
    "Green-B",
    "Green-C",
    "Green-D",
    "Green-E",
    "Mattapan",
}

BRANCH_EXPECTED_ROUTES = {"Red", "Green-B", "Green-C", "Green-D", "Green-E"}


def clean_headways_dataset(
    source_csv: Path,
    destination_parquet: Path,
    destination_csv: Optional[Path] = None,
) -> Dict[str, object]:
    if not source_csv.exists():
        raise FileNotFoundError(f"Missing headways source file: {source_csv}")

    df = pd.read_csv(source_csv, low_memory=False)
    rows_input = int(len(df))

    for col in ["service_date", "route_id", "headway_trunk_sec", "headway_branch_sec", "benchmark_headway_sec"]:
        if col not in df.columns:
            df[col] = pd.NA

    if "event_time_sec" not in df.columns:
        df["event_time_sec"] = pd.NA

    df["service_date"] = pd.to_datetime(df["service_date"], errors="coerce").dt.normalize()
    df["route_id"] = df["route_id"].astype(str).str.strip()
    df["route_valid"] = df["route_id"].isin(VALID_ROUTES)

    trunk_numeric = pd.to_numeric(df["headway_trunk_sec"], errors="coerce")
    branch_numeric = pd.to_numeric(df["headway_branch_sec"], errors="coerce")
    benchmark_numeric = pd.to_numeric(df["benchmark_headway_sec"], errors="coerce")

    null_trunk_before = int(trunk_numeric.isna().sum())
    negative_trunk_before = int((trunk_numeric < 0).fillna(False).sum())

    keep_mask = trunk_numeric.notna() & (trunk_numeric >= 0)
    cleaned = df.loc[keep_mask].copy()
    trunk_numeric = trunk_numeric.loc[keep_mask].astype("float64")
    branch_numeric = branch_numeric.loc[keep_mask].astype("float64")
    benchmark_numeric = benchmark_numeric.loc[keep_mask].astype("float64")

    rows_after_drop = int(len(cleaned))
    rows_dropped_invalid_trunk = rows_input - rows_after_drop

    cleaned["headway_trunk_sec"] = trunk_numeric
    cleaned["headway_branch_sec"] = branch_numeric
    cleaned["benchmark_headway_sec"] = benchmark_numeric

    cleaned["branch_headway_expected"] = cleaned["route_id"].isin(BRANCH_EXPECTED_ROUTES)
    cleaned["branch_headway_missing_when_expected"] = (
        cleaned["branch_headway_expected"] & cleaned["headway_branch_sec"].isna()
    )
    cleaned["branch_headway_unexpected_present"] = (
        ~cleaned["branch_headway_expected"] & cleaned["headway_branch_sec"].notna()
    )

    # Non-branch routes often have NULL branch headways; fill for convenience while retaining original values.
    cleaned["headway_branch_sec_filled"] = cleaned["headway_branch_sec"]
    fill_mask = (~cleaned["branch_headway_expected"]) & cleaned["headway_branch_sec_filled"].isna()
    cleaned.loc[fill_mask, "headway_branch_sec_filled"] = cleaned.loc[fill_mask, "headway_trunk_sec"]

    cleaned["headway_trunk_outlier"] = cleaned["headway_trunk_sec"] > 3600
    cleaned["headway_deviation_sec"] = cleaned["headway_trunk_sec"] - cleaned["benchmark_headway_sec"]

    event_time_numeric = pd.to_numeric(cleaned["event_time_sec"], errors="coerce")
    cleaned["event_time_sec"] = event_time_numeric.astype("Int64")
    cleaned["hour_of_day"] = (event_time_numeric // 3600) % 24
    cleaned["hour_of_day"] = cleaned["hour_of_day"].astype("Int64")
    cleaned["overnight_service"] = event_time_numeric > 86400
    cleaned["event_datetime"] = cleaned["service_date"] + pd.to_timedelta(event_time_numeric, unit="s")

    cleaned["time_period"] = "Unknown"
    has_time = event_time_numeric.notna()
    if has_time.any():
        cleaned.loc[has_time, "time_period"] = classify_time_period(
            event_time_numeric.loc[has_time].astype("int64")
        )

    destination_parquet.parent.mkdir(parents=True, exist_ok=True)
    cleaned.to_parquet(destination_parquet, index=False)

    if destination_csv is not None:
        destination_csv.parent.mkdir(parents=True, exist_ok=True)
        cleaned.to_csv(destination_csv, index=False)

    metrics: Dict[str, object] = {
        "rows_input": rows_input,
        "rows_after_drop": rows_after_drop,
        "rows_dropped_invalid_trunk": rows_dropped_invalid_trunk,
        "null_headway_trunk_before": null_trunk_before,
        "negative_headway_trunk_before": negative_trunk_before,
        "null_headway_trunk_after": int(cleaned["headway_trunk_sec"].isna().sum()),
        "branch_headway_null_rows": int(cleaned["headway_branch_sec"].isna().sum()),
        "branch_headway_missing_when_expected_rows": int(cleaned["branch_headway_missing_when_expected"].sum()),
        "branch_headway_unexpected_present_rows": int(cleaned["branch_headway_unexpected_present"].sum()),
        "outlier_rows": int(cleaned["headway_trunk_outlier"].sum()),
        "time_period_counts": {k: int(v) for k, v in cleaned["time_period"].value_counts(dropna=False).to_dict().items()},
        "output_parquet": str(destination_parquet),
        "output_csv": str(destination_csv) if destination_csv else None,
    }
    return metrics
