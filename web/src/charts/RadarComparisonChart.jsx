import { getLineColor } from "../design/transit";

const METRICS = [
  {
    key: "otp_pct",
    label: "Avg OTP % (selected period)",
    higherIsBetter: true,
    format: (value) => `${value.toFixed(1)}%`,
    benchmarkLabel: "MBTA target",
    benchmarkValue: 85,
  },
  {
    key: "service_delivery_pct",
    label: "Delivery %",
    higherIsBetter: true,
    format: (value) => `${value.toFixed(1)}%`,
    benchmarkLabel: "System median",
  },
  {
    key: "avg_headway_min",
    label: "Headway (min)",
    higherIsBetter: false,
    format: (value) => `${value.toFixed(1)} min`,
    benchmarkLabel: "System median",
  },
  {
    key: "travel_time_index",
    label: "Travel Index",
    higherIsBetter: false,
    format: (value) => `${value.toFixed(2)}x`,
    benchmarkLabel: "System median",
  },
  {
    key: "headway_cv_pct",
    label: "Headway CV %",
    higherIsBetter: false,
    format: (value) => `${value.toFixed(1)}%`,
    benchmarkLabel: "System median",
  },
];

function toFinite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function median(values = []) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const center = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[center - 1] + sorted[center]) / 2;
  }
  return sorted[center];
}

function buildMetricStats(data) {
  const stats = {};
  for (const metric of METRICS) {
    const values = data
      .map((row) => toFinite(row.metrics?.[metric.key]))
      .filter((value) => value !== null);
    const observedMin = values.length > 0 ? Math.min(...values) : null;
    const observedMax = values.length > 0 ? Math.max(...values) : null;
    const fallbackBenchmark = median(values);
    const metricBenchmark = toFinite(metric.benchmarkValue);
    const benchmark = metricBenchmark ?? fallbackBenchmark;
    const domainMin =
      observedMin !== null && benchmark !== null ? Math.min(observedMin, benchmark) : observedMin;
    const domainMax =
      observedMax !== null && benchmark !== null ? Math.max(observedMax, benchmark) : observedMax;
    stats[metric.key] = {
      min: observedMin,
      max: observedMax,
      domainMin,
      domainMax,
      benchmark,
    };
  }
  return stats;
}

function rawPosition(value, metricStat) {
  if (value === null || metricStat.domainMin === null || metricStat.domainMax === null) {
    return null;
  }
  if (metricStat.domainMax === metricStat.domainMin) {
    return 0.5;
  }
  return Math.max(
    0,
    Math.min(1, (value - metricStat.domainMin) / (metricStat.domainMax - metricStat.domainMin))
  );
}

function computeCompositeScore(row, metricStats) {
  const scores = [];
  for (const metric of METRICS) {
    const value = toFinite(row.metrics?.[metric.key]);
    const metricStat = metricStats[metric.key];
    if (value === null || metricStat.min === null || metricStat.max === null) {
      continue;
    }
    if (metricStat.max === metricStat.min) {
      scores.push(0.5);
      continue;
    }
    const normalizedRaw = (value - metricStat.min) / (metricStat.max - metricStat.min);
    const normalized = metric.higherIsBetter ? normalizedRaw : 1 - normalizedRaw;
    scores.push(Math.max(0, Math.min(1, normalized)));
  }
  if (scores.length === 0) {
    return null;
  }
  return (scores.reduce((sum, value) => sum + value, 0) / scores.length) * 100;
}

function RadarComparisonChart({
  title = "Line Metric Comparison",
  subtitle = "",
  data = [],
  onLineClick,
}) {
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <section className="chart-card metric-matrix-card">
        <h2>{title}</h2>
        <p>No comparison data available.</p>
      </section>
    );
  }

  const metricStats = buildMetricStats(data);

  return (
    <section className="chart-card metric-matrix-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
      <p className="card-footnote">
      </p>

      <div className="metric-matrix-wrap">
        <table className="metric-matrix" aria-label={title}>
          <thead>
            <tr>
              <th>Line</th>
              {METRICS.map((metric) => {
                const metricStat = metricStats[metric.key];
                const direction = metric.higherIsBetter ? "Higher is better" : "Lower is better";
                const rangeLabel =
                  metricStat.min !== null && metricStat.max !== null
                    ? `${metric.format(metricStat.min)} to ${metric.format(metricStat.max)}`
                    : "No range";
                const benchmarkLabel =
                  metricStat.benchmark !== null
                    ? `${metric.benchmarkLabel}: ${metric.format(metricStat.benchmark)}`
                    : `${metric.benchmarkLabel}: NA`;
                return (
                  <th key={metric.key}>
                    <div className="metric-header-label">{metric.label}</div>
                    <div
                      className={`metric-header-direction ${
                        metric.higherIsBetter ? "direction-positive" : "direction-negative"
                      }`}
                    >
                      {direction}
                    </div>
                    <div className="metric-header-range">{rangeLabel}</div>
                    <div className="metric-header-benchmark">{benchmarkLabel}</div>
                  </th>
                );
              })}
              <th>
                <div className="metric-header-label">Score</div>
                <div className="metric-header-direction">Normalized</div>
                <div className="metric-header-range">0 to 100</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((lineRow) => {
              const compositeScore = computeCompositeScore(lineRow, metricStats);
              const lineColor = getLineColor(lineRow.line);
              return (
                <tr key={lineRow.line}>
                  <th scope="row">
                    {onLineClick ? (
                      <button
                        type="button"
                        className="metric-line-button"
                        onClick={() => onLineClick(lineRow.line)}
                        style={{ "--line-color": lineColor }}
                      >
                        {lineRow.line}
                      </button>
                    ) : (
                      <span className="metric-line-label" style={{ "--line-color": lineColor }}>
                        {lineRow.line}
                      </span>
                    )}
                  </th>

                  {METRICS.map((metric) => {
                    const value = toFinite(lineRow.metrics?.[metric.key]);
                    const metricStat = metricStats[metric.key];
                    const position = rawPosition(value, metricStat);
                    const benchmarkPosition = rawPosition(metricStat.benchmark, metricStat);
                    return (
                      <td key={`${lineRow.line}-${metric.key}`}>
                        <div className="metric-cell">
                          {value !== null && position !== null ? (
                            <svg
                              viewBox="0 0 132 18"
                              className="metric-cell-plot"
                              role="img"
                              aria-label={`${lineRow.line} ${metric.label}: ${metric.format(value)}`}
                            >
                              <line x1="6" y1="9" x2="126" y2="9" className="metric-cell-track" />
                              {benchmarkPosition !== null ? (
                                <line
                                  x1={(6 + benchmarkPosition * 120).toFixed(2)}
                                  y1="3"
                                  x2={(6 + benchmarkPosition * 120).toFixed(2)}
                                  y2="15"
                                  className="metric-cell-benchmark"
                                />
                              ) : null}
                              <circle
                                cx={(6 + position * 120).toFixed(2)}
                                cy="9"
                                r="3.6"
                                className="metric-cell-dot"
                                style={{ "--line-color": lineColor }}
                              />
                              <text
                                x={(6 + position * 120 + (position > 0.76 ? -4 : 6)).toFixed(2)}
                                y="5"
                                className={`metric-cell-value-label ${
                                  position > 0.76 ? "align-right" : "align-left"
                                }`}
                              >
                                {metric.format(value)}
                              </text>
                            </svg>
                          ) : (
                            <span className="metric-cell-empty">NA</span>
                          )}
                        </div>
                      </td>
                    );
                  })}

                  <td className="metric-score-cell">
                    {compositeScore !== null ? compositeScore.toFixed(0) : "NA"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="card-footnote">
        Avg OTP is computed for the selected period (event-weighted when counts are available). Score is an
        average of within-metric normalized rankings (higher is better for OTP and Delivery; lower is better
        for Headway, Travel Index, and Headway CV). Benchmark markers show the OTP target or selected-period
        system median by metric. Missing values are excluded from scoring.
      </p>
    </section>
  );
}

export default RadarComparisonChart;
