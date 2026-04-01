"""Transform scaffold for MBTA datasets.

Creates a small summary artifact that downstream consumers can use.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from common import DATASETS, row_count, write_json


def run_transform(year: int, processed_dir: Path) -> Path:
    summary = {"year": year, "row_counts": {}}

    for dataset in DATASETS:
        clean_path = processed_dir / f"clean_{dataset}_{year}.csv"
        summary["row_counts"][dataset] = row_count(clean_path)

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
