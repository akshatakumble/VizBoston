import { useMemo, useState } from "react";
import { interpolateViridis, scaleBand, scaleLinear, scaleSequential } from "d3";
import Tooltip from "./components/Tooltip";

const ROW_MODES = [
  { id: "worst20", label: "Worst 20" },
  { id: "best20", label: "Best 20" },
  { id: "all", label: "All (Scroll)" },
];

const METRIC_OPTIONS = [
  {
    id: "otp",
    label: "OTP %",
    shortLabel: "OTP",
    higherIsBetter: true,
    targetPct: 85,
    valueAccessor: (row) => row.otpPct,
  },
  {
    id: "lateRate",
    label: "Late Rate %",
    shortLabel: "Late Rate",
    higherIsBetter: false,
    targetPct: null,
    valueAccessor: (row) => row.lateRatePct,
  },
  {
    id: "notLateRate",
    label: "Not Late %",
    shortLabel: "Not Late",
    higherIsBetter: true,
    targetPct: null,
    valueAccessor: (row) => row.notLateRatePct,
  },
  {
    id: "earlyRate",
    label: "Early Rate %",
    shortLabel: "Early Rate",
    higherIsBetter: false,
    targetPct: null,
    valueAccessor: (row) => row.earlyRatePct,
  },
];

function toFinite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function truncateLabel(text, maxLength = 24) {
  const value = String(text || "");
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "NA";
}

function OtpStationHeatmap({
  title = "Reliability Heatmap (Station × Time Period)",
  subtitle = "",
  data = [],
  selectedCell = null,
  onCellClick,
  metricId = "otp",
  onMetricChange,
  rowMode = "worst20",
  onRowModeChange,
}) {
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, rows: [], title: "" });
  const activeMetric = METRIC_OPTIONS.find((metric) => metric.id === metricId) || METRIC_OPTIONS[0];

  const normalized = useMemo(
    () =>
      data.map((row) => ({
        station: String(row.station || ""),
        period: String(row.hour || row.timePeriod || ""),
        hourValue: toFinite(row.hourValue),
        totalEvents: Math.max(0, toFinite(row.totalEvents ?? row.total_events) ?? 0),
        onTimeEvents: Math.max(0, toFinite(row.onTimeEvents ?? row.on_time_events) ?? 0),
        earlyEvents: Math.max(0, toFinite(row.earlyEvents ?? row.early_events) ?? 0),
        lateEvents: Math.max(0, toFinite(row.lateEvents ?? row.late_events) ?? 0),
        otpPct: toFinite(row.value),
        stationSortOrder: toFinite(row.stationSortOrder) ?? Number.POSITIVE_INFINITY,
      })),
    [data]
  );

  const withRates = normalized.map((row) => {
    const total = row.totalEvents;
    const safeTotal = total > 0 ? total : null;
    const otpPct =
      row.otpPct !== null
        ? row.otpPct
        : safeTotal !== null
          ? (row.onTimeEvents / safeTotal) * 100
          : null;
    const lateRatePct = safeTotal !== null ? (row.lateEvents / safeTotal) * 100 : null;
    const earlyRatePct = safeTotal !== null ? (row.earlyEvents / safeTotal) * 100 : null;
    const notLateRatePct = safeTotal !== null ? ((safeTotal - row.lateEvents) / safeTotal) * 100 : null;
    return {
      ...row,
      otpPct,
      lateRatePct,
      earlyRatePct,
      notLateRatePct,
      metricValue: activeMetric.valueAccessor({
        ...row,
        otpPct,
        lateRatePct,
        earlyRatePct,
        notLateRatePct,
      }),
    };
  });

  const nonEmpty = withRates.filter((row) => row.station && row.period);
  const valueRows = nonEmpty.filter((row) => row.metricValue !== null);

  if (valueRows.length === 0) {
    return (
      <section className="chart-card">
        <h2>{title}</h2>
        <p>No heatmap values available for {activeMetric.label}.</p>
      </section>
    );
  }

  const periodOrder = Array.from(new Set(nonEmpty.map((row) => row.period))).sort((left, right) => {
    const leftHour = toFinite(nonEmpty.find((row) => row.period === left)?.hourValue);
    const rightHour = toFinite(nonEmpty.find((row) => row.period === right)?.hourValue);
    if (leftHour !== null && rightHour !== null && leftHour !== rightHour) {
      return leftHour - rightHour;
    }
    return left.localeCompare(right);
  });

  const stationMap = new Map();
  for (const row of nonEmpty) {
    const existing = stationMap.get(row.station) || {
      station: row.station,
      stationSortOrder: row.stationSortOrder,
      valuesByPeriod: new Map(),
      weightedTotal: 0,
      weight: 0,
    };
    if (row.stationSortOrder < existing.stationSortOrder) {
      existing.stationSortOrder = row.stationSortOrder;
    }
    existing.valuesByPeriod.set(row.period, row);
    if (row.metricValue !== null) {
      const weight = Math.max(1, row.totalEvents);
      existing.weightedTotal += row.metricValue * weight;
      existing.weight += weight;
    }
    stationMap.set(row.station, existing);
  }

  const stationRows = Array.from(stationMap.values()).map((row) => ({
    ...row,
    avgMetric: row.weight > 0 ? row.weightedTotal / row.weight : null,
  }));

  const structuredRows = stationRows
    .slice()
    .sort((left, right) => left.stationSortOrder - right.stationSortOrder || left.station.localeCompare(right.station));

  const qualitySorted = stationRows
    .filter((row) => row.avgMetric !== null)
    .sort((left, right) => {
      if (activeMetric.higherIsBetter) {
        if (right.avgMetric !== left.avgMetric) {
          return right.avgMetric - left.avgMetric;
        }
      } else if (left.avgMetric !== right.avgMetric) {
        return left.avgMetric - right.avgMetric;
      }
      return right.weight - left.weight;
    });

  const bestRows = qualitySorted.slice(0, 20);
  const worstRows = qualitySorted.slice(-20).reverse();

  const activeRows = (() => {
    if (rowMode === "best20") {
      return bestRows;
    }
    if (rowMode === "all") {
      return structuredRows;
    }
    return worstRows;
  })();

  const rowHeight = activeRows.length > 40 ? 12 : activeRows.length > 24 ? 15 : 18;
  const heatWidth = Math.max(430, periodOrder.length * 88);
  const heatHeight = Math.max(120, activeRows.length * rowHeight);
  const margin = { top: 44, right: 82, bottom: 92, left: 210 };
  const summaryBandHeight = 18;
  const svgWidth = margin.left + heatWidth + margin.right;
  const svgHeight = margin.top + heatHeight + margin.bottom;

  const xScale = scaleBand().domain(periodOrder).range([0, heatWidth]).padding(0.08);
  const yScale = scaleBand().domain(activeRows.map((row) => row.station)).range([0, heatHeight]).padding(0.08);
  const colorScale = scaleSequential(interpolateViridis).domain([0, 100]);
  const summaryScale = scaleLinear().domain([0, 100]).range([0, 52]);

  const periodAverages = periodOrder.map((period) => {
    let weightedTotal = 0;
    let weight = 0;
    for (const row of activeRows) {
      const cell = row.valuesByPeriod.get(period);
      if (!cell || cell.metricValue === null) {
        continue;
      }
      const cellWeight = Math.max(1, cell.totalEvents);
      weightedTotal += cell.metricValue * cellWeight;
      weight += cellWeight;
    }
    return {
      period,
      value: weight > 0 ? weightedTotal / weight : null,
    };
  });

  const selectedRow = String(selectedCell?.row || "");
  const selectedColumn = String(selectedCell?.column || "");

  return (
    <section className="chart-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}

      <div className="otp-heatmap-controls">
        <div className="otp-heatmap-control-group">
          <span className="otp-heatmap-controls-label">Metric</span>
          <div className="toggle-pill-group" role="tablist" aria-label="Reliability heatmap metric">
            {METRIC_OPTIONS.map((metric) => (
              <button
                key={metric.id}
                type="button"
                className={metricId === metric.id ? "active" : ""}
                onClick={() => onMetricChange?.(metric.id)}
              >
                {metric.shortLabel}
              </button>
            ))}
          </div>
        </div>
        <div className="otp-heatmap-control-group">
          <span className="otp-heatmap-controls-label">Rows</span>
          <div className="toggle-pill-group" role="tablist" aria-label="Reliability heatmap station subset">
            {ROW_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={rowMode === mode.id ? "active" : ""}
                onClick={() => onRowModeChange?.(mode.id)}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
        <span className="otp-heatmap-direction">
          {activeMetric.label} · {activeMetric.higherIsBetter ? "Higher is better" : "Lower is better"}
        </span>
      </div>

      <div className="otp-heatmap-scroll">
        <svg width={svgWidth} height={svgHeight} role="img" aria-label={title}>
          <defs>
            <pattern id="otp-missing-pattern" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--surface-muted)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="color-mix(in srgb, var(--line) 88%, transparent)" strokeWidth="1" />
            </pattern>
            <linearGradient id="otp-legend-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={interpolateViridis(0)} />
              <stop offset="25%" stopColor={interpolateViridis(0.25)} />
              <stop offset="50%" stopColor={interpolateViridis(0.5)} />
              <stop offset="75%" stopColor={interpolateViridis(0.75)} />
              <stop offset="100%" stopColor={interpolateViridis(1)} />
            </linearGradient>
          </defs>

          <g transform={`translate(${margin.left},${margin.top})`}>
            {activeRows.flatMap((row) =>
              periodOrder.map((period) => {
                const cell = row.valuesByPeriod.get(period) || null;
                const x = xScale(period) || 0;
                const y = yScale(row.station) || 0;
                const value = cell?.metricValue ?? null;
                const events = cell?.totalEvents ?? 0;
                const isSelected = selectedRow === row.station && selectedColumn === period;
                return (
                  <rect
                    key={`${row.station}||${period}`}
                    x={x}
                    y={y}
                    width={xScale.bandwidth()}
                    height={yScale.bandwidth()}
                    rx={2}
                    fill={value === null ? "url(#otp-missing-pattern)" : colorScale(value)}
                    stroke={isSelected ? "var(--accent-strong)" : "transparent"}
                    strokeWidth={isSelected ? 2 : 0}
                    className={value !== null && onCellClick ? "heatmap-clickable-cell" : undefined}
                    onClick={() => {
                      if (value === null) {
                        return;
                      }
                      onCellClick?.({ row: row.station, column: period, value });
                    }}
                    onMouseEnter={(event) => {
                      const bounds = event.currentTarget.ownerSVGElement.getBoundingClientRect();
                      setTooltip({
                        visible: true,
                        x: event.clientX - bounds.left + 12,
                        y: event.clientY - bounds.top - 10,
                        title: "Reliability Cell",
                        rows: [
                          { label: "Station", value: row.station },
                          { label: "Time Period", value: period },
                          { label: activeMetric.label, value: formatPercent(value) },
                          { label: "OTP %", value: formatPercent(cell?.otpPct) },
                          { label: "Late Rate %", value: formatPercent(cell?.lateRatePct) },
                          { label: "Early Rate %", value: formatPercent(cell?.earlyRatePct) },
                          { label: "Events", value: String(events) },
                        ],
                      });
                    }}
                    onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
                  />
                );
              })
            )}

            {activeRows.map((row) => (
              <text
                key={`label-${row.station}`}
                x={-10}
                y={(yScale(row.station) || 0) + yScale.bandwidth() / 2}
                className="axis-tick-label axis-tick-label-y"
                textAnchor="end"
                dominantBaseline="middle"
              >
                {truncateLabel(row.station)}
              </text>
            ))}

            {periodOrder.map((period) => (
              <text
                key={`column-${period}`}
                x={(xScale(period) || 0) + xScale.bandwidth() / 2}
                y={heatHeight + 16}
                className="axis-tick-label axis-tick-label-x"
                textAnchor="middle"
              >
                {period}
              </text>
            ))}

            <text x={heatWidth + 8} y={-8} className="axis-tick-label">
              Station Avg
            </text>
            {activeRows.map((row) => {
              const avg = row.avgMetric;
              const y = (yScale(row.station) || 0) + yScale.bandwidth() / 2;
              const barWidth = avg === null ? 0 : summaryScale(avg);
              return (
                <g key={`row-summary-${row.station}`}>
                  <line x1={heatWidth + 6} x2={heatWidth + 58} y1={y} y2={y} className="metric-cell-track" />
                  {Number.isFinite(activeMetric.targetPct) ? (
                    <line
                      x1={heatWidth + 6 + summaryScale(activeMetric.targetPct)}
                      x2={heatWidth + 6 + summaryScale(activeMetric.targetPct)}
                      y1={y - 4}
                      y2={y + 4}
                      className="otp-target-tick"
                    />
                  ) : null}
                  <line
                    x1={heatWidth + 6}
                    x2={heatWidth + 6 + barWidth}
                    y1={y}
                    y2={y}
                    className="otp-summary-line"
                  />
                  <text x={heatWidth + 62} y={y + 3} className="axis-tick-label">
                    {formatPercent(avg)}
                  </text>
                </g>
              );
            })}

            <text x={-10} y={heatHeight + 38} className="axis-tick-label axis-tick-label-y" textAnchor="end">
              Period Avg
            </text>
            {periodAverages.map((period) => {
              const x = xScale(period.period) || 0;
              return (
                <g key={`period-summary-${period.period}`}>
                  <rect
                    x={x}
                    y={heatHeight + 24}
                    width={xScale.bandwidth()}
                    height={summaryBandHeight}
                    rx={2}
                    fill={period.value === null ? "url(#otp-missing-pattern)" : colorScale(period.value)}
                    className="calendar-cell"
                  />
                  <text
                    x={x + xScale.bandwidth() / 2}
                    y={heatHeight + 56}
                    className="axis-tick-label"
                    textAnchor="middle"
                  >
                    {formatPercent(period.value)}
                  </text>
                </g>
              );
            })}

            <g transform={`translate(0,${heatHeight + 72})`}>
              <rect x={0} y={0} width={120} height={8} rx={3} fill="url(#otp-legend-gradient)" className="calendar-cell" />
              {Number.isFinite(activeMetric.targetPct) ? (
                <line
                  x1={(activeMetric.targetPct / 100) * 120}
                  x2={(activeMetric.targetPct / 100) * 120}
                  y1={-2}
                  y2={10}
                  className="otp-target-tick"
                />
              ) : null}
              <text x={0} y={22} className="axis-tick-label">
                0%
              </text>
              <text x={60} y={22} className="axis-tick-label" textAnchor="middle">
                50%
              </text>
              <text x={120} y={22} className="axis-tick-label" textAnchor="end">
                100%
              </text>
              {Number.isFinite(activeMetric.targetPct) ? (
                <text x={(activeMetric.targetPct / 100) * 120 + 4} y={-4} className="axis-tick-label">
                  Target {activeMetric.targetPct}%
                </text>
              ) : null}
              <text x={172} y={8} className="axis-tick-label">
                {activeMetric.label} · NA shown with hatch
              </text>
            </g>
          </g>
        </svg>
      </div>

      <p className="card-footnote">
        Fixed 0-100% scale for comparability. Subset ranking uses {activeMetric.label}; All mode preserves station order.
      </p>

      <Tooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} title={tooltip.title} rows={tooltip.rows} />
    </section>
  );
}

export default OtpStationHeatmap;
