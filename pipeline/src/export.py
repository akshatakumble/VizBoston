"""Export scaffold for MBTA datasets.

Copies transformed summary output into the frontend data directory.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from common import ensure_dir


def run_export(year: int, processed_dir: Path, web_data_dir: Path) -> Path:
    ensure_dir(web_data_dir)
    source = processed_dir / f"summary_{year}.json"
    destination = web_data_dir / f"dashboard_summary_{year}.json"

    if not source.exists():
        raise FileNotFoundError(
            f"Expected transform output at {source}. Run transform before export."
        )

    shutil.copy2(source, destination)
    return destination


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export MBTA datasets to web app")
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--processed-dir", type=Path, required=True)
    parser.add_argument("--web-data-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    destination = run_export(args.year, args.processed_dir, args.web_data_dir)
    print(f"Exported summary to: {destination}")


if __name__ == "__main__":
    main()
