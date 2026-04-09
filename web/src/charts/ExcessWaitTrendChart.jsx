import { extent, line as d3Line, scaleLinear, scaleTime } from "d3";
import { useMemo, useState } from "react";
import Tooltip from "./components/Tooltip";

function parseMonth(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatMonth(value) {
  if (!(value instanceof Date)) {
    return String(value || "");
  }
  return value.toLocaleDateString(undefined, { month: "short" });
}

function formatMinutes(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "NA";
  }
  const rounded = Math.round(numeric * 60);
  const secondsPart = `${rounded} sec`;
  return `${numeric.toFixed(2)} min (${secondsPart})`;
}

function formatTick(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "NA";
  }
  return `${numeric.toFixed(1)} min`;
}

const COLORBLIND_LINE_COLORS = {
  Red: "#D55E00",
  Orange: "#E69F00",
  Blue: "#0072B2",
  Green: "#009E73",
  Silver: "#7F7F7F",
};

function lineColor(line) {
  return COLORBLIND_LINE_COLORS[line] || "#4C78A8";
}

function buildDirectLabelLayout(labelCandidates, innerHeight) {
  const minimumGap = 14;
  const bottomLimit = innerHeight - 4;
  const topLimit = 4;
  const sorted = labelCandidates.slice().sort((left, right) => left.y - right.y);
  const positioned = [];

  sorted.forEach((candidate) => {
    const previousY = positioned.length > 0 ? positioned[positioned.length - 1].y : Number.NEGATIVE_INFINITY;
    const y = Math.max(candidate.y, previousY + minimumGap);
    positioned.push({ ...candidate, y });
  });

  if (positioned.length > 0 && positioned[positioned.length - 1].y > bottomLimit) {
    positioned[positioned.length - 1].y = bottomLimit;
    for (let index = positioned.length - 2; index >= 0; index -= 1) {
      positioned[index].y = Math.min(
        positioned[index].y,
        positioned[index + 1].y - minimumGap
      );
    }
  }

  positioned.forEach((row) => {
    row.y = Math.max(topLimit, Math.min(bottomLimit, row.y));
  });
  return positioned;
}

function ExcessWaitTrendChart({
  title = "Excess Wait Time Trend",
  subtitle = "Average additional wait beyond scheduled headway (lower is better).",
  data = [],
  events = [],
}) {
  const [hoveredLine, setHoveredLine] = useState("");
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, rows: [], title: "" });

  const normalized = useMemo(
    () =>
      data
        .map((row) => ({
          line: String(row.line || ""),
          month: parseMonth(row.month),
          value: Number(row.value),
        }))
        .filter((row) => row.line && row.month && Number.isFinite(row.value))
        .sort((left, right) => left.month - right.month || left.line.localeCompare(right.line)),
    [data]
  );

  if (normalized.length === 0) {
    return (
      <section className="chart-card excess-wait-card">
        <h2>{title}</h2>
        <p>No excess wait trend data available.</p>
      </section>
    );
  }

  const byLine = new Map();
  for (const row of normalized) {
    const bucket = byLine.get(row.line) || [];
    bucket.push(row);
    byLine.set(row.line, bucket);
  }

  const lines = Array.from(byLine.keys()).sort((left, right) => left.localeCompare(right));
  const series = lines.map((line) => ({ line, values: byLine.get(line) || [] }));
  const allValues = normalized.map((row) => row.value);
  const [xMin, xMax] = extent(normalized, (row) => row.month);
  const yMin = Math.min(0, ...allValues);
  const yMax = Math.max(0, ...allValues);

  const allMonths = Array.from(new Set(normalized.map((row) => row.month.getTime())))
    .sort((left, right) => left - right)
    .map((value) => new Date(value));
  const width = 860;
  const height = 380;
  const margin = { top: 26, right: 126, bottom: 46, left: 72 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const labelX = innerWidth + 12;

  const xScale = scaleTime().domain([xMin, xMax]).range([0, innerWidth - 24]);
  const yScale = scaleLinear().domain([yMin, yMax]).nice().range([innerHeight, 0]);
  const yTicks = yScale.ticks(5);
  const xTicks = allMonths;
  const makeLine = d3Line()
    .x((point) => xScale(point.month))
    .y((point) => yScale(point.value));

  const labelCandidates = series
    .map((group) => {
      const last = group.values[group.values.length - 1];
      if (!last) {
        return null;
      }
      return {
        line: group.line,
        y: yScale(last.value),
        value: last.value,
      };
    })
    .filter(Boolean);
  const directLabels = buildDirectLabelLayout(labelCandidates, innerHeight);
  const labelLookup = new Map(directLabels.map((label) => [label.line, label]));

  const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const monthlySystem = allMonths
    .map((month) => {
      const key = monthKey(month);
      const values = normalized
        .filter((row) => monthKey(row.month) === key)
        .map((row) => row.value)
        .filter((value) => Number.isFinite(value));
      if (values.length === 0) {
        return null;
      }
      const average = values.reduce((sum, value) => sum + value, 0) / values.length;
      return { month, value: average };
    })
    .filter(Boolean);
  const systemTrendLine = d3Line()
    .x((row) => xScale(row.month))
    .y((row) => yScale(row.value))(monthlySystem);
  const systemStart = monthlySystem[0];
  const systemEnd = monthlySystem[monthlySystem.length - 1];
  const systemImprovementPct =
    systemStart && systemEnd && systemStart.value > 0
      ? ((systemStart.value - systemEnd.value) / systemStart.value) * 100
      : null;

  const resolvedEvents = events
    .map((event) => ({
      month: parseMonth(event.month),
      label: String(event.label || "").trim(),
      description: String(event.description || "").trim(),
    }))
    .filter((event) => event.month && event.label)
    .filter((event) => event.month >= xMin && event.month <= xMax);

  return (
    <section className="chart-card excess-wait-card excess-wait-tufte-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
      <p className="excess-wait-definition">
        Metric: <strong>Excess Wait Time (minutes)</strong>, where 0.5 min equals 30 seconds.
      </p>

      <div className="excess-wait-legend minimal" aria-label="Line legend fallback">
        {lines.map((line) => (
          <span key={line}>
            <i style={{ backgroundColor: lineColor(line) }} aria-hidden="true" />
            {line}
          </span>
        ))}
      </div>

      {systemImprovementPct !== null ? (
        <div className="excess-wait-trend-callout" role="status" aria-live="polite">
          <strong>System trend improving:</strong>{" "}
          Excess wait decreased about {Math.max(0, systemImprovementPct).toFixed(0)}% from{" "}
          {formatMonth(systemStart.month)} to {formatMonth(systemEnd.month)}.
        </div>
      ) : null}

      <div className="chart-frame excess-wait-frame">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {yTicks.map((tick) => (
              <g key={`ytick-${tick}`} transform={`translate(0,${yScale(tick)})`}>
                <line x1={0} x2={innerWidth} className="axis-grid-line excess-wait-grid-line" />
                <text x={-10} y={4} className="axis-tick-label" textAnchor="end">
                  {formatTick(tick)}
                </text>
              </g>
            ))}

            {xTicks.map((tick) => (
              <g key={`xtick-${tick.toISOString()}`} transform={`translate(${xScale(tick)},${innerHeight})`}>
                <line y1={0} y2={5} className="axis-tick-mark" />
                <text y={18} className="axis-tick-label" textAnchor="middle">
                  {formatMonth(tick)}
                </text>
              </g>
            ))}

            <line x1={0} x2={innerWidth} y1={yScale(0)} y2={yScale(0)} className="excess-wait-zero-line" />
            <line x1={0} x2={innerWidth} y1={innerHeight} y2={innerHeight} className="axis-line" />
            <line x1={0} x2={0} y1={0} y2={innerHeight} className="axis-line" />
            <text x={-54} y={innerHeight / 2} className="axis-tick-label excess-wait-axis-label" transform={`rotate(-90 -54 ${innerHeight / 2})`}>
              Excess Wait Time (minutes)
            </text>

            {resolvedEvents.map((event) => {
              const x = xScale(event.month);
              return (
                <g key={`${event.month.toISOString()}-${event.label}`}>
                  <line x1={x} x2={x} y1={0} y2={innerHeight} className="excess-wait-event-line" />
                  <circle
                    cx={x}
                    cy={8}
                    r={3.5}
                    className="excess-wait-event-dot"
                    onMouseEnter={(chartEvent) => {
                      const bounds = chartEvent.currentTarget.ownerSVGElement.getBoundingClientRect();
                      setTooltip({
                        visible: true,
                        x: chartEvent.clientX - bounds.left + 10,
                        y: chartEvent.clientY - bounds.top + 8,
                        title: event.label,
                        rows: [
                          { label: "Month", value: formatMonth(event.month) },
                          { label: "Context", value: event.description || "Operational milestone" },
                        ],
                      });
                    }}
                    onMouseLeave={() => setTooltip((previous) => ({ ...previous, visible: false }))}
                  />
                </g>
              );
            })}

            {systemTrendLine ? <path d={systemTrendLine} className="excess-wait-system-trend-line" /> : null}

            {series.map((group) => {
              const isDimmed = hoveredLine && hoveredLine !== group.line;
              const alpha = isDimmed ? 0.22 : 0.95;
              return (
                <g key={group.line}>
                  <path
                    d={makeLine(group.values)}
                    fill="none"
                    stroke={lineColor(group.line)}
                    strokeWidth={hoveredLine === group.line ? 3.2 : 2.4}
                    opacity={alpha}
                    onMouseEnter={() => setHoveredLine(group.line)}
                    onMouseLeave={() => setHoveredLine("")}
                  />
                  {group.values.map((point, pointIndex) => {
                    const cx = xScale(point.month);
                    const cy = yScale(point.value);
                    return (
                      <circle
                        key={`${group.line}-${pointIndex}`}
                        cx={cx}
                        cy={cy}
                        r={hoveredLine === group.line ? 3.6 : 3}
                        fill={lineColor(group.line)}
                        stroke="var(--surface)"
                        strokeWidth="1.2"
                        opacity={alpha}
                        onMouseEnter={(event) => {
                          const bounds = event.currentTarget.ownerSVGElement.getBoundingClientRect();
                          setHoveredLine(group.line);
                          setTooltip({
                            visible: true,
                            x: event.clientX - bounds.left + 10,
                            y: event.clientY - bounds.top - 12,
                            title: group.line,
                            rows: [
                              { label: "Month", value: point.month.toLocaleDateString(undefined, { month: "short", year: "numeric" }) },
                              { label: "Excess wait", value: formatMinutes(point.value) },
                            ],
                          });
                        }}
                        onMouseLeave={() => {
                          setHoveredLine("");
                          setTooltip((prev) => ({ ...prev, visible: false }));
                        }}
                      />
                    );
                  })}
                </g>
              );
            })}

            {directLabels.map((label) => {
              const xEnd = xScale(xMax);
              const yEnd = yScale(label.value);
              return (
                <g key={`label-${label.line}`}>
                  <line
                    x1={xEnd + 4}
                    x2={labelX - 4}
                    y1={yEnd}
                    y2={label.y}
                    className="excess-wait-label-leader"
                    stroke={lineColor(label.line)}
                  />
                  <text x={labelX} y={label.y + 3} className="excess-wait-direct-label" fill={lineColor(label.line)}>
                    {label.line}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        <Tooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} title={tooltip.title} rows={tooltip.rows} />
      </div>

      <p className="card-footnote">
        Negative values indicate observed headways were better than scheduled (shorter-than-scheduled waits).
      </p>
    </section>
  );
}

export default ExcessWaitTrendChart;
