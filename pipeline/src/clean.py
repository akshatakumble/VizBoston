"""Clean datasets into analysis-ready artifacts.

Epic 3.1 implements full cleaning for rapid transit events while other datasets
remain pass-through until their stories are implemented.
"""

from __future__ import annotations

import argparse
import csv
import shutil
from pathlib import Path

import pandas as pd

from common import DATASETS, ensure_dir, row_count, write_json
from clean_events import clean_events_dataset
from clean_headways import clean_headways_dataset
from clean_travel_times import clean_travel_times_dataset
from gtfs_reference import build_gtfs_schedule_reference_and_geography


def run_clean(year: int, raw_dir: Path, processed_dir: Path) -> Path:
    ensure_dir(processed_dir)
    report = {"year": year, "datasets": {}}

    for dataset in DATASETS:
        raw_path = raw_dir / f"{dataset}_{year}.csv"
        clean_path = processed_dir / f"clean_{dataset}_{year}.csv"
        dataset_report = {
            "raw_file": str(raw_path),
            "clean_file": str(clean_path),
        }

        if dataset == "rapid_transit_events":
            clean_parquet_path = processed_dir / f"clean_{dataset}_{year}.parquet"

            if raw_path.exists():
                metrics = clean_events_dataset(
                    source_csv=raw_path,
                    destination_parquet=clean_parquet_path,
                    destination_csv=clean_path,
                    raw_dir=raw_dir,
                    year=year,
                )
                status = "cleaned"
                rows = int(metrics["rows_after_drop"])
                dataset_report.update(
                    {
                        "status": status,
                        "rows": rows,
                        "clean_parquet_file": str(clean_parquet_path),
                        "metrics": metrics,
                    }
                )
                print(
                    "[rapid_transit_events] "
                    f"rows_in={metrics['rows_input']} rows_out={metrics['rows_after_drop']} "
                    f"dropped_event_time_null={metrics['rows_dropped_event_time_null']} "
                    f"null_rate_before={metrics['null_rate_before']} "
                    f"null_rate_after={metrics['null_rate_after']}"
                )
            else:
                status = "missing_raw"
                rows = 0
                dataset_report.update(
                    {
                        "status": status,
                        "rows": rows,
                        "clean_parquet_file": str(clean_parquet_path),
                    }
                )

            report["datasets"][dataset] = dataset_report
            continue

        if dataset == "rapid_transit_headways":
            clean_parquet_path = processed_dir / f"clean_{dataset}_{year}.parquet"

            if raw_path.exists():
                metrics = clean_headways_dataset(
                    source_csv=raw_path,
                    destination_parquet=clean_parquet_path,
                    destination_csv=clean_path,
                    raw_dir=raw_dir,
                    year=year,
                )
                status = "cleaned"
                rows = int(metrics["rows_after_drop"])
                dataset_report.update(
                    {
                        "status": status,
                        "rows": rows,
                        "clean_parquet_file": str(clean_parquet_path),
                        "metrics": metrics,
                    }
                )
                print(
                    "[rapid_transit_headways] "
                    f"rows_in={metrics['rows_input']} rows_out={metrics['rows_after_drop']} "
                    f"dropped_invalid_trunk={metrics['rows_dropped_invalid_trunk']} "
                    f"branch_null_rows={metrics['branch_headway_null_rows']} "
                    f"outlier_rows={metrics['outlier_rows']}"
                )
            else:
                status = "missing_raw"
                rows = 0
                dataset_report.update(
                    {
                        "status": status,
                        "rows": rows,
                        "clean_parquet_file": str(clean_parquet_path),
                    }
                )

            report["datasets"][dataset] = dataset_report
            continue

        if dataset == "rapid_transit_travel_times":
            clean_parquet_path = processed_dir / f"clean_{dataset}_{year}.parquet"

            if raw_path.exists():
                metrics = clean_travel_times_dataset(
                    source_csv=raw_path,
                    destination_parquet=clean_parquet_path,
                    destination_csv=clean_path,
                    raw_dir=raw_dir,
                    year=year,
                )
                status = "cleaned"
                rows = int(metrics["rows_after_drop"])
                dataset_report.update(
                    {
                        "status": status,
                        "rows": rows,
                        "clean_parquet_file": str(clean_parquet_path),
                        "metrics": metrics,
                    }
                )
                print(
                    "[rapid_transit_travel_times] "
                    f"rows_in={metrics['rows_input']} rows_out={metrics['rows_after_drop']} "
                    f"dropped_null_travel={metrics['rows_dropped_null_travel_time']} "
                    f"slow_zone_segments={metrics['slow_zone_segment_count']} "
                    f"invalid_stop_rows={metrics['invalid_stop_rows']}"
                )
            else:
                status = "missing_raw"
                rows = 0
                dataset_report.update(
                    {
                        "status": status,
                        "rows": rows,
                        "clean_parquet_file": str(clean_parquet_path),
                    }
                )

            report["datasets"][dataset] = dataset_report
            continue

        if dataset == "gtfs_schedules":
            clean_parquet_path = processed_dir / f"clean_{dataset}_{year}.parquet"
            gtfs_roots = list(raw_dir.rglob("stop_times.txt"))
            has_gtfs_snapshots = len(gtfs_roots) > 0

            if raw_path.exists() or has_gtfs_snapshots:
                if raw_path.exists():
                    shutil.copy2(raw_path, clean_path)
                    pd.read_csv(clean_path, low_memory=False).to_parquet(clean_parquet_path, index=False)
                else:
                    with clean_path.open("w", newline="", encoding="utf-8") as f:
                        writer = csv.writer(f)
                        writer.writerow(
                            [
                                "service_date",
                                "route_id",
                                "trip_id",
                                "stop_id",
                                "arrival_time",
                                "departure_time",
                                "stop_sequence",
                            ]
                        )
                    pd.DataFrame(
                        columns=[
                            "service_date",
                            "route_id",
                            "trip_id",
                            "stop_id",
                            "arrival_time",
                            "departure_time",
                            "stop_sequence",
                        ]
                    ).to_parquet(clean_parquet_path, index=False)
                gtfs_metrics = build_gtfs_schedule_reference_and_geography(
                    raw_dir=raw_dir,
                    processed_dir=processed_dir,
                    year=year,
                )
                status = "cleaned"
                rows = row_count(clean_path)
                dataset_report.update(
                    {
                        "status": status,
                        "rows": rows,
                        "clean_parquet_file": str(clean_parquet_path),
                        "metrics": gtfs_metrics,
                    }
                )
                print(
                    "[gtfs_schedules] "
                    f"reference_rows={gtfs_metrics['schedule_reference_rows']} "
                    f"station_rows={gtfs_metrics['station_rows']} "
                    f"seasons={len(gtfs_metrics['seasons_covered'])}"
                )
            else:
                status = "missing_raw"
                rows = 0
                dataset_report.update(
                    {
                        "status": status,
                        "rows": rows,
                        "clean_parquet_file": str(clean_parquet_path),
                    }
                )

            report["datasets"][dataset] = dataset_report
            continue

        if raw_path.exists():
            shutil.copy2(raw_path, clean_path)
            status = "copied"
            rows = row_count(clean_path)
        else:
            status = "missing_raw"
            rows = 0

        dataset_report.update(
            {
                "status": status,
                "rows": rows,
            }
        )
        report["datasets"][dataset] = dataset_report

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
