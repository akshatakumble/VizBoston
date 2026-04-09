import { useMemo } from "react";

function toFinite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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

function formatMinutes(value) {
  const numeric = toFinite(value);
  return numeric === null ? "No data" : `${numeric.toFixed(1)} min`;
}

function formatIndex(value) {
  const numeric = toFinite(value);
  return numeric === null ? "No data" : `${numeric.toFixed(2)}x`;
}

function TravelSegmentDetailPanel({ segment = null, onClear }) {
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
  const baselinePeriods = timeProfile.filter((item) => worstPeriod && item.period !== worstPeriod.period);
  const baselineAverage =
    baselinePeriods.length > 0
      ? baselinePeriods.reduce((sum, item) => sum + item.value, 0) / baselinePeriods.length
      : null;
  const worstVsBaselineRatio =
    worstPeriod && baselineAverage && baselineAverage > 0 ? worstPeriod.value / baselineAverage : null;

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

  const confidenceLabel =
    sortedMonths.length >= 8 ? "High confidence" : sortedMonths.length >= 4 ? "Medium confidence" : "Low confidence";
  const confidenceClass =
    sortedMonths.length >= 8 ? "high" : sortedMonths.length >= 4 ? "medium" : "low";

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

      <section className={`segment-critical-callout ${classifyIndex(worstPeriod?.value)}`} aria-label="Primary issue">
        <div className="segment-critical-head">
          <h3>{worstPeriod ? `${worstPeriod.period} service is critically delayed` : "Critical period unavailable"}</h3>
          <span className={`segment-confidence-pill ${confidenceClass}`}>
            {confidenceLabel}: {sortedMonths.length} month{sortedMonths.length === 1 ? "" : "s"} observed
          </span>
        </div>
        <p className="segment-critical-value">
          <strong>{worstPeriod ? `${worstPeriod.value.toFixed(2)}x` : "No data"}</strong>{" "}
          slower than benchmark
        </p>
        <p>
          {worstVsBaselineRatio !== null
            ? `${worstPeriod.period} is about ${worstVsBaselineRatio.toFixed(1)}x worse than other periods (${Math.round(
                worstVsBaselineRatio
              )}x at headline level).`
            : "Insufficient period coverage to compare against other periods."}
        </p>
      </section>

      <section className="segment-definition-row" aria-label="Metric definitions">
        <p>
          <strong>Travel Time Index (TTI)</strong>: <code>Actual / Benchmark</code>. Example: <code>1.41x</code> means 41% slower than benchmark.
        </p>
        <p>
          <strong>Buffer Time</strong>: extra minutes riders should budget above benchmark to absorb variability. 
        </p>
      </section>

      <section className="segment-metric-grid segment-metric-grid-minimal" aria-label="Core metrics">
        <article>
          <h3>Actual Median</h3>
          <strong className="metric-primary">{formatMinutes(actualMin)}</strong>
        </article>
        <article>
          <h3>Benchmark Median</h3>
          <strong>{formatMinutes(benchmarkMin)}</strong>
        </article>
        <article>
          <h3>
            TTI <span className="metric-info" title="Travel Time Index: Actual divided by benchmark travel time.">?</span>
          </h3>
          <strong className={`metric-emphasis ${classifyIndex(tti)}`}>{formatIndex(tti)}</strong>
          <p className="metric-footnote">{tti !== null ? `${Math.max(0, (tti - 1) * 100).toFixed(0)}% slower overall` : "No data"}</p>
        </article>
        <article>
          <h3>Added vs Benchmark</h3>
          <strong>{addedMinutes !== null ? `${addedMinutes.toFixed(1)} min` : "No data"}</strong>
        </article>
        <article>
          <h3>
            Buffer Time <span className="metric-info" title="Extra travel-time cushion above benchmark to be on-time reliably.">?</span>
          </h3>
          <strong>{formatMinutes(bufferMin)}</strong>
          <p className="metric-footnote">{bufferConsistencyLabel}</p>
        </article>
      </section>

    </section>
  );
}

export default TravelSegmentDetailPanel;
