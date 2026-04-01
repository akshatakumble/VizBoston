"""Helpers for locating and loading GTFS stop lookup files."""

from __future__ import annotations

from pathlib import Path
from typing import Dict, Optional, Set

import pandas as pd


STOP_LOOKUP_CANDIDATES = (
    "gtfs_stops_{year}.csv",
    "stops_{year}.csv",
    "stops_{year}.txt",
    "stops.csv",
    "stops.txt",
    # Fallback for sample/dev environments where dedicated stops files are absent.
    "gtfs_schedules_{year}.csv",
    "gtfs_schedules.csv",
)


def find_stops_lookup(raw_dir: Path, year: int, explicit_path: Optional[Path] = None) -> Optional[Path]:
    if explicit_path is not None and explicit_path.exists():
        return explicit_path

    for template in STOP_LOOKUP_CANDIDATES:
        candidate = raw_dir / template.format(year=year)
        if candidate.exists():
            return candidate
    return None


def load_stop_lookup(stops_path: Optional[Path]) -> Dict[str, str]:
    if stops_path is None or not stops_path.exists():
        return {}

    stops_df = pd.read_csv(stops_path, low_memory=False)
    if "stop_id" not in stops_df.columns:
        return {}

    if "stop_name" not in stops_df.columns:
        # Some recap CSVs only include stop_id; use stop_id as a conservative canonical label.
        stops_df["stop_name"] = stops_df["stop_id"]

    lookup_df = stops_df[["stop_id", "stop_name"]].dropna(subset=["stop_id", "stop_name"])
    lookup_df["stop_id"] = lookup_df["stop_id"].astype(str).str.strip()
    lookup_df["stop_name"] = lookup_df["stop_name"].astype(str).str.strip()
    lookup_df = lookup_df.drop_duplicates(subset=["stop_id"], keep="first")
    return dict(zip(lookup_df["stop_id"], lookup_df["stop_name"]))


def load_stop_id_set(stops_path: Optional[Path]) -> Set[str]:
    if stops_path is None or not stops_path.exists():
        return set()

    stops_df = pd.read_csv(stops_path, low_memory=False)
    if "stop_id" not in stops_df.columns:
        return set()

    return set(stops_df["stop_id"].dropna().astype(str).str.strip())


def load_stops_dataframe(stops_path: Optional[Path]) -> pd.DataFrame:
    if stops_path is None or not stops_path.exists():
        return pd.DataFrame(columns=["stop_id", "stop_name", "stop_lat", "stop_lon"])

    stops_df = pd.read_csv(stops_path, low_memory=False)
    for col in ["stop_id", "stop_name", "stop_lat", "stop_lon"]:
        if col not in stops_df.columns:
            stops_df[col] = pd.NA

    out = stops_df[["stop_id", "stop_name", "stop_lat", "stop_lon"]].copy()
    out["stop_id"] = out["stop_id"].astype(str).str.strip()
    out["stop_name"] = out["stop_name"].where(out["stop_name"].notna(), out["stop_id"])
    out["stop_name"] = out["stop_name"].astype(str).str.strip()
    out["stop_lat"] = pd.to_numeric(out["stop_lat"], errors="coerce")
    out["stop_lon"] = pd.to_numeric(out["stop_lon"], errors="coerce")
    out = out.drop_duplicates(subset=["stop_id"], keep="first")
    return out
