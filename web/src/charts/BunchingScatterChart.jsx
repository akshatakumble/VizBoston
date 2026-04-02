import { interpolateRdYlGn, max, scaleLinear } from "d3";

function BunchingScatterChart({
  title = "Train Bunching Indicator",
  subtitle = "",
  data = [],
  width = 760,
  height = 330,
}) {
  const margin = { top: 24, right: 22, bottom: 52, left: 56 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const points = data
    .map((row) => ({
      ...row,
      x: Number(row.x),
      y: Number(row.y),
      regularity: Number(row.regularity),
      bunched: Boolean(row.bunched),
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
  const xScale = scaleLinear().domain([0, axisMax]).range([0, innerWidth]).nice();
  const yScale = scaleLinear().domain([0, axisMax]).range([innerHeight, 0]).nice();
  const ticks = xScale.ticks(6);

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
                  {tick.toFixed(1)}m
                </text>
              </g>
            ))}

            {ticks.map((tick) => (
              <g key={`y-${tick}`} transform={`translate(0,${yScale(tick)})`}>
                <line x1={0} x2={innerWidth} className="axis-grid-line" />
                <text x={-10} y={4} className="axis-tick-label axis-tick-label-y" textAnchor="end">
                  {tick.toFixed(1)}m
                </text>
              </g>
            ))}

            <line x1={0} y1={innerHeight} x2={innerWidth} y2={0} className="bunching-diagonal" />
            <text x={innerWidth - 4} y={14} className="goal-line-label" textAnchor="end">
              Perfectly even spacing
            </text>

            {points.map((point, index) => (
              <circle
                key={index}
                cx={xScale(point.x)}
                cy={yScale(point.y)}
                r={point.bunched ? 4 : 3}
                fill={interpolateRdYlGn(Math.max(0, Math.min(1, point.regularity)))}
                opacity={0.75}
                stroke={point.bunched ? "var(--ink)" : "transparent"}
                strokeWidth={point.bunched ? 0.8 : 0}
              >
                <title>
                  {`${point.line}: prev ${point.x.toFixed(1)}m, current ${point.y.toFixed(1)}m, regularity ${(
                    point.regularity * 100
                  ).toFixed(0)}%${point.bunched ? " (bunched)" : ""}`}
                </title>
              </circle>
            ))}
          </g>
        </svg>
      </div>
    </section>
  );
}

export default BunchingScatterChart;
