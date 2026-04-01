"""Ingest scaffold for MBTA datasets.

In sample mode, this script copies files from data/samples when available.
Otherwise, it creates empty CSVs with expected headers so downstream steps can run.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from common import DATASETS, ensure_dir, row_count, write_csv_header, write_json


def run_ingest(year: int, raw_dir: Path, sample_dir: Path, use_samples: bool) -> Path:
    ensure_dir(raw_dir)
    manifest = {"year": year, "datasets": {}}

    for dataset, header in DATASETS.items():
        destination = raw_dir / f"{dataset}_{year}.csv"
        source = sample_dir / f"{dataset}_{year}.csv"

        if use_samples and source.exists():
            shutil.copy2(source, destination)
            mode = "copied_sample"
        elif destination.exists():
            mode = "existing"
        else:
            write_csv_header(destination, header)
            mode = "created_placeholder"

        manifest["datasets"][dataset] = {
            "file": str(destination),
            "mode": mode,
            "rows": row_count(destination),
            "size_bytes": destination.stat().st_size,
        }

    manifest_path = raw_dir / f"ingest_manifest_{year}.json"
    write_json(manifest_path, manifest)
    return manifest_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest MBTA datasets")
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--sample-dir", type=Path, required=True)
    parser.add_argument("--use-samples", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest_path = run_ingest(
        year=args.year,
        raw_dir=args.raw_dir,
        sample_dir=args.sample_dir,
        use_samples=args.use_samples,
    )
    print(f"Wrote ingest manifest: {manifest_path}")


if __name__ == "__main__":
    main()
