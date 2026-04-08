import { max, median, scaleBand, scaleLinear } from "d3";
import { getLineColor } from "../design/transit";

function GreenBranchComparisonChart({
  title = "Green Line Branch Comparison",
  subtitle = "",
  data = [],
  width = 760,
  height = 320,
}) {
  const margin = { top: 24, right: 120, bottom: 44, left: 88 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const rows = data
    .map((row) => ({
      branch: String(row.branch || ""),
      headwayMin: Number(row.headwayMin),
      sampleCount: Math.max(0, Number(row.sampleCount) || 0),
    }))
    .filter((row) => row.branch && Number.isFinite(row.headwayMin))
    .sort((left, right) => left.headwayMin - right.headwayMin);

  if (rows.length === 0) {
    return (
      <section className="chart-card">
        <h2>{title}</h2>
        <p>No branch comparison data available.</p>
      </section>
    );
  }

  const xMax = max(rows, (row) => row.headwayMin) ?? 1;
  const xScale = scaleLinear().domain([0, xMax * 1.15]).range([0, innerWidth]).nice();
  const yScale = scaleBand().domain(rows.map((row) => row.branch)).range([0, innerHeight]).padding(0.3);
  const ticks = xScale.ticks(5);
  const medianHeadway = median(rows, (row) => row.headwayMin);
  const best = rows[0]?.headwayMin ?? null;

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
              <g key={tick} transform={`translate(${xScale(tick)},0)`}>
                <line y1={0} y2={innerHeight} className="axis-grid-line" />
                <text y={innerHeight + 20} className="axis-tick-label axis-tick-label-x" textAnchor="middle">
                  {tick.toFixed(1)} min
                </text>
              </g>
            ))}

            {medianHeadway !== undefined && medianHeadway !== null ? (
              <g transform={`translate(${xScale(medianHeadway)},0)`}>
                <line y1={0} y2={innerHeight} className="bunching-diagonal" />
                <text x={4} y={-8} className="goal-line-label" textAnchor="start">
                  Median {medianHeadway.toFixed(1)} min
                </text>
              </g>
            ) : null}

            {rows.map((row) => {
              const y = yScale(row.branch) || 0;
              const barHeight = yScale.bandwidth();
              const barWidth = xScale(row.headwayMin);
              const deltaVsBest = best !== null ? row.headwayMin - best : 0;
              return (
                <g key={row.branch}>
                  <rect
                    x={0}
                    y={y}
                    width={Math.max(1, barWidth)}
                    height={barHeight}
                    rx={3}
                    fill={getLineColor(row.branch)}
                    fillOpacity={0.42}
                  >
                    <title>
                      {`${row.branch}: ${row.headwayMin.toFixed(2)} min, n=${row.sampleCount.toLocaleString()}, Δ vs best ${deltaVsBest.toFixed(2)} min`}
                    </title>
                  </rect>
                  <text
                    x={-10}
                    y={y + barHeight / 2}
                    className="axis-tick-label axis-tick-label-y"
                    textAnchor="end"
                    dominantBaseline="middle"
                  >
                    {row.branch}
                  </text>
                  <text
                    x={Math.min(innerWidth - 4, barWidth + 6)}
                    y={y + barHeight / 2 - 6}
                    className="axis-tick-label"
                    textAnchor="start"
                    dominantBaseline="middle"
                  >
                    {row.headwayMin.toFixed(1)} min
                  </text>
                  <text
                    x={Math.min(innerWidth - 4, barWidth + 6)}
                    y={y + barHeight / 2 + 8}
                    className="axis-tick-label"
                    textAnchor="start"
                    dominantBaseline="middle"
                  >
                    n={row.sampleCount.toLocaleString()}
                  </text>
                </g>
              );
            })}

            <text x={innerWidth / 2} y={innerHeight + 36} className="axis-tick-label" textAnchor="middle">
              Sample-weighted observed headway (min)
            </text>
          </g>
        </svg>
      </div>

      <p className="card-footnote">
        Branches are sorted best-to-worst (lowest to highest headway). Values and sample sizes are labeled directly.
      </p>
    </section>
  );
}

export default GreenBranchComparisonChart;

