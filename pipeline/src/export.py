"""Export transformed artifacts into frontend-optimized formats (Epic 4.5)."""

from __future__ import annotations

import argparse
import gzip
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from common import ensure_dir

JSON_GZIP_MAX_BYTES = 2 * 1024 * 1024
ASSUMED_4G_BYTES_PER_SEC = 1_000_000  # ~8 Mbps

CSV_DOWNLOAD_CANDIDATES = (
    "station_reference_{year}.csv",
)

DESCRIPTIONS = {
    "dashboard_summary": "Pipeline summary with row counts and metric artifact metadata.",
    "otp_line_daily": "Daily on-time performance percentages by line.",
    "otp_line_station_time_period": "Station-level OTP by line and time period for heatmaps.",
    "otp_line_monthly": "Monthly OTP trends by line.",
    "otp_system_daily": "System-wide daily reliability score.",
    "headway_station_time_month": "Headway regularity metrics by station, time period, month, and day type.",
    "headway_green_branch_month": "Green branch comparison metrics (B/C/D/E) by month.",
    "travel_time_segment_time_period_month": "Travel-time reliability metrics by segment, time period, and month.",
    "travel_time_slow_zones": "Slow-zone candidates based on consecutive high travel time index streaks.",
    "scheduled_vs_actual_line_time_period_season": "Seasonal planned-vs-actual headway/frequency comparison.",
    "service_delivery_line_season": "Service delivery rate by line and season with schedule change indicators.",
    "mbta_transit_geography": "Geographic MBTA station and line data.",
    "station_reference": "Canonical station metadata used for stop ordering and labels in the UI.",
    "data_manifest": "Catalog of export files, sizes, and update timestamps.",
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _file_updated_iso(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()


def _minified_json_bytes(payload: Dict[str, object]) -> bytes:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _write_minified_json(path: Path, payload: Dict[str, object]) -> int:
    ensure_dir(path.parent)
    raw = _minified_json_bytes(payload)
    path.write_bytes(raw)
    return int(len(raw))


def _gzip_bytes(data: bytes, output_path: Path) -> int:
    ensure_dir(output_path.parent)
    compressed = gzip.compress(data, compresslevel=9, mtime=0)
    output_path.write_bytes(compressed)
    return int(len(compressed))


def _gzip_json_file(path: Path, *, max_size_bytes: int = JSON_GZIP_MAX_BYTES) -> int:
    gz_path = path.with_suffix(path.suffix + ".gz")
    data = path.read_bytes()
    gz_size = _gzip_bytes(data, gz_path)
    if gz_size > max_size_bytes:
        raise ValueError(
            f"Gzipped JSON exceeds size limit ({gz_size} > {max_size_bytes} bytes): {gz_path}"
        )
    return gz_size


def _description_for(filename: str) -> str:
    stem = Path(filename).stem
    for key, description in DESCRIPTIONS.items():
        if stem.startswith(key):
            return description
    return "MBTA dashboard data artifact."


def _bbox_from_coordinates(coords: List[List[float]]) -> Optional[List[float]]:
    if not coords:
        return None
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    return [min(xs), min(ys), max(xs), max(ys)]


def _geojson_to_topojson_payload(geojson_payload: Dict[str, object]) -> Dict[str, object]:
    features = geojson_payload.get("features", [])
    if not isinstance(features, list):
        features = []

    arcs: List[List[List[float]]] = []
    points: List[Dict[str, object]] = []
    line_geometries: List[Dict[str, object]] = []
    all_coords: List[List[float]] = []

    for feature in features:
        if not isinstance(feature, dict):
            continue
        geom = feature.get("geometry", {}) or {}
        props = feature.get("properties", {}) or {}
        gtype = geom.get("type")

        if gtype == "Point":
            coordinates = geom.get("coordinates")
            if isinstance(coordinates, list) and len(coordinates) >= 2:
                coord = [float(coordinates[0]), float(coordinates[1])]
                all_coords.append(coord)
                points.append(
                    {
                        "type": "Point",
                        "coordinates": coord,
                        "properties": props,
                    }
                )
            continue

        if gtype == "LineString":
            coords = geom.get("coordinates", [])
            if isinstance(coords, list) and len(coords) >= 2:
                cleaned = [[float(c[0]), float(c[1])] for c in coords if isinstance(c, list) and len(c) >= 2]
                if len(cleaned) >= 2:
                    arc_index = len(arcs)
                    arcs.append(cleaned)
                    all_coords.extend(cleaned)
                    line_geometries.append(
                        {
                            "type": "LineString",
                            "arcs": [arc_index],
                            "properties": props,
                        }
                    )
            continue

    bbox = _bbox_from_coordinates(all_coords)
    topology: Dict[str, object] = {
        "type": "Topology",
        "objects": {
            "station_points": {"type": "GeometryCollection", "geometries": points},
            "line_paths": {"type": "GeometryCollection", "geometries": line_geometries},
        },
        "arcs": arcs,
    }
    if bbox:
        topology["bbox"] = bbox
    return topology


def _copy_and_minify_json(src: Path, dst: Path) -> int:
    payload = json.loads(src.read_text(encoding="utf-8"))
    return _write_minified_json(dst, payload)


def _manifest_entry(
    *,
    path: Path,
    rel_path: str,
    kind: str,
    description: str,
    gzip_size_bytes: Optional[int] = None,
) -> Dict[str, object]:
    return {
        "path": rel_path,
        "file_name": path.name,
        "kind": kind,
        "format": path.suffix.lstrip("."),
        "description": description,
        "size_bytes": int(path.stat().st_size),
        "gzip_size_bytes": gzip_size_bytes,
        "updated_utc": _file_updated_iso(path),
    }


def _prune_stale_exports(year: int, web_data_dir: Path, downloads_dir: Path) -> None:
    expected_downloads = {template.format(year=year) for template in CSV_DOWNLOAD_CANDIDATES}

    for csv_path in downloads_dir.glob(f"*_{year}.csv"):
        if csv_path.name not in expected_downloads:
            csv_path.unlink(missing_ok=True)

    # Frontend consumes TopoJSON; remove stale GeoJSON exports for this year.
    stale_geojson = web_data_dir / f"mbta_transit_geography_{year}.geojson"
    stale_geojson_gz = web_data_dir / f"mbta_transit_geography_{year}.geojson.gz"
    stale_geojson.unlink(missing_ok=True)
    stale_geojson_gz.unlink(missing_ok=True)


def run_export(year: int, processed_dir: Path, web_data_dir: Path) -> Path:
    ensure_dir(web_data_dir)
    downloads_dir = web_data_dir / "downloads"
    ensure_dir(downloads_dir)
    _prune_stale_exports(year=year, web_data_dir=web_data_dir, downloads_dir=downloads_dir)

    source = processed_dir / f"summary_{year}.json"
    destination = web_data_dir / f"dashboard_summary_{year}.json"
    manifest_path = web_data_dir / f"data_manifest_{year}.json"

    if not source.exists():
        raise FileNotFoundError(
            f"Expected transform output at {source}. Run transform before export."
        )

    _copy_and_minify_json(source, destination)
    json_artifacts: List[Path] = [destination]
    manifest_files: List[Dict[str, object]] = []

    payload = json.loads(source.read_text(encoding="utf-8"))
    artifact_map = payload.get("metric_artifacts", {})
    for meta in artifact_map.values():
        if not isinstance(meta, dict):
            continue
        raw_path = meta.get("path")
        if not raw_path:
            continue
        artifact_src = Path(str(raw_path))
        if artifact_src.exists():
            artifact_dst = web_data_dir / artifact_src.name
            _copy_and_minify_json(artifact_src, artifact_dst)
            json_artifacts.append(artifact_dst)

    geojson_src = processed_dir / f"mbta_transit_geography_{year}.geojson"
    if geojson_src.exists():
        geojson_payload = json.loads(geojson_src.read_text(encoding="utf-8"))

        topojson_dst = web_data_dir / f"mbta_transit_geography_{year}.topojson"
        topojson_payload = _geojson_to_topojson_payload(geojson_payload)
        _write_minified_json(topojson_dst, topojson_payload)
        json_artifacts.append(topojson_dst)

    for template in CSV_DOWNLOAD_CANDIDATES:
        csv_src = processed_dir / template.format(year=year)
        if not csv_src.exists():
            continue
        csv_dst = downloads_dir / csv_src.name
        shutil.copy2(csv_src, csv_dst)
        manifest_files.append(
            _manifest_entry(
                path=csv_dst,
                rel_path=str(csv_dst.relative_to(web_data_dir)),
                kind="download_csv",
                description=_description_for(csv_dst.name),
                gzip_size_bytes=None,
            )
        )

    total_dashboard_gzip_bytes = 0
    for json_path in json_artifacts:
        gz_size = _gzip_json_file(json_path, max_size_bytes=JSON_GZIP_MAX_BYTES)
        total_dashboard_gzip_bytes += gz_size
        manifest_files.append(
            _manifest_entry(
                path=json_path,
                rel_path=str(json_path.relative_to(web_data_dir)),
                kind="dashboard_asset",
                description=_description_for(json_path.name),
                gzip_size_bytes=gz_size,
            )
        )

    estimated_load_seconds_4g = round(total_dashboard_gzip_bytes / ASSUMED_4G_BYTES_PER_SEC, 3)
    manifest_payload: Dict[str, object] = {
        "year": year,
        "generated_at_utc": _utc_now_iso(),
        "assumptions": {
            "max_gzipped_json_bytes": JSON_GZIP_MAX_BYTES,
            "assumed_4g_bytes_per_sec": ASSUMED_4G_BYTES_PER_SEC,
        },
        "performance_budget": {
            "total_dashboard_gzip_bytes": total_dashboard_gzip_bytes,
            "estimated_full_dashboard_load_seconds_4g": estimated_load_seconds_4g,
            "target_seconds": 3.0,
            "target_met": estimated_load_seconds_4g < 3.0,
        },
        "files": sorted(manifest_files, key=lambda x: str(x.get("path", ""))),
    }
    _write_minified_json(manifest_path, manifest_payload)
    manifest_gz_size = _gzip_json_file(manifest_path, max_size_bytes=JSON_GZIP_MAX_BYTES)

    # Add manifest entry after manifest file is written.
    manifest_payload["files"].append(
        _manifest_entry(
            path=manifest_path,
            rel_path=manifest_path.name,
            kind="manifest",
            description=DESCRIPTIONS["data_manifest"],
            gzip_size_bytes=manifest_gz_size,
        )
    )
    _write_minified_json(manifest_path, manifest_payload)
    _gzip_json_file(manifest_path, max_size_bytes=JSON_GZIP_MAX_BYTES)

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
