"""Transform scaffold for MBTA datasets.

Creates a small summary artifact that downstream consumers can use.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from common import DATASETS, row_count, write_json


def _dataset_row_count(dataset: str, year: int, processed_dir: Path) -> int:
    if dataset in {
        "rapid_transit_events",
        "rapid_transit_headways",
        "rapid_transit_travel_times",
        "gtfs_schedules",
    }:
        parquet_path = processed_dir / f"clean_{dataset}_{year}.parquet"
        if parquet_path.exists():
            return int(len(pd.read_parquet(parquet_path)))

    clean_csv_path = processed_dir / f"clean_{dataset}_{year}.csv"
    return row_count(clean_csv_path)


def run_transform(year: int, processed_dir: Path) -> Path:
    summary = {"year": year, "row_counts": {}}

    for dataset in DATASETS:
        summary["row_counts"][dataset] = _dataset_row_count(dataset, year, processed_dir)

    out_path = processed_dir / f"summary_{year}.json"
    write_json(out_path, summary)
    return out_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Transform MBTA datasets")
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--processed-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    out_path = run_transform(args.year, args.processed_dir)
    print(f"Wrote transform summary: {out_path}")


if __name__ == "__main__":
    main()
