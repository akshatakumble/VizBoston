"""GTFS schedule reference and station geography builders (Epic 3.4 / 3.5)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import pandas as pd

from common import ensure_dir
from stops_lookup import find_stops_lookup, load_stops_dataframe
from time_periods import classify_time_period

LINE_COLOR_MAP = {
    "Red": "#DA291C",
    "Orange": "#ED8B00",
    "Blue": "#003DA5",
    "Green-B": "#00843D",
    "Green-C": "#00843D",
    "Green-D": "#00843D",
    "Green-E": "#00843D",
    "Mattapan": "#DA291C",
    "Silver": "#7C878E",
}

ROUTE_ANCHOR_MAP = {
    "Red": (42.352, -71.062),
    "Orange": (42.360, -71.069),
    "Blue": (42.366, -71.031),
    "Green-B": (42.349, -71.092),
    "Green-C": (42.343, -71.117),
    "Green-D": (42.340, -71.145),
    "Green-E": (42.336, -71.095),
    "Mattapan": (42.270, -71.089),
    "Silver": (42.351, -71.070),
}

SILVER_ROUTE_IDS = {"741", "742", "743", "746", "749", "751"}
RAPID_ROUTE_IDS = {"Red", "Orange", "Blue", "Mattapan", "Green-B", "Green-C", "Green-D", "Green-E"}


def _normalize_rapid_route_id(route_id: str) -> str:
    value = str(route_id or "").strip()
    if value in SILVER_ROUTE_IDS:
        return "Silver"
    return value


def _parse_hhmmss_to_seconds(series: pd.Series) -> pd.Series:
    parts = series.astype(str).str.strip().str.split(":", expand=True)
    if parts.shape[1] < 2:
        return pd.Series(pd.NA, index=series.index, dtype="float64")

    hh = pd.to_numeric(parts[0], errors="coerce")
    mm = pd.to_numeric(parts[1], errors="coerce")
    ss = pd.to_numeric(parts[2], errors="coerce") if parts.shape[1] >= 3 else 0
    return hh * 3600 + mm * 60 + ss


def _season_from_service_date(dates: pd.Series) -> pd.Series:
    month = dates.dt.month
    year = dates.dt.year

    season = pd.Series("Unknown", index=dates.index, dtype="object")
    season[(month >= 3) & (month <= 5)] = "Spring " + year.astype(str)
    season[(month >= 6) & (month <= 8)] = "Summer " + year.astype(str)
    season[(month >= 9) & (month <= 11)] = "Fall " + year.astype(str)
    season[(month == 12)] = "Winter " + year.astype(str)
    season[(month <= 2)] = "Winter " + year.astype(str)
    return season


def _season_from_name(name: str) -> str:
    name_l = name.lower()
    year_match = re.search(r"(20\d{2})", name_l)
    year = year_match.group(1) if year_match else "Unknown"

    for token in ["fall", "spring", "summer", "winter"]:
        if token in name_l:
            return f"{token.capitalize()} {year}"
    return f"Season {year}"


def _normalize_direction_id(df: pd.DataFrame) -> pd.Series:
    if "direction_id" in df.columns:
        return pd.to_numeric(df["direction_id"], errors="coerce").fillna(0).astype("int64")

    if "direction" in df.columns:
        direction = df["direction"].astype(str).str.lower()
        # Conservative mapping used for recap CSVs.
        return direction.map({"outbound": 0, "inbound": 1}).fillna(0).astype("int64")

    return pd.Series(0, index=df.index, dtype="int64")


def _extract_reference_from_recap_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, low_memory=False)

    for col in ["route_id", "trip_id", "stop_id", "arrival_time", "departure_time", "stop_sequence"]:
        if col not in df.columns:
            df[col] = pd.NA

    if "service_date" in df.columns:
        service_date = pd.to_datetime(df["service_date"], errors="coerce")
    else:
        service_date = pd.to_datetime(pd.Series(pd.NA, index=df.index), errors="coerce")

    season = _season_from_service_date(service_date)
    if "season" in df.columns:
        season = df["season"].astype(str).where(df["season"].notna(), season)

    dep = _parse_hhmmss_to_seconds(df["departure_time"])
    arr = _parse_hhmmss_to_seconds(df["arrival_time"])
    time_sec = dep.fillna(arr)

    out = pd.DataFrame(
        {
            "season": season,
            "route_id": df["route_id"].astype(str).str.strip(),
            "trip_id": df["trip_id"].astype(str).str.strip(),
            "stop_id": df["stop_id"].astype(str).str.strip(),
            "direction_id": _normalize_direction_id(df),
            "service_id": df["service_date"].astype(str) if "service_date" in df.columns else "unknown",
            "time_sec": pd.to_numeric(time_sec, errors="coerce"),
            "stop_sequence": pd.to_numeric(df["stop_sequence"], errors="coerce"),
            "source": str(path),
        }
    )

    return out


def _extract_reference_from_gtfs_folder(root: Path) -> pd.DataFrame:
    stop_times_path = root / "stop_times.txt"
    trips_path = root / "trips.txt"

    if not stop_times_path.exists() or not trips_path.exists():
        return pd.DataFrame()

    stop_times = pd.read_csv(stop_times_path, low_memory=False)
    trips = pd.read_csv(trips_path, low_memory=False)

    for col in ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"]:
        if col not in stop_times.columns:
            stop_times[col] = pd.NA

    for col in ["trip_id", "route_id", "direction_id", "service_id"]:
        if col not in trips.columns:
            trips[col] = pd.NA

    merged = stop_times.merge(
        trips[["trip_id", "route_id", "direction_id", "service_id"]],
        on="trip_id",
        how="left",
    )

    dep = _parse_hhmmss_to_seconds(merged["departure_time"])
    arr = _parse_hhmmss_to_seconds(merged["arrival_time"])
    time_sec = dep.fillna(arr)

    season = _season_from_name(str(root))

    out = pd.DataFrame(
        {
            "season": season,
            "route_id": merged["route_id"].astype(str).str.strip(),
            "trip_id": merged["trip_id"].astype(str).str.strip(),
            "stop_id": merged["stop_id"].astype(str).str.strip(),
            "direction_id": _normalize_direction_id(merged),
            "service_id": merged["service_id"].astype(str).fillna("unknown"),
            "time_sec": pd.to_numeric(time_sec, errors="coerce"),
            "stop_sequence": pd.to_numeric(merged["stop_sequence"], errors="coerce"),
            "source": str(root),
        }
    )

    return out


def _discover_gtfs_reference_sources(raw_dir: Path, year: int) -> Tuple[List[Path], List[Path]]:
    recap_files = sorted(raw_dir.glob("gtfs_schedules_*.csv"))
    year_recap = raw_dir / f"gtfs_schedules_{year}.csv"
    if year_recap.exists() and year_recap not in recap_files:
        recap_files.append(year_recap)

    gtfs_roots = sorted({p.parent for p in raw_dir.rglob("stop_times.txt")})
    return recap_files, gtfs_roots


def _build_schedule_reference(detail: pd.DataFrame) -> pd.DataFrame:
    if detail.empty:
        return pd.DataFrame(
            columns=[
                "season",
                "route_id",
                "stop_id",
                "direction_id",
                "time_period",
                "scheduled_headway_sec",
                "scheduled_travel_time_sec",
                "headway_samples",
                "travel_time_samples",
            ]
        )

    work = detail.copy()
    work = work.dropna(subset=["route_id", "stop_id", "time_sec"])
    work["time_sec"] = pd.to_numeric(work["time_sec"], errors="coerce")
    work = work.dropna(subset=["time_sec"])

    work["time_period"] = classify_time_period(work["time_sec"].astype("int64"))

    headway = work.sort_values(["season", "route_id", "stop_id", "direction_id", "service_id", "time_sec"]).copy()
    headway["prev_time_sec"] = headway.groupby(
        ["season", "route_id", "stop_id", "direction_id", "service_id"]
    )["time_sec"].shift(1)
    headway["scheduled_headway_sec"] = headway["time_sec"] - headway["prev_time_sec"]
    headway_valid = headway[headway["scheduled_headway_sec"] > 0]

    headway_agg = (
        headway_valid.groupby(["season", "route_id", "stop_id", "direction_id", "time_period"], as_index=False)
        .agg(
            scheduled_headway_sec=("scheduled_headway_sec", "median"),
            headway_samples=("scheduled_headway_sec", "size"),
        )
    )

    travel = work.sort_values(["season", "trip_id", "stop_sequence", "time_sec"]).copy()
    travel["prev_time_sec"] = travel.groupby(["season", "trip_id"])["time_sec"].shift(1)
    travel["scheduled_travel_time_sec"] = travel["time_sec"] - travel["prev_time_sec"]
    travel_valid = travel[travel["scheduled_travel_time_sec"] > 0]

    travel_agg = (
        travel_valid.groupby(["season", "route_id", "stop_id", "direction_id", "time_period"], as_index=False)
        .agg(
            scheduled_travel_time_sec=("scheduled_travel_time_sec", "median"),
            travel_time_samples=("scheduled_travel_time_sec", "size"),
        )
    )

    reference = headway_agg.merge(
        travel_agg,
        on=["season", "route_id", "stop_id", "direction_id", "time_period"],
        how="outer",
    )

    reference["direction_id"] = pd.to_numeric(reference["direction_id"], errors="coerce").fillna(0).astype("int64")
    return reference


def _route_family(route_id: str) -> str:
    route_id = _normalize_rapid_route_id(route_id)
    if isinstance(route_id, str) and route_id.startswith("Green"):
        return "Green"
    return route_id


def _route_anchor(route_id: str) -> Tuple[float, float]:
    route_id = _normalize_rapid_route_id(route_id)
    if route_id in ROUTE_ANCHOR_MAP:
        return ROUTE_ANCHOR_MAP[route_id]
    return 42.35, -71.06


def _synthesize_missing_coordinates(station_df: pd.DataFrame) -> Tuple[pd.DataFrame, int]:
    if station_df.empty:
        station_df["coordinate_source"] = pd.Series(dtype="object")
        return station_df, 0

    out = station_df.copy()
    out["coordinate_source"] = "gtfs_stops"
    missing_mask = out["latitude"].isna() | out["longitude"].isna()
    if not missing_mask.any():
        return out, 0

    synth_count = 0
    for route_id, idx in out[missing_mask].groupby("route_id").groups.items():
        route_rows = out.loc[idx].copy()
        if route_rows["stop_sequence"].notna().any():
            route_rows = route_rows.sort_values("stop_sequence")
        else:
            route_rows = route_rows.sort_values("stop_id")

        anchor_lat, anchor_lon = _route_anchor(str(route_id))
        for step, row_idx in enumerate(route_rows.index):
            if pd.notna(out.at[row_idx, "latitude"]) and pd.notna(out.at[row_idx, "longitude"]):
                continue
            out.at[row_idx, "latitude"] = anchor_lat + (step * 0.0025)
            out.at[row_idx, "longitude"] = anchor_lon - (step * 0.0020)
            out.at[row_idx, "coordinate_source"] = "synthetic_from_stop_sequence"
            synth_count += 1

    return out, synth_count


def _load_massgis_line_features(raw_dir: Path) -> Tuple[List[Dict], Optional[str]]:
    shp_candidates = [
        raw_dir / "MBTA_ARC.shp",
        raw_dir / "mbta_arc.shp",
        raw_dir / "massgis" / "MBTA_ARC.shp",
    ]
    shp_path = next((p for p in shp_candidates if p.exists()), None)
    if shp_path is None:
        return [], None

    try:
        import shapefile  # type: ignore
    except Exception:
        return [], f"MassGIS shapefile found at {shp_path} but 'shapefile' package is unavailable"

    reader = shapefile.Reader(str(shp_path))
    field_names = [f[0] for f in reader.fields[1:]]

    features: List[Dict] = []
    for sr in reader.shapeRecords():
        attrs = {field_names[i]: sr.record[i] for i in range(len(field_names))}
        coords = [[float(pt[0]), float(pt[1])] for pt in sr.shape.points]
        if len(coords) < 2:
            continue

        route_id = None
        for key in ["route_id", "ROUTE_ID", "line", "LINE", "line_name", "NAME"]:
            if key in attrs and attrs[key] not in [None, ""]:
                route_id = str(attrs[key])
                break

        feature = {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "feature_type": "line_path",
                "route_id": route_id,
                "line_color": LINE_COLOR_MAP.get(route_id, "#666666") if route_id else "#666666",
                "geometry_source": "massgis_shapefile",
            },
        }
        features.append(feature)

    return features, None


def _build_station_outputs(
    detail: pd.DataFrame,
    raw_dir: Path,
    processed_dir: Path,
    year: int,
) -> Dict[str, object]:
    stops_path = find_stops_lookup(raw_dir=raw_dir, year=year)
    stops_df = load_stops_dataframe(stops_path)

    if detail.empty:
        station_df = pd.DataFrame(
            columns=[
                "stop_id",
                "stop_name",
                "route_id",
                "line_color",
                "latitude",
                "longitude",
                "stop_sequence",
                "is_transfer_station",
            ]
        )
    else:
        route_stop = (
            detail.dropna(subset=["route_id", "stop_id"])
            .groupby(["route_id", "stop_id"], as_index=False)
            .agg(stop_sequence=("stop_sequence", "median"))
        )

        station_df = route_stop.merge(stops_df, on="stop_id", how="left")
        station_df["line_color"] = station_df["route_id"].map(LINE_COLOR_MAP).fillna("#666666")

        station_df["route_family"] = station_df["route_id"].map(_route_family)
        transfer_lookup = station_df.groupby("stop_id")["route_family"].nunique()
        station_df["is_transfer_station"] = station_df["stop_id"].map(transfer_lookup).fillna(0) > 1

        station_df["latitude"] = station_df["stop_lat"]
        station_df["longitude"] = station_df["stop_lon"]
        station_df["stop_name"] = station_df["stop_name"].fillna(station_df["stop_id"])
        station_df = station_df[
            [
                "stop_id",
                "stop_name",
                "route_id",
                "line_color",
                "latitude",
                "longitude",
                "stop_sequence",
                "is_transfer_station",
            ]
        ]

    station_df, synthetic_coordinate_rows = _synthesize_missing_coordinates(station_df)

    station_parquet = processed_dir / f"station_reference_{year}.parquet"
    station_csv = processed_dir / f"station_reference_{year}.csv"
    station_df.to_parquet(station_parquet, index=False)
    station_df.to_csv(station_csv, index=False)

    station_features: List[Dict] = []
    for _, row in station_df.dropna(subset=["latitude", "longitude"]).iterrows():
        station_features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(row["longitude"]), float(row["latitude"])],
                },
                "properties": {
                    "feature_type": "station_point",
                    "stop_id": row["stop_id"],
                    "stop_name": row["stop_name"],
                    "route_id": row["route_id"],
                    "line_color": row["line_color"],
                    "stop_sequence": None if pd.isna(row["stop_sequence"]) else float(row["stop_sequence"]),
                    "is_transfer_station": bool(row["is_transfer_station"]),
                },
            }
        )

    line_features: List[Dict] = []
    for route_id, group in station_df.dropna(subset=["latitude", "longitude", "stop_sequence"]).groupby("route_id"):
        ordered = group.sort_values("stop_sequence")
        coords = [[float(lon), float(lat)] for lat, lon in zip(ordered["latitude"], ordered["longitude"])]
        deduped: List[List[float]] = []
        for c in coords:
            if not deduped or c != deduped[-1]:
                deduped.append(c)

        if len(deduped) >= 2:
            line_features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": deduped},
                    "properties": {
                        "feature_type": "line_path",
                        "route_id": route_id,
                        "line_color": LINE_COLOR_MAP.get(route_id, "#666666"),
                        "geometry_source": "derived_stop_sequence",
                    },
                }
            )

    massgis_features, massgis_warning = _load_massgis_line_features(raw_dir)
    if massgis_features:
        line_features.extend(massgis_features)

    geojson_path = processed_dir / f"mbta_transit_geography_{year}.geojson"
    geojson_payload = {
        "type": "FeatureCollection",
        "features": station_features + line_features,
    }
    geojson_path.write_text(json.dumps(geojson_payload, indent=2), encoding="utf-8")

    return {
        "station_reference_parquet": str(station_parquet),
        "station_reference_csv": str(station_csv),
        "geography_geojson": str(geojson_path),
        "station_rows": int(len(station_df)),
        "station_point_features": int(len(station_features)),
        "line_features": int(len(line_features)),
        "synthetic_coordinate_rows": int(synthetic_coordinate_rows),
        "massgis_warning": massgis_warning,
        "stops_lookup_path": str(stops_path) if stops_path else None,
    }


def build_gtfs_schedule_reference_and_geography(
    raw_dir: Path,
    processed_dir: Path,
    year: int,
) -> Dict[str, object]:
    ensure_dir(processed_dir)

    recap_files, gtfs_roots = _discover_gtfs_reference_sources(raw_dir=raw_dir, year=year)

    detail_frames: List[pd.DataFrame] = []
    for recap in recap_files:
        try:
            detail_frames.append(_extract_reference_from_recap_csv(recap))
        except Exception:
            continue

    for root in gtfs_roots:
        try:
            detail_frames.append(_extract_reference_from_gtfs_folder(root))
        except Exception:
            continue

    if detail_frames:
        detail = pd.concat(detail_frames, ignore_index=True)
    else:
        detail = pd.DataFrame(
            columns=[
                "season",
                "route_id",
                "trip_id",
                "stop_id",
                "direction_id",
                "service_id",
                "time_sec",
                "stop_sequence",
                "source",
            ]
        )

    for col in ["route_id", "stop_id", "trip_id", "service_id", "season"]:
        detail[col] = detail[col].astype(str).str.strip()
        detail[col] = detail[col].replace({"": pd.NA, "nan": pd.NA, "None": pd.NA, "NaN": pd.NA})

    detail = detail.dropna(subset=["route_id", "stop_id"]).copy()
    # Drop synthetic placeholder stop IDs (e.g. stop_001) that were generated
    # in lightweight sample recap files and pollute station labels/geography.
    detail = detail[~detail["stop_id"].astype(str).str.match(r"^stop_\d+$", na=False)].copy()
    detail["route_id"] = detail["route_id"].map(_normalize_rapid_route_id)
    detail = detail[
        detail["route_id"].isin(RAPID_ROUTE_IDS.union({"Silver"}))
        | detail["route_id"].astype(str).str.startswith("Green")
    ].copy()
    detail["direction_id"] = pd.to_numeric(detail["direction_id"], errors="coerce").fillna(0).astype("int64")

    schedule_reference = _build_schedule_reference(detail)

    stops_path = find_stops_lookup(raw_dir=raw_dir, year=year)
    if stops_path:
        stops_df = load_stops_dataframe(stops_path)[["stop_id", "stop_name"]]
        schedule_reference = schedule_reference.merge(stops_df, on="stop_id", how="left")
    else:
        schedule_reference["stop_name"] = pd.NA

    reference_parquet = processed_dir / f"schedule_reference_{year}.parquet"
    reference_csv = processed_dir / f"schedule_reference_{year}.csv"
    schedule_reference.to_parquet(reference_parquet, index=False)
    schedule_reference.to_csv(reference_csv, index=False)

    station_metrics = _build_station_outputs(detail=detail, raw_dir=raw_dir, processed_dir=processed_dir, year=year)

    seasons = sorted(str(s) for s in schedule_reference.get("season", pd.Series(dtype="object")).dropna().unique())

    return {
        "schedule_reference_parquet": str(reference_parquet),
        "schedule_reference_csv": str(reference_csv),
        "schedule_reference_rows": int(len(schedule_reference)),
        "seasons_covered": seasons,
        "source_recap_files": [str(p) for p in recap_files],
        "source_gtfs_roots": [str(p) for p in gtfs_roots],
        **station_metrics,
    }
