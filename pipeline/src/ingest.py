"""Download MBTA Open Data CSVs and stage them under data/raw.

This module supports two modes:
1) Sample mode (`--use-samples`): copy CSVs from data/samples for fast local iteration.
2) Full mode (default): discover ArcGIS Hub item IDs, download zip payloads, and
   extract canonical CSV files to data/raw/{dataset}_{year}.csv.

A persistent manifest tracks remote metadata + local checksums so repeated runs can
skip unchanged files.
"""

from __future__ import annotations

import argparse
import json
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zipfile import ZipFile

from common import ensure_dir, read_json, row_count, sha256_file, write_json

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RAW_DIR = REPO_ROOT / "data" / "raw"
DEFAULT_SAMPLE_DIR = REPO_ROOT / "data" / "samples"

ARCGIS_SEARCH_URL = "https://www.arcgis.com/sharing/rest/search"
ARCGIS_ITEM_URL = "https://www.arcgis.com/sharing/rest/content/items/{item_id}"
ARCGIS_DATA_URL = "https://www.arcgis.com/sharing/rest/content/items/{item_id}/data"

MANIFEST_FILENAME = "download_manifest.json"
USER_AGENT = "mbta-viz-ingest/1.0"


@dataclass(frozen=True)
class DatasetSpec:
    key: str
    title_template: str
    fallback_item_id: str
    owner: str = "MBTAHUB_ADMIN"
    type_name: str = "CSV Collection"
    year_specific: bool = True
    filename_hints: tuple[str, ...] = ()


DATASET_SPECS: tuple[DatasetSpec, ...] = (
    DatasetSpec(
        key="rapid_transit_events",
        title_template="MBTA Rapid Transit Events {year}",
        fallback_item_id="e2344a2297004b36b82f57772926ed1a",
        filename_hints=("event",),
    ),
    DatasetSpec(
        key="rapid_transit_headways",
        title_template="MBTA Rapid Transit Headways {year}",
        fallback_item_id="84c9d171d32945f594fbb4d889153c44",
        filename_hints=("headway",),
    ),
    DatasetSpec(
        key="rapid_transit_travel_times",
        title_template="MBTA Rapid Transit Travel Times {year}",
        fallback_item_id="5f71a5c035fc4a4dad1b7fa73ba27ef8",
        filename_hints=("travel",),
    ),
    DatasetSpec(
        key="gtfs_schedules",
        title_template="GTFS Pre-Rating Recaps",
        fallback_item_id="9ab1dc7ea2bf4ad7b7e25cc6b941b39a",
        year_specific=False,
        filename_hints=("gtfs", "recap", "schedule"),
    ),
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fetch_json(url: str, params: Dict[str, str], timeout_sec: int = 30) -> Dict:
    full_url = f"{url}?{urlencode(params)}"
    request = Request(full_url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=timeout_sec) as response:
        return json.loads(response.read().decode("utf-8"))


def _head_headers(url: str, timeout_sec: int = 30) -> Dict[str, str]:
    request = Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=timeout_sec) as response:
        return {k.lower(): v for k, v in response.headers.items()}


def _search_item_id(spec: DatasetSpec, year: int) -> tuple[str, str]:
    title = spec.title_template.format(year=year)
    query = f'title:"{title}" AND owner:{spec.owner} AND type:"{spec.type_name}"'
    params = {"f": "json", "q": query, "num": 10, "sortField": "modified", "sortOrder": "desc"}

    payload = _fetch_json(ARCGIS_SEARCH_URL, params=params, timeout_sec=30)

    results = payload.get("results", [])
    if results:
        item = results[0]
        return str(item["id"]), str(item.get("title") or title)

    if spec.fallback_item_id:
        return spec.fallback_item_id, title

    raise RuntimeError(f"No ArcGIS item found for dataset {spec.key} ({title})")


def _fetch_item_metadata(item_id: str) -> Dict[str, str]:
    payload = _fetch_json(ARCGIS_ITEM_URL.format(item_id=item_id), params={"f": "json"}, timeout_sec=30)
    return {
        "title": str(payload.get("title", "")),
        "name": str(payload.get("name", "")),
        "modified": str(payload.get("modified", "")),
    }


def _head_item_data(item_id: str) -> Dict[str, str]:
    url = ARCGIS_DATA_URL.format(item_id=item_id)
    headers = _head_headers(url, timeout_sec=30)
    return {
        "source_url": url,
        "etag": headers.get("etag", ""),
        "last_modified": headers.get("last-modified", ""),
        "content_length": headers.get("content-length", ""),
        "content_disposition": headers.get("content-disposition", ""),
    }


def _download_zip(item_id: str, destination_zip: Path, timeout_sec: int) -> None:
    url = ARCGIS_DATA_URL.format(item_id=item_id)
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=timeout_sec) as response, destination_zip.open("wb") as f:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)


def _choose_csv_member(spec: DatasetSpec, year: int, members: Iterable) -> str:
    year_text = str(year)
    scored: List[tuple[int, int, str]] = []

    for member in members:
        name = member.filename
        if member.is_dir() or not name.lower().endswith(".csv"):
            continue

        basename = Path(name).name.lower()
        hint_score = sum(5 for hint in spec.filename_hints if hint in basename)
        year_score = 2 if year_text in basename else 0
        scored.append((hint_score + year_score, int(member.file_size), name))

    if not scored:
        raise RuntimeError(f"No CSV file found in downloaded archive for dataset {spec.key}")

    scored.sort(reverse=True)
    return scored[0][2]


def _extract_csv_from_zip(zip_path: Path, spec: DatasetSpec, year: int, destination_csv: Path) -> str:
    with ZipFile(zip_path, "r") as archive:
        member_name = _choose_csv_member(spec, year, archive.infolist())
        with archive.open(member_name) as src, destination_csv.open("wb") as dst:
            shutil.copyfileobj(src, dst)
    return member_name


def _should_skip_download(
    existing_entry: Optional[Dict[str, str]],
    destination_csv: Path,
    item_id: str,
    remote_head: Dict[str, str],
) -> bool:
    if not existing_entry or not destination_csv.exists():
        return False

    if existing_entry.get("item_id") != item_id:
        return False

    checks = ("etag", "last_modified", "content_length")
    for key in checks:
        remote_value = remote_head.get(key, "")
        existing_value = existing_entry.get(key, "")
        if remote_value and existing_value and remote_value != existing_value:
            return False

    if any(remote_head.get(key, "") for key in checks):
        return True

    return False


def _bytes_to_mb(size_bytes: int) -> float:
    return round(size_bytes / (1024 * 1024), 2)


def run_ingest(
    year: int,
    raw_dir: Path,
    sample_dir: Path,
    use_samples: bool,
    *,
    force_download: bool = False,
    timeout_sec: int = 300,
    selected_datasets: Optional[Iterable[str]] = None,
) -> Path:
    ensure_dir(raw_dir)
    ensure_dir(sample_dir)

    selected = set(selected_datasets or [spec.key for spec in DATASET_SPECS])
    specs = [spec for spec in DATASET_SPECS if spec.key in selected]
    if not specs:
        raise ValueError("No datasets selected for ingestion")

    run_manifest = {
        "year": year,
        "generated_at_utc": utc_now_iso(),
        "datasets": {},
    }

    persistent_manifest_path = raw_dir / MANIFEST_FILENAME
    persistent_manifest = read_json(persistent_manifest_path) or {}
    persistent_manifest.setdefault("updated_at_utc", utc_now_iso())
    persistent_manifest.setdefault("datasets", {})

    for spec in specs:
        destination = raw_dir / f"{spec.key}_{year}.csv"
        sample_source = sample_dir / f"{spec.key}_{year}.csv"
        manifest_key = f"{spec.key}:{year}"
        existing_entry = persistent_manifest["datasets"].get(manifest_key)

        result: Dict[str, str | int | float] = {
            "file": str(destination),
            "dataset": spec.key,
        }

        if use_samples and sample_source.exists():
            shutil.copy2(sample_source, destination)
            mode = "copied_sample"
            result.update(
                {
                    "mode": mode,
                    "sample_source": str(sample_source),
                }
            )
        else:
            item_id, resolved_title = _search_item_id(spec, year)
            item_meta = _fetch_item_metadata(item_id)
            remote_head = _head_item_data(item_id)

            result.update(
                {
                    "item_id": item_id,
                    "source_title": resolved_title,
                    "source_item_title": item_meta.get("title", ""),
                    "source_item_name": item_meta.get("name", ""),
                    "source_item_modified": item_meta.get("modified", ""),
                    "source_url": remote_head.get("source_url", ""),
                }
            )

            if not force_download and _should_skip_download(existing_entry, destination, item_id, remote_head):
                mode = "skipped_unchanged"
            else:
                mode = "downloaded"
                with tempfile.TemporaryDirectory(prefix="mbta_ingest_") as tmp_dir:
                    tmp_zip = Path(tmp_dir) / f"{spec.key}_{year}.zip"
                    selected_member = ""
                    _download_zip(item_id, tmp_zip, timeout_sec=timeout_sec)
                    selected_member = _extract_csv_from_zip(tmp_zip, spec, year, destination)
                    result["archive_member"] = selected_member

            result.update(remote_head)

        rows = row_count(destination)
        size_bytes = destination.stat().st_size if destination.exists() else 0
        checksum = sha256_file(destination) if destination.exists() else ""

        result.update(
            {
                "mode": mode,
                "rows": rows,
                "size_bytes": size_bytes,
                "size_mb": _bytes_to_mb(size_bytes),
                "sha256": checksum,
                "updated_at_utc": utc_now_iso(),
            }
        )

        run_manifest["datasets"][spec.key] = result

        persistent_manifest["datasets"][manifest_key] = {
            "year": year,
            "dataset": spec.key,
            "item_id": str(result.get("item_id", "")),
            "mode": mode,
            "source_url": str(result.get("source_url", "")),
            "etag": str(result.get("etag", "")),
            "last_modified": str(result.get("last_modified", "")),
            "content_length": str(result.get("content_length", "")),
            "sha256": checksum,
            "size_bytes": size_bytes,
            "rows": rows,
            "updated_at_utc": str(result.get("updated_at_utc")),
        }

        print(
            f"[{spec.key}] mode={mode} rows={rows} "
            f"size_mb={_bytes_to_mb(size_bytes)} path={destination}"
        )

    persistent_manifest["updated_at_utc"] = utc_now_iso()
    write_json(persistent_manifest_path, persistent_manifest)

    run_manifest_path = raw_dir / f"ingest_manifest_{year}.json"
    write_json(run_manifest_path, run_manifest)
    return run_manifest_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest MBTA datasets from ArcGIS Hub")
    parser.add_argument("--year", type=int, required=True, help="Dataset year to fetch (e.g. 2025)")
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--sample-dir", type=Path, default=DEFAULT_SAMPLE_DIR)
    parser.add_argument("--use-samples", action="store_true", help="Use data/samples/*.csv instead of downloading")
    parser.add_argument("--force-download", action="store_true", help="Re-download even when manifest metadata matches")
    parser.add_argument("--timeout-sec", type=int, default=300)
    parser.add_argument(
        "--datasets",
        nargs="*",
        default=None,
        choices=[spec.key for spec in DATASET_SPECS],
        help="Optional subset of datasets to ingest",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest_path = run_ingest(
        year=args.year,
        raw_dir=args.raw_dir,
        sample_dir=args.sample_dir,
        use_samples=args.use_samples,
        force_download=args.force_download,
        timeout_sec=args.timeout_sec,
        selected_datasets=args.datasets,
    )
    print(f"Wrote ingest manifest: {manifest_path}")


if __name__ == "__main__":
    main()
