"""Create representative development samples from raw MBTA CSVs.

By default this extracts January rows for Red + Orange lines and writes
`data/samples/{dataset}_{year}.csv` files with up to 10k rows each.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Dict, Iterable, List

import pandas as pd

from common import DATASETS, ensure_dir, write_json

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RAW_DIR = REPO_ROOT / "data" / "raw"
DEFAULT_SAMPLE_DIR = REPO_ROOT / "data" / "samples"


def _filter_chunk(chunk: pd.DataFrame, month: int, routes: set[str]) -> pd.DataFrame:
    mask = pd.Series(True, index=chunk.index)

    if "service_date" in chunk.columns:
        service_dates = pd.to_datetime(chunk["service_date"], errors="coerce")
        mask &= service_dates.dt.month == month

    if "route_id" in chunk.columns:
        mask &= chunk["route_id"].astype(str).isin(routes)

    return chunk.loc[mask]


def _sample_single_dataset(
    dataset: str,
    year: int,
    raw_dir: Path,
    sample_dir: Path,
    month: int,
    routes: set[str],
    target_rows: int,
    chunksize: int,
    max_size_mb: float,
) -> Dict[str, str | int | float]:
    source = raw_dir / f"{dataset}_{year}.csv"
    destination = sample_dir / f"{dataset}_{year}.csv"

    if not source.exists():
        raise FileNotFoundError(
            f"Missing source dataset: {source}. Run ingest for {year} before sampling."
        )

    selected_chunks: List[pd.DataFrame] = []
    selected_count = 0

    for chunk in pd.read_csv(source, chunksize=chunksize, low_memory=False):
        filtered = _filter_chunk(chunk, month=month, routes=routes)
        if filtered.empty:
            continue

        selected_chunks.append(filtered)
        selected_count += len(filtered)
        if selected_count >= target_rows:
            break

    if selected_chunks:
        sample_df = pd.concat(selected_chunks, ignore_index=True).head(target_rows)
        source_mode = "filtered"
    else:
        sample_df = pd.read_csv(source, nrows=target_rows, low_memory=False)
        source_mode = "fallback_head"

    if sample_df.empty:
        # Preserve schema so downstream tests and scripts remain stable.
        header = DATASETS.get(dataset)
        if header:
            sample_df = pd.DataFrame(columns=header)

    sample_df.to_csv(destination, index=False)

    size_bytes = destination.stat().st_size
    size_mb = round(size_bytes / (1024 * 1024), 3)
    if size_mb > max_size_mb:
        raise ValueError(
            f"Sample file {destination} is {size_mb}MB, exceeding limit of {max_size_mb}MB"
        )

    return {
        "dataset": dataset,
        "source": str(source),
        "sample": str(destination),
        "rows": int(len(sample_df)),
        "size_bytes": int(size_bytes),
        "size_mb": size_mb,
        "month": month,
        "routes": sorted(routes),
        "selection_mode": source_mode,
    }


def create_samples(
    year: int,
    raw_dir: Path,
    sample_dir: Path,
    month: int,
    routes: Iterable[str],
    target_rows: int,
    chunksize: int = 200_000,
    max_size_mb: float = 5.0,
) -> Path:
    ensure_dir(sample_dir)
    route_set = {route.strip() for route in routes if route.strip()}

    if not route_set:
        raise ValueError("At least one route must be provided")

    manifest: Dict[str, object] = {
        "year": year,
        "month": month,
        "routes": sorted(route_set),
        "target_rows": target_rows,
        "datasets": {},
    }

    for dataset in DATASETS:
        dataset_stats = _sample_single_dataset(
            dataset=dataset,
            year=year,
            raw_dir=raw_dir,
            sample_dir=sample_dir,
            month=month,
            routes=route_set,
            target_rows=target_rows,
            chunksize=chunksize,
            max_size_mb=max_size_mb,
        )
        manifest["datasets"][dataset] = dataset_stats
        print(
            f"[{dataset}] rows={dataset_stats['rows']} size_mb={dataset_stats['size_mb']} "
            f"mode={dataset_stats['selection_mode']}"
        )

    manifest_path = sample_dir / f"sample_manifest_{year}.json"
    write_json(manifest_path, manifest)
    return manifest_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create development samples from raw MBTA CSV files")
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--sample-dir", type=Path, default=DEFAULT_SAMPLE_DIR)
    parser.add_argument("--month", type=int, default=1, help="Month filter for service_date (1=Jan)")
    parser.add_argument(
        "--routes",
        type=str,
        default="Red,Orange",
        help="Comma-separated route list for filtering (default: Red,Orange)",
    )
    parser.add_argument("--target-rows", type=int, default=10_000)
    parser.add_argument("--chunksize", type=int, default=200_000)
    parser.add_argument("--max-size-mb", type=float, default=5.0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    route_list = [route.strip() for route in args.routes.split(",")]
    manifest_path = create_samples(
        year=args.year,
        raw_dir=args.raw_dir,
        sample_dir=args.sample_dir,
        month=args.month,
        routes=route_list,
        target_rows=args.target_rows,
        chunksize=args.chunksize,
        max_size_mb=args.max_size_mb,
    )
    print(f"Wrote sample manifest: {manifest_path}")


if __name__ == "__main__":
    main()
