import { useMemo, useState } from "react";
import { extent, line as d3Line, max, min, scaleLinear, scalePoint, scaleTime } from "d3";
import Tooltip from "./components/Tooltip";
import { getLineColor } from "../design/transit";

function toDateValue(value) {
  if (value instanceof Date) {
    return value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function defaultFormatX(value) {
  if (!(value instanceof Date)) {
    return String(value);
  }
  return value.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function defaultFormatY(value) {
  return Number(value).toFixed(1);
}

function LineChart({
  title = "Line Chart",
  subtitle = "",
  data = [],
  xKey = "x",
  yKey = "y",
  seriesKey = "series",
  xLabel = "",
  yLabel = "",
  xTickFormatter = defaultFormatX,
  yTickFormatter = defaultFormatY,
  metricFormatter = (value) => String(value),
  width = 760,
  height = 320,
}) {
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, rows: [], title: "" });
  const margin = { top: 24, right: 24, bottom: 42, left: 52 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const normalized = useMemo(
    () =>
      data
        .map((row) => {
          const dateCandidate = toDateValue(row[xKey]);
          return {
            ...row,
            __x: dateCandidate || row[xKey],
            __xDate: dateCandidate,
            __y: Number(row[yKey]),
            __series: row[seriesKey] || "Series",
          };
        })
        .filter((row) => Number.isFinite(row.__y) && row.__x !== undefined && row.__x !== null),
    [data, xKey, yKey, seriesKey]
  );

  const hasDates = normalized.some((d) => d.__xDate instanceof Date);
  const seriesValues = Array.from(new Set(normalized.map((d) => d.__series)));
  const grouped = seriesValues.map((series) => ({
    key: series,
    values: normalized.filter((d) => d.__series === series),
  }));

  const xScale = useMemo(() => {
    if (normalized.length === 0) {
      return null;
    }

    if (hasDates) {
      const [xMin, xMax] = extent(normalized, (d) => d.__xDate);
      return scaleTime().domain([xMin, xMax]).range([0, innerWidth]).nice();
    }

    const categories = Array.from(new Set(normalized.map((d) => String(d.__x))));
    return scalePoint().domain(categories).range([0, innerWidth]).padding(0.4);
  }, [normalized, hasDates, innerWidth]);

  const yScale = useMemo(() => {
    if (normalized.length === 0) {
      return null;
    }
    const yMin = min(normalized, (d) => d.__y) ?? 0;
    const yMax = max(normalized, (d) => d.__y) ?? 1;
    const floor = yMin > 0 ? 0 : yMin;
    return scaleLinear().domain([floor, yMax]).nice().range([innerHeight, 0]);
  }, [normalized, innerHeight]);

  if (!xScale || !yScale) {
    return (
      <section className="chart-card">
        <h2>{title}</h2>
        <p>No data available.</p>
      </section>
    );
  }

  const yTicks = yScale.ticks(5);
  const xTicks = hasDates ? xScale.ticks(6) : xScale.domain();
  const makeLine = d3Line()
    .x((d) => (hasDates ? xScale(d.__xDate) : xScale(String(d.__x))))
    .y((d) => yScale(d.__y));

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
                  {yTickFormatter(tick)}
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

            <line x1={0} x2={innerWidth} y1={innerHeight} y2={innerHeight} className="axis-line" />
            <line x1={0} x2={0} y1={0} y2={innerHeight} className="axis-line" />

            {grouped.map((group) => (
              <g key={group.key}>
                <path d={makeLine(group.values)} fill="none" stroke={getLineColor(group.key)} strokeWidth={2.5} />
                {group.values.map((point, idx) => {
                  const cx = hasDates ? xScale(point.__xDate) : xScale(String(point.__x));
                  const cy = yScale(point.__y);
                  return (
                    <circle
                      key={`${group.key}-${idx}`}
                      cx={cx}
                      cy={cy}
                      r={4}
                      fill={getLineColor(group.key)}
                      stroke="var(--surface)"
                      strokeWidth={1.2}
                      onMouseEnter={(event) => {
                        const bounds = event.currentTarget.ownerSVGElement.getBoundingClientRect();
                        setTooltip({
                          visible: true,
                          x: event.clientX - bounds.left + 12,
                          y: event.clientY - bounds.top - 10,
                          title: group.key,
                          rows: [
                            { label: xLabel || "Time", value: xTickFormatter(hasDates ? point.__xDate : point.__x) },
                            { label: yLabel || "Value", value: metricFormatter(point.__y) },
                          ],
                        });
                      }}
                      onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
                    />
                  );
                })}
              </g>
            ))}
          </g>
        </svg>

        <Tooltip
          visible={tooltip.visible}
          x={tooltip.x}
          y={tooltip.y}
          title={tooltip.title}
          rows={tooltip.rows}
        />
      </div>
    </section>
  );
}

export default LineChart;
