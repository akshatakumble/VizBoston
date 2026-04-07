import { max, scaleBand, scaleLinear } from "d3";
import { getLineColor } from "../design/transit";

function HeadwayBoxPlot({
  title = "Headway Distribution",
  subtitle = "",
  data = [],
  width = 760,
  height = 320,
}) {
  const margin = { top: 20, right: 24, bottom: 56, left: 56 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  if (!Array.isArray(data) || data.length === 0) {
    return (
      <section className="chart-card">
        <h2>{title}</h2>
        <p>No distribution data available.</p>
      </section>
    );
  }

  const categories = data.map((row) => `${row.line} ${row.periodGroup}`);
  const xScale = scaleBand().domain(categories).range([0, innerWidth]).padding(0.35);
  const yMax = max(data, (row) => row.p90 ?? row.q3 ?? row.median ?? row.max) ?? 1;
  const yScale = scaleLinear().domain([0, yMax]).range([innerHeight, 0]).nice();
  const yTicks = yScale.ticks(5);

  return (
    <section className="chart-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}

      <div className="chart-frame">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {yTicks.map((tick) => (
              <g key={tick} transform={`translate(0,${yScale(tick)})`}>
                <line x1={0} x2={innerWidth} className="axis-grid-line" />
                <text x={-10} y={4} className="axis-tick-label axis-tick-label-y" textAnchor="end">
                  {tick.toFixed(1)} min
                </text>
              </g>
            ))}

            {data.map((row) => {
              const category = `${row.line} ${row.periodGroup}`;
              const x = xScale(category);
              const boxWidth = xScale.bandwidth();
              const center = x + boxWidth / 2;
              const lineColor = getLineColor(row.line);
              const whiskerLow = Number.isFinite(row.p10) ? row.p10 : row.min;
              const whiskerHigh = Number.isFinite(row.p90) ? row.p90 : row.max;
              const isClipped = Number.isFinite(row.max) && row.max > yScale.domain()[1];
              return (
                <g key={category}>
                  <line x1={center} x2={center} y1={yScale(whiskerLow)} y2={yScale(whiskerHigh)} className="boxplot-whisker" />
                  <line x1={x + 4} x2={x + boxWidth - 4} y1={yScale(whiskerLow)} y2={yScale(whiskerLow)} className="boxplot-cap" />
                  <line x1={x + 4} x2={x + boxWidth - 4} y1={yScale(whiskerHigh)} y2={yScale(whiskerHigh)} className="boxplot-cap" />
                  <rect
                    x={x}
                    y={yScale(row.q3)}
                    width={boxWidth}
                    height={Math.max(1, yScale(row.q1) - yScale(row.q3))}
                    fill={lineColor}
                    fillOpacity={0.2}
                    stroke={lineColor}
                    strokeWidth={1.5}
                  />
                  <line x1={x} x2={x + boxWidth} y1={yScale(row.median)} y2={yScale(row.median)} className="boxplot-median" />
                  {isClipped ? (
                    <path
                      d={`M ${center - 4} 2 L ${center + 4} 2 L ${center} 8 Z`}
                      fill={lineColor}
                      opacity={0.9}
                    />
                  ) : null}
                  <title>
                    {`${row.line} ${row.periodGroup}: p10 ${whiskerLow.toFixed(1)}m, q1 ${row.q1.toFixed(
                      1
                    )}m, median ${row.median.toFixed(1)}m, q3 ${row.q3.toFixed(1)}m, max ${row.max.toFixed(
                      1
                    )}m, n=${row.count}`}
                  </title>
                </g>
              );
            })}

            {categories.map((category) => (
              <text
                key={category}
                x={(xScale(category) || 0) + xScale.bandwidth() / 2}
                y={innerHeight + 20}
                className="axis-tick-label axis-tick-label-x"
                textAnchor="middle"
              >
                {category}
              </text>
            ))}
          </g>
        </svg>
      </div>

      <p className="card-footnote">
        Whiskers show P10-P90 (not absolute min/max) to reduce outlier distortion and improve cross-line comparison.
      </p>
    </section>
  );
}

export default HeadwayBoxPlot;
