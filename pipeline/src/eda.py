"""Generate exploratory dataset profiles, notebooks, and a quality report."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, Optional

import nbformat
import pandas as pd

from common import DATASETS, ensure_dir

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RAW_DIR = REPO_ROOT / "data" / "raw"
DEFAULT_SAMPLE_DIR = REPO_ROOT / "data" / "samples"
DEFAULT_NOTEBOOK_DIR = REPO_ROOT / "pipeline" / "notebooks"
DEFAULT_REPORT_PATH = REPO_ROOT / "docs" / "data_quality_report.md"


@dataclass(frozen=True)
class AnalysisConfig:
    key_fields: tuple[str, ...]
    notebook_title: str


ANALYSIS_CONFIG: Dict[str, AnalysisConfig] = {
    "rapid_transit_events": AnalysisConfig(
        key_fields=("route_id", "direction", "event_type", "stop_id"),
        notebook_title="EDA - Rapid Transit Events",
    ),
    "rapid_transit_headways": AnalysisConfig(
        key_fields=("route_id", "direction", "stop_id"),
        notebook_title="EDA - Rapid Transit Headways",
    ),
    "rapid_transit_travel_times": AnalysisConfig(
        key_fields=("route_id", "direction", "from_stop_id", "to_stop_id"),
        notebook_title="EDA - Rapid Transit Travel Times",
    ),
    "gtfs_schedules": AnalysisConfig(
        key_fields=("route_id", "direction_id", "stop_id"),
        notebook_title="EDA - GTFS Schedules",
    ),
}


def _safe_to_numeric(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce")


def _compute_outlier_count(dataset: str, df: pd.DataFrame) -> int:
    if df.empty:
        return 0

    if dataset == "rapid_transit_events":
        outlier_mask = pd.Series(False, index=df.index)
        if "event_time_sec" in df.columns:
            event_time = _safe_to_numeric(df["event_time_sec"])
            outlier_mask |= (event_time < 0) | (event_time > 172800)
        if "schedule_deviation_sec" in df.columns:
            deviation = _safe_to_numeric(df["schedule_deviation_sec"])
            outlier_mask |= deviation.abs() > 3600
        return int(outlier_mask.sum())

    if dataset == "rapid_transit_headways":
        outlier_mask = pd.Series(False, index=df.index)
        if "headway_trunk_sec" in df.columns:
            trunk = _safe_to_numeric(df["headway_trunk_sec"])
            outlier_mask |= (trunk < 0) | (trunk > 3600)
        if "headway_branch_sec" in df.columns:
            branch = _safe_to_numeric(df["headway_branch_sec"])
            outlier_mask |= (branch < 0) | (branch > 3600)
        return int(outlier_mask.sum())

    if dataset == "rapid_transit_travel_times":
        if "travel_time_sec" not in df.columns:
            return 0
        travel = _safe_to_numeric(df["travel_time_sec"])
        return int(((travel < 0) | (travel > 7200)).sum())

    if dataset == "gtfs_schedules":
        if "stop_sequence" not in df.columns:
            return 0
        seq = _safe_to_numeric(df["stop_sequence"])
        return int((seq <= 0).sum())

    return 0


def _date_coverage(df: pd.DataFrame) -> Dict[str, object]:
    if "service_date" not in df.columns or df.empty:
        return {"date_min": None, "date_max": None, "missing_dates": []}

    parsed_dates = pd.to_datetime(df["service_date"], errors="coerce").dropna().dt.normalize()
    if parsed_dates.empty:
        return {"date_min": None, "date_max": None, "missing_dates": []}

    date_min = parsed_dates.min()
    date_max = parsed_dates.max()
    full_range = pd.date_range(date_min, date_max, freq="D")
    seen = pd.DatetimeIndex(parsed_dates.unique()).normalize()
    missing = [d.strftime("%Y-%m-%d") for d in full_range.difference(seen)]

    return {
        "date_min": date_min.strftime("%Y-%m-%d"),
        "date_max": date_max.strftime("%Y-%m-%d"),
        "missing_dates": missing,
    }


def _value_distributions(df: pd.DataFrame, columns: Iterable[str], limit: int = 10) -> Dict[str, Dict[str, int]]:
    distributions: Dict[str, Dict[str, int]] = {}
    for col in columns:
        if col not in df.columns:
            continue
        counts = df[col].astype(str).fillna("<NA>").value_counts(dropna=False).head(limit)
        distributions[col] = {str(idx): int(val) for idx, val in counts.items()}
    return distributions


def _green_line_coverage(df: pd.DataFrame) -> Dict[str, float | int]:
    if "route_id" not in df.columns or df.empty:
        return {"green_rows": 0, "green_pct": 0.0}

    route_ids = df["route_id"].astype(str)
    green_rows = int(route_ids.str.startswith("Green", na=False).sum())
    green_pct = round((green_rows / len(df)) * 100, 3) if len(df) else 0.0
    return {"green_rows": green_rows, "green_pct": green_pct}


def analyze_dataset(dataset: str, csv_path: Path, max_rows: Optional[int] = None) -> Dict[str, object]:
    if not csv_path.exists():
        raise FileNotFoundError(f"Missing dataset for EDA: {csv_path}")

    df = pd.read_csv(csv_path, low_memory=False, nrows=max_rows)

    dtypes = {col: str(dtype) for col, dtype in df.dtypes.items()}
    null_rates = ((df.isna().mean() * 100).round(3)).to_dict() if len(df.columns) else {}

    config = ANALYSIS_CONFIG[dataset]
    distributions = _value_distributions(df, config.key_fields)
    date_info = _date_coverage(df)
    outlier_count = _compute_outlier_count(dataset, df)
    green_coverage = _green_line_coverage(df)

    return {
        "dataset": dataset,
        "csv_path": str(csv_path),
        "rows": int(len(df)),
        "columns": int(len(df.columns)),
        "dtypes": dtypes,
        "null_rates_pct": null_rates,
        "value_distributions": distributions,
        "date_min": date_info["date_min"],
        "date_max": date_info["date_max"],
        "missing_dates": date_info["missing_dates"],
        "outlier_count": outlier_count,
        "green_rows": green_coverage["green_rows"],
        "green_pct": green_coverage["green_pct"],
    }


def _dict_to_table_lines(payload: Dict[str, object], limit: int = 20) -> str:
    items = list(payload.items())[:limit]
    if not items:
        return "(none)"
    return "\n".join(f"- {k}: {v}" for k, v in items)


def _build_notebook(profile: Dict[str, object], notebook_path: Path, title: str) -> None:
    missing_dates = profile["missing_dates"][:20]

    summary_text = (
        f"Dataset: {profile['dataset']}\n"
        f"Source: {profile['csv_path']}\n"
        f"Rows: {profile['rows']}\n"
        f"Columns: {profile['columns']}\n"
        f"Date Range: {profile['date_min']} -> {profile['date_max']}\n"
        f"Missing Dates Count: {len(profile['missing_dates'])}\n"
        f"Outlier Count: {profile['outlier_count']}\n"
        f"Green Line Rows: {profile['green_rows']} ({profile['green_pct']}%)\n"
    )

    dtypes_text = _dict_to_table_lines(profile["dtypes"], limit=80)
    nulls_text = _dict_to_table_lines(profile["null_rates_pct"], limit=80)

    dist_blocks = []
    for col, dist in profile["value_distributions"].items():
        dist_blocks.append(f"{col}:\n" + _dict_to_table_lines(dist, limit=15))
    distribution_text = "\n\n".join(dist_blocks) if dist_blocks else "(none)"

    missing_text = "\n".join(f"- {d}" for d in missing_dates) if missing_dates else "- none"

    nb = nbformat.v4.new_notebook()
    nb.cells = [
        nbformat.v4.new_markdown_cell(f"# {title}"),
        nbformat.v4.new_markdown_cell(
            "This notebook profiles raw MBTA data for row counts, dtypes, null rates, "
            "value distributions, date coverage, outliers, and Green Line coverage."
        ),
        nbformat.v4.new_code_cell(
            source="# Generated profile summary\nprint('Dataset profile complete')",
            execution_count=1,
            outputs=[nbformat.v4.new_output("stream", name="stdout", text=summary_text)],
        ),
        nbformat.v4.new_code_cell(
            source="# Column dtypes\nprint('See saved output')",
            execution_count=2,
            outputs=[nbformat.v4.new_output("stream", name="stdout", text=dtypes_text + "\n")],
        ),
        nbformat.v4.new_code_cell(
            source="# Null rates (%)\nprint('See saved output')",
            execution_count=3,
            outputs=[nbformat.v4.new_output("stream", name="stdout", text=nulls_text + "\n")],
        ),
        nbformat.v4.new_code_cell(
            source="# Key value distributions\nprint('See saved output')",
            execution_count=4,
            outputs=[nbformat.v4.new_output("stream", name="stdout", text=distribution_text + "\n")],
        ),
        nbformat.v4.new_code_cell(
            source="# Missing service dates (first 20)\nprint('See saved output')",
            execution_count=5,
            outputs=[nbformat.v4.new_output("stream", name="stdout", text=missing_text + "\n")],
        ),
    ]

    ensure_dir(notebook_path.parent)
    with notebook_path.open("w", encoding="utf-8") as f:
        nbformat.write(nb, f)


def _write_quality_report(report_path: Path, year: int, profiles: Dict[str, Dict[str, object]], source_label: str) -> None:
    ensure_dir(report_path.parent)

    lines = [
        "# Data Quality Report",
        "",
        f"Year: {year}",
        f"Source: {source_label}",
        "",
        "| Dataset | Rows | Columns | Date Range | Missing Service Dates | Outliers | Green Line Coverage |",
        "|---|---:|---:|---|---:|---:|---:|",
    ]

    for dataset, profile in profiles.items():
        date_range = f"{profile['date_min']} to {profile['date_max']}" if profile["date_min"] else "N/A"
        lines.append(
            "| "
            f"{dataset} | {profile['rows']} | {profile['columns']} | {date_range} | "
            f"{len(profile['missing_dates'])} | {profile['outlier_count']} | "
            f"{profile['green_rows']} ({profile['green_pct']}%) |"
        )

    lines.extend(
        [
            "",
            "## Notes",
            "",
            "- Null rate and value distribution details are documented inside each dataset notebook.",
            "- Outlier rules are dataset-specific and intentionally conservative for initial exploration.",
            "- Green Line coverage is based on `route_id` values starting with `Green`.",
        ]
    )

    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def run_eda(
    year: int,
    raw_dir: Path,
    sample_dir: Path,
    notebook_dir: Path,
    report_path: Path,
    source: str,
    max_rows: Optional[int] = None,
) -> Dict[str, Dict[str, object]]:
    source_dir = sample_dir if source == "samples" else raw_dir
    source_label = f"{source} ({source_dir})"

    profiles: Dict[str, Dict[str, object]] = {}

    for dataset in DATASETS:
        csv_path = source_dir / f"{dataset}_{year}.csv"
        profile = analyze_dataset(dataset, csv_path, max_rows=max_rows)
        profiles[dataset] = profile

        notebook_name = f"{dataset}_{year}_eda.ipynb"
        notebook_path = notebook_dir / notebook_name
        _build_notebook(profile, notebook_path, ANALYSIS_CONFIG[dataset].notebook_title)
        print(f"[{dataset}] notebook={notebook_path}")

    _write_quality_report(report_path, year, profiles, source_label)
    print(f"Wrote report: {report_path}")
    return profiles


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate EDA notebooks + data quality report")
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--sample-dir", type=Path, default=DEFAULT_SAMPLE_DIR)
    parser.add_argument("--notebook-dir", type=Path, default=DEFAULT_NOTEBOOK_DIR)
    parser.add_argument("--report-path", type=Path, default=DEFAULT_REPORT_PATH)
    parser.add_argument("--source", choices=["raw", "samples"], default="raw")
    parser.add_argument("--max-rows", type=int, default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    run_eda(
        year=args.year,
        raw_dir=args.raw_dir,
        sample_dir=args.sample_dir,
        notebook_dir=args.notebook_dir,
        report_path=args.report_path,
        source=args.source,
        max_rows=args.max_rows,
    )


if __name__ == "__main__":
    main()
