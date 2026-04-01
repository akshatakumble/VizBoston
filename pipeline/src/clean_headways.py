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


def _parse_hhmmss_to_seconds(series: pd.Series) -> pd.Series:
    parts = series.astype(str).str.strip().str.split(":", expand=True)
    if parts.shape[1] < 2:
        return pd.Series(float("nan"), index=series.index, dtype="float64")

    hh = pd.to_numeric(parts[0], errors="coerce")
    mm = pd.to_numeric(parts[1], errors="coerce")
    ss = pd.to_numeric(parts[2], errors="coerce") if parts.shape[1] >= 3 else 0
    return hh * 3600 + mm * 60 + ss


def _infer_event_time_from_gtfs(raw_dir: Optional[Path], year: Optional[int]) -> pd.Series:
    if raw_dir is None or year is None:
        return pd.Series(dtype="float64")

    gtfs_path = raw_dir / f"gtfs_schedules_{year}.csv"
    if not gtfs_path.exists():
        return pd.Series(dtype="float64")

    gtfs = pd.read_csv(gtfs_path, low_memory=False)
    if "trip_id" not in gtfs.columns:
        return pd.Series(dtype="float64")

    dep = _parse_hhmmss_to_seconds(gtfs.get("departure_time", pd.Series(pd.NA, index=gtfs.index)))
    arr = _parse_hhmmss_to_seconds(gtfs.get("arrival_time", pd.Series(pd.NA, index=gtfs.index)))
    time_sec = dep.fillna(arr)
    inferred = pd.DataFrame({"trip_id": gtfs["trip_id"].astype(str).str.strip(), "event_time_sec": time_sec})
    inferred = inferred.dropna(subset=["trip_id", "event_time_sec"])
    if inferred.empty:
        return pd.Series(dtype="float64")

    return inferred.groupby("trip_id")["event_time_sec"].median()


def clean_headways_dataset(
    source_csv: Path,
    destination_parquet: Path,
    destination_csv: Optional[Path] = None,
    *,
    raw_dir: Optional[Path] = None,
    year: Optional[int] = None,
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
    inferred_event_rows = 0
    if event_time_numeric.isna().any():
        inferred_by_trip = _infer_event_time_from_gtfs(raw_dir=raw_dir, year=year)
        if not inferred_by_trip.empty and "trip_id" in cleaned.columns:
            trip_ids = cleaned["trip_id"].astype(str).str.strip()
            inferred_values = trip_ids.map(inferred_by_trip)
            fill_mask = event_time_numeric.isna() & inferred_values.notna()
            inferred_event_rows = int(fill_mask.sum())
            event_time_numeric = event_time_numeric.where(~fill_mask, inferred_values)

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
        "inferred_event_time_rows": inferred_event_rows,
        "unknown_time_period_rows": int((cleaned["time_period"] == "Unknown").sum()),
        "time_period_counts": {k: int(v) for k, v in cleaned["time_period"].value_counts(dropna=False).to_dict().items()},
        "output_parquet": str(destination_parquet),
        "output_csv": str(destination_csv) if destination_csv else None,
    }
    return metrics
