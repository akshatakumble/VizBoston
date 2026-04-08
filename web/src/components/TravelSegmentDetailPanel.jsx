function trendPointsPath(points, width = 300, height = 78, padding = 8) {
  if (!Array.isArray(points) || points.length === 0) {
    return "";
  }
  const values = points.map((point) => Number(point.value)).filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return "";
  }
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;
  return points
    .map((point, index) => {
      const x =
        padding +
        (index / Math.max(1, points.length - 1)) * (width - padding * 2);
      const value = Number(point.value);
      const normalized = (value - minValue) / range;
      const y = height - padding - normalized * (height - padding * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function classifyIndex(index) {
  if (!Number.isFinite(index)) {
    return "No data";
  }
  if (index <= 1.1) {
    return "Near benchmark";
  }
  if (index <= 1.3) {
    return "Moderate delay pressure";
  }
  return "Severe delay pressure";
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

function TravelSegmentDetailPanel({ segment = null, onClear }) {
  const actualMin = segment?.medianTravelTimeSec !== null ? segment.medianTravelTimeSec / 60 : null;
  const benchmarkMin = segment?.benchmarkMedianSec !== null ? segment.benchmarkMedianSec / 60 : null;
  const addedMinutes =
    actualMin !== null && benchmarkMin !== null ? Math.max(0, actualMin - benchmarkMin) : null;

  const trendStart = segment?.monthSeries?.[0] || null;
  const trendEnd = segment?.monthSeries?.[segment.monthSeries.length - 1] || null;

  return (
    <section className="chart-card segment-detail-card">
      <div className="card-header">
        <h2>Segment Detail Panel</h2>
        {segment ? (
          <button type="button" className="detail-clear-btn" onClick={onClear}>
            Clear
          </button>
        ) : null}
      </div>

      {!segment ? (
        <p className="card-subtitle">Click a segment on the map to inspect detailed travel-time behavior.</p>
      ) : (
        <>
          <p className="card-subtitle">
            {segment.segmentName} ({segment.line}) · {classifyIndex(segment.travelTimeIndex)}
          </p>

          <div className="segment-metric-grid">
            <article>
              <h3>Actual Median</h3>
              <strong>
                {segment.medianTravelTimeSec !== null
                  ? `${(segment.medianTravelTimeSec / 60).toFixed(1)} min`
                  : "No data"}
              </strong>
            </article>
            <article>
              <h3>Benchmark</h3>
              <strong>
                {segment.benchmarkMedianSec !== null
                  ? `${(segment.benchmarkMedianSec / 60).toFixed(1)} min`
                  : "No data"}
              </strong>
            </article>
            <article>
              <h3>Buffer Time</h3>
              <strong>
                {segment.bufferTimeSec !== null
                  ? `${(segment.bufferTimeSec / 60).toFixed(1)} min`
                  : "No data"}
              </strong>
            </article>
            <article>
              <h3>Travel Time Index (TTI)</h3>
              <strong>{segment.travelTimeIndex?.toFixed(2)}x</strong>
            </article>
            <article>
              <h3>Added Time vs Benchmark</h3>
              <strong>{addedMinutes !== null ? `${addedMinutes.toFixed(1)} min` : "No data"}</strong>
            </article>
          </div>

          <div className="segment-profile-grid">
            <article>
              <h3>Time-of-Day Profile</h3>
              <ul>
                {segment.timeProfile.map((item) => (
                  <li key={item.period}>
                    <span>{item.period}</span>
                    <strong>{item.value?.toFixed(2)}x</strong>
                  </li>
                ))}
              </ul>
            </article>
            <article>
              <h3>Monthly Trend</h3>
              {segment.monthSeries.length > 0 ? (
                <>
                  <svg viewBox="0 0 320 90" className="segment-trend-spark">
                    <path d={trendPointsPath(segment.monthSeries, 320, 90, 8)} />
                  </svg>
                  <p className="segment-trend-range">
                    {trendStart && trendEnd
                      ? `${monthShortLabel(trendStart.month)} ${trendStart.value?.toFixed(2)}x to ${monthShortLabel(trendEnd.month)} ${trendEnd.value?.toFixed(2)}x`
                      : null}
                  </p>
                </>
              ) : (
                <p>No monthly trend data available.</p>
              )}
              <p className="segment-trend-direction">
                Trend: {segment.trendDirection}
              </p>
              <p className="segment-trend-direction">
                Months observed: {segment.observedMonths ?? segment.monthSeries.length}
              </p>
            </article>
          </div>
        </>
      )}
    </section>
  );
}

export default TravelSegmentDetailPanel;
