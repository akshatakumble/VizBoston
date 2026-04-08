import { csvParse } from "d3";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DASHBOARD_YEAR = String(import.meta.env.VITE_DASHBOARD_YEAR || "2025");
const DATA_BASE_URL_ENV = import.meta.env.VITE_DATA_BASE_URL;
const DATA_BASE_URL = String(DATA_BASE_URL_ENV || "/data").replace(/\/+$/, "");
const FETCH_CACHE_MODE = import.meta.env.DEV ? "no-store" : "default";
const OTP_TARGET_PCT = Number(import.meta.env.VITE_MBTA_OTP_TARGET || 85);
const RELIABILITY_RANKING_MIN_EVENTS = Number(import.meta.env.VITE_RELIABILITY_RANKING_MIN_EVENTS || 200);
const TIME_PERIOD_ORDER = ["AM Peak", "Midday", "PM Peak", "Evening", "Late Night", "Other"];
const OVERVIEW_LINE_ORDER = ["Red", "Orange", "Blue", "Green", "Silver"];
const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_COMMUTER_CHAIN_HOPS = 8;
const WAIT_BUNCHING_MIN_OBSERVATIONS = Number(import.meta.env.VITE_WAIT_BUNCHING_MIN_OBSERVATIONS || 200);
const WAIT_BUNCHING_MAX_HEADWAY_MIN = Number(import.meta.env.VITE_WAIT_BUNCHING_MAX_HEADWAY_MIN || 60);
const WAIT_BUNCHING_MAX_P90_MIN = Number(import.meta.env.VITE_WAIT_BUNCHING_MAX_P90_MIN || 90);
const WAIT_EXCESS_MIN_MONTHLY_SAMPLES = Number(import.meta.env.VITE_WAIT_EXCESS_MIN_MONTHLY_SAMPLES || 300);
const TRAVEL_FRONTEND_MAX_SEQUENCE_GAP = Number(import.meta.env.VITE_TRAVEL_FRONTEND_MAX_SEQUENCE_GAP || 25);
const TRAVEL_FRONTEND_MAX_DISTANCE_KM = Number(import.meta.env.VITE_TRAVEL_FRONTEND_MAX_DISTANCE_KM || 4.0);

const DATASET_FILES = {
  otpLineDaily: `otp_line_daily_${DASHBOARD_YEAR}.json.gz`,
  otpLineMonthly: `otp_line_monthly_${DASHBOARD_YEAR}.json.gz`,
  otpSystemDaily: `otp_system_daily_${DASHBOARD_YEAR}.json.gz`,
  otpLineStationTimePeriod: `otp_line_station_time_period_${DASHBOARD_YEAR}.json.gz`,
  headwayStationTimeMonth: `headway_station_time_month_${DASHBOARD_YEAR}.json.gz`,
  headwayGreenBranchMonth: `headway_green_branch_month_${DASHBOARD_YEAR}.json.gz`,
  travelSegmentTimePeriodMonth: `travel_time_segment_time_period_month_${DASHBOARD_YEAR}.json.gz`,
  travelSlowZones: `travel_time_slow_zones_${DASHBOARD_YEAR}.json.gz`,
  scheduledVsActualBySeason: `scheduled_vs_actual_line_time_period_season_${DASHBOARD_YEAR}.json.gz`,
  serviceDeliveryBySeason: `service_delivery_line_season_${DASHBOARD_YEAR}.json.gz`,
  dashboardSummary: `dashboard_summary_${DASHBOARD_YEAR}.json.gz`,
  stationReferenceCsv: `downloads/station_reference_${DASHBOARD_YEAR}.csv`,
  geographyTopojson: `mbta_transit_geography_${DASHBOARD_YEAR}.topojson`,
  timelineAnnotations: "timeline_annotations.json",
};

const OPTIONAL_DATASETS = new Set([
  "otpLineMonthly",
  "headwayGreenBranchMonth",
  "travelSlowZones",
  "scheduledVsActualBySeason",
  "serviceDeliveryBySeason",
  "stationReferenceCsv",
  "geographyTopojson",
  "timelineAnnotations",
]);
const bundledGzipUrls = import.meta.glob("./*.json.gz", {
  eager: true,
  import: "default",
  query: "?url",
});
const bundledJsonUrls = import.meta.glob("./*.json", {
  eager: true,
  import: "default",
  query: "?url",
});
const bundledTopojsonUrls = import.meta.glob("./*.topojson", {
  eager: true,
  import: "default",
  query: "?url",
});
const inflightDatasetRequests = new Map();
const datasetValueCache = new Map();

function normalizeLineId(lineId) {
  const value = String(lineId || "").trim();
  if (!value) {
    return "";
  }
  const upper = value.toUpperCase();
  if (
    upper === "SILVER" ||
    upper === "SILVER LINE" ||
    /^SL[1-5W]?$/.test(upper) ||
    ["741", "742", "743", "746", "749", "751"].includes(value)
  ) {
    return "Silver";
  }
  if (value.startsWith("Green")) {
    return "Green";
  }
  if (value === "Mattapan") {
    return "Red";
  }
  return value;
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function average(numbers) {
  const valid = numbers
    .map((value) => toFiniteNumber(value))
    .filter((value) => value !== null);
  if (valid.length === 0) {
    return null;
  }
  const sum = valid.reduce((accumulator, value) => accumulator + value, 0);
  return sum / valid.length;
}

function monthKey(value) {
  const parsed = parseDateLike(value);
  if (!parsed) {
    return null;
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function monthLabel(value) {
  const parsed = parseDateLike(value);
  if (!parsed) {
    return String(value || "");
  }
  return parsed.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function shiftDays(date, deltaDays) {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + deltaDays);
  return shifted;
}

function formatDateYYYYMMDD(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildSparklineSeries(records, days = 90) {
  if (!Array.isArray(records) || records.length === 0) {
    return [];
  }

  const sorted = records
    .map((record) => ({
      date: formatDateYYYYMMDD(parseDateLike(record.date || record.service_date) || new Date(record.date)),
      value: toFiniteNumber(record.value ?? record.otp_pct),
    }))
    .filter((record) => record.date && record.value !== null)
    .sort((left, right) => left.date.localeCompare(right.date));

  if (sorted.length === 0) {
    return [];
  }

  const latestDate = parseDateLike(sorted[sorted.length - 1].date);
  const earliestDate = shiftDays(latestDate, -(days - 1));
  const valueByDate = new Map(sorted.map((record) => [record.date, record.value]));
  const baseline = sorted[0].value;
  const series = [];
  let carryValue = baseline;

  for (let index = 0; index < days; index += 1) {
    const day = shiftDays(earliestDate, index);
    const key = formatDateYYYYMMDD(day);
    const current = valueByDate.get(key);
    if (current !== undefined && current !== null) {
      carryValue = current;
    }
    series.push({ date: key, value: carryValue });
  }

  return series;
}

function parseDateLike(value) {
  if (!value) {
    return null;
  }
  const text = String(value);
  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);
    const day = first > 12 ? first : second;
    const month = first > 12 ? second : first;
    if (
      Number.isFinite(day) &&
      Number.isFinite(month) &&
      Number.isFinite(year) &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      const parsedSlashDate = new Date(year, month - 1, day);
      if (!Number.isNaN(parsedSlashDate.getTime())) {
        return parsedSlashDate;
      }
    }
  }
  const isoLike = text.length === 7 ? `${text}-01` : text;
  const parsed = new Date(isoLike);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function seasonYear(season) {
  const match = String(season || "").match(/(20\d{2})/);
  return match ? Number(match[1]) : null;
}

function seasonOrdinal(season) {
  const text = String(season || "");
  if (text.startsWith("Winter")) {
    return 1;
  }
  if (text.startsWith("Spring")) {
    return 2;
  }
  if (text.startsWith("Summer")) {
    return 3;
  }
  if (text.startsWith("Fall")) {
    return 4;
  }
  return 5;
}

function seasonAnchorDate(season) {
  const year = seasonYear(season);
  if (!Number.isFinite(year)) {
    return null;
  }
  const ordinal = seasonOrdinal(season);
  if (ordinal === 1) {
    return `${year}-01-01`;
  }
  if (ordinal === 2) {
    return `${year}-04-01`;
  }
  if (ordinal === 3) {
    return `${year}-07-01`;
  }
  if (ordinal === 4) {
    return `${year}-10-01`;
  }
  return `${year}-01-01`;
}

function normalizeText(value, fallback = "Unknown") {
  const text = String(value || "").trim();
  return text || fallback;
}

function isPlaceholderStopToken(value) {
  return /^stop_\d+$/i.test(String(value || "").trim());
}

function isNullLikeToken(value) {
  const token = String(value || "").trim().toLowerCase();
  return token === "nan" || token === "null" || token === "none" || token === "n/a" || token === "na" || token === "undefined";
}

function parseSyntheticStopIndex(value) {
  const match = String(value || "").trim().match(/^stop_(\d+)$/i);
  if (!match) {
    return null;
  }
  const index = Number(match[1]);
  return Number.isFinite(index) && index > 0 ? index : null;
}

function isNumericCode(value) {
  return /^\d+$/.test(String(value || "").trim());
}

function weekdayOrWeekend(dateValue) {
  const parsed = parseDateLike(dateValue);
  if (!parsed) {
    return "Unknown";
  }
  const day = parsed.getDay();
  return day === 0 || day === 6 ? "Weekend" : "Weekday";
}

function weekdayName(dateValue) {
  const parsed = parseDateLike(dateValue);
  if (!parsed) {
    return "Unknown";
  }
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][parsed.getDay()];
}

function directionLabel(directionId) {
  const normalized = String(directionId ?? "").trim();
  if (normalized === "0") {
    return "Direction 0";
  }
  if (normalized === "1") {
    return "Direction 1";
  }
  return "Unknown Direction";
}

function hourDistance(leftHour, rightHour) {
  if (leftHour === null || rightHour === null) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(leftHour - rightHour);
}

function monthNumber(value) {
  const parsed = parseDateLike(value);
  return parsed ? parsed.getMonth() + 1 : null;
}

function classifyTimePeriod(eventTimeSeconds) {
  const seconds = toFiniteNumber(eventTimeSeconds);
  if (seconds === null) {
    return "Other";
  }
  if (seconds >= 6.5 * 3600 && seconds < 9 * 3600) {
    return "AM Peak";
  }
  if (seconds >= 9 * 3600 && seconds < 15.5 * 3600) {
    return "Midday";
  }
  if (seconds >= 15.5 * 3600 && seconds < 18.5 * 3600) {
    return "PM Peak";
  }
  if (seconds >= 18.5 * 3600 && seconds < 23 * 3600) {
    return "Evening";
  }
  if (seconds >= 23 * 3600 || seconds < 1 * 3600) {
    return "Late Night";
  }
  return "Other";
}

function formatHourLabel(hourValue) {
  const hour = toFiniteNumber(hourValue);
  if (hour === null) {
    return "Unknown";
  }
  return `${String(Math.max(0, Math.min(23, Math.floor(hour)))).padStart(2, "0")}:00`;
}

function quantileFromSorted(sortedValues, quantile) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) {
    return null;
  }
  if (quantile <= 0) {
    return sortedValues[0];
  }
  if (quantile >= 1) {
    return sortedValues[sortedValues.length - 1];
  }
  const position = (sortedValues.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[upperIndex];
  if (lowerIndex === upperIndex) {
    return lower;
  }
  const fraction = position - lowerIndex;
  return lower + (upper - lower) * fraction;
}

function decodeTopologyArc(topology, arcIndex) {
  if (!topology || !Array.isArray(topology.arcs)) {
    return [];
  }
  const normalizedIndex = arcIndex >= 0 ? arcIndex : ~arcIndex;
  const arc = topology.arcs[normalizedIndex] || [];
  const coordinates = arc.map((point) => [Number(point[1]), Number(point[0])]);
  return arcIndex >= 0 ? coordinates : coordinates.reverse();
}

function haversineDistanceKm(latA, lonA, latB, lonB) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRadians(latB - latA);
  const dLon = toRadians(lonB - lonA);
  const lat1 = toRadians(latA);
  const lat2 = toRadians(latB);
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(haversine));
}

function extractStationPointsFromTopology(topology) {
  const collection = topology?.objects?.station_points;
  if (!collection || !Array.isArray(collection.geometries)) {
    return [];
  }

  const deduped = new Map();
  for (const geometry of collection.geometries) {
    if (!geometry || geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) {
      continue;
    }
    const lon = toFiniteNumber(geometry.coordinates[0]);
    const lat = toFiniteNumber(geometry.coordinates[1]);
    if (lat === null || lon === null) {
      continue;
    }

    const rawRouteId = normalizeText(geometry.properties?.route_id, "");
    const routeId = normalizeLineId(rawRouteId);
    if (!routeId) {
      continue;
    }

    const stopId = normalizeText(geometry.properties?.stop_id, "");
    const stopName = normalizeText(
      geometry.properties?.stop_name || geometry.properties?.station_name || stopId,
      stopId || "Unknown"
    );
    if (isPlaceholderStopToken(stopName) || isNumericCode(stopName)) {
      continue;
    }
    const stopSequence = toFiniteNumber(geometry.properties?.stop_sequence) ?? Number.POSITIVE_INFINITY;
    const lineColor = normalizeText(geometry.properties?.line_color, "");
    const isTransferStation = Boolean(geometry.properties?.is_transfer_station);

    const key = `${rawRouteId}||${stopId || stopName}||${lat.toFixed(6)}||${lon.toFixed(6)}`;
    const existing = deduped.get(key);
    if (!existing || stopSequence < existing.stopSequence) {
      deduped.set(key, {
        routeId,
        rawRouteId: rawRouteId || routeId,
        lineColor: lineColor || null,
        stopId,
        stopName,
        stopSequence,
        isTransferStation,
        coordinates: [lat, lon],
      });
    }
  }

  return Array.from(deduped.values()).sort((left, right) => {
    if (left.routeId !== right.routeId) {
      return left.routeId.localeCompare(right.routeId);
    }
    if (left.rawRouteId !== right.rawRouteId) {
      return left.rawRouteId.localeCompare(right.rawRouteId);
    }
    if (left.stopSequence !== right.stopSequence) {
      return left.stopSequence - right.stopSequence;
    }
    return left.stopName.localeCompare(right.stopName);
  });
}

function buildLineSegmentsFromStations(stationPoints) {
  if (!Array.isArray(stationPoints) || stationPoints.length === 0) {
    return [];
  }

  const byRawRoute = new Map();
  for (const station of stationPoints) {
    const bucket = byRawRoute.get(station.rawRouteId) || [];
    bucket.push(station);
    byRawRoute.set(station.rawRouteId, bucket);
  }

  const segments = [];
  const MAX_SEQUENCE_GAP = 10;
  const MAX_SEGMENT_KM = 3.5;

  for (const [rawRouteId, stations] of byRawRoute.entries()) {
    const localDeduped = new Map();
    for (const station of stations) {
      const key = `${station.stopName}||${station.coordinates[0].toFixed(5)}||${station.coordinates[1].toFixed(5)}`;
      const existing = localDeduped.get(key);
      if (!existing || station.stopSequence < existing.stopSequence) {
        localDeduped.set(key, station);
      }
    }
    const routeStations = Array.from(localDeduped.values()).sort((left, right) => {
      if (left.stopSequence !== right.stopSequence) {
        return left.stopSequence - right.stopSequence;
      }
      return left.stopName.localeCompare(right.stopName);
    });
    const seenEdges = new Set();

    for (const source of routeStations) {
      if (!Number.isFinite(source.stopSequence)) {
        continue;
      }
      let bestCandidate = null;

      for (const target of routeStations) {
        if (source.stopId === target.stopId || !Number.isFinite(target.stopSequence)) {
          continue;
        }
        const sequenceGap = target.stopSequence - source.stopSequence;
        if (sequenceGap <= 0 || sequenceGap > MAX_SEQUENCE_GAP) {
          continue;
        }

        const distanceKm = haversineDistanceKm(
          source.coordinates[0],
          source.coordinates[1],
          target.coordinates[0],
          target.coordinates[1]
        );
        if (distanceKm > MAX_SEGMENT_KM) {
          continue;
        }

        if (
          !bestCandidate ||
          sequenceGap < bestCandidate.sequenceGap ||
          (sequenceGap === bestCandidate.sequenceGap && distanceKm < bestCandidate.distanceKm)
        ) {
          bestCandidate = { target, distanceKm, sequenceGap };
        }
      }

      if (!bestCandidate) {
        continue;
      }

      const bestTarget = bestCandidate.target;
      const edgeKey = [source.stopId, bestTarget.stopId].sort().join("||");
      if (seenEdges.has(edgeKey)) {
        continue;
      }
      seenEdges.add(edgeKey);

      segments.push({
        routeId: source.routeId,
        rawRouteId,
        lineColor: source.lineColor || bestTarget.lineColor || null,
        coordinates: [source.coordinates, bestTarget.coordinates],
      });
    }
  }

  return segments;
}

function extractLinePathsFromTopology(topology, stationPoints = []) {
  const stationDerivedSegments = buildLineSegmentsFromStations(stationPoints);
  if (stationDerivedSegments.length > 0) {
    return stationDerivedSegments;
  }

  const paths = [];
  const lineCollection = topology?.objects?.line_paths;
  if (!lineCollection || !Array.isArray(lineCollection.geometries)) {
    return paths;
  }

  for (const geometry of lineCollection.geometries) {
    if (!geometry || geometry.type !== "LineString") {
      continue;
    }
    const coordinates = (geometry.arcs || [])
      .flatMap((arcIndex, index) => {
        const decoded = decodeTopologyArc(topology, arcIndex);
        if (index > 0 && decoded.length > 0) {
          return decoded.slice(1);
        }
        return decoded;
      })
      .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
    if (coordinates.length === 0) {
      continue;
    }
    paths.push({
      routeId: normalizeLineId(geometry.properties?.route_id),
      lineColor: geometry.properties?.line_color || null,
      coordinates,
    });
  }

  return paths;
}

function trendDirection(valuesByMonth) {
  const series = valuesByMonth
    .map((item) => ({
      month: parseDateLike(item.month),
      value: toFiniteNumber(item.value),
    }))
    .filter((item) => item.month && item.value !== null)
    .sort((left, right) => left.month - right.month);
  if (series.length < 2) {
    return "stable";
  }
  const first = series[0].value;
  const last = series[series.length - 1].value;
  const delta = last - first;
  if (delta >= 0.03) {
    return "degrading";
  }
  if (delta <= -0.03) {
    return "improving";
  }
  return "stable";
}

function buildDatasetUrls(fileName) {
  const urls = [];
  const preferSrcDataInDev =
    import.meta.env.DEV &&
    (!DATA_BASE_URL_ENV || String(DATA_BASE_URL_ENV).trim() === "" || DATA_BASE_URL === "/data");

  // In local dev, files live under src/data and are fetchable as static assets.
  // This avoids importing large CSV files as raw module strings.
  if (preferSrcDataInDev) {
    urls.push(`/src/data/${fileName}`);
    if (fileName.endsWith(".json.gz")) {
      urls.push(`/src/data/${fileName.replace(/\.gz$/, "")}`);
    }
  }

  if (DATA_BASE_URL) {
    urls.push(`${DATA_BASE_URL}/${fileName}`);
    if (fileName.endsWith(".json.gz")) {
      urls.push(`${DATA_BASE_URL}/${fileName.replace(/\.gz$/, "")}`);
    }
  }

  if (import.meta.env.DEV && !preferSrcDataInDev) {
    urls.push(`/src/data/${fileName}`);
    if (fileName.endsWith(".json.gz")) {
      urls.push(`/src/data/${fileName.replace(/\.gz$/, "")}`);
    }
  }

  const bundledPrimary =
    bundledGzipUrls[`./${fileName}`] ||
    bundledJsonUrls[`./${fileName}`] ||
    bundledTopojsonUrls[`./${fileName}`];
  if (bundledPrimary) {
    urls.push(bundledPrimary);
  }

  if (fileName.endsWith(".json.gz")) {
    const fallbackJsonFile = fileName.replace(/\.gz$/, "");
    const bundledJson = bundledJsonUrls[`./${fallbackJsonFile}`];
    if (bundledJson) {
      urls.push(bundledJson);
    }
  }

  return Array.from(new Set(urls));
}

async function readJsonText(response, sourceUrl) {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/html")) {
    throw new Error("Received HTML instead of JSON data.");
  }

  const isGzip = sourceUrl.endsWith(".gz");
  if (isGzip && typeof DecompressionStream !== "undefined" && response.body) {
    const decompressed = response.body.pipeThrough(new DecompressionStream("gzip"));
    const text = await new Response(decompressed).text();
    const trimmed = text.trim().toLowerCase();
    if (trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html")) {
      throw new Error("Received HTML instead of JSON data.");
    }
    return text;
  }

  const text = await response.text();
  const lowered = text.trim().toLowerCase();
  if (lowered.startsWith("<!doctype html") || lowered.startsWith("<html")) {
    throw new Error("Received HTML instead of JSON data.");
  }

  if (!isGzip) {
    return text;
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return text;
  }

  throw new Error(
    "Gzip assets require browser decompression support. Provide plain .json files for unsupported browsers."
  );
}

async function readCsvText(response) {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/html")) {
    throw new Error("Received HTML instead of CSV data.");
  }

  const text = await response.text();
  const lowered = text.trim().toLowerCase();
  if (lowered.startsWith("<!doctype html") || lowered.startsWith("<html")) {
    throw new Error("Received HTML instead of CSV data.");
  }
  return text;
}

function parseLenientJson(text, sourceUrl) {
  try {
    return JSON.parse(text);
  } catch (parseError) {
    const sanitized = text
      .replace(/\b-?Infinity\b/g, "null")
      .replace(/\bNaN\b/g, "null");
    try {
      return JSON.parse(sanitized);
    } catch {
      throw new Error(`Unable to parse dataset from ${sourceUrl}`);
    }
  }
}

async function fetchDatasetFile(fileName) {
  if (fileName.endsWith(".csv")) {
    return fetchCsvDatasetFile(fileName);
  }

  if (fileName.endsWith(".topojson")) {
    return fetchTopojsonDatasetFile(fileName);
  }

  const urls = buildDatasetUrls(fileName);
  if (urls.length === 0) {
    throw new Error(`No dataset URL candidates found for ${fileName}`);
  }

  const failures = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: FETCH_CACHE_MODE });
      if (!response.ok) {
        failures.push(`${url} (HTTP ${response.status})`);
        continue;
      }

      const text = await readJsonText(response, url);
      return parseLenientJson(text, url);
    } catch (error) {
      failures.push(`${url} (${error.message})`);
    }
  }

  throw new Error(`Failed to load ${fileName}. Tried: ${failures.join("; ")}`);
}

async function fetchTopojsonDatasetFile(fileName) {
  const urls = buildDatasetUrls(fileName);
  const failures = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: FETCH_CACHE_MODE });
      if (!response.ok) {
        failures.push(`${url} (HTTP ${response.status})`);
        continue;
      }
      const text = await readJsonText(response, url);
      return parseLenientJson(text, url);
    } catch (error) {
      failures.push(`${url} (${error.message})`);
    }
  }

  throw new Error(`Failed to load ${fileName}. Tried: ${failures.join("; ")}`);
}

async function fetchCsvDatasetFile(fileName) {
  const urls = buildDatasetUrls(fileName);
  const failures = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: FETCH_CACHE_MODE });
      if (!response.ok) {
        failures.push(`${url} (HTTP ${response.status})`);
        continue;
      }
      const text = await readCsvText(response);
      return { records: csvParse(text) };
    } catch (error) {
      failures.push(`${url} (${error.message})`);
    }
  }

  throw new Error(`Failed to load ${fileName}. Tried: ${failures.join("; ")}`);
}

async function loadDataset(datasetKey, fileName, { forceRefresh = false } = {}) {
  const cacheKey = `${datasetKey}:${fileName}`;
  if (!forceRefresh && datasetValueCache.has(cacheKey)) {
    return datasetValueCache.get(cacheKey);
  }

  if (!forceRefresh && inflightDatasetRequests.has(cacheKey)) {
    return inflightDatasetRequests.get(cacheKey);
  }

  const request = fetchDatasetFile(fileName)
    .then((payload) => {
      datasetValueCache.set(cacheKey, payload);
      return payload;
    })
    .finally(() => {
      inflightDatasetRequests.delete(cacheKey);
    });

  inflightDatasetRequests.set(cacheKey, request);
  return request;
}

async function loadAllDatasets({ forceRefresh = false } = {}) {
  const entries = Object.entries(DATASET_FILES);
  const loaded = await Promise.all(
    entries.map(async ([datasetKey, fileName]) => {
      try {
        const payload = await loadDataset(datasetKey, fileName, { forceRefresh });
        return [datasetKey, payload];
      } catch (error) {
        if (OPTIONAL_DATASETS.has(datasetKey)) {
          return [datasetKey, { records: [] }];
        }
        throw error;
      }
    })
  );

  return Object.fromEntries(loaded);
}

function sortByTimePeriod(left, right) {
  const leftIndex = TIME_PERIOD_ORDER.indexOf(left);
  const rightIndex = TIME_PERIOD_ORDER.indexOf(right);
  const safeLeft = leftIndex === -1 ? TIME_PERIOD_ORDER.length : leftIndex;
  const safeRight = rightIndex === -1 ? TIME_PERIOD_ORDER.length : rightIndex;
  if (safeLeft !== safeRight) {
    return safeLeft - safeRight;
  }
  return String(left).localeCompare(String(right));
}

export function useDashboardData({
  selectedLine = "All",
  startDate = "",
  endDate = "",
  timePeriod = "All",
  selectedStation = "All",
  reliabilityDayType = "All",
  selectedReliabilityCell = null,
  commuterOriginKey = "",
  commuterPairKey = "",
  commuterDepartureHour = 8,
  historicalLeftPeriod = "",
  historicalRightPeriod = "",
} = {}) {
  const [rawData, setRawData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadData = useCallback(async (forceRefresh = false) => {
    if (!mountedRef.current) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const data = await loadAllDatasets({ forceRefresh });
      if (!mountedRef.current) {
        return;
      }
      setRawData(data);
    } catch (loadError) {
      if (!mountedRef.current) {
        return;
      }
      setError(loadError.message || "Unable to load dashboard datasets.");
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  const retry = useCallback(() => {
    void loadData(true);
  }, [loadData]);

  const views = useMemo(() => {
    const empty = {
      overviewScorecards: [],
      overviewSystemTrend: [],
      overviewRadar: [],
      overviewHighlights: [],
      overviewGoalPct: OTP_TARGET_PCT,
      reliabilityStationHourHeatmap: [],
      reliabilityCalendarHeatmap: [],
      reliabilityOnTimeWindowBreakdown: null,
      reliabilityWorstStations: [],
      reliabilityRankingMinEvents: RELIABILITY_RANKING_MIN_EVENTS,
      reliabilitySelectedCell: null,
      reliabilityAvailableDates: [],
      otpTrendData: [],
      stationOtpHeatmapData: [],
      waitTimeHeatmapData: [],
      waitTimeBranchBars: [],
      waitTimesHeadwayHeatmap: [],
      waitTimesDistribution: [],
      waitTimesBunchingScatter: [],
      waitTimesGreenBranchComparison: [],
      waitTimesExcessTrend: [],
      travelMapSegments: [],
      travelLinePaths: [],
      travelStationPoints: [],
      travelSlowZoneTable: [],
      travelSegmentIds: [],
      serviceDeliveryBars: [],
      travelTimeTrendData: [],
      commuterBufferBars: [],
      commuterMatrixData: [],
      commuterOriginOptions: [],
      commuterDestinationOptions: [],
      commuterSelectedPair: null,
      commuterSummaryMetrics: null,
      commuterTimeProfile: [],
      commuterWeekdayBreakdown: [],
      commuterEffectiveOriginKey: "",
      commuterEffectivePairKey: "",
      historicalYoyOtp: [],
      historicalYoyCoverage: [],
      historicalFrequencyBars: [],
      historicalPredictionAccuracy: [],
      historicalServiceDeliveryTrend: [],
      historicalTimelineSeries: [],
      historicalTimelineMarkers: [],
      historicalPeriodOptions: [],
      historicalSideBySideBars: [],
      historicalScheduleChangeNotes: [],
      historicalEffectiveLeftPeriod: "",
      historicalEffectiveRightPeriod: "",
      stationOptions: ["All"],
      availableLines: [],
      year: Number(DASHBOARD_YEAR),
      lastUpdatedUtc: null,
    };

    if (!rawData) {
      return empty;
    }

    const start = parseDateLike(startDate);
    const end = parseDateLike(endDate);
    const selectedPeriod = String(timePeriod || "All");
    const selectedStationName = String(selectedStation || "All");

    const lineMatches = (lineId) => {
      if (selectedLine === "All") {
        return true;
      }
      return normalizeLineId(lineId) === selectedLine;
    };

    const periodMatches = (rowPeriod) =>
      selectedPeriod === "All" || String(rowPeriod || "Other") === selectedPeriod;

    const stationMatches = (...stations) => {
      if (selectedStationName === "All") {
        return true;
      }
      return stations.some((station) => normalizeText(station, "") === selectedStationName);
    };

    const dateInRange = (value) => {
      const parsed = parseDateLike(value);
      if (!parsed) {
        return true;
      }
      if (start && parsed < start) {
        return false;
      }
      if (end && parsed > end) {
        return false;
      }
      return true;
    };

    const seasonInRange = (season) => {
      const year = seasonYear(season);
      if (!year) {
        return true;
      }
      const startYear = start ? start.getFullYear() : null;
      const endYear = end ? end.getFullYear() : null;
      if (startYear && year < startYear) {
        return false;
      }
      if (endYear && year > endYear) {
        return false;
      }
      return true;
    };

    const otpDailyRecords = rawData.otpLineDaily?.records || [];
    const otpMonthlyRecords = rawData.otpLineMonthly?.records || [];
    const otpSystemDailyRecordsRaw = rawData.otpSystemDaily?.records || [];
    const otpStationRecords = rawData.otpLineStationTimePeriod?.records || [];
    const headwayRecords = rawData.headwayStationTimeMonth?.records || [];
    const greenBranchRecords = rawData.headwayGreenBranchMonth?.records || [];
    const travelRecords = rawData.travelSegmentTimePeriodMonth?.records || [];
    const travelSlowZoneRecords = rawData.travelSlowZones?.records || [];
    const scheduledVsActualRecords = rawData.scheduledVsActualBySeason?.records || [];
    const serviceDeliveryRecords = rawData.serviceDeliveryBySeason?.records || [];
    const stationReferenceRows = rawData.stationReferenceCsv?.records || [];
    const geographyTopology = rawData.geographyTopojson || null;
    const timelineAnnotationsRaw =
      rawData.timelineAnnotations?.records ||
      (Array.isArray(rawData.timelineAnnotations) ? rawData.timelineAnnotations : []);

    const derivedSystemDaily = [];
    if (otpSystemDailyRecordsRaw.length === 0) {
      const totalsByDate = new Map();
      for (const row of otpDailyRecords) {
        const date = row.service_date;
        const totalEvents = toFiniteNumber(row.total_events) || 0;
        const onTimeEvents = toFiniteNumber(row.on_time_events) || 0;
        const bucket = totalsByDate.get(date) || { service_date: date, total_events: 0, on_time_events: 0 };
        bucket.total_events += totalEvents;
        bucket.on_time_events += onTimeEvents;
        totalsByDate.set(date, bucket);
      }
      for (const bucket of totalsByDate.values()) {
        const reliability =
          bucket.total_events > 0 ? (bucket.on_time_events / bucket.total_events) * 100 : null;
        derivedSystemDaily.push({
          service_date: bucket.service_date,
          reliability_score_pct: reliability,
        });
      }
    }

    const otpSystemDailyRecords =
      otpSystemDailyRecordsRaw.length > 0 ? otpSystemDailyRecordsRaw : derivedSystemDaily;

    const availableLines = Array.from(
      new Set(
        [
          ...otpDailyRecords.map((row) => normalizeLineId(row.line_id)),
          ...headwayRecords.map((row) => normalizeLineId(row.line_id || row.route_id)),
          ...travelRecords.map((row) => normalizeLineId(row.line_id || row.route_id)),
        ].filter(Boolean)
      )
    ).sort();

    const stationSet = new Set();
    const stopNameByStopId = new Map();
    const orderedLineStations = new Map();

    for (const row of stationReferenceRows) {
      const lineName = normalizeLineId(row.route_id || row.line_id);
      const stopId = normalizeText(row.stop_id, "");
      const stopName = normalizeText(row.stop_name || row.station_name || row.canonical_stop_name || row.stop_id, "");
      const stopSequence = toFiniteNumber(row.stop_sequence);
      if (!stopId) {
        continue;
      }
      if (stopName && !isPlaceholderStopToken(stopName) && !stopNameByStopId.has(stopId)) {
        stopNameByStopId.set(stopId, stopName);
      }
      if (
        lineName &&
        stopName &&
        !isPlaceholderStopToken(stopName) &&
        !isNumericCode(stopName)
      ) {
        const bucket = orderedLineStations.get(lineName) || [];
        bucket.push({
          stopName,
          stopSequence: Number.isFinite(stopSequence) ? stopSequence : Number.POSITIVE_INFINITY,
        });
        orderedLineStations.set(lineName, bucket);
      }
    }

    for (const [lineName, entries] of orderedLineStations.entries()) {
      const deduped = [];
      const seen = new Set();
      entries
        .sort((left, right) => left.stopSequence - right.stopSequence || left.stopName.localeCompare(right.stopName))
        .forEach((entry) => {
          if (!seen.has(entry.stopName)) {
            seen.add(entry.stopName);
            deduped.push(entry.stopName);
          }
        });
      orderedLineStations.set(lineName, deduped);
    }

    const inferSyntheticStopName = (lineName, stopId) => {
      const idx = parseSyntheticStopIndex(stopId);
      if (!idx) {
        return "";
      }
      const lineStations = orderedLineStations.get(lineName) || [];
      if (lineStations.length === 0) {
        return "";
      }
      return lineStations[(idx - 1) % lineStations.length] || "";
    };

    const resolveStationName = (lineNameCandidate, nameCandidate, stopIdCandidate = "") => {
      const lineName = normalizeLineId(lineNameCandidate);
      const stopId = normalizeText(stopIdCandidate, "");
      const rawName = normalizeText(nameCandidate || stopIdCandidate, "");
      if (rawName && !isPlaceholderStopToken(rawName) && !isNumericCode(rawName) && !isNullLikeToken(rawName)) {
        return rawName;
      }
      const inferredFromSynthetic = inferSyntheticStopName(lineName, stopId);
      if (inferredFromSynthetic) {
        return inferredFromSynthetic;
      }
      if (stopId && stopNameByStopId.has(stopId)) {
        const candidate = normalizeText(stopNameByStopId.get(stopId), "");
        if (candidate && !isPlaceholderStopToken(candidate) && !isNumericCode(candidate) && !isNullLikeToken(candidate)) {
          return candidate;
        }
      }
      return "";
    };

    for (const row of otpStationRecords) {
      if (!lineMatches(row.line_id)) {
        continue;
      }
      const stationName = resolveStationName(row.line_id, row.station_name, row.stop_id);
      if (stationName && !isNumericCode(stationName)) {
        stationSet.add(stationName);
      }
    }
    for (const row of headwayRecords) {
      if (!lineMatches(row.line_id || row.route_id)) {
        continue;
      }
      const stationName = resolveStationName(
        row.line_id || row.route_id,
        row.stop_name || row.canonical_stop_name,
        row.stop_id
      );
      if (stationName && !isNumericCode(stationName)) {
        stationSet.add(stationName);
      }
    }
    for (const row of travelRecords) {
      if (!lineMatches(row.line_id || row.route_id)) {
        continue;
      }
      const lineName = row.line_id || row.route_id;
      const fromName = resolveStationName(lineName, row.from_stop_name, row.from_stop_id);
      const toName = resolveStationName(lineName, row.to_stop_name, row.to_stop_id);
      if (fromName) {
        stationSet.add(fromName);
      }
      if (toName) {
        stationSet.add(toName);
      }
    }
    const stationOptions = ["All", ...Array.from(stationSet).sort((a, b) => a.localeCompare(b))];

    const lineOrderMap = new Map(
      OVERVIEW_LINE_ORDER.map((lineName, index) => [lineName, index])
    );
    const stationSequenceMap = new Map();
    for (const row of stationReferenceRows) {
      const lineName = normalizeLineId(row.route_id || row.line_id);
      const stopId = normalizeText(row.stop_id, "");
      if (!lineName || !stopId) {
        continue;
      }
      const sequence = toFiniteNumber(row.stop_sequence);
      stationSequenceMap.set(`${lineName}||${stopId}`, sequence ?? Number.POSITIVE_INFINITY);
    }

    const isLikelyAdjacentTravelLink = (
      lineName,
      fromStopId,
      toStopId,
      fromLatitude,
      fromLongitude,
      toLatitude,
      toLongitude
    ) => {
      if (!lineName || !fromStopId || !toStopId || fromStopId === toStopId) {
        return false;
      }

      const fromSequence = stationSequenceMap.get(`${lineName}||${fromStopId}`);
      const toSequence = stationSequenceMap.get(`${lineName}||${toStopId}`);
      const hasFiniteSequence = Number.isFinite(fromSequence) && Number.isFinite(toSequence);
      if (hasFiniteSequence && Math.abs(fromSequence - toSequence) > TRAVEL_FRONTEND_MAX_SEQUENCE_GAP) {
        return false;
      }

      const hasFiniteCoords =
        Number.isFinite(fromLatitude) &&
        Number.isFinite(fromLongitude) &&
        Number.isFinite(toLatitude) &&
        Number.isFinite(toLongitude);
      if (
        hasFiniteCoords &&
        haversineDistanceKm(fromLatitude, fromLongitude, toLatitude, toLongitude) >
          TRAVEL_FRONTEND_MAX_DISTANCE_KM
      ) {
        return false;
      }

      // Reject links when neither topology signal is available.
      if (!hasFiniteSequence && !hasFiniteCoords) {
        return false;
      }

      return true;
    };

    const representativeSecondsByPeriod = {
      "AM Peak": Math.round(7.5 * 3600),
      Midday: Math.round(12.0 * 3600),
      "PM Peak": Math.round(17.0 * 3600),
      Evening: Math.round(20.0 * 3600),
      "Late Night": Math.round(23.5 * 3600),
      Other: Math.round(2.0 * 3600),
      Unknown: Math.round(12.0 * 3600),
    };

    const representativeSecondsForPeriod = (periodName) =>
      representativeSecondsByPeriod[normalizeText(periodName, "Other")] ??
      representativeSecondsByPeriod.Other;

    const selectedReliabilityDayTypeName = String(reliabilityDayType || "All");
    const reliabilityDayTypeMatches = (dayTypeName) =>
      selectedReliabilityDayTypeName === "All" || dayTypeName === selectedReliabilityDayTypeName;

    const reliabilityAvailableDates = Array.from(
      new Set(
        otpDailyRecords
          .filter((row) => lineMatches(row.line_id))
          .map((row) => normalizeText(row.service_date, ""))
          .filter(Boolean)
      )
    ).sort((left, right) => left.localeCompare(right));

    const reliabilityStationHourHeatmap = otpStationRecords
      .filter(
        (row) =>
          lineMatches(row.line_id) &&
          periodMatches(row.time_period) &&
          stationMatches(row.station_name || row.stop_id)
      )
      .map((row) => {
      const lineName = normalizeLineId(row.line_id);
      const stopId = normalizeText(row.stop_id, "");
      const stationName = resolveStationName(row.line_id, row.station_name, row.stop_id);
      if (!stationName || isNumericCode(stationName) || isNullLikeToken(stationName)) {
        return null;
      }
      const displayStation = selectedLine === "All" ? `${lineName} · ${stationName}` : stationName;
      const timePeriodName = normalizeText(row.time_period, "Other");
      const hourOfDay = Math.floor(representativeSecondsForPeriod(timePeriodName) / 3600) % 24;
        const lineRank = lineOrderMap.get(lineName) ?? 99;
        const sequence = stationSequenceMap.get(`${lineName}||${stopId}`) ?? Number.POSITIVE_INFINITY;
        const stationSortOrder = lineRank * 10000 + (Number.isFinite(sequence) ? sequence : 999);
        const totalEvents = toFiniteNumber(row.total_events) ?? 0;
        const onTimeEvents = toFiniteNumber(row.on_time_events) ?? 0;
        const earlyEvents = toFiniteNumber(row.early_events) ?? Math.max(0, totalEvents - onTimeEvents);
        const lateEvents = toFiniteNumber(row.late_events) ?? 0;
        const otpPct =
          toFiniteNumber(row.otp_pct) ??
          (totalEvents > 0 ? (onTimeEvents / totalEvents) * 100 : 0);

        return {
          station: displayStation,
          hour: formatHourLabel(hourOfDay),
          value: otpPct,
          line: lineName,
          stopId,
          hourValue: hourOfDay,
          stationSortOrder,
          totalEvents,
          onTimeEvents,
          earlyEvents,
          lateEvents,
          timePeriod: timePeriodName,
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (left.stationSortOrder !== right.stationSortOrder) {
          return left.stationSortOrder - right.stationSortOrder;
        }
        if (left.station !== right.station) {
          return left.station.localeCompare(right.station);
        }
        return left.hourValue - right.hourValue;
      });

    const selectedHeatCell =
      selectedReliabilityCell &&
      reliabilityStationHourHeatmap.find(
        (cell) =>
          String(cell.station) === String(selectedReliabilityCell.row) &&
          String(cell.hour) === String(selectedReliabilityCell.column)
      );

    const calendarByDate = new Map();
    for (const row of otpDailyRecords) {
      const lineName = normalizeLineId(row.line_id);
      const serviceDate = normalizeText(row.service_date, "");
      if (!lineName || !serviceDate) {
        continue;
      }
      if (!lineMatches(lineName) || !dateInRange(serviceDate) || !reliabilityDayTypeMatches(weekdayOrWeekend(serviceDate))) {
        continue;
      }
      const totalEvents = toFiniteNumber(row.total_events) ?? 0;
      const onTimeEvents = toFiniteNumber(row.on_time_events) ?? 0;
      const bucket = calendarByDate.get(serviceDate) || {
        serviceDate,
        totalEvents: 0,
        onTimeEvents: 0,
      };
      bucket.totalEvents += totalEvents;
      bucket.onTimeEvents += onTimeEvents;
      calendarByDate.set(serviceDate, bucket);
    }

    const reliabilityCalendarHeatmap = Array.from(calendarByDate.values())
      .map((bucket) => ({
        date: bucket.serviceDate,
        value: bucket.totalEvents > 0 ? (bucket.onTimeEvents / bucket.totalEvents) * 100 : 0,
        totalEvents: bucket.totalEvents,
      }))
      .sort((left, right) => left.date.localeCompare(right.date));

    const reliabilityOnTimeWindowCounts = selectedHeatCell
      ? {
          earlyEvents: toFiniteNumber(selectedHeatCell.earlyEvents) ?? 0,
          onTimeEvents: toFiniteNumber(selectedHeatCell.onTimeEvents) ?? 0,
          lateEvents: toFiniteNumber(selectedHeatCell.lateEvents) ?? 0,
        }
      : reliabilityStationHourHeatmap.reduce(
          (accumulator, row) => ({
            earlyEvents: (accumulator.earlyEvents ?? 0) + (toFiniteNumber(row.earlyEvents) ?? 0),
            onTimeEvents: (accumulator.onTimeEvents ?? 0) + (toFiniteNumber(row.onTimeEvents) ?? 0),
            lateEvents: (accumulator.lateEvents ?? 0) + (toFiniteNumber(row.lateEvents) ?? 0),
          }),
          { earlyEvents: 0, onTimeEvents: 0, lateEvents: 0 }
        );
    const reliabilityOnTimeTotal =
      reliabilityOnTimeWindowCounts.earlyEvents +
      reliabilityOnTimeWindowCounts.onTimeEvents +
      reliabilityOnTimeWindowCounts.lateEvents;
    const reliabilityOnTimeWindowBreakdown =
      reliabilityOnTimeTotal > 0
        ? {
            totalEvents: reliabilityOnTimeTotal,
            earlyEvents: reliabilityOnTimeWindowCounts.earlyEvents,
            onTimeEvents: reliabilityOnTimeWindowCounts.onTimeEvents,
            lateEvents: reliabilityOnTimeWindowCounts.lateEvents,
            earlyPct: (reliabilityOnTimeWindowCounts.earlyEvents / reliabilityOnTimeTotal) * 100,
            onTimePct: (reliabilityOnTimeWindowCounts.onTimeEvents / reliabilityOnTimeTotal) * 100,
            latePct: (reliabilityOnTimeWindowCounts.lateEvents / reliabilityOnTimeTotal) * 100,
          }
        : null;

    const stationRankingBuckets = new Map();
    for (const row of reliabilityStationHourHeatmap) {
      const key = `${row.line}||${row.station}`;
      const bucket = stationRankingBuckets.get(key) || {
        station: row.station,
        line: row.line,
        stationSortOrder: row.stationSortOrder,
        totalEvents: 0,
        onTimeEvents: 0,
      };
      bucket.totalEvents += toFiniteNumber(row.totalEvents) ?? 0;
      bucket.onTimeEvents += toFiniteNumber(row.onTimeEvents) ?? 0;
      stationRankingBuckets.set(key, bucket);
    }

    const reliabilityWorstStations = Array.from(stationRankingBuckets.values())
      .map((bucket) => ({
        station: bucket.station,
        line: bucket.line,
        otpPct: bucket.totalEvents > 0 ? (bucket.onTimeEvents / bucket.totalEvents) * 100 : 0,
        lateRatePct:
          bucket.totalEvents > 0 ? ((bucket.totalEvents - bucket.onTimeEvents) / bucket.totalEvents) * 100 : 0,
        totalEvents: bucket.totalEvents,
        stationSortOrder: bucket.stationSortOrder,
      }))
      .filter(
        (bucket) =>
          bucket.totalEvents >= RELIABILITY_RANKING_MIN_EVENTS &&
          bucket.station &&
          !isNullLikeToken(bucket.station) &&
          !isNumericCode(bucket.station)
      )
      .sort((left, right) => {
        if (left.otpPct !== right.otpPct) {
          return left.otpPct - right.otpPct;
        }
        if (right.totalEvents !== left.totalEvents) {
          return right.totalEvents - left.totalEvents;
        }
        return left.stationSortOrder - right.stationSortOrder;
      })
      .slice(0, 12);

    const normalizedHeadwayRows = headwayRecords
      .map((row) => {
        const month = normalizeText(row.month, "");
        const serviceDate = month ? `${month}-15` : "";
        const lineName = normalizeLineId(row.route_id || row.line_id);
        const stopId = normalizeText(row.stop_id, "");
        const stationName = normalizeText(row.stop_name || row.canonical_stop_name || row.stop_id);
        const timePeriodName = normalizeText(row.time_period, "Other");
        const eventTimeSec = representativeSecondsForPeriod(timePeriodName);
        const hourOfDay = Math.max(0, Math.min(23, Math.floor(eventTimeSec / 3600)));
        const headwayTrunkSec = toFiniteNumber(row.avg_headway_sec);
        const benchmarkSec = toFiniteNumber(row.avg_scheduled_headway_sec);
        const deviationSec =
          toFiniteNumber(row.headway_deviation_sec) ??
          (headwayTrunkSec !== null && benchmarkSec !== null ? headwayTrunkSec - benchmarkSec : null);
        const dayType = normalizeText(row.day_type, "All");
        const stationSequence =
          stationSequenceMap.get(`${lineName}||${stopId}`) ?? Number.POSITIVE_INFINITY;
        const sampleCount = Math.max(0, Math.round(toFiniteNumber(row.sample_count) ?? 0));
        const scheduledSampleCount = Math.max(0, Math.round(toFiniteNumber(row.scheduled_sample_count) ?? 0));
        return {
          serviceDate,
          lineName,
          stopId,
          stationName,
          eventTimeSec,
          hourOfDay,
          hourLabel: formatHourLabel(hourOfDay),
          headwayTrunkMin: headwayTrunkSec !== null ? headwayTrunkSec / 60 : null,
          benchmarkHeadwayMin: benchmarkSec !== null ? benchmarkSec / 60 : null,
          excessWaitMin: deviationSec !== null ? deviationSec / 60 : null,
          timePeriodName,
          dayType,
          stationSequence,
          routeId: normalizeText(row.route_id || row.line_id, ""),
          directionId: normalizeText(row.direction_id, ""),
          p90HeadwayMin: (() => {
            const p90 = toFiniteNumber(row.p90_headway_sec);
            return p90 !== null ? p90 / 60 : null;
          })(),
          headwayCv: toFiniteNumber(row.headway_cv),
          bunchingRatePct: toFiniteNumber(row.bunching_rate_pct),
          sampleCount,
          scheduledSampleCount,
        };
      })
      .filter((row) => row.serviceDate && row.lineName && row.stopId);

    const normalizedTravelTimeRows = travelRecords
      .map((row) => {
        const month = normalizeText(row.month, "");
        const serviceDate = month ? `${month}-15` : "";
        const lineName = normalizeLineId(row.route_id || row.line_id);
        const fromStopId = normalizeText(row.from_stop_id, "");
        const toStopId = normalizeText(row.to_stop_id, "");
        const fromLatitude = toFiniteNumber(row.from_latitude);
        const fromLongitude = toFiniteNumber(row.from_longitude);
        const toLatitude = toFiniteNumber(row.to_latitude);
        const toLongitude = toFiniteNumber(row.to_longitude);
        const fromStopName = resolveStationName(lineName, row.from_stop_name, fromStopId);
        const toStopName = resolveStationName(lineName, row.to_stop_name, toStopId);
        const inferredFromIndex = parseSyntheticStopIndex(fromStopId);
        const inferredToIndex = parseSyntheticStopIndex(toStopId);
        const rawDirectionId = normalizeText(row.direction_id, "");
        const directionId =
          rawDirectionId ||
          (inferredFromIndex !== null && inferredToIndex !== null
            ? inferredFromIndex < inferredToIndex
              ? "0"
              : inferredFromIndex > inferredToIndex
                ? "1"
                : ""
            : "");
        const timePeriodName = normalizeText(row.time_period, "Other");
        const eventTimeSec = representativeSecondsForPeriod(timePeriodName);
        const hourOfDay = Math.max(0, Math.min(23, Math.floor(eventTimeSec / 3600)));
        const travelTimeSec = toFiniteNumber(row.median_travel_time_sec);
        const benchmarkTravelTimeSec = toFiniteNumber(row.benchmark_median_sec);
        const bufferTimeSec = toFiniteNumber(row.buffer_time_sec);
        const planningTimeIndex = toFiniteNumber(row.planning_time_index);
        const p95TravelTimeSec =
          planningTimeIndex !== null && benchmarkTravelTimeSec !== null
            ? planningTimeIndex * benchmarkTravelTimeSec
            : travelTimeSec !== null && bufferTimeSec !== null
              ? travelTimeSec + bufferTimeSec
              : null;
        return {
          serviceDate,
          lineName,
          fromStopId,
          toStopId,
          fromStopName,
          toStopName,
          fromLatitude,
          fromLongitude,
          toLatitude,
          toLongitude,
          directionId,
          directionName: directionLabel(directionId),
          eventTimeSec,
          hourOfDay,
          hourLabel: formatHourLabel(hourOfDay),
          travelTimeSec,
          p95TravelTimeSec,
          benchmarkTravelTimeSec,
          timePeriodName,
          dayType: weekdayOrWeekend(serviceDate),
          dayName: weekdayName(serviceDate),
        };
      })
      .filter(
        (row) =>
          row.serviceDate &&
          row.lineName &&
          row.fromStopId &&
          row.toStopId &&
          row.fromStopId !== row.toStopId &&
          row.fromStopName &&
          row.toStopName &&
          isLikelyAdjacentTravelLink(
            row.lineName,
            row.fromStopId,
            row.toStopId,
            row.fromLatitude,
            row.fromLongitude,
            row.toLatitude,
            row.toLongitude
          ) &&
          row.travelTimeSec !== null
      );

    const filteredWaitTimesRows = normalizedHeadwayRows.filter(
      (row) =>
        lineMatches(row.lineName) &&
        dateInRange(row.serviceDate) &&
        periodMatches(row.timePeriodName) &&
        stationMatches(row.stationName, row.stopId)
    );

    const waitHeatBuckets = new Map();
    for (const row of filteredWaitTimesRows) {
      if (row.hourOfDay === null || row.headwayTrunkMin === null) {
        continue;
      }
      const displayStation =
        selectedLine === "All" ? `${row.lineName} · ${row.stationName}` : row.stationName;
      const key = `${displayStation}||${row.hourLabel}`;
      const lineRank = lineOrderMap.get(row.lineName) ?? 99;
      const sequence = Number.isFinite(row.stationSequence) ? row.stationSequence : 999;
      const stationSortOrder = lineRank * 10000 + sequence;
      const bucket = waitHeatBuckets.get(key) || {
        station: displayStation,
        hour: row.hourLabel,
        hourValue: row.hourOfDay,
        line: row.lineName,
        stationSortOrder,
        headwayTotal: 0,
        headwayCount: 0,
        p90Total: 0,
        p90Count: 0,
        cvTotal: 0,
        cvCount: 0,
        bunchingTotal: 0,
        bunchingCount: 0,
      };
      bucket.headwayTotal += row.headwayTrunkMin;
      bucket.headwayCount += 1;
      if (row.p90HeadwayMin !== null) {
        bucket.p90Total += row.p90HeadwayMin;
        bucket.p90Count += 1;
      }
      if (row.headwayCv !== null) {
        bucket.cvTotal += row.headwayCv;
        bucket.cvCount += 1;
      }
      if (row.bunchingRatePct !== null) {
        bucket.bunchingTotal += row.bunchingRatePct;
        bucket.bunchingCount += 1;
      }
      waitHeatBuckets.set(key, bucket);
    }

    const waitTimesHeadwayHeatmap = Array.from(waitHeatBuckets.values())
      .map((bucket) => ({
        station: bucket.station,
        hour: bucket.hour,
        value: bucket.headwayTotal / Math.max(1, bucket.headwayCount),
        headwayMin: bucket.headwayTotal / Math.max(1, bucket.headwayCount),
        p90HeadwayMin: bucket.p90Count > 0 ? bucket.p90Total / bucket.p90Count : null,
        headwayCvPct: bucket.cvCount > 0 ? (bucket.cvTotal / bucket.cvCount) * 100 : null,
        bunchingRatePct: bucket.bunchingCount > 0 ? bucket.bunchingTotal / bucket.bunchingCount : null,
        sampleCount: bucket.headwayCount,
        line: bucket.line,
        stationSortOrder: bucket.stationSortOrder,
        hourValue: bucket.hourValue,
      }))
      .sort((left, right) => {
        if (left.stationSortOrder !== right.stationSortOrder) {
          return left.stationSortOrder - right.stationSortOrder;
        }
        if (left.station !== right.station) {
          return left.station.localeCompare(right.station);
        }
        return left.hourValue - right.hourValue;
      });

    const distributionBuckets = new Map();
    for (const row of filteredWaitTimesRows) {
      if (row.headwayTrunkMin === null) {
        continue;
      }
      const periodGroup =
        row.timePeriodName === "AM Peak" || row.timePeriodName === "PM Peak" ? "Peak" : "Off-Peak";
      const key = `${row.lineName}||${periodGroup}`;
      const values = distributionBuckets.get(key) || [];
      values.push(row.headwayTrunkMin);
      distributionBuckets.set(key, values);
    }

    const waitTimesDistribution = Array.from(distributionBuckets.entries())
      .map(([key, values]) => {
        const [line, periodGroup] = key.split("||");
        const sorted = values.slice().sort((left, right) => left - right);
        return {
          line,
          periodGroup,
          count: sorted.length,
          min: quantileFromSorted(sorted, 0),
          p10: quantileFromSorted(sorted, 0.1),
          q1: quantileFromSorted(sorted, 0.25),
          median: quantileFromSorted(sorted, 0.5),
          q3: quantileFromSorted(sorted, 0.75),
          p90: quantileFromSorted(sorted, 0.9),
          max: quantileFromSorted(sorted, 1),
        };
      })
      .sort((left, right) => {
        const leftRank = lineOrderMap.get(left.line) ?? 99;
        const rightRank = lineOrderMap.get(right.line) ?? 99;
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
        const periodRank = { Peak: 0, "Off-Peak": 1 };
        const leftPeriod = periodRank[left.periodGroup] ?? 9;
        const rightPeriod = periodRank[right.periodGroup] ?? 9;
        if (leftPeriod !== rightPeriod) {
          return leftPeriod - rightPeriod;
        }
        return left.line.localeCompare(right.line);
      });

    const coreBunchingPeriods = new Set(["AM Peak", "Midday", "PM Peak", "Evening"]);
    const bunchingSourceRows = filteredWaitTimesRows.filter((row) => {
      if (selectedPeriod === "All" && !coreBunchingPeriods.has(row.timePeriodName)) {
        return false;
      }
      if (row.headwayTrunkMin === null || row.p90HeadwayMin === null) {
        return false;
      }
      if (row.sampleCount <= 0 || row.scheduledSampleCount <= 0) {
        return false;
      }
      if (row.headwayTrunkMin > WAIT_BUNCHING_MAX_HEADWAY_MIN || row.p90HeadwayMin > WAIT_BUNCHING_MAX_P90_MIN) {
        return false;
      }
      return true;
    });

    const bunchingBuckets = new Map();
    for (const row of bunchingSourceRows) {
      const key = `${row.lineName}||${row.stationName}`;
      const weight = Math.max(1, row.sampleCount);
      const bucket = bunchingBuckets.get(key) || {
        line: row.lineName,
        station: row.stationName,
        headwayWeightedTotal: 0,
        p90WeightedTotal: 0,
        cvWeightedTotal: 0,
        cvWeightTotal: 0,
        bunchingWeightedTotal: 0,
        bunchingWeightTotal: 0,
        sampleCount: 0,
      };
      bucket.headwayWeightedTotal += row.headwayTrunkMin * weight;
      bucket.p90WeightedTotal += row.p90HeadwayMin * weight;
      bucket.sampleCount += weight;
      if (row.headwayCv !== null) {
        bucket.cvWeightedTotal += row.headwayCv * weight;
        bucket.cvWeightTotal += weight;
      }
      if (row.bunchingRatePct !== null) {
        bucket.bunchingWeightedTotal += row.bunchingRatePct * weight;
        bucket.bunchingWeightTotal += weight;
      }
      bunchingBuckets.set(key, bucket);
    }

    const waitTimesBunchingScatter = Array.from(bunchingBuckets.values())
      .map((bucket) => {
        const avgCv = bucket.cvWeightTotal > 0 ? bucket.cvWeightedTotal / bucket.cvWeightTotal : 0;
        const avgBunching = bucket.bunchingWeightTotal > 0 ? bucket.bunchingWeightedTotal / bucket.bunchingWeightTotal : 0;
        const avgHeadway = bucket.sampleCount > 0 ? bucket.headwayWeightedTotal / bucket.sampleCount : null;
        const avgP90 = bucket.sampleCount > 0 ? bucket.p90WeightedTotal / bucket.sampleCount : null;
        return {
          x: avgHeadway,
          y: avgP90,
          line: bucket.line,
          station: bucket.station,
          regularity: Math.max(0, 1 - avgCv),
          bunchingRatePct: avgBunching,
          bunched: avgBunching >= 10,
          sampleCount: bucket.sampleCount,
        };
      })
      .filter(
        (bucket) =>
          bucket.x !== null &&
          bucket.y !== null &&
          bucket.sampleCount >= WAIT_BUNCHING_MIN_OBSERVATIONS
      )
      .sort((left, right) => right.sampleCount - left.sampleCount || left.line.localeCompare(right.line));

    const shouldShowGreenBranchComparison = selectedLine === "All" || selectedLine === "Green";
    const greenBranchSourceRows =
      (greenBranchRecords || []).length > 0
        ? greenBranchRecords
            .filter((row) => dateInRange(row.month) && periodMatches(row.time_period))
            .map((row) => {
              const branch = normalizeText(row.branch_id || row.branch || row.route_id || row.line_id, "");
              const avgHeadwaySec = toFiniteNumber(row.avg_headway_sec);
              const p90HeadwaySec = toFiniteNumber(row.p90_headway_sec);
              const sampleCount = Math.max(0, Math.round(toFiniteNumber(row.sample_count) ?? 0));
              return {
                branch,
                headwayMin:
                  avgHeadwaySec !== null
                    ? avgHeadwaySec / 60
                    : p90HeadwaySec !== null
                      ? p90HeadwaySec / 60
                      : null,
                sampleCount,
              };
            })
        : normalizedHeadwayRows
            .filter(
              (row) =>
                row.routeId.startsWith("Green-") &&
                dateInRange(row.serviceDate) &&
                periodMatches(row.timePeriodName)
            )
            .map((row) => ({
              branch: row.routeId,
              headwayMin: row.headwayTrunkMin,
              sampleCount: row.sampleCount,
            }));

    const greenBranchBuckets = new Map();
    for (const row of greenBranchSourceRows) {
      if (!shouldShowGreenBranchComparison) {
        continue;
      }
      if (!row.branch.startsWith("Green-") || row.headwayMin === null || row.sampleCount <= 0) {
        continue;
      }
      const weight = Math.max(1, row.sampleCount);
      const bucket = greenBranchBuckets.get(row.branch) || {
        branch: row.branch,
        headwayWeightedTotal: 0,
        sampleTotal: 0,
      };
      bucket.headwayWeightedTotal += row.headwayMin * weight;
      bucket.sampleTotal += weight;
      greenBranchBuckets.set(row.branch, bucket);
    }

    const greenBranchOrder = new Map([
      ["Green-B", 0],
      ["Green-C", 1],
      ["Green-D", 2],
      ["Green-E", 3],
    ]);
    const waitTimesGreenBranchComparison = Array.from(greenBranchBuckets.values())
      .map((bucket) => ({
        branch: bucket.branch,
        headwayMin: bucket.sampleTotal > 0 ? bucket.headwayWeightedTotal / bucket.sampleTotal : null,
        sampleCount: bucket.sampleTotal,
      }))
      .filter((row) => row.headwayMin !== null)
      .sort(
        (left, right) =>
          (greenBranchOrder.get(left.branch) ?? 99) - (greenBranchOrder.get(right.branch) ?? 99)
      );

    const excessSourceRows = filteredWaitTimesRows.filter((row) => {
      if (row.excessWaitMin === null) {
        return false;
      }
      if (selectedPeriod === "All" && !coreBunchingPeriods.has(row.timePeriodName)) {
        return false;
      }
      if (row.sampleCount <= 0 || row.scheduledSampleCount <= 0) {
        return false;
      }
      return true;
    });

    const excessBuckets = new Map();
    for (const row of excessSourceRows) {
      if (row.excessWaitMin === null) {
        continue;
      }
      const month = monthKey(row.serviceDate);
      if (!month) {
        continue;
      }
      const weight = Math.max(1, row.sampleCount);
      const key = `${month}||${row.lineName}`;
      const bucket = excessBuckets.get(key) || { month, line: row.lineName, weightedTotal: 0, sampleTotal: 0 };
      bucket.weightedTotal += row.excessWaitMin * weight;
      bucket.sampleTotal += weight;
      excessBuckets.set(key, bucket);
    }

    const waitTimesExcessTrend = Array.from(excessBuckets.values())
      .map((bucket) => ({
        month: `${bucket.month}-01`,
        line: bucket.line,
        value: bucket.sampleTotal > 0 ? bucket.weightedTotal / bucket.sampleTotal : null,
        sampleCount: bucket.sampleTotal,
      }))
      .filter((bucket) => bucket.value !== null && bucket.sampleCount >= WAIT_EXCESS_MIN_MONTHLY_SAMPLES)
      .sort((left, right) => left.month.localeCompare(right.month) || left.line.localeCompare(right.line));

    const overviewLines =
      selectedLine === "All" ? OVERVIEW_LINE_ORDER : OVERVIEW_LINE_ORDER.filter((line) => line === selectedLine);

    const lineOtpRecords = new Map();
    for (const row of otpDailyRecords) {
      const line = normalizeLineId(row.line_id);
      if (!line || !overviewLines.includes(line)) {
        continue;
      }
      if (!dateInRange(row.service_date)) {
        continue;
      }
      const otpPct = toFiniteNumber(row.otp_pct);
      const totalEvents = toFiniteNumber(row.total_events);
      const onTimeEvents = toFiniteNumber(row.on_time_events);
      const lateEvents = toFiniteNumber(row.late_events);
      const derivedOtp =
        otpPct !== null
          ? otpPct
          : totalEvents && totalEvents > 0 && onTimeEvents !== null
            ? (onTimeEvents / totalEvents) * 100
            : null;
      if (derivedOtp === null) {
        continue;
      }
      const existing = lineOtpRecords.get(line) || [];
      existing.push({
        service_date: row.service_date,
        otp_pct: derivedOtp,
        total_events: totalEvents,
        on_time_events: onTimeEvents,
        late_events: lateEvents,
      });
      lineOtpRecords.set(line, existing);
    }

    const excessWaitByLine = new Map();
    for (const row of filteredWaitTimesRows) {
      if (!overviewLines.includes(row.lineName) || row.excessWaitMin === null) {
        continue;
      }
      const bucket = excessWaitByLine.get(row.lineName) || { total: 0, count: 0 };
      bucket.total += row.excessWaitMin;
      bucket.count += 1;
      excessWaitByLine.set(row.lineName, bucket);
    }

    const overviewScorecards = overviewLines.map((line) => {
      const records = (lineOtpRecords.get(line) || []).sort((left, right) =>
        left.service_date.localeCompare(right.service_date)
      );
      if (records.length > 0) {
        const sparkline = buildSparklineSeries(
          records.map((record) => ({ date: record.service_date, value: record.otp_pct })),
          90
        );
        const latest = records[records.length - 1] || null;
        const latestOtp = latest ? toFiniteNumber(latest.otp_pct) : null;
        const latestTotalEvents = latest ? toFiniteNumber(latest.total_events) : null;
        const latestLateEvents = latest ? toFiniteNumber(latest.late_events) : null;
        const latestNotLatePct =
          latestTotalEvents && latestTotalEvents > 0 && latestLateEvents !== null
            ? ((latestTotalEvents - latestLateEvents) / latestTotalEvents) * 100
            : null;
        const recentAverage = average(sparkline.slice(-30).map((point) => point.value));
        const baselineAverage = average(sparkline.slice(0, 30).map((point) => point.value));
        const delta90 =
          recentAverage !== null && baselineAverage !== null ? recentAverage - baselineAverage : null;
        const excessWaitBucket = excessWaitByLine.get(line);
        const avgExcessWaitMin =
          excessWaitBucket && excessWaitBucket.count > 0
            ? excessWaitBucket.total / excessWaitBucket.count
            : null;

        return {
          line,
          latestOtpPct: latestOtp,
          latestNotLatePct,
          avgExcessWaitMin,
          latestDate: latest?.service_date || null,
          sparkline90d: sparkline,
          delta90dPct: delta90,
          metricLabel: "OTP",
        };
      }

      return {
        line,
        latestOtpPct: null,
        latestNotLatePct: null,
        avgExcessWaitMin: null,
        latestDate: null,
        sparkline90d: [],
        delta90dPct: null,
        metricLabel: "OTP",
      };
    });

    const systemDailyFiltered = otpSystemDailyRecords
      .filter((row) => dateInRange(row.service_date))
      .map((row) => ({
        service_date: row.service_date,
        value:
          toFiniteNumber(row.reliability_score_pct) ??
          (() => {
            const total = toFiniteNumber(row.total_events);
            const onTime = toFiniteNumber(row.on_time_events);
            if (total && total > 0 && onTime !== null) {
              return (onTime / total) * 100;
            }
            return null;
          })(),
      }))
      .filter((row) => row.value !== null)
      .sort((left, right) => left.service_date.localeCompare(right.service_date));

    const monthlyValues = new Map();
    for (const row of systemDailyFiltered) {
      const key = monthKey(row.service_date);
      if (!key) {
        continue;
      }
      const bucket = monthlyValues.get(key) || [];
      bucket.push(row.value);
      monthlyValues.set(key, bucket);
    }

    const fallbackDate =
      parseDateLike(systemDailyFiltered[systemDailyFiltered.length - 1]?.service_date) ||
      parseDateLike(`${DASHBOARD_YEAR}-12-01`) ||
      new Date();
    const endMonth = new Date(fallbackDate.getFullYear(), fallbackDate.getMonth(), 1);
    const monthWindow = [];
    for (let index = 11; index >= 0; index -= 1) {
      const monthDate = new Date(endMonth.getFullYear(), endMonth.getMonth() - index, 1);
      monthWindow.push(monthDate);
    }

    const monthlySeries = monthWindow.map((monthDate) => {
      const key = formatDateYYYYMMDD(monthDate).slice(0, 7);
      return {
        month: key,
        date: `${key}-01`,
        label: monthLabel(`${key}-01`),
        value: average(monthlyValues.get(key) || []),
      };
    });

    const knownMonthlyValues = monthlySeries
      .map((item) => item.value)
      .filter((value) => value !== null);
    const fallbackMonthlyValue = average(knownMonthlyValues) ?? OTP_TARGET_PCT;
    let carryForward = fallbackMonthlyValue;
    const overviewSystemTrend = monthlySeries.map((item) => {
      const nextValue = item.value !== null ? item.value : carryForward;
      carryForward = nextValue;
      return {
        ...item,
        value: nextValue,
        goal: OTP_TARGET_PCT,
        isImputed: item.value === null,
      };
    });

    const headwayByLine = new Map();
    for (const row of headwayRecords) {
      const line = normalizeLineId(row.line_id || row.route_id);
      if (!line || !overviewLines.includes(line)) {
        continue;
      }
      if (!dateInRange(row.month)) {
        continue;
      }
      const avgHeadwaySec = toFiniteNumber(row.avg_headway_sec);
      const cv = toFiniteNumber(row.headway_cv);
      const bucket = headwayByLine.get(line) || { headway: [], cv: [] };
      if (avgHeadwaySec !== null) {
        bucket.headway.push(avgHeadwaySec / 60);
      }
      if (cv !== null) {
        bucket.cv.push(cv);
      }
      headwayByLine.set(line, bucket);
    }

    // Fill gaps (notably Silver) with schedule-backed headway when observed headway is unavailable.
    for (const row of scheduledVsActualRecords) {
      const line = normalizeLineId(row.line_id || row.route_id);
      if (!line || !overviewLines.includes(line)) {
        continue;
      }
      if (!seasonInRange(row.season)) {
        continue;
      }
      const headwaySec =
        toFiniteNumber(row.actual_headway_sec) ??
        toFiniteNumber(row.scheduled_headway_sec);
      if (headwaySec === null) {
        continue;
      }
      const bucket = headwayByLine.get(line) || { headway: [], cv: [] };
      bucket.headway.push(headwaySec / 60);
      headwayByLine.set(line, bucket);
    }

    const travelByLine = new Map();
    for (const row of travelRecords) {
      const line = normalizeLineId(row.line_id || row.route_id);
      if (!line || !overviewLines.includes(line)) {
        continue;
      }
      if (!dateInRange(row.month)) {
        continue;
      }
      const tti = toFiniteNumber(row.travel_time_index);
      if (tti === null) {
        continue;
      }
      const bucket = travelByLine.get(line) || [];
      bucket.push(tti);
      travelByLine.set(line, bucket);
    }

    const serviceByLine = new Map();
    for (const row of serviceDeliveryRecords) {
      const line = normalizeLineId(row.line_id);
      if (!line || !overviewLines.includes(line)) {
        continue;
      }
      if (!seasonInRange(row.season)) {
        continue;
      }
      const rate = toFiniteNumber(row.service_delivery_rate);
      if (rate === null) {
        continue;
      }
      const bucket = serviceByLine.get(line) || [];
      bucket.push(rate);
      serviceByLine.set(line, bucket);
    }

    const radarRawMetrics = overviewLines.map((line) => {
      const otpRecords = lineOtpRecords.get(line) || [];
      let otpTotalEvents = 0;
      let otpOnTimeEvents = 0;
      for (const record of otpRecords) {
        const total = toFiniteNumber(record.total_events);
        const onTime = toFiniteNumber(record.on_time_events);
        if (total && total > 0 && onTime !== null) {
          otpTotalEvents += total;
          otpOnTimeEvents += onTime;
        }
      }
      const periodAvgOtpPct =
        otpTotalEvents > 0 ? (otpOnTimeEvents / otpTotalEvents) * 100 : average(otpRecords.map((record) => record.otp_pct));
      return {
        line,
        otp_pct: periodAvgOtpPct,
        avg_headway_min: average((headwayByLine.get(line) || {}).headway || []),
        travel_time_index: average(travelByLine.get(line) || []),
        headway_cv_pct: (() => {
          const cv = average((headwayByLine.get(line) || {}).cv || []);
          return cv === null ? null : cv * 100;
        })(),
        service_delivery_pct: (() => {
          const rate = average(serviceByLine.get(line) || []);
          return rate === null ? null : rate * 100;
        })(),
      };
    });

    const metricSpecs = [
      { key: "otp_pct", higherIsBetter: true },
      { key: "avg_headway_min", higherIsBetter: false },
      { key: "travel_time_index", higherIsBetter: false },
      { key: "headway_cv_pct", higherIsBetter: false },
      { key: "service_delivery_pct", higherIsBetter: true },
    ];

    const overviewRadar = radarRawMetrics.map((lineRow) => {
      const normalized = {};
      for (const spec of metricSpecs) {
        const values = radarRawMetrics
          .map((candidate) => toFiniteNumber(candidate[spec.key]))
          .filter((value) => value !== null);
        const minimum = values.length > 0 ? Math.min(...values) : null;
        const maximum = values.length > 0 ? Math.max(...values) : null;
        const rawValue = toFiniteNumber(lineRow[spec.key]);

        if (rawValue === null || minimum === null || maximum === null) {
          normalized[spec.key] = 0;
          continue;
        }

        if (maximum === minimum) {
          normalized[spec.key] = 70;
          continue;
        }

        const percent = spec.higherIsBetter
          ? ((rawValue - minimum) / (maximum - minimum)) * 100
          : ((maximum - rawValue) / (maximum - minimum)) * 100;
        normalized[spec.key] = Math.max(0, Math.min(100, percent));
      }

      return {
        line: lineRow.line,
        metrics: lineRow,
        normalized,
      };
    });

    const bestOtp = radarRawMetrics
      .filter((row) => row.otp_pct !== null)
      .sort((left, right) => right.otp_pct - left.otp_pct)[0];
    const bestHeadway = radarRawMetrics
      .filter((row) => row.avg_headway_min !== null)
      .sort((left, right) => left.avg_headway_min - right.avg_headway_min)[0];
    const worstTravel = radarRawMetrics
      .filter((row) => row.travel_time_index !== null)
      .sort((left, right) => right.travel_time_index - left.travel_time_index)[0];
    const bestDelivery = radarRawMetrics
      .filter((row) => row.service_delivery_pct !== null)
      .sort((left, right) => right.service_delivery_pct - left.service_delivery_pct)[0];

    const overviewHighlights = [
      bestOtp
        ? {
            id: "best-otp",
            title: `${bestOtp.line} leads on-time performance`,
            body: `Avg OTP across the selected period is ${bestOtp.otp_pct.toFixed(1)}%.`,
            tone: "positive",
          }
        : null,
      bestHeadway
        ? {
            id: "best-headway",
            title: `${bestHeadway.line} has shortest waits`,
            body: `Average headway is ${bestHeadway.avg_headway_min.toFixed(1)} minutes in current data.`,
            tone: "positive",
          }
        : null,
      worstTravel
        ? {
            id: "travel-pressure",
            title: `${worstTravel.line} shows the biggest slow-zone pressure`,
            body: `Travel Time Index is ${worstTravel.travel_time_index.toFixed(2)}x benchmark.`,
            tone: "warning",
          }
        : null,
      bestDelivery
        ? {
            id: "delivery",
            title: `${bestDelivery.line} leads delivered service`,
            body: `Service delivery is ${bestDelivery.service_delivery_pct.toFixed(1)}% of scheduled trips.`,
            tone: "neutral",
          }
        : null,
    ].filter(Boolean);

    const otpTrendData = otpDailyRecords
      .filter((row) => lineMatches(row.line_id) && dateInRange(row.service_date))
      .map((row) => ({
        date: row.service_date,
        value: toFiniteNumber(row.otp_pct),
        series: normalizeLineId(row.line_id),
      }))
      .filter((row) => row.value !== null)
      .sort((left, right) => left.date.localeCompare(right.date));

    const stationOtpHeatmapData = otpStationRecords
      .filter(
        (row) =>
          lineMatches(row.line_id) &&
          periodMatches(row.time_period) &&
          stationMatches(row.station_name || row.stop_id)
      )
      .map((row) => {
        const otp = toFiniteNumber(row.otp_pct);
        const totalEvents = toFiniteNumber(row.total_events);
        const onTimeEvents = toFiniteNumber(row.on_time_events);
        const derivedOtp =
          otp !== null
            ? otp
            : totalEvents && totalEvents > 0 && onTimeEvents !== null
              ? (onTimeEvents / totalEvents) * 100
              : null;

        return {
          station: normalizeText(row.station_name || row.stop_id),
          timePeriod: normalizeText(row.time_period, "Other"),
          value: derivedOtp,
        };
      })
      .filter((row) => row.value !== null)
      .sort(
        (left, right) =>
          left.station.localeCompare(right.station) || sortByTimePeriod(left.timePeriod, right.timePeriod)
      );

    const filteredHeadway = headwayRecords.filter(
      (row) =>
        lineMatches(row.line_id || row.route_id) &&
        dateInRange(row.month) &&
        periodMatches(row.time_period) &&
        stationMatches(row.stop_name || row.stop_id)
    );

    const waitHeatmapBuckets = new Map();
    for (const row of filteredHeadway) {
      const station = normalizeText(row.stop_name || row.stop_id);
      const period = normalizeText(row.time_period, "Other");
      const cv = toFiniteNumber(row.headway_cv);
      if (cv === null) {
        continue;
      }

      const key = `${station}||${period}`;
      const current = waitHeatmapBuckets.get(key) || { station, timePeriod: period, cvTotal: 0, count: 0 };
      current.cvTotal += cv;
      current.count += 1;
      waitHeatmapBuckets.set(key, current);
    }

    const waitTimeHeatmapData = Array.from(waitHeatmapBuckets.values())
      .map((bucket) => {
        const averageCvPct = (bucket.cvTotal / Math.max(1, bucket.count)) * 100;
        return {
          station: bucket.station,
          timePeriod: bucket.timePeriod,
          value: Math.max(0, 100 - averageCvPct),
        };
      })
      .sort(
        (left, right) =>
          left.station.localeCompare(right.station) || sortByTimePeriod(left.timePeriod, right.timePeriod)
      );

    const preferredBranchRows = greenBranchRecords.length > 0 ? greenBranchRecords : filteredHeadway;
    const branchBuckets = new Map();
    for (const row of preferredBranchRows) {
      const rawBranch = row.branch_id || row.branch || row.route_id || row.line_id || row.line;
      const branch = normalizeText(rawBranch);
      const line = normalizeLineId(row.line_id || row.route_id || rawBranch);
      if (!lineMatches(line)) {
        continue;
      }

      const p90HeadwaySec = toFiniteNumber(row.p90_headway_sec) ?? toFiniteNumber(row.avg_headway_sec);
      if (p90HeadwaySec === null) {
        continue;
      }

      const key = `${branch}||${line}`;
      const current = branchBuckets.get(key) || { branch, line, total: 0, count: 0 };
      current.total += p90HeadwaySec;
      current.count += 1;
      branchBuckets.set(key, current);
    }

    const waitTimeBranchBars = Array.from(branchBuckets.values())
      .map((bucket) => ({
        branch: bucket.branch,
        line: bucket.line,
        p90: (bucket.total / Math.max(1, bucket.count)) / 60,
      }))
      .sort((left, right) => right.p90 - left.p90);

    const serviceDeliveryBars = serviceDeliveryRecords
      .filter((row) => lineMatches(row.line_id) && seasonInRange(row.season))
      .map((row) => ({
        season: normalizeText(row.season),
        line: normalizeLineId(row.line_id),
        rate: toFiniteNumber(row.service_delivery_rate),
      }))
      .filter((row) => row.rate !== null)
      .sort((left, right) => {
        const leftYear = seasonYear(left.season) || 0;
        const rightYear = seasonYear(right.season) || 0;
        if (leftYear !== rightYear) {
          return leftYear - rightYear;
        }
        return seasonOrdinal(left.season) - seasonOrdinal(right.season);
      });

    const filteredTravel = travelRecords.filter(
      (row) =>
        (() => {
          const lineName = normalizeLineId(row.line_id || row.route_id);
          const fromStopId = normalizeText(row.from_stop_id, "");
          const toStopId = normalizeText(row.to_stop_id, "");
          const fromLat = toFiniteNumber(row.from_latitude);
          const fromLon = toFiniteNumber(row.from_longitude);
          const toLat = toFiniteNumber(row.to_latitude);
          const toLon = toFiniteNumber(row.to_longitude);
          return (
            lineMatches(lineName) &&
            isLikelyAdjacentTravelLink(lineName, fromStopId, toStopId, fromLat, fromLon, toLat, toLon)
          );
        })() &&
        dateInRange(row.month) &&
        periodMatches(row.time_period) &&
        stationMatches(
          row.from_stop_name || row.from_stop_id,
          row.to_stop_name || row.to_stop_id
        )
    );

    const travelStationPoints = extractStationPointsFromTopology(geographyTopology).filter((station) =>
      selectedLine === "All" ? true : station.routeId === selectedLine
    );

    const travelLinePaths = extractLinePathsFromTopology(geographyTopology, travelStationPoints).filter((path) =>
      selectedLine === "All" ? true : path.routeId === selectedLine
    );

    const slowZoneBySegment = new Map();
    for (const row of travelSlowZoneRecords) {
      const line = normalizeLineId(row.line_id || row.route_id);
      const segmentId = normalizeText(row.segment_id, "");
      if (!line || !segmentId) {
        continue;
      }
      slowZoneBySegment.set(`${line}||${segmentId}`, row);
    }

    const segmentBuckets = new Map();
    for (const row of filteredTravel) {
      const line = normalizeLineId(row.line_id || row.route_id);
      const segmentId = normalizeText(row.segment_id, "");
      const fromLat = toFiniteNumber(row.from_latitude);
      const fromLon = toFiniteNumber(row.from_longitude);
      const toLat = toFiniteNumber(row.to_latitude);
      const toLon = toFiniteNumber(row.to_longitude);
      const travelTimeIndex = toFiniteNumber(row.travel_time_index);
      const medianTravelSec = toFiniteNumber(row.median_travel_time_sec);
      const benchmarkSec = toFiniteNumber(row.benchmark_median_sec);
      const bufferSec = toFiniteNumber(row.buffer_time_sec);
      const planningIndex = toFiniteNumber(row.planning_time_index);
      const month = normalizeText(row.month, "");
      const period = normalizeText(row.time_period, "Other");
      if (!line || !segmentId || fromLat === null || fromLon === null || toLat === null || toLon === null) {
        continue;
      }

      const key = `${line}||${segmentId}`;
      const bucket = segmentBuckets.get(key) || {
        segmentId,
        line,
        fromStopName: normalizeText(row.from_stop_name || row.from_stop_id),
        toStopName: normalizeText(row.to_stop_name || row.to_stop_id),
        fromStopId: normalizeText(row.from_stop_id, ""),
        toStopId: normalizeText(row.to_stop_id, ""),
        fromLatitude: fromLat,
        fromLongitude: fromLon,
        toLatitude: toLat,
        toLongitude: toLon,
        indexValues: [],
        medianValues: [],
        benchmarkValues: [],
        bufferValues: [],
        planningValues: [],
        periodMap: new Map(),
        monthMap: new Map(),
      };
      if (travelTimeIndex !== null) {
        bucket.indexValues.push(travelTimeIndex);
      }
      if (medianTravelSec !== null) {
        bucket.medianValues.push(medianTravelSec);
      }
      if (benchmarkSec !== null) {
        bucket.benchmarkValues.push(benchmarkSec);
      }
      if (bufferSec !== null) {
        bucket.bufferValues.push(bufferSec);
      }
      if (planningIndex !== null) {
        bucket.planningValues.push(planningIndex);
      }

      const periodBucket = bucket.periodMap.get(period) || [];
      if (travelTimeIndex !== null) {
        periodBucket.push(travelTimeIndex);
      }
      bucket.periodMap.set(period, periodBucket);

      const monthBucket = bucket.monthMap.get(month) || [];
      if (travelTimeIndex !== null) {
        monthBucket.push(travelTimeIndex);
      }
      bucket.monthMap.set(month, monthBucket);

      segmentBuckets.set(key, bucket);
    }

    const travelMapSegments = Array.from(segmentBuckets.values())
      .map((bucket) => {
        const avgIndex = average(bucket.indexValues);
        const avgMedianSec = average(bucket.medianValues);
        const avgBenchmarkSec = average(bucket.benchmarkValues);
        const avgBufferSec = average(bucket.bufferValues);
        const avgPlanningIndex = average(bucket.planningValues);

        const timeProfile = Array.from(bucket.periodMap.entries())
          .map(([period, values]) => ({
            period,
            value: average(values),
          }))
          .filter((item) => item.value !== null)
          .sort((left, right) => sortByTimePeriod(left.period, right.period));

        const monthSeries = Array.from(bucket.monthMap.entries())
          .map(([month, values]) => ({
            month: `${month}-01`,
            value: average(values),
          }))
          .filter((item) => item.value !== null)
          .sort((left, right) => left.month.localeCompare(right.month));

        const slowZoneMeta = slowZoneBySegment.get(`${bucket.line}||${bucket.segmentId}`);
        const worstPeriodRow =
          timeProfile.length > 0
            ? timeProfile
                .slice()
                .sort((left, right) => (right.value ?? Number.NEGATIVE_INFINITY) - (left.value ?? Number.NEGATIVE_INFINITY))[0]
            : null;
        const trend = trendDirection(monthSeries);
        return {
          segmentId: bucket.segmentId,
          line: bucket.line,
          segmentName: `${bucket.fromStopName} -> ${bucket.toStopName}`,
          fromStopName: bucket.fromStopName,
          toStopName: bucket.toStopName,
          fromStopId: bucket.fromStopId,
          toStopId: bucket.toStopId,
          fromLatitude: bucket.fromLatitude,
          fromLongitude: bucket.fromLongitude,
          toLatitude: bucket.toLatitude,
          toLongitude: bucket.toLongitude,
          coordinates: [
            [bucket.fromLatitude, bucket.fromLongitude],
            [bucket.toLatitude, bucket.toLongitude],
          ],
          travelTimeIndex: avgIndex,
          medianTravelTimeSec: avgMedianSec,
          benchmarkMedianSec: avgBenchmarkSec,
          bufferTimeSec: avgBufferSec,
          planningTimeIndex: avgPlanningIndex,
          timeProfile,
          monthSeries,
          observedMonths: monthSeries.length,
          worstPeriod: worstPeriodRow?.period || null,
          worstPeriodIndex: worstPeriodRow?.value ?? null,
          trendDirection: trend,
          slowZoneCandidate: Boolean(slowZoneMeta?.slow_zone_candidate),
          slowZoneMonths: toFiniteNumber(slowZoneMeta?.months_over_threshold) ?? 0,
          longestConsecutiveSlowZoneMonths: toFiniteNumber(slowZoneMeta?.longest_consecutive_months) ?? 0,
        };
      })
      .filter((segment) => segment.travelTimeIndex !== null)
      .sort((left, right) => right.travelTimeIndex - left.travelTimeIndex);

    const travelSlowZoneTable = travelMapSegments.map((segment) => ({
      segmentId: segment.segmentId,
      segmentName: segment.segmentName,
      line: segment.line,
      travelTimeIndex: segment.travelTimeIndex,
      bufferMin:
        segment.bufferTimeSec !== null ? segment.bufferTimeSec / 60 : null,
      planningTimeIndex: segment.planningTimeIndex,
      worstPeriod: segment.worstPeriod,
      worstPeriodIndex: segment.worstPeriodIndex,
      observedMonths: segment.observedMonths,
      trendDirection: segment.trendDirection,
      slowZoneCandidate: segment.slowZoneCandidate,
      slowZoneMonths: segment.slowZoneMonths,
      longestConsecutiveSlowZoneMonths: segment.longestConsecutiveSlowZoneMonths,
    }));

    const travelSegmentIds = travelMapSegments.map((segment) => segment.segmentId);

    const travelTrendBuckets = new Map();
    for (const row of filteredTravel) {
      const month = String(row.month || "");
      const line = normalizeLineId(row.line_id || row.route_id);
      const index = toFiniteNumber(row.travel_time_index);
      if (!month || !line || index === null) {
        continue;
      }

      const key = `${month}||${line}`;
      const current = travelTrendBuckets.get(key) || { month, line, total: 0, count: 0 };
      current.total += index;
      current.count += 1;
      travelTrendBuckets.set(key, current);
    }

    const travelTimeTrendData = Array.from(travelTrendBuckets.values())
      .map((bucket) => ({
        month: `${bucket.month}-01`,
        line: bucket.line,
        index: bucket.total / Math.max(1, bucket.count),
      }))
      .sort((left, right) => left.month.localeCompare(right.month) || left.line.localeCompare(right.line));

    const observedTravelLines = new Set(normalizedTravelTimeRows.map((row) => row.lineName));

    const lineStopsForCommuter = new Map();
    for (const row of stationReferenceRows) {
      const lineName = normalizeLineId(row.route_id || row.line_id);
      const stopId = normalizeText(row.stop_id, "");
      const stopName = resolveStationName(lineName, row.stop_name || row.station_name || row.canonical_stop_name, stopId);
      const stopSequence = toFiniteNumber(row.stop_sequence);
      if (!lineName || !stopId || !stopName || isNumericCode(stopName)) {
        continue;
      }
      const bucket = lineStopsForCommuter.get(lineName) || [];
      bucket.push({
        stopId,
        stopName,
        stopSequence: Number.isFinite(stopSequence) ? stopSequence : Number.POSITIVE_INFINITY,
      });
      lineStopsForCommuter.set(lineName, bucket);
    }

    for (const [lineName, stops] of lineStopsForCommuter.entries()) {
      const dedupedStops = [];
      const seenNames = new Set();
      stops
        .sort((left, right) => left.stopSequence - right.stopSequence || left.stopName.localeCompare(right.stopName))
        .forEach((stop) => {
          if (!seenNames.has(stop.stopName)) {
            seenNames.add(stop.stopName);
            dedupedStops.push(stop);
          }
        });
      lineStopsForCommuter.set(lineName, dedupedStops);
    }

    const headwayTemplatesByLine = new Map();
    const headwayAggregate = new Map();
    for (const row of normalizedHeadwayRows) {
      if (row.headwayTrunkMin === null || !row.lineName || !row.serviceDate) {
        continue;
      }
      const key = `${row.lineName}||${row.serviceDate}||${row.timePeriodName}`;
      const bucket = headwayAggregate.get(key) || {
        lineName: row.lineName,
        serviceDate: row.serviceDate,
        timePeriodName: row.timePeriodName,
        total: 0,
        count: 0,
      };
      bucket.total += row.headwayTrunkMin;
      bucket.count += 1;
      headwayAggregate.set(key, bucket);
    }
    for (const bucket of headwayAggregate.values()) {
      const templates = headwayTemplatesByLine.get(bucket.lineName) || [];
      templates.push({
        serviceDate: bucket.serviceDate,
        timePeriodName: bucket.timePeriodName,
        headwayMin: bucket.total / Math.max(1, bucket.count),
      });
      headwayTemplatesByLine.set(bucket.lineName, templates);
    }

    const commuterFallbackRows = [];
    const fallbackSeedDate = `${DASHBOARD_YEAR}-06-15`;
    for (const lineName of OVERVIEW_LINE_ORDER) {
      if (observedTravelLines.has(lineName)) {
        continue;
      }
      const stops = lineStopsForCommuter.get(lineName) || [];
      if (stops.length < 2) {
        continue;
      }

      const templates = headwayTemplatesByLine.get(lineName) || [
        { serviceDate: fallbackSeedDate, timePeriodName: "Midday", headwayMin: 8.0 },
      ];
      for (let index = 0; index < stops.length - 1; index += 1) {
        const fromStop = stops[index];
        const toStop = stops[index + 1];
        for (const template of templates) {
          const estimatedTravelMin = Math.max(2.5, Math.min(14.0, 2.0 + template.headwayMin * 0.45));
          const estimatedTravelSec = Math.round(estimatedTravelMin * 60);
          const estimatedP95Sec = Math.round(estimatedTravelSec * 1.25);
          const estimatedBenchmarkSec = Math.max(60, Math.round(estimatedTravelSec * 0.9));

          commuterFallbackRows.push({
            serviceDate: template.serviceDate,
            lineName,
            fromStopId: fromStop.stopId,
            toStopId: toStop.stopId,
            fromStopName: fromStop.stopName,
            toStopName: toStop.stopName,
            directionId: "0",
            directionName: directionLabel("0"),
            eventTimeSec: representativeSecondsForPeriod(template.timePeriodName),
            hourOfDay: Math.max(0, Math.min(23, Math.floor(representativeSecondsForPeriod(template.timePeriodName) / 3600))),
            hourLabel: formatHourLabel(Math.max(0, Math.min(23, Math.floor(representativeSecondsForPeriod(template.timePeriodName) / 3600)))),
            travelTimeSec: estimatedTravelSec,
            p95TravelTimeSec: estimatedP95Sec,
            benchmarkTravelTimeSec: estimatedBenchmarkSec,
            timePeriodName: template.timePeriodName,
            dayType: weekdayOrWeekend(template.serviceDate),
            dayName: weekdayName(template.serviceDate),
            isEstimatedFallback: true,
          });
          commuterFallbackRows.push({
            serviceDate: template.serviceDate,
            lineName,
            fromStopId: toStop.stopId,
            toStopId: fromStop.stopId,
            fromStopName: toStop.stopName,
            toStopName: fromStop.stopName,
            directionId: "1",
            directionName: directionLabel("1"),
            eventTimeSec: representativeSecondsForPeriod(template.timePeriodName),
            hourOfDay: Math.max(0, Math.min(23, Math.floor(representativeSecondsForPeriod(template.timePeriodName) / 3600))),
            hourLabel: formatHourLabel(Math.max(0, Math.min(23, Math.floor(representativeSecondsForPeriod(template.timePeriodName) / 3600)))),
            travelTimeSec: estimatedTravelSec,
            p95TravelTimeSec: estimatedP95Sec,
            benchmarkTravelTimeSec: estimatedBenchmarkSec,
            timePeriodName: template.timePeriodName,
            dayType: weekdayOrWeekend(template.serviceDate),
            dayName: weekdayName(template.serviceDate),
            isEstimatedFallback: true,
          });
        }
      }
    }

    const commuterRowsSourceBase = normalizedTravelTimeRows.concat(commuterFallbackRows);

    const stopOrderForCommuter = (lineName, stopId) => {
      const syntheticIndex = parseSyntheticStopIndex(stopId);
      if (syntheticIndex !== null) {
        return syntheticIndex;
      }
      const seq = stationSequenceMap.get(`${lineName}||${stopId}`);
      return Number.isFinite(seq) ? seq : null;
    };

    const chainedGroupRows = new Map();
    for (const row of commuterRowsSourceBase) {
      if (!row.lineName || !row.fromStopId || !row.toStopId || row.travelTimeSec === null) {
        continue;
      }
      const fromOrder = stopOrderForCommuter(row.lineName, row.fromStopId);
      const toOrder = stopOrderForCommuter(row.lineName, row.toStopId);
      if (fromOrder === null || toOrder === null || fromOrder === toOrder) {
        continue;
      }

      const normalizedDirectionId =
        row.directionId === "0" || row.directionId === "1"
          ? row.directionId
          : toOrder > fromOrder
            ? "0"
            : "1";

      const groupKey = [
        row.lineName,
        normalizedDirectionId,
        row.serviceDate,
        row.timePeriodName,
        row.dayType,
        row.dayName,
        row.hourOfDay,
      ].join("||");

      const bucket = chainedGroupRows.get(groupKey) || [];
      bucket.push({
        ...row,
        directionId: normalizedDirectionId,
        directionName: directionLabel(normalizedDirectionId),
        fromOrder,
        toOrder,
      });
      chainedGroupRows.set(groupKey, bucket);
    }

    const derivedCommuterRows = [];
    for (const [groupKey, rows] of chainedGroupRows.entries()) {
      const [lineName, directionId, serviceDate, timePeriodName, dayType, dayName, hourOfDayRaw] = groupKey.split("||");
      const hourOfDay = Number(hourOfDayRaw);

      const pairStats = new Map();
      for (const row of rows) {
        const step = row.toOrder - row.fromOrder;
        if ((directionId === "0" && step <= 0) || (directionId === "1" && step >= 0)) {
          continue;
        }

        const key = `${row.fromStopId}||${row.toStopId}`;
        const bucket = pairStats.get(key) || {
          fromStopId: row.fromStopId,
          toStopId: row.toStopId,
          fromStopName: row.fromStopName,
          toStopName: row.toStopName,
          fromOrder: row.fromOrder,
          toOrder: row.toOrder,
          travelTotal: 0,
          p95Total: 0,
          benchmarkTotal: 0,
          count: 0,
          fallbackCount: 0,
        };
        bucket.travelTotal += row.travelTimeSec;
        bucket.p95Total += row.p95TravelTimeSec ?? row.travelTimeSec;
        bucket.benchmarkTotal += row.benchmarkTravelTimeSec ?? row.travelTimeSec;
        bucket.count += 1;
        if (row.isEstimatedFallback) {
          bucket.fallbackCount += 1;
        }
        pairStats.set(key, bucket);
      }

      const adjacency = new Map();
      for (const edge of pairStats.values()) {
        const fromEdges = adjacency.get(edge.fromStopId) || [];
        fromEdges.push(edge);
        adjacency.set(edge.fromStopId, fromEdges);
      }

      for (const edges of adjacency.values()) {
        edges.sort((left, right) => {
          const leftStep = Math.abs(left.toOrder - left.fromOrder);
          const rightStep = Math.abs(right.toOrder - right.fromOrder);
          if (leftStep !== rightStep) {
            return leftStep - rightStep;
          }
          return directionId === "0" ? left.toOrder - right.toOrder : right.toOrder - left.toOrder;
        });
      }

      for (const originStopId of adjacency.keys()) {
        const visited = new Set([originStopId]);
        let currentStopId = originStopId;
        let originName = null;
        let currentName = null;
        let totalTravelSec = 0;
        let totalP95Sec = 0;
        let totalBenchmarkSec = 0;
        let segmentCount = 0;
        let fallbackSegments = 0;

        for (let hop = 0; hop < MAX_COMMUTER_CHAIN_HOPS; hop += 1) {
          const nextEdge = (adjacency.get(currentStopId) || [])[0];
          if (!nextEdge || visited.has(nextEdge.toStopId)) {
            break;
          }

          if (!originName) {
            originName = nextEdge.fromStopName;
          }
          currentName = nextEdge.toStopName;
          totalTravelSec += nextEdge.travelTotal / Math.max(1, nextEdge.count);
          totalP95Sec += nextEdge.p95Total / Math.max(1, nextEdge.count);
          totalBenchmarkSec += nextEdge.benchmarkTotal / Math.max(1, nextEdge.count);
          segmentCount += 1;
          fallbackSegments += nextEdge.fallbackCount > 0 ? 1 : 0;
          currentStopId = nextEdge.toStopId;
          visited.add(currentStopId);

          if (segmentCount >= 2) {
            derivedCommuterRows.push({
              serviceDate,
              lineName,
              fromStopId: originStopId,
              toStopId: currentStopId,
              fromStopName: originName || originStopId,
              toStopName: currentName || currentStopId,
              directionId,
              directionName: directionLabel(directionId),
              eventTimeSec: Math.max(0, Math.min(86399, hourOfDay * 3600)),
              hourOfDay,
              hourLabel: formatHourLabel(hourOfDay),
              travelTimeSec: totalTravelSec,
              p95TravelTimeSec: totalP95Sec,
              benchmarkTravelTimeSec: totalBenchmarkSec,
              timePeriodName,
              dayType,
              dayName,
              isEstimatedFallback: fallbackSegments > 0,
              isDerivedCommuterChain: true,
            });
          }
        }
      }
    }

    const commuterRowsSource = commuterRowsSourceBase.concat(derivedCommuterRows);
    const commuterRowsBase = commuterRowsSource.filter((row) => lineMatches(row.lineName));
    const commuterPairsMap = new Map();
    for (const row of commuterRowsBase) {
      const originKey = `${row.lineName}||${row.directionId}||${row.fromStopId}`;
      const pairKey = `${originKey}||${row.toStopId}`;
      const current = commuterPairsMap.get(pairKey) || {
        pairKey,
        originKey,
        line: row.lineName,
        directionId: row.directionId,
        directionName: row.directionName,
        fromStopId: row.fromStopId,
        toStopId: row.toStopId,
        fromStopName: row.fromStopName,
        toStopName: row.toStopName,
        count: 0,
      };
      current.count += 1;
      commuterPairsMap.set(pairKey, current);
    }

    const commuterPairs = Array.from(commuterPairsMap.values()).sort((left, right) => {
      const leftRank = lineOrderMap.get(left.line) ?? 99;
      const rightRank = lineOrderMap.get(right.line) ?? 99;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      if (left.fromStopName !== right.fromStopName) {
        return left.fromStopName.localeCompare(right.fromStopName);
      }
      if (left.toStopName !== right.toStopName) {
        return left.toStopName.localeCompare(right.toStopName);
      }
      return left.directionId.localeCompare(right.directionId);
    });

    const commuterOriginOptions = Array.from(
      commuterPairs.reduce((accumulator, pair) => {
        if (!accumulator.has(pair.originKey)) {
          const directionSuffix =
            pair.directionName && pair.directionName !== "Unknown Direction"
              ? `, ${pair.directionName}`
              : "";
          const label =
            selectedLine === "All"
              ? `${pair.fromStopName} (${pair.line}${directionSuffix})`
              : `${pair.fromStopName}${directionSuffix ? ` (${pair.directionName})` : ""}`;
          accumulator.set(pair.originKey, { value: pair.originKey, label });
        }
        return accumulator;
      }, new Map()).values()
    );

    const originOptionValues = new Set(commuterOriginOptions.map((option) => option.value));
    const commuterEffectiveOriginKey = originOptionValues.has(commuterOriginKey)
      ? commuterOriginKey
      : commuterOriginOptions[0]?.value || "";

    const commuterDestinationOptions = commuterPairs
      .filter((pair) => pair.originKey === commuterEffectiveOriginKey)
      .map((pair) => ({
        value: pair.pairKey,
        label: pair.toStopName,
      }));

    const destinationOptionValues = new Set(
      commuterDestinationOptions.map((option) => option.value)
    );
    const commuterEffectivePairKey = destinationOptionValues.has(commuterPairKey)
      ? commuterPairKey
      : commuterDestinationOptions[0]?.value || "";

    const commuterSelectedPair =
      commuterPairs.find((pair) => pair.pairKey === commuterEffectivePairKey) || null;

    const commuterPairRows = commuterSelectedPair
      ? commuterRowsBase.filter(
          (row) =>
            row.lineName === commuterSelectedPair.line &&
            row.directionId === commuterSelectedPair.directionId &&
            row.fromStopId === commuterSelectedPair.fromStopId &&
            row.toStopId === commuterSelectedPair.toStopId
        )
      : [];

    const selectedDepartureHour = Math.max(
      0,
      Math.min(23, Math.floor(toFiniteNumber(commuterDepartureHour) ?? 8))
    );
    const commuterWindowRows = commuterPairRows.filter(
      (row) => hourDistance(row.hourOfDay, selectedDepartureHour) <= 1
    );
    const commuterAnalysisRows =
      commuterWindowRows.length > 0 ? commuterWindowRows : commuterPairRows;

    const commuterTravelValues = commuterAnalysisRows
      .map((row) => row.travelTimeSec)
      .filter((value) => value !== null)
      .sort((left, right) => left - right);
    const commuterP95Candidates = commuterAnalysisRows
      .map((row) => row.p95TravelTimeSec ?? row.travelTimeSec)
      .filter((value) => value !== null);
    const commuterMedianSec = quantileFromSorted(commuterTravelValues, 0.5);
    const commuterP95Sec = average(commuterP95Candidates);
    const commuterBufferSec =
      commuterMedianSec !== null && commuterP95Sec !== null
        ? Math.max(0, commuterP95Sec - commuterMedianSec)
        : null;
    const commuterUsesEstimatedFallback =
      commuterAnalysisRows.length > 0 &&
      commuterAnalysisRows.every((row) => Boolean(row.isEstimatedFallback));
    const commuterReliabilityPct =
      commuterMedianSec !== null && commuterAnalysisRows.length > 0
        ? (commuterAnalysisRows.filter((row) => Math.abs(row.travelTimeSec - commuterMedianSec) <= 300).length /
            commuterAnalysisRows.length) *
          100
        : null;
    const departureContextLabel =
      selectedDepartureHour >= 6 && selectedDepartureHour < 10
        ? "weekday mornings"
        : selectedDepartureHour >= 15 && selectedDepartureHour < 19
          ? "weekday evenings"
          : `around ${String(selectedDepartureHour).padStart(2, "0")}:00`;
    const commuterRecommendation =
      commuterBufferSec !== null
        ? `${
            commuterUsesEstimatedFallback ? "Estimated from available headway patterns: " : ""
          }Add ${Math.round(commuterBufferSec / 60)} minutes to this trip on ${departureContextLabel}.`
        : "Not enough data to recommend a buffer yet.";

    const commuterSummaryMetrics =
      commuterSelectedPair && commuterMedianSec !== null
        ? {
            medianMin: commuterMedianSec / 60,
            p95Min: commuterP95Sec !== null ? commuterP95Sec / 60 : null,
            bufferMin: commuterBufferSec !== null ? commuterBufferSec / 60 : null,
            reliabilityPct: commuterReliabilityPct,
            sampleCount: commuterAnalysisRows.length,
            recommendation: commuterRecommendation,
            selectedDepartureHour,
            isEstimatedFallback: commuterUsesEstimatedFallback,
          }
        : null;

    const commuterHourBuckets = new Map();
    for (const row of commuterPairRows) {
      if (row.hourOfDay === null) {
        continue;
      }
      const bucket = commuterHourBuckets.get(row.hourOfDay) || [];
      bucket.push({
        median: row.travelTimeSec,
        p95: row.p95TravelTimeSec ?? row.travelTimeSec,
      });
      commuterHourBuckets.set(row.hourOfDay, bucket);
    }

    const commuterTimeProfile = Array.from(commuterHourBuckets.entries())
      .map(([hour, values]) => {
        const median = average(values.map((value) => value.median).filter((value) => value !== null));
        const p95 = average(values.map((value) => value.p95).filter((value) => value !== null));
        return {
          hour,
          hourLabel: formatHourLabel(hour),
          medianMin: median !== null ? median / 60 : null,
          p95Min: p95 !== null ? p95 / 60 : null,
        };
      })
      .sort((left, right) => left.hour - right.hour)
      .flatMap((row) => {
        const points = [];
        if (row.medianMin !== null) {
          points.push({ hour: row.hourLabel, value: row.medianMin, series: "Median" });
        }
        if (row.p95Min !== null) {
          points.push({ hour: row.hourLabel, value: row.p95Min, series: "P95" });
        }
        return points;
      });

    const weekdayBuckets = new Map();
    for (const row of commuterAnalysisRows) {
      if (!WEEKDAY_ORDER.includes(row.dayName)) {
        continue;
      }
      const bucket = weekdayBuckets.get(row.dayName) || [];
      bucket.push({
        median: row.travelTimeSec,
        p95: row.p95TravelTimeSec ?? row.travelTimeSec,
      });
      weekdayBuckets.set(row.dayName, bucket);
    }

    const commuterWeekdayBreakdown = WEEKDAY_ORDER.flatMap((dayName) => {
      const values = weekdayBuckets.get(dayName);
      if (!values || values.length === 0) {
        return [];
      }
      const median = average(values.map((value) => value.median).filter((value) => value !== null));
      const p95 = average(values.map((value) => value.p95).filter((value) => value !== null));
      const points = [];
      if (median !== null) {
        points.push({ day: dayName, metric: "Median", value: median / 60 });
      }
      if (p95 !== null) {
        points.push({ day: dayName, metric: "P95", value: p95 / 60 });
      }
      return points;
    });

    const commuterBufferBars =
      commuterSelectedPair && commuterSummaryMetrics?.bufferMin !== null
        ? [
            {
              corridor: `${commuterSelectedPair.fromStopName} -> ${commuterSelectedPair.toStopName}`,
              line: commuterSelectedPair.line,
              buffer: commuterSummaryMetrics.bufferMin,
            },
          ]
        : [];
    const commuterMatrixData = commuterTimeProfile
      .filter((row) => row.series === "P95")
      .map((row) => ({
        station: commuterSelectedPair?.fromStopName || "Selected Origin",
        timePeriod: row.hour,
        value: row.value,
      }));

    const yoyBuckets = new Map();
    for (const row of otpDailyRecords) {
      const line = normalizeLineId(row.line_id);
      if (!line || !lineMatches(line)) {
        continue;
      }
      const parsedDate = parseDateLike(row.service_date);
      if (!parsedDate) {
        continue;
      }
      const month = monthNumber(row.service_date);
      const year = parsedDate.getFullYear();
      if (!month || !year) {
        continue;
      }
      const key = `${year}-${String(month).padStart(2, "0")}`;
      const bucket = yoyBuckets.get(key) || {
        year,
        month,
        totalEvents: 0,
        onTimeEvents: 0,
        otpValues: [],
      };
      const total = toFiniteNumber(row.total_events);
      const onTime = toFiniteNumber(row.on_time_events);
      const otp = toFiniteNumber(row.otp_pct);
      if (total !== null && onTime !== null && total > 0) {
        bucket.totalEvents += total;
        bucket.onTimeEvents += onTime;
      } else if (otp !== null) {
        bucket.otpValues.push(otp);
      }
      yoyBuckets.set(key, bucket);
    }

    for (const row of otpMonthlyRecords) {
      const line = normalizeLineId(row.line_id);
      if (!line || !lineMatches(line)) {
        continue;
      }
      const parsedDate = parseDateLike(`${row.month}-01`);
      if (!parsedDate) {
        continue;
      }
      const month = parsedDate.getMonth() + 1;
      const year = parsedDate.getFullYear();
      const key = `${year}-${String(month).padStart(2, "0")}`;
      const bucket = yoyBuckets.get(key) || {
        year,
        month,
        totalEvents: 0,
        onTimeEvents: 0,
        otpValues: [],
      };
      const total = toFiniteNumber(row.total_events);
      const onTime = toFiniteNumber(row.on_time_events);
      const otp = toFiniteNumber(row.otp_pct);
      if (total !== null && onTime !== null && total > 0) {
        bucket.totalEvents += total;
        bucket.onTimeEvents += onTime;
      } else if (otp !== null) {
        bucket.otpValues.push(otp);
      }
      yoyBuckets.set(key, bucket);
    }

    const historicalYoyOtp = Array.from(yoyBuckets.values())
      .map((bucket) => ({
        year: String(bucket.year),
        monthNumber: bucket.month,
        month: MONTH_LABELS[bucket.month - 1] || String(bucket.month),
        value:
          bucket.totalEvents > 0
            ? (bucket.onTimeEvents / bucket.totalEvents) * 100
            : average(bucket.otpValues),
      }))
      .filter((row) => row.value !== null)
      .sort((left, right) => left.monthNumber - right.monthNumber || left.year.localeCompare(right.year));

    const defaultYoyYears = [2022, 2023, 2024, 2025];
    const allYoyYears = Array.from(
      new Set([...defaultYoyYears, ...historicalYoyOtp.map((row) => Number(row.year))])
    ).sort((left, right) => left - right);
    const historicalYoyCoverage = allYoyYears.map((year) => ({
      year: String(year),
      availableMonths: new Set(
        historicalYoyOtp
          .filter((row) => Number(row.year) === year)
          .map((row) => row.monthNumber)
      ).size,
    }));

    const frequencyBuckets = new Map();
    for (const row of scheduledVsActualRecords) {
      const season = normalizeText(row.season, "");
      const line = normalizeLineId(row.line_id || row.route_id);
      if (!season || !line || !lineMatches(line)) {
        continue;
      }
      const key = `${season}||${line}`;
      const bucket = frequencyBuckets.get(key) || {
        season,
        line,
        scheduledTotal: 0,
        scheduledCount: 0,
        actualTotal: 0,
        actualCount: 0,
      };
      const scheduledFrequency = toFiniteNumber(row.scheduled_frequency_tph);
      const actualFrequency = toFiniteNumber(row.actual_frequency_tph);
      if (scheduledFrequency !== null) {
        bucket.scheduledTotal += scheduledFrequency;
        bucket.scheduledCount += 1;
      }
      if (actualFrequency !== null) {
        bucket.actualTotal += actualFrequency;
        bucket.actualCount += 1;
      }
      frequencyBuckets.set(key, bucket);
    }

    const historicalFrequencyBars = Array.from(frequencyBuckets.values())
      .flatMap((bucket) => {
        const rows = [];
        if (bucket.scheduledCount > 0) {
          rows.push({
            seasonLine: `${bucket.season} · ${bucket.line}`,
            line: bucket.line,
            metric: "Scheduled",
            value: bucket.scheduledTotal / bucket.scheduledCount,
            season: bucket.season,
          });
        }
        if (bucket.actualCount > 0) {
          rows.push({
            seasonLine: `${bucket.season} · ${bucket.line}`,
            line: bucket.line,
            metric: "Actual",
            value: bucket.actualTotal / bucket.actualCount,
            season: bucket.season,
          });
        }
        return rows;
      })
      .sort((left, right) => {
        const leftYear = seasonYear(left.season) || 0;
        const rightYear = seasonYear(right.season) || 0;
        if (leftYear !== rightYear) {
          return leftYear - rightYear;
        }
        const leftSeasonOrder = seasonOrdinal(left.season);
        const rightSeasonOrder = seasonOrdinal(right.season);
        if (leftSeasonOrder !== rightSeasonOrder) {
          return leftSeasonOrder - rightSeasonOrder;
        }
        return left.seasonLine.localeCompare(right.seasonLine);
      });

    const predictionBuckets = new Map();
    for (const row of scheduledVsActualRecords) {
      const season = normalizeText(row.season, "");
      const line = normalizeLineId(row.line_id || row.route_id);
      if (!season || !line || !lineMatches(line)) {
        continue;
      }
      const scheduledFrequency = toFiniteNumber(row.scheduled_frequency_tph);
      const actualFrequency = toFiniteNumber(row.actual_frequency_tph);
      if (scheduledFrequency === null || scheduledFrequency <= 0 || actualFrequency === null) {
        continue;
      }
      const absPercentError = Math.abs(actualFrequency - scheduledFrequency) / scheduledFrequency * 100;
      if (!Number.isFinite(absPercentError)) {
        continue;
      }
      const sampleWeight = Math.max(1, toFiniteNumber(row.actual_sample_count) ?? 1);
      const key = `${season}||${line}`;
      const bucket = predictionBuckets.get(key) || {
        season,
        line,
        weightedErrorTotal: 0,
        weightTotal: 0,
        rows: 0,
      };
      bucket.weightedErrorTotal += absPercentError * sampleWeight;
      bucket.weightTotal += sampleWeight;
      bucket.rows += 1;
      predictionBuckets.set(key, bucket);
    }

    const historicalPredictionAccuracy = Array.from(predictionBuckets.values())
      .map((bucket) => {
        const weightedErrorPct =
          bucket.weightTotal > 0 ? bucket.weightedErrorTotal / bucket.weightTotal : null;
        const accuracyPct =
          weightedErrorPct !== null ? Math.max(0, Math.min(100, 100 - weightedErrorPct)) : null;
        return {
          season: bucket.season,
          line: bucket.line,
          value: accuracyPct,
          errorPct: weightedErrorPct,
          contributingRows: bucket.rows,
        };
      })
      .filter((row) => row.value !== null)
      .sort((left, right) => {
        const leftYear = seasonYear(left.season) || 0;
        const rightYear = seasonYear(right.season) || 0;
        if (leftYear !== rightYear) {
          return leftYear - rightYear;
        }
        const leftSeasonOrder = seasonOrdinal(left.season);
        const rightSeasonOrder = seasonOrdinal(right.season);
        if (leftSeasonOrder !== rightSeasonOrder) {
          return leftSeasonOrder - rightSeasonOrder;
        }
        return left.line.localeCompare(right.line);
      });

    const historicalServiceDeliveryTrend = serviceDeliveryRecords
      .map((row) => ({
        season: normalizeText(row.season, ""),
        line: normalizeLineId(row.line_id || row.route_id),
        value: (() => {
          const rate = toFiniteNumber(row.service_delivery_rate);
          return rate !== null ? rate * 100 : null;
        })(),
      }))
      .filter((row) => row.season && row.line && row.value !== null && lineMatches(row.line))
      .sort((left, right) => {
        const leftYear = seasonYear(left.season) || 0;
        const rightYear = seasonYear(right.season) || 0;
        if (leftYear !== rightYear) {
          return leftYear - rightYear;
        }
        const leftSeasonOrder = seasonOrdinal(left.season);
        const rightSeasonOrder = seasonOrdinal(right.season);
        if (leftSeasonOrder !== rightSeasonOrder) {
          return leftSeasonOrder - rightSeasonOrder;
        }
        return left.line.localeCompare(right.line);
      });

    const historicalPeriodOptions = Array.from(
      new Set([
        ...historicalServiceDeliveryTrend.map((row) => row.season),
        ...historicalFrequencyBars.map((row) => row.season),
        ...historicalPredictionAccuracy.map((row) => row.season),
      ])
    ).sort((left, right) => {
      const leftYear = seasonYear(left) || 0;
      const rightYear = seasonYear(right) || 0;
      if (leftYear !== rightYear) {
        return leftYear - rightYear;
      }
      return seasonOrdinal(left) - seasonOrdinal(right);
    });

    const defaultRightPeriod = historicalPeriodOptions[historicalPeriodOptions.length - 1] || "";
    const defaultLeftPeriod =
      historicalPeriodOptions[historicalPeriodOptions.length - 2] || defaultRightPeriod;
    const historicalEffectiveRightPeriod = historicalPeriodOptions.includes(historicalRightPeriod)
      ? historicalRightPeriod
      : defaultRightPeriod;
    let historicalEffectiveLeftPeriod = historicalPeriodOptions.includes(historicalLeftPeriod)
      ? historicalLeftPeriod
      : defaultLeftPeriod;
    if (
      historicalEffectiveLeftPeriod === historicalEffectiveRightPeriod &&
      historicalPeriodOptions.length > 1
    ) {
      historicalEffectiveLeftPeriod = historicalPeriodOptions.find(
        (season) => season !== historicalEffectiveRightPeriod
      );
    }
    historicalEffectiveLeftPeriod = historicalEffectiveLeftPeriod || historicalEffectiveRightPeriod || "";

    const deliveryLookup = new Map();
    for (const row of historicalServiceDeliveryTrend) {
      deliveryLookup.set(`${row.season}||${row.line}`, row.value);
    }

    const historicalComparisonLines =
      selectedLine === "All"
        ? Array.from(new Set(historicalServiceDeliveryTrend.map((row) => row.line))).sort(
            (left, right) => (lineOrderMap.get(left) ?? 99) - (lineOrderMap.get(right) ?? 99)
          )
        : [selectedLine];

    const historicalSideBySideBars = historicalComparisonLines.flatMap((line) => {
      const rows = [];
      const leftValue = deliveryLookup.get(`${historicalEffectiveLeftPeriod}||${line}`);
      const rightValue = deliveryLookup.get(`${historicalEffectiveRightPeriod}||${line}`);
      if (leftValue !== undefined) {
        rows.push({
          line,
          comparison: "Selected A",
          value: leftValue,
          period: historicalEffectiveLeftPeriod,
        });
      }
      if (rightValue !== undefined) {
        rows.push({
          line,
          comparison: "Selected B",
          value: rightValue,
          period: historicalEffectiveRightPeriod,
        });
      }
      return rows;
    });

    const timelineBuckets = new Map();
    for (const row of historicalServiceDeliveryTrend) {
      const bucket = timelineBuckets.get(row.season) || { season: row.season, total: 0, count: 0 };
      bucket.total += row.value;
      bucket.count += 1;
      timelineBuckets.set(row.season, bucket);
    }
    const historicalTimelineSeries = Array.from(timelineBuckets.values())
      .map((bucket) => ({
        season: bucket.season,
        value: bucket.total / Math.max(1, bucket.count),
      }))
      .sort((left, right) => {
        const leftYear = seasonYear(left.season) || 0;
        const rightYear = seasonYear(right.season) || 0;
        if (leftYear !== rightYear) {
          return leftYear - rightYear;
        }
        return seasonOrdinal(left.season) - seasonOrdinal(right.season);
      });

    const timelineSeasonSet = new Set(historicalTimelineSeries.map((row) => row.season));
    const historicalTimelineMarkers = timelineAnnotationsRaw
      .map((row) => ({
        season: normalizeText(row.season || row.period || row.date, ""),
        label: normalizeText(row.label || row.title, "Event"),
        description: normalizeText(row.description || row.note, ""),
      }))
      .filter((row) => row.season && timelineSeasonSet.has(row.season));

    const scheduleChangeMap = new Map();
    for (const row of scheduledVsActualRecords) {
      const season = normalizeText(row.season, "");
      const line = normalizeLineId(row.line_id || row.route_id);
      const scheduleChangeDirection = normalizeText(row.schedule_change_direction, "No Change");
      if (!season || !line || !lineMatches(line) || scheduleChangeDirection === "No Change") {
        continue;
      }
      const key = `${season}||${line}||${scheduleChangeDirection}`;
      if (!scheduleChangeMap.has(key)) {
        scheduleChangeMap.set(key, {
          season,
          line,
          change: scheduleChangeDirection,
        });
      }
    }
    const historicalScheduleChangeNotes = Array.from(scheduleChangeMap.values()).sort((left, right) => {
      const leftYear = seasonYear(left.season) || 0;
      const rightYear = seasonYear(right.season) || 0;
      if (leftYear !== rightYear) {
        return rightYear - leftYear;
      }
      return seasonOrdinal(right.season) - seasonOrdinal(left.season);
    });

    return {
      overviewScorecards,
      overviewSystemTrend,
      overviewRadar,
      overviewHighlights,
      overviewGoalPct: OTP_TARGET_PCT,
      reliabilityStationHourHeatmap,
      reliabilityCalendarHeatmap,
      reliabilityOnTimeWindowBreakdown,
      reliabilityWorstStations,
      reliabilityRankingMinEvents: RELIABILITY_RANKING_MIN_EVENTS,
      reliabilitySelectedCell: selectedHeatCell
        ? {
            row: selectedHeatCell.station,
            column: selectedHeatCell.hour,
            otpPct: selectedHeatCell.value,
            totalEvents: selectedHeatCell.totalEvents,
          }
        : null,
      reliabilityAvailableDates,
      otpTrendData,
      stationOtpHeatmapData,
      waitTimeHeatmapData,
      waitTimeBranchBars,
      waitTimesHeadwayHeatmap,
      waitTimesDistribution,
      waitTimesBunchingScatter,
      waitTimesGreenBranchComparison,
      waitTimesExcessTrend,
      travelMapSegments,
      travelLinePaths,
      travelStationPoints,
      travelSlowZoneTable,
      travelSegmentIds,
      serviceDeliveryBars,
      travelTimeTrendData,
      commuterBufferBars,
      commuterMatrixData,
      commuterOriginOptions,
      commuterDestinationOptions,
      commuterSelectedPair,
      commuterSummaryMetrics,
      commuterTimeProfile,
      commuterWeekdayBreakdown,
      commuterEffectiveOriginKey,
      commuterEffectivePairKey,
      historicalYoyOtp,
      historicalYoyCoverage,
      historicalFrequencyBars,
      historicalPredictionAccuracy,
      historicalServiceDeliveryTrend,
      historicalTimelineSeries,
      historicalTimelineMarkers,
      historicalPeriodOptions,
      historicalSideBySideBars,
      historicalScheduleChangeNotes,
      historicalEffectiveLeftPeriod,
      historicalEffectiveRightPeriod,
      stationOptions,
      availableLines,
      year: toFiniteNumber(rawData.dashboardSummary?.year) || Number(DASHBOARD_YEAR),
      lastUpdatedUtc: rawData.dashboardSummary?.generated_at_utc || null,
    };
  }, [
    rawData,
    selectedLine,
    startDate,
    endDate,
    timePeriod,
    selectedStation,
    reliabilityDayType,
    selectedReliabilityCell,
    commuterOriginKey,
    commuterPairKey,
    commuterDepartureHour,
    historicalLeftPeriod,
    historicalRightPeriod,
  ]);

  return {
    loading,
    error,
    retry,
    ...views,
  };
}

export default useDashboardData;
