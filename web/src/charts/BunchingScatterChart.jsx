import { interpolateRdYlGn, max, scaleLinear } from "d3";

function BunchingScatterChart({
  title = "Train Bunching Indicator",
  subtitle = "",
  data = [],
  width = 760,
  height = 330,
}) {
  const margin = { top: 24, right: 20, bottom: 48, left: 70 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const points = data
    .map((row) => ({
      ...row,
      x: Number(row.x),
      y: Number(row.y),
      regularity: Number(row.regularity),
      bunched: Boolean(row.bunched),
      sampleCount: Math.max(1, Number(row.sampleCount) || 1),
      bunchingRatePct: Number(row.bunchingRatePct),
    }))
    .filter((row) => Number.isFinite(row.x) && Number.isFinite(row.y));

  if (points.length === 0) {
    return (
      <section className="chart-card">
        <h2>{title}</h2>
        <p>No bunching scatter data available.</p>
      </section>
    );
  }

  const axisMax = max(points, (point) => Math.max(point.x, point.y)) ?? 1;
  const maxSampleCount = max(points, (point) => point.sampleCount) ?? 1;
  const xScale = scaleLinear().domain([0, axisMax]).range([0, innerWidth]).nice();
  const yScale = scaleLinear().domain([0, axisMax]).range([innerHeight, 0]).nice();
  const ticks = xScale.ticks(5);

  return (
    <section className="chart-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}

      <div className="chart-frame">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {ticks.map((tick) => (
              <g key={`x-${tick}`} transform={`translate(${xScale(tick)},0)`}>
                <line y1={0} y2={innerHeight} className="axis-grid-line" />
                <text y={innerHeight + 20} className="axis-tick-label axis-tick-label-x" textAnchor="middle">
                  {tick.toFixed(1)} min
                </text>
              </g>
            ))}

            {ticks.map((tick) => (
              <g key={`y-${tick}`} transform={`translate(0,${yScale(tick)})`}>
                <line x1={0} x2={innerWidth} className="axis-grid-line" />
                <text x={-8} y={4} className="axis-tick-label axis-tick-label-y" textAnchor="end">
                  {tick.toFixed(1)} min
                </text>
              </g>
            ))}

            <line x1={0} y1={innerHeight} x2={innerWidth} y2={0} className="bunching-diagonal" />
            <text x={innerWidth - 4} y={14} className="goal-line-label" textAnchor="end">
              Perfectly even spacing
            </text>
            <text x={0} y={-8} className="axis-tick-label" textAnchor="start">
              P90 headway (min)
            </text>
            <text x={innerWidth / 2} y={innerHeight + 38} className="axis-tick-label" textAnchor="middle">
              Average observed headway (min)
            </text>

            {points.map((point, index) => (
              <circle
                key={index}
                cx={xScale(point.x)}
                cy={yScale(point.y)}
                r={2 + 3 * Math.sqrt(point.sampleCount / Math.max(1, maxSampleCount))}
                fill={interpolateRdYlGn(Math.max(0, Math.min(1, point.regularity)))}
                opacity={0.72}
                stroke={point.bunched ? "var(--ink)" : "transparent"}
                strokeWidth={point.bunched ? 0.8 : 0}
              >
                <title>
                  {`${point.line}: avg ${point.x.toFixed(1)} min, p90 ${point.y.toFixed(1)} min, regularity ${(
                    point.regularity * 100
                  ).toFixed(0)}%, bunching ${Number.isFinite(point.bunchingRatePct) ? point.bunchingRatePct.toFixed(1) : "NA"}%, n=${point.sampleCount}${point.bunched ? " (bunched)" : ""}`}
                </title>
              </circle>
            ))}
          </g>
        </svg>
      </div>

      <p className="card-footnote">
        Points are aggregated by station under current filters; larger points indicate more observations.
      </p>
    </section>
  );
}

export default BunchingScatterChart;
