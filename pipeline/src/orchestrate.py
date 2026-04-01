"""Pipeline orchestration with validation + structured logging (Epic 3.6)."""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, Tuple

from clean import run_clean
from export import run_export
from ingest import run_ingest
from transform import run_transform
from validate_pipeline import (
    PipelineValidationError,
    validate_clean,
    validate_export,
    validate_ingest,
    validate_transform,
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_log(log_dir: Path, payload: Dict[str, object]) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "pipeline_steps.jsonl"
    with log_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload) + "\n")


def _run_step(
    *,
    step: str,
    year: int,
    raw_dir: Path,
    sample_dir: Path,
    processed_dir: Path,
    web_data_dir: Path,
    use_samples: bool,
    log_dir: Path,
    timeout_sec: int,
) -> Dict[str, object]:
    validators: Dict[str, Callable[[], Tuple[Dict[str, int], Dict[str, float]]]] = {
        "ingest": lambda: validate_ingest(year, raw_dir),
        "clean": lambda: validate_clean(year, processed_dir),
        "transform": lambda: validate_transform(year, processed_dir),
        "export": lambda: validate_export(year, web_data_dir),
    }

    started = time.perf_counter()
    started_utc = _utc_now()

    try:
        if step == "ingest":
            run_ingest(
                year=year,
                raw_dir=raw_dir,
                sample_dir=sample_dir,
                use_samples=use_samples,
                timeout_sec=timeout_sec,
            )
        elif step == "clean":
            run_clean(year=year, raw_dir=raw_dir, processed_dir=processed_dir)
        elif step == "transform":
            run_transform(year=year, processed_dir=processed_dir)
        elif step == "export":
            run_export(year=year, processed_dir=processed_dir, web_data_dir=web_data_dir)
        else:
            raise ValueError(f"Unknown step: {step}")

        row_counts, null_rates = validators[step]()
        duration = round(time.perf_counter() - started, 6)
        payload = {
            "timestamp_utc": _utc_now(),
            "started_utc": started_utc,
            "step": step,
            "year": year,
            "status": "success",
            "processing_time_sec": duration,
            "row_counts": row_counts,
            "null_rates": null_rates,
        }
        _write_log(log_dir, payload)
        return payload

    except Exception as exc:
        duration = round(time.perf_counter() - started, 6)
        payload = {
            "timestamp_utc": _utc_now(),
            "started_utc": started_utc,
            "step": step,
            "year": year,
            "status": "failed",
            "processing_time_sec": duration,
            "error": str(exc),
        }
        _write_log(log_dir, payload)
        raise


def run_pipeline(
    *,
    step: str,
    year: int,
    raw_dir: Path,
    sample_dir: Path,
    processed_dir: Path,
    web_data_dir: Path,
    use_samples: bool,
    log_dir: Path,
    timeout_sec: int,
) -> Dict[str, object]:
    if step != "all":
        return _run_step(
            step=step,
            year=year,
            raw_dir=raw_dir,
            sample_dir=sample_dir,
            processed_dir=processed_dir,
            web_data_dir=web_data_dir,
            use_samples=use_samples,
            log_dir=log_dir,
            timeout_sec=timeout_sec,
        )

    results: Dict[str, object] = {}
    for current in ["ingest", "clean", "transform", "export"]:
        results[current] = _run_step(
            step=current,
            year=year,
            raw_dir=raw_dir,
            sample_dir=sample_dir,
            processed_dir=processed_dir,
            web_data_dir=web_data_dir,
            use_samples=use_samples,
            log_dir=log_dir,
            timeout_sec=timeout_sec,
        )
    return {"status": "success", "steps": results}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run MBTA pipeline steps with validation + structured logs")
    parser.add_argument("--step", choices=["ingest", "clean", "transform", "export", "all"], required=True)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--sample-dir", type=Path, required=True)
    parser.add_argument("--processed-dir", type=Path, required=True)
    parser.add_argument("--web-data-dir", type=Path, required=True)
    parser.add_argument("--log-dir", type=Path, required=True)
    parser.add_argument("--use-samples", action="store_true")
    parser.add_argument("--timeout-sec", type=int, default=300)
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    try:
        result = run_pipeline(
            step=args.step,
            year=args.year,
            raw_dir=args.raw_dir,
            sample_dir=args.sample_dir,
            processed_dir=args.processed_dir,
            web_data_dir=args.web_data_dir,
            use_samples=args.use_samples,
            log_dir=args.log_dir,
            timeout_sec=args.timeout_sec,
        )
        print(json.dumps(result, indent=2))
    except PipelineValidationError as exc:
        raise SystemExit(f"VALIDATION FAILED: {exc}")
    except Exception as exc:
        raise SystemExit(f"PIPELINE FAILED: {exc}")


if __name__ == "__main__":
    main()
