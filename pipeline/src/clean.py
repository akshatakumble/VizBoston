"""Clean scaffold for MBTA datasets.

Current behavior performs a deterministic pass-through copy from raw to processed
so orchestration and testing can begin while cleaning logic is implemented.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from common import DATASETS, ensure_dir, row_count, write_json


def run_clean(year: int, raw_dir: Path, processed_dir: Path) -> Path:
    ensure_dir(processed_dir)
    report = {"year": year, "datasets": {}}

    for dataset in DATASETS:
        raw_path = raw_dir / f"{dataset}_{year}.csv"
        clean_path = processed_dir / f"clean_{dataset}_{year}.csv"

        if raw_path.exists():
            shutil.copy2(raw_path, clean_path)
            status = "copied"
            rows = row_count(clean_path)
        else:
            status = "missing_raw"
            rows = 0

        report["datasets"][dataset] = {
            "raw_file": str(raw_path),
            "clean_file": str(clean_path),
            "status": status,
            "rows": rows,
        }

    report_path = processed_dir / f"clean_report_{year}.json"
    write_json(report_path, report)
    return report_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Clean MBTA datasets")
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--processed-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report_path = run_clean(args.year, args.raw_dir, args.processed_dir)
    print(f"Wrote clean report: {report_path}")


if __name__ == "__main__":
    main()
