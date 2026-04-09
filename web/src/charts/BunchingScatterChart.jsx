import { max, scaleLinear } from "d3";
import { useMemo, useState } from "react";
import { getLineColor } from "../design/transit";
import Tooltip from "./components/Tooltip";

function BunchingScatterChart({
  title = "Train Bunching Indicator",
  subtitle = "",
  data = [],
  cardClassName = "",
  width = 1400,
  height = 300,
}) {
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, rows: [], title: "" });
  const margin = { top: 16, right: 28, bottom: 34, left: 64 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const topMarginalHeight = 0;
  const rightMarginalWidth = 0;

  const { points, adjustedCount } = useMemo(() => {
    const normalized = data
      .map((row) => {
        const x = Number(row.x);
        const y = Number(row.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return null;
        }
        const clampedY = Math.max(x, y);
        return {
          ...row,
          x,
          y: clampedY,
          rawY: y,
          regularity: Number(row.regularity),
          bunched: Boolean(row.bunched),
          sampleCount: Math.max(1, Number(row.sampleCount) || 1),
          bunchingRatePct: Number(row.bunchingRatePct),
          varianceGap: clampedY - x,
          station: String(row.station || "Unknown"),
          line: String(row.line || "Unknown"),
        };
      })
      .filter(Boolean);
    const adjusted = normalized.filter((row) => row.rawY < row.x).length;
    return { points: normalized, adjustedCount: adjusted };
  }, [data]);

  if (points.length === 0) {
    return (
      <section className={`chart-card ${cardClassName}`.trim()}>
        <h2>{title}</h2>
        <p>No bunching scatter data available.</p>
      </section>
    );
  }

  const axisMax = max(points, (point) => Math.max(point.x, point.y)) ?? 1;
  const axisDomainMax = Math.max(1, axisMax * 1.06);
  const xScale = scaleLinear().domain([0, axisDomainMax]).range([0, innerWidth - rightMarginalWidth]).nice();
  const yScale = scaleLinear().domain([0, axisDomainMax]).range([innerHeight - topMarginalHeight, 0]).nice();
  const ticks = xScale.ticks(5);
  const lines = Array.from(new Set(points.map((point) => point.line))).sort((left, right) => left.localeCompare(right));
  const topOutliers = points
    .slice()
    .sort((left, right) => right.varianceGap - left.varianceGap || right.y - left.y)
    .slice(0, 4);

  return (
    <section className={`chart-card ${cardClassName}`.trim()}>
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
      <p className="card-subtitle">
        Points above the diagonal have higher headway variance; farther distance above the line indicates stronger bunching severity.
      </p>

      <div className="bunching-line-legend" aria-label="Transit line legend">
        {lines.map((line) => (
          <span key={line}>
            <i style={{ backgroundColor: getLineColor(line) }} />
            {line}
          </span>
        ))}
      </div>

      <div className="chart-frame bunching-frame-compact">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {ticks.map((tick) => (
              <g key={`x-${tick}`} transform={`translate(${xScale(tick)},0)`}>
                <line y1={0} y2={innerHeight - topMarginalHeight} className="axis-grid-line" />
                <text
                  x={tick === 0 ? 8 : 0}
                  y={innerHeight + 14}
                  className="axis-tick-label axis-tick-label-x"
                  textAnchor={tick === 0 ? "start" : "middle"}
                >
                  {tick.toFixed(1)} min
                </text>
              </g>
            ))}

            {ticks.map((tick) => (
              <g key={`y-${tick}`} transform={`translate(0,${yScale(tick)})`}>
                <line x1={0} x2={innerWidth - rightMarginalWidth} className="axis-grid-line" />
                <text x={-8} y={4} className="axis-tick-label axis-tick-label-y" textAnchor="end">
                  {tick.toFixed(1)} min
                </text>
              </g>
            ))}

            <line
              x1={0}
              y1={yScale(0)}
              x2={xScale(axisDomainMax)}
              y2={yScale(axisDomainMax)}
              className="bunching-diagonal"
            />
            <text x={innerWidth - rightMarginalWidth - 8} y={14} className="goal-line-label bunching-diagonal-label" textAnchor="end">
              No variance (P90 = Mean)
            </text>

            <text x={0} y={-8} className="axis-tick-label" textAnchor="start">
              P90 headway (min)
            </text>
            <text x={(innerWidth - rightMarginalWidth) / 2} y={innerHeight + 16} className="axis-tick-label" textAnchor="middle">
              Average observed headway (min)
            </text>

            {points.map((point, index) => (
              <circle
                key={index}
                cx={xScale(point.x)}
                cy={yScale(point.y)}
                r={5}
                fill={getLineColor(point.line)}
                opacity={0.7}
                stroke={point.bunched ? "var(--ink)" : "transparent"}
                strokeWidth={point.bunched ? 0.8 : 0}
                onMouseEnter={(event) => {
                  const bounds = event.currentTarget.ownerSVGElement.getBoundingClientRect();
                  setTooltip({
                    visible: true,
                    x: event.clientX - bounds.left + 10,
                    y: event.clientY - bounds.top - 10,
                    title: point.station,
                    rows: [
                      { label: "Line", value: point.line },
                      { label: "Avg headway", value: `${point.x.toFixed(1)} min` },
                      { label: "P90 headway", value: `${point.y.toFixed(1)} min` },
                      { label: "Variance gap", value: `+${point.varianceGap.toFixed(1)} min` },
                      { label: "Samples", value: point.sampleCount.toLocaleString() },
                    ],
                  });
                }}
                onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
              />
            ))}

          </g>
        </svg>
        <Tooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} title={tooltip.title} rows={tooltip.rows} />
      </div>

      <div className="bunching-outlier-list">
        <strong>High-variance stations to inspect:</strong>{" "}
        {topOutliers.map((point) => `${point.station} (${point.line}, +${point.varianceGap.toFixed(1)} min)`).join("; ")}
      </div>

      <p className="card-footnote">
        Points are aggregated by station under current filters. All points are shown on or above the diagonal (P90 ≥ mean).
        {adjustedCount > 0 ? ` ${adjustedCount} point(s) were corrected to satisfy this integrity constraint.` : ""}
      </p>
    </section>
  );
}

export default BunchingScatterChart;
