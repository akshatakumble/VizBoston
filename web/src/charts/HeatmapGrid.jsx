import { useMemo, useState } from "react";
import { interpolateYlOrRd, max, min, scaleBand, scaleSequential } from "d3";
import Tooltip from "./components/Tooltip";

function HeatmapGrid({
  title = "Heatmap",
  subtitle = "",
  data = [],
  rowKey = "row",
  columnKey = "column",
  valueKey = "value",
  valueFormatter = (value) => Number(value).toFixed(2),
  width = 760,
  height = 340,
}) {
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, rows: [] });
  const margin = { top: 26, right: 20, bottom: 56, left: 120 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const normalized = useMemo(
    () =>
      data
        .map((row) => ({
          ...row,
          __row: String(row[rowKey]),
          __column: String(row[columnKey]),
          __value: Number(row[valueKey]),
        }))
        .filter((row) => Number.isFinite(row.__value)),
    [data, rowKey, columnKey, valueKey]
  );

  const rows = useMemo(() => Array.from(new Set(normalized.map((d) => d.__row))), [normalized]);
  const columns = useMemo(() => Array.from(new Set(normalized.map((d) => d.__column))), [normalized]);

  const xScale = scaleBand().domain(columns).range([0, innerWidth]).padding(0.08);
  const yScale = scaleBand().domain(rows).range([0, innerHeight]).padding(0.08);
  const minValue = min(normalized, (d) => d.__value) ?? 0;
  const maxValue = max(normalized, (d) => d.__value) ?? 1;
  const colorScale = scaleSequential(interpolateYlOrRd).domain([minValue, maxValue || minValue + 1]);

  if (normalized.length === 0) {
    return (
      <section className="chart-card">
        <h2>{title}</h2>
        <p>No heatmap values available.</p>
      </section>
    );
  }

  return (
    <section className="chart-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}

      <div className="chart-frame">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {normalized.map((cell, idx) => {
              const x = xScale(cell.__column);
              const y = yScale(cell.__row);
              return (
                <rect
                  key={`${cell.__row}-${cell.__column}-${idx}`}
                  x={x}
                  y={y}
                  width={xScale.bandwidth()}
                  height={yScale.bandwidth()}
                  rx={6}
                  fill={colorScale(cell.__value)}
                  onMouseEnter={(event) => {
                    const bounds = event.currentTarget.ownerSVGElement.getBoundingClientRect();
                    setTooltip({
                      visible: true,
                      x: event.clientX - bounds.left + 14,
                      y: event.clientY - bounds.top - 8,
                      rows: [
                        { label: rowKey, value: cell.__row },
                        { label: columnKey, value: cell.__column },
                        { label: valueKey, value: valueFormatter(cell.__value) },
                      ],
                    });
                  }}
                  onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
                />
              );
            })}

            {rows.map((row) => (
              <text
                key={row}
                x={-10}
                y={(yScale(row) || 0) + yScale.bandwidth() / 2}
                className="axis-tick-label axis-tick-label-y"
                textAnchor="end"
                dominantBaseline="middle"
              >
                {row}
              </text>
            ))}

            {columns.map((column) => (
              <text
                key={column}
                x={(xScale(column) || 0) + xScale.bandwidth() / 2}
                y={innerHeight + 18}
                className="axis-tick-label axis-tick-label-x"
                textAnchor="middle"
              >
                {column}
              </text>
            ))}
          </g>
        </svg>

        <Tooltip
          visible={tooltip.visible}
          x={tooltip.x}
          y={tooltip.y}
          title={title}
          rows={tooltip.rows}
        />
      </div>
    </section>
  );
}

export default HeatmapGrid;
