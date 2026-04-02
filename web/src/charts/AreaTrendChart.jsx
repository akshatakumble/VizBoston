import { area as d3Area, line as d3Line, max, min, scaleLinear, scalePoint, scaleTime } from "d3";

function parseDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function defaultFormatter(value) {
  return `${Number(value).toFixed(1)}%`;
}

function AreaTrendChart({
  title = "Area Trend",
  subtitle = "",
  data = [],
  xKey = "date",
  yKey = "value",
  goalKey = "goal",
  xTickFormatter = (tick) => {
    if (tick instanceof Date) {
      return tick.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
    }
    return String(tick);
  },
  metricFormatter = defaultFormatter,
  width = 760,
  height = 320,
}) {
  const margin = { top: 26, right: 26, bottom: 52, left: 56 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const normalized = data
    .map((row) => ({
      ...row,
      __xDate: parseDate(row[xKey]),
      __xRaw: row[xKey],
      __y: Number(row[yKey]),
      __goal: Number(row[goalKey]),
    }))
    .filter((row) => Number.isFinite(row.__y))
    .sort((left, right) =>
      (left.__xDate?.getTime() || String(left.__xRaw)) > (right.__xDate?.getTime() || String(right.__xRaw))
        ? 1
        : -1
    );

  if (normalized.length === 0) {
    return (
      <section className="chart-card">
        <h2>{title}</h2>
        <p>No data available.</p>
      </section>
    );
  }

  const hasDates = normalized.every((row) => row.__xDate instanceof Date);
  const xScale = hasDates
    ? scaleTime()
        .domain([normalized[0].__xDate, normalized[normalized.length - 1].__xDate])
        .range([0, innerWidth])
    : scalePoint()
        .domain(normalized.map((row) => String(row.__xRaw)))
        .range([0, innerWidth])
        .padding(0.3);

  const goalValues = normalized.map((row) => row.__goal).filter((value) => Number.isFinite(value));
  const yMin = min([...normalized.map((row) => row.__y), ...goalValues]) ?? 0;
  const yMax = max([...normalized.map((row) => row.__y), ...goalValues]) ?? 100;
  const yScale = scaleLinear()
    .domain([Math.max(0, yMin - 2), yMax + 2])
    .range([innerHeight, 0])
    .nice();

  const areaPath = d3Area()
    .x((row) => (hasDates ? xScale(row.__xDate) : xScale(String(row.__xRaw))))
    .y0(innerHeight)
    .y1((row) => yScale(row.__y))(normalized);

  const linePath = d3Line()
    .x((row) => (hasDates ? xScale(row.__xDate) : xScale(String(row.__xRaw))))
    .y((row) => yScale(row.__y))(normalized);

  const firstGoal = goalValues.length > 0 ? goalValues[0] : null;
  const xTicks = hasDates ? xScale.ticks(6) : xScale.domain();
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
                <text x={-10} y={4} className="axis-tick-label axis-tick-label-y">
                  {metricFormatter(tick)}
                </text>
              </g>
            ))}

            {xTicks.map((tick) => {
              const xPos = hasDates ? xScale(tick) : xScale(String(tick));
              return (
                <g key={String(tick)} transform={`translate(${xPos},${innerHeight})`}>
                  <line y1={0} y2={6} className="axis-tick-mark" />
                  <text y={20} className="axis-tick-label axis-tick-label-x">
                    {xTickFormatter(tick)}
                  </text>
                </g>
              );
            })}

            {firstGoal !== null ? (
              <g>
                <line
                  x1={0}
                  x2={innerWidth}
                  y1={yScale(firstGoal)}
                  y2={yScale(firstGoal)}
                  className="goal-line"
                />
                <text x={innerWidth - 4} y={yScale(firstGoal) - 8} className="goal-line-label" textAnchor="end">
                  MBTA Target {metricFormatter(firstGoal)}
                </text>
              </g>
            ) : null}

            <path d={areaPath} className="area-trend-fill" />
            <path d={linePath} className="area-trend-line" />

            {normalized.map((row, index) => {
              const cx = hasDates ? xScale(row.__xDate) : xScale(String(row.__xRaw));
              return <circle key={index} cx={cx} cy={yScale(row.__y)} r={2.8} className="area-trend-point" />;
            })}
          </g>
        </svg>
      </div>
    </section>
  );
}

export default AreaTrendChart;
