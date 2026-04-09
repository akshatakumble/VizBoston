import { line as d3Line, scaleLinear, scalePoint } from "d3";
import { useMemo, useState } from "react";
import { getLineColor } from "../design/transit";

function parseDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function defaultFormatter(value) {
  return `${Number(value).toFixed(1)}%`;
}

function formatSigned(value, digits = 1, suffix = "") {
  if (!Number.isFinite(value)) {
    return "NA";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}${suffix}`;
}

function monthLabel(dateText) {
  const parsed = parseDate(dateText);
  if (!parsed) {
    return String(dateText);
  }
  return parsed.toLocaleDateString(undefined, { month: "short" });
}

function AreaTrendChart({
  title = "System Reliability Trend",
  subtitle = "",
  cardClassName = "",
  data = [],
  lineSeries = [],
  xKey = "date",
  yKey = "value",
  goalKey = "goal",
  metricFormatter = defaultFormatter,
  width = 760,
  height = 320,
  yDomain = [0, 100],
}) {
  const [hoverIndex, setHoverIndex] = useState(null);

  const monthly = useMemo(
    () =>
      data
        .map((row) => ({
          ...row,
          __x: String(row[xKey]),
          __label: monthLabel(row[xKey]),
          __y: Number(row[yKey]),
          __goal: Number(row[goalKey]),
        }))
        .filter((row) => Number.isFinite(row.__y))
        .sort((left, right) => (left.__x > right.__x ? 1 : -1)),
    [data, goalKey, xKey, yKey]
  );

  if (monthly.length === 0) {
    return (
      <section className={`chart-card ${cardClassName}`.trim()}>
        <h2>{title}</h2>
        <p>No data available.</p>
      </section>
    );
  }

  const margin = { top: 14, right: 12, bottom: 34, left: 68 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const xDomain = monthly.map((row) => row.__x);
  const xScale = scalePoint().domain(xDomain).range([0, innerWidth]);

  const yLower = Number.isFinite(yDomain?.[0]) ? Number(yDomain[0]) : 0;
  const yUpper = Number.isFinite(yDomain?.[1]) ? Number(yDomain[1]) : 100;
  const yScale = scaleLinear().domain([yLower, yUpper]).range([innerHeight, 0]);

  const systemSeries = monthly.map((row) => ({ x: row.__x, y: row.__y, label: row.__label }));
  const target = Number.isFinite(monthly[0].__goal) ? monthly[0].__goal : null;

  const lineSeriesNormalized = (lineSeries || [])
    .map((series) => ({
      line: series.line,
      color: getLineColor(series.line),
      points: (series.points || [])
        .map((point) => ({ x: String(point.date), y: Number(point.value) }))
        .filter((point) => xDomain.includes(point.x) && Number.isFinite(point.y))
        .sort((left, right) => (left.x > right.x ? 1 : -1)),
    }))
    .filter((series) => series.points.length > 0);

  const allSeries = [
    {
      line: "System average",
      color: "#3b82f6",
      points: systemSeries,
      system: true,
    },
    ...lineSeriesNormalized,
  ];

  const lineGenerator = d3Line()
    .x((point) => xScale(point.x))
    .y((point) => yScale(point.y));

  const latestValue = systemSeries[systemSeries.length - 1]?.y ?? null;
  const firstValue = systemSeries[0]?.y ?? null;
  const change12m = Number.isFinite(latestValue) && Number.isFinite(firstValue) ? latestValue - firstValue : null;
  const gapToClose = Number.isFinite(latestValue) && Number.isFinite(target) ? latestValue - target : null;
  const pointsNeeded = Number.isFinite(target) && Number.isFinite(latestValue) ? target - latestValue : null;
  const annualRate = Number.isFinite(change12m) ? change12m : null;
  const yearsToTarget =
    Number.isFinite(pointsNeeded) && pointsNeeded > 0 && Number.isFinite(annualRate) && annualRate > 0
      ? pointsNeeded / annualRate
      : null;
  const latestDate = parseDate(systemSeries[systemSeries.length - 1]?.x);
  const projectedYear = latestDate && Number.isFinite(yearsToTarget) ? latestDate.getFullYear() + Math.ceil(yearsToTarget) : null;

  const hoveredIndex = hoverIndex === null ? Math.max(0, systemSeries.length - 1) : hoverIndex;
  const hoveredPoint = systemSeries[hoveredIndex];
  const hoveredX = xScale(hoveredPoint.x);

  const tooltipRows = allSeries
    .map((series) => ({
      line: series.line,
      color: series.color,
      value: series.points.find((point) => point.x === hoveredPoint.x)?.y,
    }))
    .filter((row) => Number.isFinite(row.value));

  if (Number.isFinite(target)) {
    tooltipRows.unshift({ line: "Target", color: "#10b981", value: target, target: true });
  }

  return (
    <section className={`chart-card trend-reference-card ${cardClassName}`.trim()}>
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}

      <div className="trend-ref-kpis" aria-label="System OTP summary">
        <article>
          <h3>Current system OTP</h3>
          <strong className="trend-ref-kpi-system">{Number.isFinite(latestValue) ? `${Math.round(latestValue)}%` : "NA"}</strong>
        </article>
        <article>
          <h3>Target</h3>
          <strong className="trend-ref-kpi-target">{Number.isFinite(target) ? `${Math.round(target)}%` : "NA"}</strong>
        </article>
        <article>
          <h3>Gap to close</h3>
          <strong className="trend-ref-kpi-gap">{Number.isFinite(gapToClose) ? `${Math.round(gapToClose)} pts` : "NA"}</strong>
        </article>
        <article>
          <h3>12-month change</h3>
          <strong className="trend-ref-kpi-change">{Number.isFinite(change12m) ? `${formatSigned(change12m, 0, " pts")}` : "NA"}</strong>
        </article>
      </div>

      <div className="trend-ref-legend" aria-label="Legend">
        {allSeries.map((series) => (
          <span key={series.line} className="trend-ref-legend-item">
            <i style={{ background: series.color }} />
            {series.line}
          </span>
        ))}
        {Number.isFinite(target) ? (
          <span className="trend-ref-legend-item">
            <i className="target" />
            {`${Math.round(target)}% target`}
          </span>
        ) : null}
      </div>

      <div className="chart-frame trend-ref-frame">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {[0, 20, 40, 60, 80, 100].map((tick) => (
              <g key={tick} transform={`translate(0,${yScale(tick)})`}>
                <line x1={0} x2={innerWidth} className="axis-grid-line" />
                <text x={-16} y={4} textAnchor="end" className="axis-tick-label axis-tick-label-y">
                  {metricFormatter(tick)}
                </text>
              </g>
            ))}

            {xDomain.map((monthKey) => {
              const x = xScale(monthKey);
              const month = monthly.find((row) => row.__x === monthKey);
              return (
                <g key={monthKey} transform={`translate(${x},${innerHeight})`}>
                  <text y={20} className="axis-tick-label axis-tick-label-x" textAnchor="middle">
                    {month?.__label || monthKey}
                  </text>
                </g>
              );
            })}

            {Number.isFinite(target) ? (
              <line
                x1={0}
                x2={innerWidth}
                y1={yScale(target)}
                y2={yScale(target)}
                className="goal-line trend-ref-target-line"
              />
            ) : null}

            {allSeries.map((series) => {
              const path = lineGenerator(series.points);
              return (
                <g key={`line-${series.line}`}>
                  <path
                    d={path || ""}
                    className={`trend-ref-line ${series.system ? "system" : ""}`}
                    style={{ stroke: series.color }}
                  />
                  {series.system
                    ? series.points.map((point) => (
                        <circle
                          key={`${series.line}-${point.x}`}
                          cx={xScale(point.x)}
                          cy={yScale(point.y)}
                          r={3.2}
                          style={{ fill: series.color }}
                          className="trend-ref-system-point"
                        />
                      ))
                    : null}
                </g>
              );
            })}

            <g>
              {xDomain.map((monthKey, index) => {
                const x = xScale(monthKey);
                const next = xDomain[index + 1] ? xScale(xDomain[index + 1]) : innerWidth;
                const prev = xDomain[index - 1] ? xScale(xDomain[index - 1]) : 0;
                const left = index === 0 ? 0 : (prev + x) / 2;
                const right = index === xDomain.length - 1 ? innerWidth : (x + next) / 2;
                return (
                  <rect
                    key={`hitbox-${monthKey}`}
                    x={left}
                    y={0}
                    width={Math.max(1, right - left)}
                    height={innerHeight}
                    fill="transparent"
                    onMouseEnter={() => setHoverIndex(index)}
                    onFocus={() => setHoverIndex(index)}
                  />
                );
              })}
            </g>
          </g>
        </svg>

        {hoveredPoint ? (
          <aside
            className="trend-ref-tooltip"
            style={{
              left: `calc(${((hoveredX + margin.left) / width) * 100}% + 8px)`,
              top: "18%",
            }}
          >
            <h4>{hoveredPoint.label}</h4>
            <ul>
              {tooltipRows.map((row) => (
                <li key={row.line}>
                  <span className="swatch" style={{ background: row.color }} />
                  <span>{row.line}:</span>
                  <strong>{row.target ? `${Math.round(row.value)}%` : `${Math.round(row.value)}%`}</strong>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>

      <section className="trend-ref-callout">
        <h3>
          At current rate of improvement ({Number.isFinite(annualRate) ? `${formatSigned(annualRate, 0, " pts/year")}` : "NA"})
        </h3>
        <p>
          {Number.isFinite(yearsToTarget) && Number.isFinite(projectedYear)
            ? `MBTA would reach ${Math.round(target)}% target in ${Math.max(1, Math.round(yearsToTarget))} years (${projectedYear}).`
            : "Current pace is insufficient to project a target date."}{" "}
          {Number.isFinite(pointsNeeded) && pointsNeeded > 0
            ? `To reach ${Math.round(target)}% by end of ${latestDate ? latestDate.getFullYear() + 1 : "next year"}, the system needs to improve by ${Math.round(
                pointsNeeded
              )} points in 12 months.`
            : ""}
        </p>
      </section>
    </section>
  );
}

export default AreaTrendChart;
