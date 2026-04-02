import { csvParse } from "d3";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DASHBOARD_YEAR = String(import.meta.env.VITE_DASHBOARD_YEAR || "2025");
const DATA_BASE_URL = String(import.meta.env.VITE_DATA_BASE_URL || "/data").replace(/\/+$/, "");
const OTP_TARGET_PCT = Number(import.meta.env.VITE_MBTA_OTP_TARGET || 85);
const TIME_PERIOD_ORDER = ["AM Peak", "Midday", "PM Peak", "Evening", "Late Night", "Other"];
const OVERVIEW_LINE_ORDER = ["Red", "Orange", "Blue", "Green", "Silver"];
const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

function normalizeText(value, fallback = "Unknown") {
  const text = String(value || "").trim();
  return text || fallback;
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

function extractLinePathsFromTopology(topology) {
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
  if (DATA_BASE_URL) {
    urls.push(`${DATA_BASE_URL}/${fileName}`);
    if (fileName.endsWith(".json.gz")) {
      urls.push(`${DATA_BASE_URL}/${fileName.replace(/\.gz$/, "")}`);
    }
  }

  // In local dev, files live under src/data and are fetchable as static assets.
  // This avoids importing large CSV files as raw module strings.
  if (import.meta.env.DEV) {
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
      const response = await fetch(url, { cache: "force-cache" });
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
      const response = await fetch(url, { cache: "force-cache" });
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
      const response = await fetch(url, { cache: "force-cache" });
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
      reliabilityDelayValues: [],
      reliabilityWorstStations: [],
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
          ...serviceDeliveryRecords.map((row) => normalizeLineId(row.line_id)),
        ].filter(Boolean)
      )
    ).sort();

    const stationSet = new Set();
    for (const row of otpStationRecords) {
      if (!lineMatches(row.line_id)) {
        continue;
      }
      stationSet.add(normalizeText(row.station_name || row.stop_id));
    }
    for (const row of headwayRecords) {
      if (!lineMatches(row.line_id || row.route_id)) {
        continue;
      }
      stationSet.add(normalizeText(row.stop_name || row.stop_id));
    }
    for (const row of travelRecords) {
      if (!lineMatches(row.line_id || row.route_id)) {
        continue;
      }
      stationSet.add(normalizeText(row.from_stop_name || row.from_stop_id));
      stationSet.add(normalizeText(row.to_stop_name || row.to_stop_id));
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
        const stationName = normalizeText(row.station_name || row.stop_id);
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

    const buildDelaySamplesFromCounts = (counts, maxSamples = 1600) => {
      const early = Math.max(0, Math.floor(toFiniteNumber(counts?.earlyEvents) ?? 0));
      const onTime = Math.max(0, Math.floor(toFiniteNumber(counts?.onTimeEvents) ?? 0));
      const late = Math.max(0, Math.floor(toFiniteNumber(counts?.lateEvents) ?? 0));
      const total = Math.max(1, early + onTime + late);
      const scale = Math.min(1, maxSamples / total);
      const sample = [];
      const pushSamples = (value, count) => {
        const scaled = Math.max(1, Math.round(count * scale));
        for (let index = 0; index < scaled; index += 1) {
          sample.push(value);
        }
      };
      if (early > 0) {
        pushSamples(-120, early);
      }
      if (onTime > 0) {
        pushSamples(0, onTime);
      }
      if (late > 0) {
        pushSamples(420, late);
      }
      return sample;
    };

    const reliabilityDelayValues = selectedHeatCell
      ? buildDelaySamplesFromCounts(selectedHeatCell, 1200)
      : buildDelaySamplesFromCounts(
          reliabilityStationHourHeatmap.reduce(
            (accumulator, row) => ({
              earlyEvents: (accumulator.earlyEvents ?? 0) + (toFiniteNumber(row.earlyEvents) ?? 0),
              onTimeEvents: (accumulator.onTimeEvents ?? 0) + (toFiniteNumber(row.onTimeEvents) ?? 0),
              lateEvents: (accumulator.lateEvents ?? 0) + (toFiniteNumber(row.lateEvents) ?? 0),
            }),
            { earlyEvents: 0, onTimeEvents: 0, lateEvents: 0 }
          ),
          2400
        );

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
        totalEvents: bucket.totalEvents,
        stationSortOrder: bucket.stationSortOrder,
      }))
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
        const fromStopName = normalizeText(row.from_stop_name || row.from_stop_id);
        const toStopName = normalizeText(row.to_stop_name || row.to_stop_id);
        const directionId = normalizeText(row.direction_id, "");
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
        total: 0,
        count: 0,
      };
      bucket.total += row.headwayTrunkMin;
      bucket.count += 1;
      waitHeatBuckets.set(key, bucket);
    }

    const waitTimesHeadwayHeatmap = Array.from(waitHeatBuckets.values())
      .map((bucket) => ({
        station: bucket.station,
        hour: bucket.hour,
        value: bucket.total / Math.max(1, bucket.count),
        sampleCount: bucket.count,
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
          q1: quantileFromSorted(sorted, 0.25),
          median: quantileFromSorted(sorted, 0.5),
          q3: quantileFromSorted(sorted, 0.75),
          max: quantileFromSorted(sorted, 1),
        };
      })
      .sort((left, right) => left.line.localeCompare(right.line) || left.periodGroup.localeCompare(right.periodGroup));

    const waitTimesBunchingScatter = filteredWaitTimesRows
      .filter((row) => row.headwayTrunkMin !== null && row.p90HeadwayMin !== null)
      .map((row) => {
        const cv = row.headwayCv ?? 0;
        const regularity = Math.max(0, 1 - cv);
        const bunched = (row.bunchingRatePct ?? 0) > 5;
        return {
          x: row.headwayTrunkMin,
          y: row.p90HeadwayMin,
          line: row.lineName,
          station: row.stationName,
          regularity,
          bunched,
        };
      });

    const greenBranchSource =
      (greenBranchRecords || []).length > 0
        ? greenBranchRecords.map((row) => ({
            branch: normalizeText(row.branch_id || row.branch || row.route_id || row.line_id, ""),
            station: normalizeText(row.stop_name || row.station_name || row.stop_id, ""),
            headwayMin:
              toFiniteNumber(row.avg_headway_sec) !== null
                ? toFiniteNumber(row.avg_headway_sec) / 60
                : toFiniteNumber(row.p90_headway_sec) !== null
                  ? toFiniteNumber(row.p90_headway_sec) / 60
                  : null,
          }))
        : normalizedHeadwayRows
            .filter((row) => row.routeId.startsWith("Green-"))
            .map((row) => ({
              branch: row.routeId,
              station: row.stationName,
              headwayMin: row.headwayTrunkMin,
            }));

    const greenBranchBuckets = new Map();
    for (const row of greenBranchSource) {
      if (!row.branch.startsWith("Green-") || !row.station || row.headwayMin === null) {
        continue;
      }
      const key = `${row.station}||${row.branch}`;
      const bucket = greenBranchBuckets.get(key) || { station: row.station, branch: row.branch, total: 0, count: 0 };
      bucket.total += row.headwayMin;
      bucket.count += 1;
      greenBranchBuckets.set(key, bucket);
    }

    const initialGreenBranchComparison = Array.from(greenBranchBuckets.values()).map((bucket) => ({
      station: bucket.station,
      branch: bucket.branch,
      headwayMin: bucket.total / Math.max(1, bucket.count),
    }));
    const branchCountByStation = new Map();
    for (const row of initialGreenBranchComparison) {
      const branches = branchCountByStation.get(row.station) || new Set();
      branches.add(row.branch);
      branchCountByStation.set(row.station, branches);
    }
    const waitTimesGreenBranchComparison = initialGreenBranchComparison
      .filter((row) => (branchCountByStation.get(row.station)?.size || 0) >= 2)
      .sort((left, right) => left.station.localeCompare(right.station) || left.branch.localeCompare(right.branch));

    const excessBuckets = new Map();
    for (const row of filteredWaitTimesRows) {
      if (row.excessWaitMin === null) {
        continue;
      }
      const month = monthKey(row.serviceDate);
      if (!month) {
        continue;
      }
      const key = `${month}||${row.lineName}`;
      const bucket = excessBuckets.get(key) || { month, line: row.lineName, total: 0, count: 0 };
      bucket.total += row.excessWaitMin;
      bucket.count += 1;
      excessBuckets.set(key, bucket);
    }

    const waitTimesExcessTrend = Array.from(excessBuckets.values())
      .map((bucket) => ({
        month: `${bucket.month}-01`,
        line: bucket.line,
        value: bucket.total / Math.max(1, bucket.count),
      }))
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
      existing.push({ service_date: row.service_date, otp_pct: derivedOtp });
      lineOtpRecords.set(line, existing);
    }

    const overviewScorecards = overviewLines.map((line) => {
      const records = (lineOtpRecords.get(line) || []).sort((left, right) =>
        left.service_date.localeCompare(right.service_date)
      );
      const sparkline = buildSparklineSeries(records.map((record) => ({ date: record.service_date, value: record.otp_pct })), 90);
      const latest = records[records.length - 1] || null;
      const latestOtp = latest ? toFiniteNumber(latest.otp_pct) : null;
      const recentAverage = average(sparkline.slice(-30).map((point) => point.value));
      const baselineAverage = average(sparkline.slice(0, 30).map((point) => point.value));
      const delta90 =
        recentAverage !== null && baselineAverage !== null ? recentAverage - baselineAverage : null;

      return {
        line,
        latestOtpPct: latestOtp,
        latestDate: latest?.service_date || null,
        sparkline90d: sparkline,
        delta90dPct: delta90,
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
      return {
        line,
        otp_pct: average(otpRecords.map((record) => record.otp_pct)),
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
            body: `Latest OTP trend is around ${bestOtp.otp_pct.toFixed(1)}%.`,
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
        lineMatches(row.line_id || row.route_id) &&
        dateInRange(row.month) &&
        periodMatches(row.time_period) &&
        stationMatches(
          row.from_stop_name || row.from_stop_id,
          row.to_stop_name || row.to_stop_id
        )
    );

    const travelLinePaths = extractLinePathsFromTopology(geographyTopology).filter((path) =>
      selectedLine === "All" ? true : path.routeId === selectedLine
    );

    const slowZoneBySegment = new Map();
    for (const row of travelSlowZoneRecords) {
      slowZoneBySegment.set(normalizeText(row.segment_id, ""), row);
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

        const slowZoneMeta = slowZoneBySegment.get(bucket.segmentId);
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
          trendDirection: trend,
          slowZoneCandidate: Boolean(slowZoneMeta?.slow_zone_candidate),
          slowZoneMonths: toFiniteNumber(slowZoneMeta?.months_over_threshold) ?? 0,
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
      trendDirection: segment.trendDirection,
      slowZoneCandidate: segment.slowZoneCandidate,
      slowZoneMonths: segment.slowZoneMonths,
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

    const commuterRowsBase = normalizedTravelTimeRows.filter((row) => lineMatches(row.lineName));
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
          const label =
            selectedLine === "All"
              ? `${pair.fromStopName} (${pair.line}, ${pair.directionName})`
              : `${pair.fromStopName} (${pair.directionName})`;
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
        ? `Add ${Math.round(commuterBufferSec / 60)} minutes to this trip on ${departureContextLabel}.`
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
      reliabilityDelayValues,
      reliabilityWorstStations,
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
