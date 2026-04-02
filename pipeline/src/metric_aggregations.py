"""Metric computation for Epic 4 (OTP + headway regularity aggregations)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

import pandas as pd

from common import ensure_dir
from time_periods import classify_time_period

LINE_IDS = ["Red", "Orange", "Blue", "Green", "Mattapan"]
GREEN_BRANCHES = {"Green-B", "Green-C", "Green-D", "Green-E"}
TIME_PERIOD_ORDER = ["AM Peak", "Midday", "PM Peak", "Evening", "Late Night", "Other", "Unknown"]
# Transform-stage payloads can be larger; export stage enforces the frontend gzip budget.
MAX_JSON_BYTES = 16 * 1024 * 1024

METRIC_FILENAMES = {
    "otp_line_daily": "otp_line_daily_{year}.json",
    "otp_line_station_time_period": "otp_line_station_time_period_{year}.json",
    "otp_line_monthly": "otp_line_monthly_{year}.json",
    "otp_system_daily": "otp_system_daily_{year}.json",
    "headway_station_time_month": "headway_station_time_month_{year}.json",
    "headway_green_branch_month": "headway_green_branch_month_{year}.json",
    "travel_time_segment_time_period_month": "travel_time_segment_time_period_month_{year}.json",
    "travel_time_slow_zones": "travel_time_slow_zones_{year}.json",
    "scheduled_vs_actual_line_time_period_season": "scheduled_vs_actual_line_time_period_season_{year}.json",
    "service_delivery_line_season": "service_delivery_line_season_{year}.json",
}


def metric_output_paths(processed_dir: Path, year: int) -> Dict[str, Path]:
    return {
        key: processed_dir / template.format(year=year)
        for key, template in METRIC_FILENAMES.items()
    }


def _line_id_from_route(route_id: pd.Series) -> pd.Series:
    route = route_id.astype(str).str.strip()
    return route.where(~route.str.startswith("Green"), "Green")


def _season_from_service_date(dates: pd.Series) -> pd.Series:
    month = pd.to_datetime(dates, errors="coerce").dt.month
    year = pd.to_datetime(dates, errors="coerce").dt.year
    season = pd.Series("Unknown", index=dates.index, dtype="object")
    season[(month >= 3) & (month <= 5)] = "Spring " + year.astype("Int64").astype(str)
    season[(month >= 6) & (month <= 8)] = "Summer " + year.astype("Int64").astype(str)
    season[(month >= 9) & (month <= 11)] = "Fall " + year.astype("Int64").astype(str)
    season[(month == 12) | (month <= 2)] = "Winter " + year.astype("Int64").astype(str)
    return season


def _season_sort_key(value: str) -> Tuple[int, int]:
    if not isinstance(value, str):
        return (9999, 99)
    parts = value.strip().split()
    if len(parts) < 2:
        return (9999, 99)
    season_name = parts[0]
    try:
        year = int(parts[1])
    except ValueError:
        return (9999, 99)

    season_order = {"Winter": 1, "Spring": 2, "Summer": 3, "Fall": 4}
    return (year, season_order.get(season_name, 99))


def _sort_by_season(df: pd.DataFrame, cols: List[str]) -> pd.DataFrame:
    if "season" not in df.columns or df.empty:
        return df
    out = df.copy()
    out["_season_key"] = out["season"].map(_season_sort_key)
    out = out.sort_values(cols + ["_season_key"]).drop(columns=["_season_key"])
    return out.reset_index(drop=True)


def _normalize_time_period(values: pd.Series, event_time_sec: pd.Series) -> pd.Series:
    out = values.astype(str).replace({"nan": "Unknown", "None": "Unknown", "NaN": "Unknown"}).fillna("Unknown")
    out = out.where(out.isin(TIME_PERIOD_ORDER), "Unknown")

    # Fill unknowns from event_time_sec when available.
    event_time = pd.to_numeric(event_time_sec, errors="coerce")
    fill_mask = out.eq("Unknown") & event_time.notna()
    if fill_mask.any():
        out.loc[fill_mask] = classify_time_period(event_time.loc[fill_mask].astype("int64"))
    return out


def _safe_pct(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    num = pd.to_numeric(numerator, errors="coerce")
    den = pd.to_numeric(denominator, errors="coerce").replace(0, pd.NA)
    pct = (num / den) * 100.0
    return pd.to_numeric(pct, errors="coerce").round(2)


def _records(df: pd.DataFrame, *, numeric_round: Dict[str, int] | None = None) -> List[Dict[str, object]]:
    out = df.copy()
    if numeric_round:
        for col, digits in numeric_round.items():
            if col in out.columns:
                out[col] = pd.to_numeric(out[col], errors="coerce").round(digits)

    for col in out.columns:
        if pd.api.types.is_datetime64_any_dtype(out[col]):
            out[col] = out[col].dt.strftime("%Y-%m-%d")

    out = out.where(pd.notna(out), None)
    return out.to_dict(orient="records")


def _write_compact_json(path: Path, payload: Dict[str, object], max_bytes: int = MAX_JSON_BYTES) -> int:
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)

    size_bytes = path.stat().st_size
    if size_bytes > max_bytes:
        raise ValueError(
            f"Metric JSON exceeds size limit ({size_bytes} > {max_bytes} bytes): {path}"
        )
    return int(size_bytes)


def _enrich_events(events: pd.DataFrame) -> pd.DataFrame:
    df = events.copy()
    for col in ["service_date", "route_id", "stop_id", "event_time_sec", "schedule_deviation_sec"]:
        if col not in df.columns:
            df[col] = pd.NA

    df["service_date"] = pd.to_datetime(df["service_date"], errors="coerce").dt.normalize()
    df["route_id"] = df["route_id"].astype(str).str.strip()
    df["line_id"] = _line_id_from_route(df["route_id"])
    df = df[df["line_id"].isin(LINE_IDS)].copy()

    df["stop_id"] = df["stop_id"].astype(str).str.strip()
    if "canonical_stop_name" in df.columns:
        df["station_name"] = df["canonical_stop_name"].astype(str).str.strip()
    else:
        df["station_name"] = df["stop_id"]
    df["station_name"] = df["station_name"].replace({"nan": pd.NA}).fillna(df["stop_id"])

    df["schedule_deviation_sec"] = pd.to_numeric(df["schedule_deviation_sec"], errors="coerce")
    df = df[df["schedule_deviation_sec"].notna()].copy()

    df["is_on_time"] = df["schedule_deviation_sec"].between(-60, 300, inclusive="both")
    df["is_early"] = df["schedule_deviation_sec"] < -60
    df["is_late"] = df["schedule_deviation_sec"] > 300

    time_period_source = df["time_period"] if "time_period" in df.columns else pd.Series("Unknown", index=df.index)
    df["time_period"] = _normalize_time_period(time_period_source, df["event_time_sec"])
    df["month"] = df["service_date"].dt.to_period("M").astype(str)
    return df


def _otp_line_daily(df: pd.DataFrame) -> pd.DataFrame:
    group_cols = ["service_date", "line_id"]
    agg = (
        df.groupby(group_cols, as_index=False)
        .agg(
            total_events=("is_on_time", "size"),
            on_time_events=("is_on_time", "sum"),
            early_events=("is_early", "sum"),
            late_events=("is_late", "sum"),
        )
    )

    for col in ["total_events", "on_time_events", "early_events", "late_events"]:
        agg[col] = agg[col].fillna(0).astype("int64")
    agg["otp_pct"] = _safe_pct(agg["on_time_events"], agg["total_events"])
    return agg.sort_values(group_cols).reset_index(drop=True)


def _otp_line_station_time(df: pd.DataFrame) -> pd.DataFrame:
    group_cols = ["line_id", "stop_id", "station_name", "time_period"]
    agg = (
        df.groupby(group_cols, as_index=False)
        .agg(
            total_events=("is_on_time", "size"),
            on_time_events=("is_on_time", "sum"),
            early_events=("is_early", "sum"),
            late_events=("is_late", "sum"),
        )
    )
    agg["otp_pct"] = _safe_pct(agg["on_time_events"], agg["total_events"])
    return agg.sort_values(["line_id", "station_name", "time_period"]).reset_index(drop=True)


def _otp_line_monthly(df: pd.DataFrame) -> pd.DataFrame:
    group_cols = ["month", "line_id"]
    agg = (
        df.groupby(group_cols, as_index=False)
        .agg(
            total_events=("is_on_time", "size"),
            on_time_events=("is_on_time", "sum"),
            early_events=("is_early", "sum"),
            late_events=("is_late", "sum"),
        )
    )

    for col in ["total_events", "on_time_events", "early_events", "late_events"]:
        agg[col] = agg[col].fillna(0).astype("int64")
    agg["otp_pct"] = _safe_pct(agg["on_time_events"], agg["total_events"])
    return agg.sort_values(group_cols).reset_index(drop=True)


def _otp_system_daily(df: pd.DataFrame) -> pd.DataFrame:
    agg = (
        df.groupby(["service_date"], as_index=False)
        .agg(
            total_events=("is_on_time", "size"),
            on_time_events=("is_on_time", "sum"),
            early_events=("is_early", "sum"),
            late_events=("is_late", "sum"),
        )
    )
    agg["reliability_score_pct"] = _safe_pct(agg["on_time_events"], agg["total_events"])
    return agg.sort_values(["service_date"]).reset_index(drop=True)


def _enrich_headways(headways: pd.DataFrame, stop_names: Dict[str, str]) -> pd.DataFrame:
    df = headways.copy()
    for col in ["service_date", "route_id", "stop_id", "headway_trunk_sec", "benchmark_headway_sec", "event_time_sec"]:
        if col not in df.columns:
            df[col] = pd.NA

    df["service_date"] = pd.to_datetime(df["service_date"], errors="coerce").dt.normalize()
    df["route_id"] = df["route_id"].astype(str).str.strip()
    df["line_id"] = _line_id_from_route(df["route_id"])
    df = df[df["line_id"].isin(LINE_IDS)].copy()

    df["stop_id"] = df["stop_id"].astype(str).str.strip()
    df["stop_name"] = df["stop_id"].map(stop_names).fillna(df["stop_id"])

    df["headway_actual_sec"] = pd.to_numeric(df["headway_trunk_sec"], errors="coerce")
    df["scheduled_headway_sec"] = pd.to_numeric(df["benchmark_headway_sec"], errors="coerce")
    df = df[df["headway_actual_sec"].notna() & (df["headway_actual_sec"] >= 0)].copy()

    time_period_source = df["time_period"] if "time_period" in df.columns else pd.Series("Unknown", index=df.index)
    df["time_period"] = _normalize_time_period(time_period_source, df["event_time_sec"])
    df["month"] = df["service_date"].dt.to_period("M").astype(str)
    df["season"] = _season_from_service_date(df["service_date"])
    df["day_type"] = "Unknown"
    valid_dates = df["service_date"].notna()
    df.loc[valid_dates, "day_type"] = df.loc[valid_dates, "service_date"].dt.dayofweek.map(
        lambda d: "Weekend" if d >= 5 else "Weekday"
    )

    valid_sched = df["scheduled_headway_sec"] > 0
    df["is_bunched"] = valid_sched & (df["headway_actual_sec"] < (0.5 * df["scheduled_headway_sec"]))
    return df


def _load_stop_dimensions(processed_dir: Path, year: int) -> pd.DataFrame:
    station_ref_path = processed_dir / f"station_reference_{year}.parquet"
    if not station_ref_path.exists():
        return pd.DataFrame(columns=["stop_id", "stop_name", "latitude", "longitude"])

    station = pd.read_parquet(station_ref_path)
    needed = ["stop_id", "stop_name", "latitude", "longitude"]
    for col in needed:
        if col not in station.columns:
            station[col] = pd.NA
    dim = station[needed].copy()
    dim["stop_id"] = dim["stop_id"].astype(str).str.strip()
    dim["stop_name"] = dim["stop_name"].astype(str).str.strip()
    dim["latitude"] = pd.to_numeric(dim["latitude"], errors="coerce")
    dim["longitude"] = pd.to_numeric(dim["longitude"], errors="coerce")

    # Keep one canonical geometry row per stop_id.
    dim = (
        dim.sort_values(["stop_id"])
        .groupby("stop_id", as_index=False)
        .agg(
            stop_name=("stop_name", "first"),
            latitude=("latitude", "mean"),
            longitude=("longitude", "mean"),
        )
    )
    return dim


def _enrich_travel_times(travel: pd.DataFrame, stop_dim: pd.DataFrame) -> pd.DataFrame:
    df = travel.copy()
    for col in [
        "service_date",
        "route_id",
        "from_stop_id",
        "to_stop_id",
        "travel_time_sec",
        "benchmark_travel_time_sec",
        "event_time_sec",
    ]:
        if col not in df.columns:
            df[col] = pd.NA

    df["service_date"] = pd.to_datetime(df["service_date"], errors="coerce").dt.normalize()
    df["route_id"] = df["route_id"].astype(str).str.strip()
    df["line_id"] = _line_id_from_route(df["route_id"])
    df = df[df["line_id"].isin(LINE_IDS)].copy()

    df["from_stop_id"] = df["from_stop_id"].astype(str).str.strip()
    df["to_stop_id"] = df["to_stop_id"].astype(str).str.strip()
    df["segment_id"] = df["from_stop_id"] + "-" + df["to_stop_id"]

    df["travel_time_sec"] = pd.to_numeric(df["travel_time_sec"], errors="coerce")
    df["benchmark_travel_time_sec"] = pd.to_numeric(df["benchmark_travel_time_sec"], errors="coerce")
    df = df[df["travel_time_sec"].notna() & (df["travel_time_sec"] >= 0)].copy()

    time_period_source = df["time_period"] if "time_period" in df.columns else pd.Series("Unknown", index=df.index)
    df["time_period"] = _normalize_time_period(time_period_source, df["event_time_sec"])
    df["month"] = df["service_date"].dt.to_period("M").astype(str)

    for col in [
        "from_stop_name",
        "to_stop_name",
        "from_latitude",
        "from_longitude",
        "to_latitude",
        "to_longitude",
    ]:
        if col in df.columns:
            df = df.drop(columns=[col])

    if not stop_dim.empty:
        from_dim = stop_dim.rename(
            columns={
                "stop_id": "from_stop_id",
                "stop_name": "from_stop_name",
                "latitude": "from_latitude",
                "longitude": "from_longitude",
            }
        )
        to_dim = stop_dim.rename(
            columns={
                "stop_id": "to_stop_id",
                "stop_name": "to_stop_name",
                "latitude": "to_latitude",
                "longitude": "to_longitude",
            }
        )
        df = df.merge(from_dim, on="from_stop_id", how="left").merge(to_dim, on="to_stop_id", how="left")
    else:
        df["from_stop_name"] = df["from_stop_id"]
        df["to_stop_name"] = df["to_stop_id"]
        df["from_latitude"] = pd.NA
        df["from_longitude"] = pd.NA
        df["to_latitude"] = pd.NA
        df["to_longitude"] = pd.NA

    df["from_stop_name"] = df["from_stop_name"].fillna(df["from_stop_id"])
    df["to_stop_name"] = df["to_stop_name"].fillna(df["to_stop_id"])
    return df


def _travel_time_segment_time_period_month(df: pd.DataFrame) -> pd.DataFrame:
    group_cols = [
        "month",
        "line_id",
        "segment_id",
        "from_stop_id",
        "to_stop_id",
        "from_stop_name",
        "to_stop_name",
        "from_latitude",
        "from_longitude",
        "to_latitude",
        "to_longitude",
        "time_period",
    ]
    if df.empty:
        return pd.DataFrame(
            columns=group_cols
            + [
                "median_travel_time_sec",
                "benchmark_median_sec",
                "travel_time_index",
                "buffer_time_sec",
                "planning_time_index",
            ]
        )

    agg = (
        df.groupby(group_cols, as_index=False, dropna=False)
        .agg(
            sample_count=("travel_time_sec", "size"),
            median_travel_time_sec=("travel_time_sec", "median"),
            p95_travel_time_sec=("travel_time_sec", lambda s: s.quantile(0.95)),
            benchmark_median_sec=("benchmark_travel_time_sec", "median"),
        )
    )
    agg["travel_time_index"] = agg["median_travel_time_sec"] / agg["benchmark_median_sec"].replace(0, pd.NA)
    agg["buffer_time_sec"] = agg["p95_travel_time_sec"] - agg["median_travel_time_sec"]
    agg["planning_time_index"] = agg["p95_travel_time_sec"] / agg["benchmark_median_sec"].replace(0, pd.NA)

    for col in [
        "median_travel_time_sec",
        "benchmark_median_sec",
        "travel_time_index",
        "buffer_time_sec",
        "planning_time_index",
    ]:
        agg[col] = pd.to_numeric(agg[col], errors="coerce").round(3)
    agg["sample_count"] = pd.to_numeric(agg["sample_count"], errors="coerce").fillna(0).astype("int64")
    agg = agg.drop(columns=["p95_travel_time_sec", "sample_count"])

    return agg.sort_values(["month", "line_id", "segment_id", "time_period"]).reset_index(drop=True)


def _longest_consecutive_month_streak(months: List[pd.Period]) -> int:
    if not months:
        return 0
    ordered = sorted(months)
    longest = 1
    current = 1
    for prev, nxt in zip(ordered, ordered[1:]):
        if (nxt.year - prev.year) * 12 + (nxt.month - prev.month) == 1:
            current += 1
            longest = max(longest, current)
        else:
            current = 1
    return longest


def _travel_time_slow_zones(travel_month: pd.DataFrame) -> pd.DataFrame:
    if travel_month.empty:
        return pd.DataFrame(
            columns=[
                "line_id",
                "segment_id",
                "from_stop_id",
                "to_stop_id",
                "from_stop_name",
                "to_stop_name",
                "slow_zone_threshold_index",
                "months_over_threshold",
                "longest_consecutive_months",
                "first_month_over_threshold",
                "last_month_over_threshold",
                "slow_zone_candidate",
            ]
        )

    segment_month = (
        travel_month.groupby(
            ["month", "line_id", "segment_id", "from_stop_id", "to_stop_id", "from_stop_name", "to_stop_name"],
            as_index=False,
        )
        .agg(travel_time_index=("travel_time_index", "median"))
    )

    threshold = 1.5
    rows: List[Dict[str, object]] = []
    for _, group in segment_month.groupby(
        ["line_id", "segment_id", "from_stop_id", "to_stop_id", "from_stop_name", "to_stop_name"],
        as_index=False,
    ):
        group = group.copy()
        over = group[group["travel_time_index"] > threshold]
        over_month_periods = [pd.Period(m, freq="M") for m in over["month"].astype(str).tolist()]
        longest = _longest_consecutive_month_streak(over_month_periods)
        first_month = str(min(over_month_periods)) if over_month_periods else None
        last_month = str(max(over_month_periods)) if over_month_periods else None

        rows.append(
            {
                "line_id": group["line_id"].iloc[0],
                "segment_id": group["segment_id"].iloc[0],
                "from_stop_id": group["from_stop_id"].iloc[0],
                "to_stop_id": group["to_stop_id"].iloc[0],
                "from_stop_name": group["from_stop_name"].iloc[0],
                "to_stop_name": group["to_stop_name"].iloc[0],
                "slow_zone_threshold_index": threshold,
                "months_over_threshold": len(over_month_periods),
                "longest_consecutive_months": int(longest),
                "first_month_over_threshold": first_month,
                "last_month_over_threshold": last_month,
                "slow_zone_candidate": bool(longest >= 3),
            }
        )

    out = pd.DataFrame(rows)
    out = out.sort_values(["line_id", "segment_id"]).reset_index(drop=True)
    return out


def _scheduled_vs_actual_line_time_period_season(
    schedule_reference: pd.DataFrame,
    headway_base: pd.DataFrame,
) -> pd.DataFrame:
    if schedule_reference.empty and headway_base.empty:
        return pd.DataFrame(
            columns=[
                "season",
                "line_id",
                "time_period",
                "scheduled_headway_sec",
                "scheduled_frequency_tph",
                "actual_headway_sec",
                "actual_frequency_tph",
                "actual_sample_count",
                "headway_gap_sec",
                "frequency_gap_tph",
                "scheduled_headway_change_vs_prev_sec",
                "scheduled_frequency_change_vs_prev_tph",
                "schedule_change_direction",
            ]
        )

    sched = schedule_reference.copy()
    for col in ["season", "route_id", "time_period", "scheduled_headway_sec"]:
        if col not in sched.columns:
            sched[col] = pd.NA
    sched["route_id"] = sched["route_id"].astype(str).str.strip()
    sched["line_id"] = _line_id_from_route(sched["route_id"])
    sched["scheduled_headway_sec"] = pd.to_numeric(sched["scheduled_headway_sec"], errors="coerce")
    sched = sched[sched["line_id"].isin(LINE_IDS)].copy()
    sched_group = (
        sched.groupby(["season", "line_id", "time_period"], as_index=False)
        .agg(scheduled_headway_sec=("scheduled_headway_sec", "median"))
    )
    sched_group["scheduled_frequency_tph"] = 3600.0 / sched_group["scheduled_headway_sec"].replace(0, pd.NA)

    if not headway_base.empty:
        actual = (
            headway_base.groupby(["season", "line_id", "time_period"], as_index=False)
            .agg(
                actual_headway_sec=("headway_actual_sec", "mean"),
                actual_sample_count=("headway_actual_sec", "size"),
            )
        )
        actual["actual_frequency_tph"] = 3600.0 / actual["actual_headway_sec"].replace(0, pd.NA)
    else:
        actual = pd.DataFrame(
            columns=["season", "line_id", "time_period", "actual_headway_sec", "actual_sample_count", "actual_frequency_tph"]
        )

    out = sched_group.merge(actual, on=["season", "line_id", "time_period"], how="outer")
    out["headway_gap_sec"] = out["actual_headway_sec"] - out["scheduled_headway_sec"]
    out["frequency_gap_tph"] = out["actual_frequency_tph"] - out["scheduled_frequency_tph"]

    out = _sort_by_season(out, ["line_id", "time_period"])
    out["scheduled_headway_change_vs_prev_sec"] = out.groupby(["line_id", "time_period"])[
        "scheduled_headway_sec"
    ].diff()
    out["scheduled_frequency_change_vs_prev_tph"] = out.groupby(["line_id", "time_period"])[
        "scheduled_frequency_tph"
    ].diff()

    out["schedule_change_direction"] = "No Change"
    out.loc[out["scheduled_headway_change_vs_prev_sec"] > 0, "schedule_change_direction"] = "Reduced Scheduled Service"
    out.loc[out["scheduled_headway_change_vs_prev_sec"] < 0, "schedule_change_direction"] = "Increased Scheduled Service"

    for col in [
        "scheduled_headway_sec",
        "scheduled_frequency_tph",
        "actual_headway_sec",
        "actual_frequency_tph",
        "headway_gap_sec",
        "frequency_gap_tph",
        "scheduled_headway_change_vs_prev_sec",
        "scheduled_frequency_change_vs_prev_tph",
    ]:
        out[col] = pd.to_numeric(out[col], errors="coerce").round(3)
    out["actual_sample_count"] = pd.to_numeric(out.get("actual_sample_count"), errors="coerce").fillna(0).astype("int64")

    return out.reset_index(drop=True)


def _service_delivery_line_season(
    events: pd.DataFrame,
    clean_gtfs: pd.DataFrame,
    schedule_reference: pd.DataFrame,
) -> pd.DataFrame:
    if events.empty and clean_gtfs.empty and schedule_reference.empty:
        return pd.DataFrame(
            columns=[
                "season",
                "line_id",
                "scheduled_avg_daily_trips",
                "scheduled_trips_source",
                "actual_avg_daily_trips",
                "actual_trips_source",
                "service_delivery_rate",
                "scheduled_trips_change_vs_prev",
                "delivery_rate_change_vs_prev",
            ]
        )

    # Actual trips/day/line from events.
    actual_daily = pd.DataFrame(columns=["service_date", "line_id", "actual_trips"])
    if not events.empty:
        e = events.copy()
        for col in ["service_date", "route_id", "trip_id"]:
            if col not in e.columns:
                e[col] = pd.NA
        e["service_date"] = pd.to_datetime(e["service_date"], errors="coerce").dt.normalize()
        e["route_id"] = e["route_id"].astype(str).str.strip()
        e["line_id"] = _line_id_from_route(e["route_id"])
        e = e[e["line_id"].isin(LINE_IDS)].copy()
        e["trip_id"] = e["trip_id"].astype(str).str.strip()
        actual_daily = (
            e.groupby(["service_date", "line_id"], as_index=False)
            .agg(actual_trips=("trip_id", "nunique"))
        )
    if not actual_daily.empty:
        actual_daily["season"] = _season_from_service_date(actual_daily["service_date"])
        actual_season = (
            actual_daily.groupby(["season", "line_id"], as_index=False)
            .agg(actual_avg_daily_trips=("actual_trips", "mean"))
        )
        actual_season["actual_trips_source"] = "events_observed"
    else:
        actual_season = pd.DataFrame(columns=["season", "line_id", "actual_avg_daily_trips", "actual_trips_source"])

    # Scheduled trips/day/line from clean GTFS recap (when available).
    sched_daily = pd.DataFrame(columns=["service_date", "line_id", "scheduled_trips"])
    if not clean_gtfs.empty:
        g = clean_gtfs.copy()
        for col in ["service_date", "route_id", "trip_id"]:
            if col not in g.columns:
                g[col] = pd.NA
        g["service_date"] = pd.to_datetime(g["service_date"], errors="coerce").dt.normalize()
        g["route_id"] = g["route_id"].astype(str).str.strip()
        g["line_id"] = _line_id_from_route(g["route_id"])
        g = g[g["line_id"].isin(LINE_IDS)].copy()
        g["trip_id"] = g["trip_id"].astype(str).str.strip()
        sched_daily = (
            g.groupby(["service_date", "line_id"], as_index=False)
            .agg(scheduled_trips=("trip_id", "nunique"))
        )
    if not sched_daily.empty:
        sched_daily["season"] = _season_from_service_date(sched_daily["service_date"])
        sched_season = (
            sched_daily.groupby(["season", "line_id"], as_index=False)
            .agg(scheduled_avg_daily_trips=("scheduled_trips", "mean"))
        )
        sched_season["scheduled_trips_source"] = "gtfs_daily"
    else:
        sched_season = pd.DataFrame(columns=["season", "line_id", "scheduled_avg_daily_trips", "scheduled_trips_source"])

    # Fill missing seasonal schedules from schedule_reference proxy.
    seasons_from_ref = pd.DataFrame(columns=["season", "line_id", "scheduled_proxy"])
    if not schedule_reference.empty:
        sr = schedule_reference.copy()
        for col in ["season", "route_id", "scheduled_headway_sec", "headway_samples"]:
            if col not in sr.columns:
                sr[col] = pd.NA
        sr["route_id"] = sr["route_id"].astype(str).str.strip()
        sr["line_id"] = _line_id_from_route(sr["route_id"])
        sr["headway_samples"] = pd.to_numeric(sr["headway_samples"], errors="coerce").fillna(0.0)
        sr["scheduled_headway_sec"] = pd.to_numeric(sr["scheduled_headway_sec"], errors="coerce")
        sr["scheduled_proxy"] = sr["headway_samples"] + (3600.0 / sr["scheduled_headway_sec"].replace(0, pd.NA)).fillna(0)
        seasons_from_ref = (
            sr.groupby(["season", "line_id"], as_index=False)
            .agg(scheduled_proxy=("scheduled_proxy", "sum"))
        )

    if not seasons_from_ref.empty:
        if not sched_season.empty:
            overlap = seasons_from_ref.merge(sched_season, on=["season", "line_id"], how="inner")
            if not overlap.empty:
                overlap["ratio"] = overlap["scheduled_avg_daily_trips"] / overlap["scheduled_proxy"].replace(0, pd.NA)
                scale = float(overlap["ratio"].dropna().median()) if overlap["ratio"].dropna().any() else 1.0
            else:
                scale = 1.0
        else:
            scale = 1.0

        proxy = seasons_from_ref.copy()
        proxy["scheduled_avg_daily_trips"] = (proxy["scheduled_proxy"] * scale).round(3)
        proxy["scheduled_trips_source"] = "schedule_reference_proxy"
        proxy = proxy.drop(columns=["scheduled_proxy"])
        sched_season = proxy.merge(
            sched_season,
            on=["season", "line_id"],
            how="left",
            suffixes=("_proxy", ""),
        )
        # prefer real gtfs_daily when available
        missing_real = sched_season["scheduled_avg_daily_trips"].isna()
        sched_season.loc[missing_real, "scheduled_avg_daily_trips"] = sched_season.loc[
            missing_real, "scheduled_avg_daily_trips_proxy"
        ]
        sched_season.loc[missing_real, "scheduled_trips_source"] = sched_season.loc[
            missing_real, "scheduled_trips_source_proxy"
        ]
        sched_season = sched_season.drop(
            columns=["scheduled_avg_daily_trips_proxy", "scheduled_trips_source_proxy"]
        )

    # Build season/line frame from schedule coverage.
    seasons_lines = pd.concat(
        [
            sched_season[["season", "line_id"]] if not sched_season.empty else pd.DataFrame(columns=["season", "line_id"]),
            seasons_from_ref[["season", "line_id"]] if not seasons_from_ref.empty else pd.DataFrame(columns=["season", "line_id"]),
            actual_season[["season", "line_id"]] if not actual_season.empty else pd.DataFrame(columns=["season", "line_id"]),
        ],
        ignore_index=True,
    ).drop_duplicates()

    out = seasons_lines.merge(sched_season, on=["season", "line_id"], how="left").merge(
        actual_season, on=["season", "line_id"], how="left"
    )

    # If actual is missing for a season, use latest observed season per line as baseline.
    if not actual_season.empty:
        baseline_map: Dict[str, Tuple[float, str]] = {}
        for line_id, grp in actual_season.groupby("line_id"):
            grp = grp.copy()
            grp["_season_key"] = grp["season"].map(_season_sort_key)
            latest = grp.sort_values("_season_key").iloc[-1]
            baseline_map[str(line_id)] = (
                float(latest["actual_avg_daily_trips"]),
                f"baseline_from_{latest['season']}",
            )

        for idx, row in out[out["actual_avg_daily_trips"].isna()].iterrows():
            line = str(row["line_id"])
            if line in baseline_map:
                out.at[idx, "actual_avg_daily_trips"] = baseline_map[line][0]
                out.at[idx, "actual_trips_source"] = baseline_map[line][1]

    out["service_delivery_rate"] = out["actual_avg_daily_trips"] / out["scheduled_avg_daily_trips"].replace(0, pd.NA)
    out = _sort_by_season(out, ["line_id"])
    out["scheduled_trips_change_vs_prev"] = out.groupby("line_id")["scheduled_avg_daily_trips"].diff()
    out["delivery_rate_change_vs_prev"] = out.groupby("line_id")["service_delivery_rate"].diff()

    out["schedule_change_flag"] = "No Change"
    out.loc[out["scheduled_trips_change_vs_prev"] < 0, "schedule_change_flag"] = "Reduced Scheduled Service"
    out.loc[out["scheduled_trips_change_vs_prev"] > 0, "schedule_change_flag"] = "Increased Scheduled Service"
    out["delivery_rate_trend"] = "Stable"
    out.loc[out["delivery_rate_change_vs_prev"] > 0, "delivery_rate_trend"] = "Improving"
    out.loc[out["delivery_rate_change_vs_prev"] < 0, "delivery_rate_trend"] = "Declining"

    for col in [
        "scheduled_avg_daily_trips",
        "actual_avg_daily_trips",
        "service_delivery_rate",
        "scheduled_trips_change_vs_prev",
        "delivery_rate_change_vs_prev",
    ]:
        out[col] = pd.to_numeric(out[col], errors="coerce").round(3)

    return out.reset_index(drop=True)


def _headway_group_metrics(df: pd.DataFrame, group_cols: Iterable[str]) -> pd.DataFrame:
    group_cols = list(group_cols)
    if df.empty:
        return pd.DataFrame(
            columns=group_cols
            + [
                "sample_count",
                "scheduled_sample_count",
                "avg_headway_sec",
                "std_headway_sec",
                "headway_cv",
                "avg_scheduled_headway_sec",
                "excess_wait_time_sec",
                "p90_headway_sec",
                "bunched_count",
                "bunching_rate_pct",
            ]
        )

    grouped = df.groupby(group_cols, as_index=False, dropna=False)
    agg = grouped.agg(
        sample_count=("headway_actual_sec", "size"),
        avg_headway_sec=("headway_actual_sec", "mean"),
        std_headway_sec=("headway_actual_sec", lambda s: s.std(ddof=0)),
        avg_scheduled_headway_sec=("scheduled_headway_sec", "mean"),
        p90_headway_sec=("headway_actual_sec", lambda s: s.quantile(0.9)),
    )

    sched = (
        df.assign(_has_sched=df["scheduled_headway_sec"] > 0)
        .groupby(group_cols, as_index=False, dropna=False)["_has_sched"]
        .sum()
        .rename(columns={"_has_sched": "scheduled_sample_count"})
    )
    bunched = (
        df.groupby(group_cols, as_index=False, dropna=False)["is_bunched"]
        .sum()
        .rename(columns={"is_bunched": "bunched_count"})
    )

    out = agg.merge(sched, on=group_cols, how="left").merge(bunched, on=group_cols, how="left")
    out["headway_cv"] = out["std_headway_sec"] / out["avg_headway_sec"].replace(0, pd.NA)
    out["excess_wait_time_sec"] = out["avg_headway_sec"] - out["avg_scheduled_headway_sec"]
    out["bunching_rate_pct"] = _safe_pct(out["bunched_count"], out["scheduled_sample_count"])

    numeric_round = {
        "avg_headway_sec": 2,
        "std_headway_sec": 2,
        "headway_cv": 3,
        "avg_scheduled_headway_sec": 2,
        "excess_wait_time_sec": 2,
        "p90_headway_sec": 2,
        "bunching_rate_pct": 2,
    }
    for col, digits in numeric_round.items():
        out[col] = pd.to_numeric(out[col], errors="coerce").round(digits)

    count_cols = ["sample_count", "scheduled_sample_count", "bunched_count"]
    for col in count_cols:
        out[col] = pd.to_numeric(out[col], errors="coerce").fillna(0).astype("int64")

    return out


def compute_metric_aggregations(year: int, processed_dir: Path) -> Dict[str, Dict[str, object]]:
    output_paths = metric_output_paths(processed_dir=processed_dir, year=year)

    events_path = processed_dir / f"clean_rapid_transit_events_{year}.parquet"
    if events_path.exists():
        events = pd.read_parquet(events_path)
        otp_base = _enrich_events(events)
    else:
        otp_base = pd.DataFrame()

    otp_outputs: Dict[str, pd.DataFrame] = {
        "otp_line_daily": _otp_line_daily(otp_base) if not otp_base.empty else pd.DataFrame(),
        "otp_line_station_time_period": _otp_line_station_time(otp_base) if not otp_base.empty else pd.DataFrame(),
        "otp_line_monthly": _otp_line_monthly(otp_base) if not otp_base.empty else pd.DataFrame(),
        "otp_system_daily": _otp_system_daily(otp_base) if not otp_base.empty else pd.DataFrame(),
    }

    stop_dim = _load_stop_dimensions(processed_dir=processed_dir, year=year)
    stop_name_map: Dict[str, str] = {}
    if not stop_dim.empty:
        stop_name_map = dict(zip(stop_dim["stop_id"], stop_dim["stop_name"]))

    headways_path = processed_dir / f"clean_rapid_transit_headways_{year}.parquet"
    if headways_path.exists():
        headways = pd.read_parquet(headways_path)
        headway_base = _enrich_headways(headways, stop_name_map)
    else:
        headway_base = pd.DataFrame()

    if not headway_base.empty:
        station_metrics = _headway_group_metrics(
            headway_base,
            ["month", "line_id", "route_id", "stop_id", "stop_name", "time_period", "day_type"],
        )
        station_metrics = station_metrics.sort_values(
            ["month", "line_id", "route_id", "stop_name", "time_period", "day_type"]
        ).reset_index(drop=True)

        green_branch = _headway_group_metrics(
            headway_base[headway_base["route_id"].isin(GREEN_BRANCHES)].copy(),
            ["month", "route_id", "time_period", "day_type"],
        )
        green_branch = green_branch.sort_values(
            ["month", "route_id", "time_period", "day_type"]
        ).reset_index(drop=True)
    else:
        station_metrics = pd.DataFrame()
        green_branch = pd.DataFrame()

    headway_outputs = {
        "headway_station_time_month": station_metrics,
        "headway_green_branch_month": green_branch,
    }

    travel_path = processed_dir / f"clean_rapid_transit_travel_times_{year}.parquet"
    if travel_path.exists():
        travel_raw = pd.read_parquet(travel_path)
        travel_base = _enrich_travel_times(travel_raw, stop_dim=stop_dim)
    else:
        travel_base = pd.DataFrame()

    travel_segment_month = _travel_time_segment_time_period_month(travel_base) if not travel_base.empty else pd.DataFrame()
    travel_slow_zones = _travel_time_slow_zones(travel_segment_month)
    travel_outputs = {
        "travel_time_segment_time_period_month": travel_segment_month,
        "travel_time_slow_zones": travel_slow_zones,
    }

    schedule_ref_path = processed_dir / f"schedule_reference_{year}.parquet"
    schedule_ref = pd.read_parquet(schedule_ref_path) if schedule_ref_path.exists() else pd.DataFrame()
    sched_vs_actual = _scheduled_vs_actual_line_time_period_season(
        schedule_reference=schedule_ref,
        headway_base=headway_base,
    )

    clean_gtfs_path = processed_dir / f"clean_gtfs_schedules_{year}.parquet"
    clean_gtfs = pd.read_parquet(clean_gtfs_path) if clean_gtfs_path.exists() else pd.DataFrame()
    service_delivery = _service_delivery_line_season(
        events=otp_base,
        clean_gtfs=clean_gtfs,
        schedule_reference=schedule_ref,
    )
    schedule_outputs = {
        "scheduled_vs_actual_line_time_period_season": sched_vs_actual,
        "service_delivery_line_season": service_delivery,
    }

    payload_specs = {
        **{
            key: {
                "records": _records(df),
                "type": "otp",
            }
            for key, df in otp_outputs.items()
        },
        **{
            key: {
                "records": _records(df),
                "type": "headway",
            }
            for key, df in headway_outputs.items()
        },
        **{
            key: {
                "records": _records(df),
                "type": "travel_time",
            }
            for key, df in travel_outputs.items()
        },
        **{
            key: {
                "records": _records(df),
                "type": "scheduled_vs_actual",
            }
            for key, df in schedule_outputs.items()
        },
    }

    artifacts: Dict[str, Dict[str, object]] = {}
    for key, spec in payload_specs.items():
        path = output_paths[key]
        payload = {
            "year": year,
            "aggregation": key,
            "metric_type": spec["type"],
            "line_ids": LINE_IDS,
            "time_period_order": TIME_PERIOD_ORDER,
            "records": spec["records"],
        }
        size_bytes = _write_compact_json(path, payload, max_bytes=MAX_JSON_BYTES)
        artifacts[key] = {
            "path": str(path.resolve()),
            "rows": len(spec["records"]),
            "size_bytes": size_bytes,
        }

    return artifacts
