import { getLineColor } from "../design/transit";

const METRICS = [
  {
    key: "otp_pct",
    label: "Avg OTP % (selected period)",
    higherIsBetter: true,
    format: (value) => `${value.toFixed(1)}%`,
  },
  {
    key: "avg_headway_min",
    label: "Headway (min)",
    higherIsBetter: false,
    format: (value) => `${value.toFixed(1)} min`,
  },
  {
    key: "travel_time_index",
    label: "Travel Index",
    higherIsBetter: false,
    format: (value) => `${value.toFixed(2)}x`,
  },
  {
    key: "headway_cv_pct",
    label: "Headway CV %",
    higherIsBetter: false,
    format: (value) => `${value.toFixed(1)}%`,
  },
  {
    key: "service_delivery_pct",
    label: "Delivery %",
    higherIsBetter: true,
    format: (value) => `${value.toFixed(1)}%`,
  },
];

function toFinite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildMetricRanges(data) {
  const ranges = {};
  for (const metric of METRICS) {
    const values = data
      .map((row) => toFinite(row.metrics?.[metric.key]))
      .filter((value) => value !== null);
    ranges[metric.key] = {
      min: values.length > 0 ? Math.min(...values) : null,
      max: values.length > 0 ? Math.max(...values) : null,
    };
  }
  return ranges;
}

function rawPosition(value, range) {
  if (value === null || range.min === null || range.max === null) {
    return null;
  }
  if (range.max === range.min) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, (value - range.min) / (range.max - range.min)));
}

function computeCompositeScore(row, ranges) {
  const scores = [];
  for (const metric of METRICS) {
    const value = toFinite(row.metrics?.[metric.key]);
    const range = ranges[metric.key];
    if (value === null || range.min === null || range.max === null) {
      continue;
    }
    if (range.max === range.min) {
      scores.push(0.5);
      continue;
    }
    const normalizedRaw = (value - range.min) / (range.max - range.min);
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
      <section className="chart-card">
        <h2>{title}</h2>
        <p>No comparison data available.</p>
      </section>
    );
  }

  const ranges = buildMetricRanges(data);

  return (
    <section className="chart-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}

      <div className="metric-matrix-wrap">
        <table className="metric-matrix" aria-label={title}>
          <thead>
            <tr>
              <th>Line</th>
              {METRICS.map((metric) => {
                const range = ranges[metric.key];
                const direction = metric.higherIsBetter ? "Higher is better" : "Lower is better";
                const rangeLabel =
                  range.min !== null && range.max !== null
                    ? `${metric.format(range.min)} to ${metric.format(range.max)}`
                    : "No range";
                return (
                  <th key={metric.key}>
                    <div className="metric-header-label">{metric.label}</div>
                    <div className="metric-header-direction">{direction}</div>
                    <div className="metric-header-range">{rangeLabel}</div>
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
              const compositeScore = computeCompositeScore(lineRow, ranges);
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
                    const range = ranges[metric.key];
                    const position = rawPosition(value, range);
                    return (
                      <td key={`${lineRow.line}-${metric.key}`}>
                        <div className="metric-cell">
                          <span className="metric-cell-value">
                            {value !== null ? metric.format(value) : "NA"}
                          </span>
                          {value !== null && position !== null ? (
                            <svg
                              viewBox="0 0 120 14"
                              className="metric-cell-plot"
                              aria-hidden="true"
                            >
                              <line x1="2" y1="7" x2="118" y2="7" className="metric-cell-track" />
                              <circle
                                cx={(2 + position * 116).toFixed(2)}
                                cy="7"
                                r="3.4"
                                fill={lineColor}
                              />
                            </svg>
                          ) : (
                            <span className="metric-cell-empty" aria-hidden="true" />
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
        for Headway, Travel Index, and Headway CV). Missing values are excluded from scoring.
      </p>
    </section>
  );
}

export default RadarComparisonChart;
