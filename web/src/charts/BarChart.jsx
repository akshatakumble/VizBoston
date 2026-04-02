import { useMemo, useState } from "react";
import { max, scaleBand, scaleLinear } from "d3";
import Tooltip from "./components/Tooltip";
import { getLineColor } from "../design/transit";

function BarChart({
  title = "Bar Chart",
  subtitle = "",
  data = [],
  categoryKey = "category",
  valueKey = "value",
  groupKey = null,
  orientation = "vertical",
  metricFormatter = (value) => Number(value).toFixed(2),
  width = 760,
  height = 320,
}) {
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, rows: [] });
  const margin =
    orientation === "horizontal"
      ? { top: 20, right: 24, bottom: 40, left: 120 }
      : { top: 24, right: 24, bottom: 52, left: 56 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const normalized = useMemo(
    () =>
      data
        .map((row) => ({
          ...row,
          __category: String(row[categoryKey]),
          __value: Number(row[valueKey]),
          __group: groupKey ? String(row[groupKey]) : "Series",
        }))
        .filter((row) => Number.isFinite(row.__value)),
    [data, categoryKey, valueKey, groupKey]
  );

  if (normalized.length === 0) {
    return (
      <section className="chart-card">
        <h2>{title}</h2>
        <p>No bars available.</p>
      </section>
    );
  }

  const categories = Array.from(new Set(normalized.map((d) => d.__category)));
  const groups = Array.from(new Set(normalized.map((d) => d.__group)));
  const categoryScale =
    orientation === "horizontal"
      ? scaleBand().domain(categories).range([0, innerHeight]).padding(0.2)
      : scaleBand().domain(categories).range([0, innerWidth]).padding(0.2);
  const groupScale = scaleBand().domain(groups).range([0, categoryScale.bandwidth()]).padding(0.15);
  const valueMax = max(normalized, (d) => d.__value) ?? 1;
  const valueScale =
    orientation === "horizontal"
      ? scaleLinear().domain([0, valueMax]).range([0, innerWidth]).nice()
      : scaleLinear().domain([0, valueMax]).range([innerHeight, 0]).nice();

  const ticks = valueScale.ticks(5);

  return (
    <section className="chart-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}

      <div className="chart-frame">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {orientation === "horizontal"
              ? ticks.map((tick) => (
                  <g key={tick} transform={`translate(${valueScale(tick)},0)`}>
                    <line y1={0} y2={innerHeight} className="axis-grid-line" />
                    <text y={innerHeight + 20} className="axis-tick-label axis-tick-label-x" textAnchor="middle">
                      {metricFormatter(tick)}
                    </text>
                  </g>
                ))
              : ticks.map((tick) => (
                  <g key={tick} transform={`translate(0,${valueScale(tick)})`}>
                    <line x1={0} x2={innerWidth} className="axis-grid-line" />
                    <text x={-10} y={4} className="axis-tick-label axis-tick-label-y" textAnchor="end">
                      {metricFormatter(tick)}
                    </text>
                  </g>
                ))}

            {normalized.map((bar, idx) => {
              const groupOffset = groupScale(bar.__group);
              const fill = getLineColor(bar.__group);

              const x =
                orientation === "horizontal" ? 0 : (categoryScale(bar.__category) || 0) + (groupOffset || 0);
              const y =
                orientation === "horizontal"
                  ? (categoryScale(bar.__category) || 0) + (groupOffset || 0)
                  : valueScale(bar.__value);
              const w = orientation === "horizontal" ? valueScale(bar.__value) : groupScale.bandwidth();
              const h =
                orientation === "horizontal"
                  ? groupScale.bandwidth()
                  : innerHeight - valueScale(bar.__value);

              return (
                <rect
                  key={`${bar.__category}-${bar.__group}-${idx}`}
                  x={x}
                  y={y}
                  width={Math.max(0, w)}
                  height={Math.max(0, h)}
                  rx={4}
                  fill={fill}
                  onMouseEnter={(event) => {
                    const bounds = event.currentTarget.ownerSVGElement.getBoundingClientRect();
                    setTooltip({
                      visible: true,
                      x: event.clientX - bounds.left + 12,
                      y: event.clientY - bounds.top - 10,
                      rows: [
                        { label: categoryKey, value: bar.__category },
                        { label: groupKey || "Series", value: bar.__group },
                        { label: valueKey, value: metricFormatter(bar.__value) },
                      ],
                    });
                  }}
                  onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
                />
              );
            })}

            {categories.map((category) => {
              if (orientation === "horizontal") {
                return (
                  <text
                    key={category}
                    x={-10}
                    y={(categoryScale(category) || 0) + categoryScale.bandwidth() / 2}
                    className="axis-tick-label axis-tick-label-y"
                    textAnchor="end"
                    dominantBaseline="middle"
                  >
                    {category}
                  </text>
                );
              }

              return (
                <text
                  key={category}
                  x={(categoryScale(category) || 0) + categoryScale.bandwidth() / 2}
                  y={innerHeight + 20}
                  className="axis-tick-label axis-tick-label-x"
                  textAnchor="middle"
                >
                  {category}
                </text>
              );
            })}
          </g>
        </svg>

        <Tooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} title={title} rows={tooltip.rows} />
      </div>
    </section>
  );
}

export default BarChart;
