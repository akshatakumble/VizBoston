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
  const yMax = max(data, (row) => row.max) ?? 1;
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
                  {tick.toFixed(1)}m
                </text>
              </g>
            ))}

            {data.map((row) => {
              const category = `${row.line} ${row.periodGroup}`;
              const x = xScale(category);
              const boxWidth = xScale.bandwidth();
              const center = x + boxWidth / 2;
              const lineColor = getLineColor(row.line);
              return (
                <g key={category}>
                  <line x1={center} x2={center} y1={yScale(row.min)} y2={yScale(row.max)} className="boxplot-whisker" />
                  <line x1={x + 4} x2={x + boxWidth - 4} y1={yScale(row.min)} y2={yScale(row.min)} className="boxplot-cap" />
                  <line x1={x + 4} x2={x + boxWidth - 4} y1={yScale(row.max)} y2={yScale(row.max)} className="boxplot-cap" />
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
                  <title>
                    {`${row.line} ${row.periodGroup}: min ${row.min.toFixed(1)}m, q1 ${row.q1.toFixed(
                      1
                    )}m, median ${row.median.toFixed(1)}m, q3 ${row.q3.toFixed(1)}m, max ${row.max.toFixed(
                      1
                    )}m`}
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
    </section>
  );
}

export default HeadwayBoxPlot;
