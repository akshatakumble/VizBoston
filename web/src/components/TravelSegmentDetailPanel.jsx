import { useMemo, useState } from "react";

function toFinite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function trendPointsPath(points, width = 520, height = 180, padding = 16, minDomain = null, maxDomain = null) {
  if (!Array.isArray(points) || points.length === 0) {
    return "";
  }
  const values = points.map((point) => toFinite(point.value)).filter((value) => value !== null);
  if (values.length === 0) {
    return "";
  }
  const minValue = Number.isFinite(minDomain) ? Number(minDomain) : Math.min(...values);
  const maxValue = Number.isFinite(maxDomain) ? Number(maxDomain) : Math.max(...values);
  const range = maxValue - minValue || 1;
  return points
    .map((point, index) => {
      const x = padding + (index / Math.max(1, points.length - 1)) * (width - padding * 2);
      const value = toFinite(point.value);
      const normalized = value === null ? 0 : (value - minValue) / range;
      const y = height - padding - normalized * (height - padding * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function areaPath(points, width = 520, height = 180, padding = 16, minDomain = null, maxDomain = null) {
  if (!Array.isArray(points) || points.length === 0) {
    return "";
  }
  const line = trendPointsPath(points, width, height, padding, minDomain, maxDomain);
  if (!line) {
    return "";
  }
  const firstX = padding;
  const lastX = padding + (width - padding * 2);
  const baseY = height - padding;
  return `${line} L${lastX.toFixed(2)},${baseY.toFixed(2)} L${firstX.toFixed(2)},${baseY.toFixed(2)} Z`;
}

function classifyIndex(index) {
  if (!Number.isFinite(index)) {
    return "unknown";
  }
  if (index <= 1.1) {
    return "good";
  }
  if (index <= 1.3) {
    return "watch";
  }
  if (index <= 1.8) {
    return "bad";
  }
  return "critical";
}

function monthShortLabel(value) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleDateString(undefined, { month: "short" });
}

function formatMinutes(value) {
  const numeric = toFinite(value);
  return numeric === null ? "No data" : `${numeric.toFixed(1)} min`;
}

function formatIndex(value) {
  const numeric = toFinite(value);
  return numeric === null ? "No data" : `${numeric.toFixed(2)}x`;
}

function TravelSegmentDetailPanel({ segment = null, onClear }) {
  const [expandedTrend, setExpandedTrend] = useState(false);

  const actualMin = toFinite(segment?.medianTravelTimeSec) !== null ? segment.medianTravelTimeSec / 60 : null;
  const benchmarkMin = toFinite(segment?.benchmarkMedianSec) !== null ? segment.benchmarkMedianSec / 60 : null;
  const bufferMin = toFinite(segment?.bufferTimeSec) !== null ? segment.bufferTimeSec / 60 : null;
  const tti = toFinite(segment?.travelTimeIndex);
  const addedMinutes =
    actualMin !== null && benchmarkMin !== null ? Math.max(0, actualMin - benchmarkMin) : null;

  const sortedMonths = useMemo(() => {
    if (!Array.isArray(segment?.monthSeries)) {
      return [];
    }
    return segment.monthSeries
      .map((point) => ({ ...point, value: toFinite(point.value) }))
      .filter((point) => point.value !== null)
      .sort((left, right) => String(left.month).localeCompare(String(right.month)));
  }, [segment?.monthSeries]);

  const trendStart = sortedMonths[0] || null;
  const trendEnd = sortedMonths[sortedMonths.length - 1] || null;
  const trendDelta = trendStart && trendEnd ? trendEnd.value - trendStart.value : null;
  const trendDirectionClass =
    trendDelta === null ? "stable" : trendDelta >= 0.03 ? "degrading" : trendDelta <= -0.03 ? "improving" : "stable";

  const timeProfile = useMemo(() => {
    if (!Array.isArray(segment?.timeProfile)) {
      return [];
    }
    return segment.timeProfile
      .map((item) => ({ ...item, value: toFinite(item.value) }))
      .filter((item) => item.value !== null)
      .sort((left, right) => right.value - left.value);
  }, [segment?.timeProfile]);

  const worstPeriod =
    timeProfile.find((item) => item.period === segment?.worstPeriod) ||
    (timeProfile.length > 0 ? timeProfile[0] : null);

  const expectedAddedFromTti =
    benchmarkMin !== null && tti !== null ? Math.max(0, benchmarkMin * (tti - 1)) : null;
  const bufferConsistencyGap =
    expectedAddedFromTti !== null && bufferMin !== null ? Math.abs(expectedAddedFromTti - bufferMin) : null;
  const bufferConsistencyLabel =
    bufferConsistencyGap === null
      ? "Insufficient data to compare"
      : bufferConsistencyGap <= 0.5
        ? "Consistent with TTI"
        : bufferConsistencyGap <= 1.5
          ? "Moderately different from TTI estimate"
          : "Significantly different from TTI estimate";

  const trendWidth = expandedTrend ? 640 : 520;
  const trendHeight = expandedTrend ? 220 : 176;
  const trendMin = Math.max(0.8, Math.min(0.95, ...(sortedMonths.map((point) => point.value) || [0.95])));
  const trendMax = Math.max(2.2, ...(sortedMonths.map((point) => point.value) || [2.2]));

  if (!segment) {
    return (
      <section className="chart-card segment-detail-card segment-detail-redesign">
        <div className="card-header">
          <h2>Segment Detail Panel</h2>
        </div>
        <p className="card-subtitle">Click a segment on the map to inspect detailed travel-time behavior.</p>
      </section>
    );
  }

  return (
    <section className="chart-card segment-detail-card segment-detail-redesign">
      <div className="card-header">
        <h2>Segment Detail Panel</h2>
        <button type="button" className="detail-clear-btn" onClick={onClear}>
          Clear
        </button>
      </div>

      <p className="card-subtitle">
        {segment.segmentName} ({segment.line})
      </p>

      <section className="segment-priority-strip" aria-label="Critical insights">
        <article className={`segment-priority-card ${classifyIndex(worstPeriod?.value)}`}>
          <h3>Worst Time Period</h3>
          <strong>
            {worstPeriod ? `${worstPeriod.period}: ${worstPeriod.value.toFixed(2)}x` : "No period data"}
          </strong>
          <p>
            {worstPeriod
              ? `This period runs at ${(worstPeriod.value * 100).toFixed(0)}% of benchmark travel time (higher is worse).`
              : ""}
          </p>
        </article>

        <article className={`segment-priority-card ${trendDirectionClass}`}>
          <h3>12-Month Direction</h3>
          <strong>
            {trendDelta === null
              ? "No trend data"
              : `${trendDelta > 0 ? "+" : ""}${trendDelta.toFixed(2)}x (${trendDirectionClass})`}
          </strong>
          <p>
            {trendStart && trendEnd
              ? `${monthShortLabel(trendStart.month)} ${trendStart.value.toFixed(2)}x → ${monthShortLabel(trendEnd.month)} ${trendEnd.value.toFixed(2)}x`
              : ""}
          </p>
        </article>
      </section>

      <section className="segment-definition-row" aria-label="Metric definitions">
        <p>
          <strong>Travel Time Index (TTI)</strong>: <code>Actual / Benchmark</code>. Example: <code>1.50x</code> means trips take 50% longer than benchmark.
        </p>
        <p>
          <strong>Buffer Time</strong>: extra minutes riders should budget above benchmark to absorb variability.
        </p>
      </section>

      <section className="segment-metric-grid segment-metric-grid-redesign" aria-label="Core metrics">
        <article>
          <h3>Actual Median</h3>
          <strong className="metric-primary">{formatMinutes(actualMin)}</strong>
        </article>
        <article>
          <h3>Benchmark Median</h3>
          <strong>{formatMinutes(benchmarkMin)}</strong>
        </article>
        <article>
          <h3>TTI</h3>
          <strong className={`metric-emphasis ${classifyIndex(tti)}`}>{formatIndex(tti)}</strong>
        </article>
        <article>
          <h3>Added vs Benchmark</h3>
          <strong>{addedMinutes !== null ? `${addedMinutes.toFixed(1)} min` : "No data"}</strong>
        </article>
        <article>
          <h3>Buffer Time</h3>
          <strong>{formatMinutes(bufferMin)}</strong>
          <p className="metric-footnote">{bufferConsistencyLabel}</p>
        </article>
      </section>

      <section className="segment-trend-card" aria-label="Monthly trend">
        <div className="segment-trend-header">
          <h3>Monthly TTI Trend</h3>
          <button type="button" className="detail-clear-btn" onClick={() => setExpandedTrend((value) => !value)}>
            {expandedTrend ? "Compact" : "Expand"}
          </button>
        </div>

        {sortedMonths.length > 0 ? (
          <>
            <svg viewBox={`0 0 ${trendWidth} ${trendHeight}`} className="segment-trend-spark segment-trend-spark-large" role="img" aria-label="Monthly travel time index trend">
              <line
                x1="16"
                x2={String(trendWidth - 16)}
                y1={String(16 + ((trendMax - 1.0) / (trendMax - trendMin || 1)) * (trendHeight - 32))}
                y2={String(16 + ((trendMax - 1.0) / (trendMax - trendMin || 1)) * (trendHeight - 32))}
                className="segment-trend-benchmark"
              />
              <path d={areaPath(sortedMonths, trendWidth, trendHeight, 16, trendMin, trendMax)} className="segment-trend-area" />
              <path d={trendPointsPath(sortedMonths, trendWidth, trendHeight, 16, trendMin, trendMax)} className="segment-trend-line" />
              {sortedMonths.map((point, index) => {
                const x = 16 + (index / Math.max(1, sortedMonths.length - 1)) * (trendWidth - 32);
                const y = trendHeight - 16 - ((point.value - trendMin) / (trendMax - trendMin || 1)) * (trendHeight - 32);
                return (
                  <g key={`${point.month}-${index}`}>
                    <circle cx={x} cy={y} r={index === sortedMonths.length - 1 ? 4.2 : 3.2} className="segment-trend-point" />
                    <title>{`${monthShortLabel(point.month)}: ${point.value.toFixed(2)}x`}</title>
                  </g>
                );
              })}
              {trendStart ? (
                <text x="16" y={trendHeight - 4} className="segment-trend-axis-label">{monthShortLabel(trendStart.month)}</text>
              ) : null}
              {trendEnd ? (
                <text x={trendWidth - 16} y={trendHeight - 4} textAnchor="end" className="segment-trend-axis-label">{monthShortLabel(trendEnd.month)}</text>
              ) : null}
              <text x={trendWidth - 16} y="14" textAnchor="end" className="segment-trend-axis-label">Benchmark 1.00x</text>
            </svg>
            <p className={`segment-trend-direction trend-${trendDirectionClass}`}>
              {trendDelta === null
                ? "Trend unavailable"
                : `Net change: ${trendDelta > 0 ? "+" : ""}${trendDelta.toFixed(2)}x over ${sortedMonths.length} months (${trendDirectionClass}).`}
            </p>
          </>
        ) : (
          <p>No monthly trend data available.</p>
        )}
      </section>

      <section className="segment-period-list" aria-label="Time of day performance">
        <h3>Time-of-Day Breakdown (sorted by worst)</h3>
        <ul>
          {timeProfile.map((item) => {
            const severity = classifyIndex(item.value);
            return (
              <li key={item.period} className={severity}>
                <span>{item.period}</span>
                <strong>{item.value.toFixed(2)}x</strong>
              </li>
            );
          })}
        </ul>
      </section>
    </section>
  );
}

export default TravelSegmentDetailPanel;
