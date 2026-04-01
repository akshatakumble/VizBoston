from pathlib import Path
import sys
import json

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import clean  # noqa: E402
import export  # noqa: E402
import ingest  # noqa: E402
import transform  # noqa: E402
from common import DATASETS, write_json  # noqa: E402
from metric_aggregations import METRIC_FILENAMES  # noqa: E402


def _write_minimal_samples(sample_dir: Path, year: int) -> None:
    sample_dir.mkdir(parents=True, exist_ok=True)
    for dataset, header in DATASETS.items():
        sample_file = sample_dir / f"{dataset}_{year}.csv"
        sample_file.write_text(
            ",".join(header) + "\n" + ",".join(["x"] * len(header)) + "\n",
            encoding="utf-8",
        )


def test_ingest_uses_samples_by_default(tmp_path: Path) -> None:
    year = 2025
    raw_dir = tmp_path / "raw"
    sample_dir = tmp_path / "samples"
    _write_minimal_samples(sample_dir, year)

    manifest_path = ingest.run_ingest(
        year=year,
        raw_dir=raw_dir,
        sample_dir=sample_dir,
        use_samples=True,
    )

    assert manifest_path.exists()
    for dataset in DATASETS:
        assert (raw_dir / f"{dataset}_{year}.csv").exists()
    # GTFS sample mode materializes synthetic historical recap files when none are provided.
    assert (raw_dir / "gtfs_schedules_2024.csv").exists()


def test_ingest_skips_unchanged_download_when_manifest_matches(tmp_path: Path, monkeypatch) -> None:
    year = 2025
    raw_dir = tmp_path / "raw"
    sample_dir = tmp_path / "samples"
    raw_dir.mkdir(parents=True)
    sample_dir.mkdir(parents=True)

    destination = raw_dir / f"rapid_transit_events_{year}.csv"
    destination.write_text("service_date\n2025-01-01\n", encoding="utf-8")

    write_json(
        raw_dir / "download_manifest.json",
        {
            "updated_at_utc": "2026-01-01T00:00:00+00:00",
            "datasets": {
                f"rapid_transit_events:{year}": {
                    "item_id": "item-123",
                    "etag": "abc",
                    "last_modified": "Mon, 01 Jan 2026 00:00:00 GMT",
                    "content_length": "20",
                }
            },
        },
    )

    monkeypatch.setattr(ingest, "_search_item_id", lambda *_args, **_kwargs: ("item-123", "Events"))
    monkeypatch.setattr(
        ingest,
        "_fetch_item_metadata",
        lambda *_args, **_kwargs: {"title": "Events", "name": "events.zip", "modified": "1"},
    )
    monkeypatch.setattr(
        ingest,
        "_head_item_data",
        lambda *_args, **_kwargs: {
            "source_url": "https://example.com/item-123/data",
            "etag": "abc",
            "last_modified": "Mon, 01 Jan 2026 00:00:00 GMT",
            "content_length": "20",
            "content_disposition": "attachment; filename=events.zip",
        },
    )

    def _unexpected_download(*_args, **_kwargs):
        raise AssertionError("Download should have been skipped")

    monkeypatch.setattr(ingest, "_download_zip", _unexpected_download)

    manifest_path = ingest.run_ingest(
        year=year,
        raw_dir=raw_dir,
        sample_dir=sample_dir,
        use_samples=False,
        selected_datasets=["rapid_transit_events"],
    )

    assert manifest_path.exists()


def test_clean_transform_export_flow_uses_sample_ingest(tmp_path: Path) -> None:
    year = 2025
    raw_dir = tmp_path / "raw"
    sample_dir = tmp_path / "samples"
    processed_dir = tmp_path / "processed"
    web_data_dir = tmp_path / "web_data"

    _write_minimal_samples(sample_dir, year)
    ingest.run_ingest(year, raw_dir, sample_dir, use_samples=True)
    clean_report = clean.run_clean(year, raw_dir, processed_dir)
    summary_path = transform.run_transform(year, processed_dir)
    destination = export.run_export(year, processed_dir, web_data_dir)

    assert clean_report.exists()
    assert summary_path.exists()
    assert destination.exists()

    summary_payload = json.loads(summary_path.read_text(encoding="utf-8"))
    assert "metric_artifacts" in summary_payload
    for key in METRIC_FILENAMES:
        assert key in summary_payload["metric_artifacts"]
        metric_path = Path(summary_payload["metric_artifacts"][key]["path"])
        assert metric_path.exists()
        assert (web_data_dir / metric_path.name).exists()
        assert (web_data_dir / f"{metric_path.name}.gz").exists()

    manifest_path = web_data_dir / f"data_manifest_{year}.json"
    assert manifest_path.exists()
    assert (web_data_dir / f"data_manifest_{year}.json.gz").exists()
    manifest_payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert "files" in manifest_payload
    assert isinstance(manifest_payload["files"], list)
    assert manifest_payload["files"]
    assert "performance_budget" in manifest_payload
    assert manifest_payload["performance_budget"]["target_met"] is True

    topojson_path = web_data_dir / f"mbta_transit_geography_{year}.topojson"
    assert topojson_path.exists()
    assert (web_data_dir / f"mbta_transit_geography_{year}.topojson.gz").exists()
    assert (web_data_dir / "downloads").exists()

    report_payload = json.loads(clean_report.read_text(encoding="utf-8"))
    events_report = report_payload["datasets"]["rapid_transit_events"]
    assert events_report["status"] == "cleaned"
    assert "metrics" in events_report
    assert Path(events_report["clean_parquet_file"]).exists()

    headways_report = report_payload["datasets"]["rapid_transit_headways"]
    assert headways_report["status"] == "cleaned"
    assert "metrics" in headways_report
    assert Path(headways_report["clean_parquet_file"]).exists()

    travel_report = report_payload["datasets"]["rapid_transit_travel_times"]
    assert travel_report["status"] == "cleaned"
    assert "metrics" in travel_report
    assert Path(travel_report["clean_parquet_file"]).exists()

    gtfs_report = report_payload["datasets"]["gtfs_schedules"]
    assert gtfs_report["status"] == "cleaned"
    assert "metrics" in gtfs_report
    assert Path(gtfs_report["clean_parquet_file"]).exists()
