import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DASHBOARD_YEAR = String(import.meta.env.VITE_DASHBOARD_YEAR || "2025");
const DATA_BASE_URL = String(import.meta.env.VITE_DATA_BASE_URL || "/data").replace(/\/+$/, "");
const TIME_PERIOD_ORDER = ["AM Peak", "Midday", "PM Peak", "Evening", "Late Night", "Other"];

const DATASET_FILES = {
  otpLineDaily: `otp_line_daily_${DASHBOARD_YEAR}.json.gz`,
  otpLineStationTimePeriod: `otp_line_station_time_period_${DASHBOARD_YEAR}.json.gz`,
  headwayStationTimeMonth: `headway_station_time_month_${DASHBOARD_YEAR}.json.gz`,
  headwayGreenBranchMonth: `headway_green_branch_month_${DASHBOARD_YEAR}.json.gz`,
  travelSegmentTimePeriodMonth: `travel_time_segment_time_period_month_${DASHBOARD_YEAR}.json.gz`,
  travelSlowZones: `travel_time_slow_zones_${DASHBOARD_YEAR}.json.gz`,
  serviceDeliveryBySeason: `service_delivery_line_season_${DASHBOARD_YEAR}.json.gz`,
  dashboardSummary: `dashboard_summary_${DASHBOARD_YEAR}.json.gz`,
};

const OPTIONAL_DATASETS = new Set(["headwayGreenBranchMonth", "travelSlowZones"]);
const bundledGzipUrls = import.meta.glob("./*.json.gz", { eager: true, import: "default" });
const bundledRawJsonLoaders = import.meta.glob("./*.json", { query: "?raw", import: "default" });
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

function parseDateLike(value) {
  if (!value) {
    return null;
  }
  const text = String(value);
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

function buildDatasetUrls(fileName) {
  const urls = [];
  if (DATA_BASE_URL) {
    urls.push(`${DATA_BASE_URL}/${fileName}`);
    if (fileName.endsWith(".json.gz")) {
      urls.push(`${DATA_BASE_URL}/${fileName.replace(/\.gz$/, "")}`);
    }
  }

  const bundledGzip = bundledGzipUrls[`./${fileName}`];
  if (bundledGzip) {
    urls.push(bundledGzip);
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
  const localJsonFile = fileName.replace(/\.gz$/, "");
  if (import.meta.env.DEV) {
    const devLoader = bundledRawJsonLoaders[`./${localJsonFile}`];
    if (devLoader) {
      try {
        const devText = await devLoader();
        return parseLenientJson(devText, `./${localJsonFile}`);
      } catch {
        // Continue to network/bundled URL fallbacks below.
      }
    }
  }

  const urls = buildDatasetUrls(fileName);
  if (urls.length === 0) {
    const localLoader = bundledRawJsonLoaders[`./${localJsonFile}`];
    if (localLoader) {
      const text = await localLoader();
      return parseLenientJson(text, `./${localJsonFile}`);
    }
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

  const localLoader = bundledRawJsonLoaders[`./${localJsonFile}`];
  if (localLoader) {
    try {
      const text = await localLoader();
      return parseLenientJson(text, `./${localJsonFile}`);
    } catch (error) {
      failures.push(`./${localJsonFile} (${error.message})`);
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
      otpTrendData: [],
      stationOtpHeatmapData: [],
      waitTimeHeatmapData: [],
      waitTimeBranchBars: [],
      serviceDeliveryBars: [],
      travelTimeTrendData: [],
      commuterBufferBars: [],
      commuterMatrixData: [],
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
    const otpStationRecords = rawData.otpLineStationTimePeriod?.records || [];
    const headwayRecords = rawData.headwayStationTimeMonth?.records || [];
    const greenBranchRecords = rawData.headwayGreenBranchMonth?.records || [];
    const travelRecords = rawData.travelSegmentTimePeriodMonth?.records || [];
    const serviceDeliveryRecords = rawData.serviceDeliveryBySeason?.records || [];

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

    const commuterBufferBuckets = new Map();
    for (const row of filteredTravel) {
      const corridor = `${normalizeText(row.from_stop_name || row.from_stop_id)} -> ${normalizeText(
        row.to_stop_name || row.to_stop_id
      )}`;
      const line = normalizeLineId(row.line_id || row.route_id);
      const bufferSeconds = toFiniteNumber(row.buffer_time_sec);
      if (!line || bufferSeconds === null) {
        continue;
      }

      const key = `${corridor}||${line}`;
      const current = commuterBufferBuckets.get(key) || { corridor, line, total: 0, count: 0 };
      current.total += bufferSeconds;
      current.count += 1;
      commuterBufferBuckets.set(key, current);
    }

    const commuterBufferBars = Array.from(commuterBufferBuckets.values())
      .map((bucket) => ({
        corridor: bucket.corridor,
        line: bucket.line,
        buffer: (bucket.total / Math.max(1, bucket.count)) / 60,
      }))
      .sort((left, right) => right.buffer - left.buffer)
      .slice(0, 18);

    const commuterMatrixBuckets = new Map();
    for (const row of filteredTravel) {
      const station = normalizeText(row.from_stop_name || row.from_stop_id);
      const period = normalizeText(row.time_period, "Other");
      const planningTimeIndex = toFiniteNumber(row.planning_time_index);
      if (planningTimeIndex === null) {
        continue;
      }

      const key = `${station}||${period}`;
      const current = commuterMatrixBuckets.get(key) || {
        station,
        timePeriod: period,
        total: 0,
        count: 0,
      };
      current.total += planningTimeIndex;
      current.count += 1;
      commuterMatrixBuckets.set(key, current);
    }

    const commuterMatrixData = Array.from(commuterMatrixBuckets.values())
      .map((bucket) => ({
        station: bucket.station,
        timePeriod: bucket.timePeriod,
        value: bucket.total / Math.max(1, bucket.count),
      }))
      .sort(
        (left, right) =>
          left.station.localeCompare(right.station) || sortByTimePeriod(left.timePeriod, right.timePeriod)
      );

    return {
      otpTrendData,
      stationOtpHeatmapData,
      waitTimeHeatmapData,
      waitTimeBranchBars,
      serviceDeliveryBars,
      travelTimeTrendData,
      commuterBufferBars,
      commuterMatrixData,
      stationOptions,
      availableLines,
      year: toFiniteNumber(rawData.dashboardSummary?.year) || Number(DASHBOARD_YEAR),
      lastUpdatedUtc: rawData.dashboardSummary?.generated_at_utc || null,
    };
  }, [rawData, selectedLine, startDate, endDate, timePeriod, selectedStation]);

  return {
    loading,
    error,
    retry,
    ...views,
  };
}

export default useDashboardData;
