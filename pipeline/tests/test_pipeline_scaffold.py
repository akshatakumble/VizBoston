from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import clean  # noqa: E402
import export  # noqa: E402
import ingest  # noqa: E402
import transform  # noqa: E402


def test_ingest_creates_manifest_and_files(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    sample_dir = tmp_path / "samples"
    sample_dir.mkdir(parents=True)

    manifest_path = ingest.run_ingest(
        year=2025,
        raw_dir=raw_dir,
        sample_dir=sample_dir,
        use_samples=True,
    )

    assert manifest_path.exists()
    assert (raw_dir / "rapid_transit_events_2025.csv").exists()
    assert (raw_dir / "gtfs_schedules_2025.csv").exists()


def test_clean_transform_export_flow(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    sample_dir = tmp_path / "samples"
    processed_dir = tmp_path / "processed"
    web_data_dir = tmp_path / "web_data"

    ingest.run_ingest(2025, raw_dir, sample_dir, use_samples=False)
    clean_report = clean.run_clean(2025, raw_dir, processed_dir)
    summary_path = transform.run_transform(2025, processed_dir)
    destination = export.run_export(2025, processed_dir, web_data_dir)

    assert clean_report.exists()
    assert summary_path.exists()
    assert destination.exists()
