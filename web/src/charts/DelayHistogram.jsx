import { bin, max, min, scaleLinear } from "d3";

function DelayHistogram({
  title = "Delay Distribution",
  subtitle = "",
  values = [],
  width = 760,
  height = 320,
}) {
  const margin = { top: 20, right: 24, bottom: 48, left: 56 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const numericValues = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (numericValues.length === 0) {
    return (
      <section className="chart-card">
        <h2>{title}</h2>
        <p>No delay distribution data available.</p>
      </section>
    );
  }

  const low = min(numericValues) ?? -120;
  const high = max(numericValues) ?? 300;
  const xScale = scaleLinear().domain([Math.floor(low), Math.ceil(high)]).range([0, innerWidth]).nice();
  const histogram = bin().domain(xScale.domain()).thresholds(24)(numericValues);
  const yMax = max(histogram, (bucket) => bucket.length) ?? 1;
  const yScale = scaleLinear().domain([0, yMax]).range([innerHeight, 0]).nice();
  const xTicks = xScale.ticks(7);
  const yTicks = yScale.ticks(5);

  const earlyThreshold = -60;
  const lateThreshold = 300;

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
                <text x={-10} y={4} className="axis-tick-label axis-tick-label-y">
                  {Math.round(tick)}
                </text>
              </g>
            ))}

            <rect
              x={xScale(earlyThreshold)}
              y={0}
              width={Math.max(0, xScale(lateThreshold) - xScale(earlyThreshold))}
              height={innerHeight}
              className="delay-on-time-band"
            />

            {histogram.map((bucket, index) => {
              const x0 = xScale(bucket.x0);
              const x1 = xScale(bucket.x1);
              const barWidth = Math.max(1, x1 - x0 - 1);
              const barHeight = innerHeight - yScale(bucket.length);
              return (
                <rect
                  key={index}
                  x={x0}
                  y={yScale(bucket.length)}
                  width={barWidth}
                  height={barHeight}
                  className="delay-hist-bar"
                />
              );
            })}

            <line x1={xScale(earlyThreshold)} x2={xScale(earlyThreshold)} y1={0} y2={innerHeight} className="delay-threshold" />
            <line x1={xScale(lateThreshold)} x2={xScale(lateThreshold)} y1={0} y2={innerHeight} className="delay-threshold" />
            <text x={xScale(earlyThreshold)} y={-8} textAnchor="middle" className="goal-line-label">
              Early &lt; -60s
            </text>
            <text x={xScale(lateThreshold)} y={-8} textAnchor="middle" className="goal-line-label">
              Late &gt; 300s
            </text>

            {xTicks.map((tick) => (
              <g key={tick} transform={`translate(${xScale(tick)},${innerHeight})`}>
                <line y1={0} y2={6} className="axis-tick-mark" />
                <text y={20} className="axis-tick-label axis-tick-label-x" textAnchor="middle">
                  {Math.round(tick)}s
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>
    </section>
  );
}

export default DelayHistogram;
