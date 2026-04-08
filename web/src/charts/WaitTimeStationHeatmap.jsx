import { useMemo, useState } from "react";
import { interpolateRdYlGn, quantile, scaleBand, scaleLinear, scaleSequential } from "d3";
import Tooltip from "./components/Tooltip";

const ROW_MODES = [
  { id: "worst20", label: "Worst 20" },
  { id: "best20", label: "Best 20" },
  { id: "all", label: "All (Scroll)" },
];

const METRIC_OPTIONS = [
  {
    id: "headwayMin",
    label: "Avg Headway (min)",
    shortLabel: "Headway",
    higherIsBetter: false,
    valueAccessor: (row) => row.headwayMin,
    formatter: (value) => `${value.toFixed(1)} min`,
    legendTicks: ["min", "mid", "max"],
  },
  {
    id: "p90HeadwayMin",
    label: "P90 Headway (min)",
    shortLabel: "P90",
    higherIsBetter: false,
    valueAccessor: (row) => row.p90HeadwayMin,
    formatter: (value) => `${value.toFixed(1)} min`,
    legendTicks: ["min", "mid", "max"],
  },
  {
    id: "headwayCvPct",
    label: "Headway CV %",
    shortLabel: "CV%",
    higherIsBetter: false,
    valueAccessor: (row) => row.headwayCvPct,
    formatter: (value) => `${value.toFixed(1)}%`,
    fixedDomain: [0, 100],
    legendTicks: ["0%", "50%", "100%"],
  },
  {
    id: "bunchingRatePct",
    label: "Bunching Rate %",
    shortLabel: "Bunching",
    higherIsBetter: false,
    valueAccessor: (row) => row.bunchingRatePct,
    formatter: (value) => `${value.toFixed(1)}%`,
    fixedDomain: [0, 100],
    legendTicks: ["0%", "50%", "100%"],
  },
];

function toFinite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function truncateLabel(text, maxLength = 26) {
  const value = String(text || "");
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function formatValue(value, metric) {
  if (value === null || !Number.isFinite(value)) {
    return "NA";
  }
  return metric.formatter(value);
}

function WaitTimeStationHeatmap({
  title = "Headway Heatmap (Station × Time Period)",
  subtitle = "",
  data = [],
  metricId = "headwayMin",
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
        line: String(row.line || ""),
        stationSortOrder: toFinite(row.stationSortOrder) ?? Number.POSITIVE_INFINITY,
        sampleCount: Math.max(0, toFinite(row.sampleCount) ?? 0),
        headwayMin: toFinite(row.headwayMin ?? row.value),
        p90HeadwayMin: toFinite(row.p90HeadwayMin),
        headwayCvPct: toFinite(row.headwayCvPct),
        bunchingRatePct: toFinite(row.bunchingRatePct),
      })),
    [data]
  );

  const rowsWithMetric = normalized
    .map((row) => ({
      ...row,
      metricValue: activeMetric.valueAccessor(row),
    }))
    .filter((row) => row.station && row.period);

  const metricRows = rowsWithMetric.filter((row) => row.metricValue !== null);
  if (metricRows.length === 0) {
    return (
      <section className="chart-card wait-heatmap-card">
        <h2>{title}</h2>
        <p>No heatmap values available for {activeMetric.label}.</p>
      </section>
    );
  }

  const periodOrder = Array.from(new Set(rowsWithMetric.map((row) => row.period))).sort((left, right) => {
    const leftHour = toFinite(rowsWithMetric.find((row) => row.period === left)?.hourValue);
    const rightHour = toFinite(rowsWithMetric.find((row) => row.period === right)?.hourValue);
    if (leftHour !== null && rightHour !== null && leftHour !== rightHour) {
      return leftHour - rightHour;
    }
    return left.localeCompare(right);
  });

  const stationMap = new Map();
  for (const row of rowsWithMetric) {
    const existing = stationMap.get(row.station) || {
      station: row.station,
      line: row.line,
      stationSortOrder: row.stationSortOrder,
      valuesByPeriod: new Map(),
      weightedTotal: 0,
      weight: 0,
    };
    existing.valuesByPeriod.set(row.period, row);
    if (row.metricValue !== null) {
      const weight = Math.max(1, row.sampleCount);
      existing.weightedTotal += row.metricValue * weight;
      existing.weight += weight;
    }
    if (row.stationSortOrder < existing.stationSortOrder) {
      existing.stationSortOrder = row.stationSortOrder;
    }
    stationMap.set(row.station, existing);
  }

  const stationRows = Array.from(stationMap.values()).map((row) => {
    let metricPeriods = 0;
    let totalObservations = 0;
    for (const period of periodOrder) {
      const cell = row.valuesByPeriod.get(period);
      if (!cell || cell.metricValue === null) {
        continue;
      }
      metricPeriods += 1;
      totalObservations += Math.max(0, cell.sampleCount || 0);
    }
    return {
      ...row,
      avgMetric: row.weight > 0 ? row.weightedTotal / row.weight : null,
      metricPeriods,
      totalObservations,
      coveragePct: periodOrder.length > 0 ? (metricPeriods / periodOrder.length) * 100 : 0,
    };
  });

  const structuredRows = stationRows
    .slice()
    .sort((left, right) => left.stationSortOrder - right.stationSortOrder || left.station.localeCompare(right.station));

  const minCoveragePeriods = Math.max(2, Math.ceil(periodOrder.length * 0.5));
  const minObservations = 20;
  const denseCandidates = stationRows.filter(
    (row) =>
      row.avgMetric !== null &&
      row.metricPeriods >= minCoveragePeriods &&
      row.totalObservations >= minObservations
  );

  const rankingPool = denseCandidates.length >= 8
    ? denseCandidates
    : stationRows.filter((row) => row.avgMetric !== null);

  const qualitySorted = rankingPool
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
  const activeRows = rowMode === "best20" ? bestRows : rowMode === "all" ? structuredRows : worstRows;

  const metricValues = metricRows.map((row) => row.metricValue).filter((value) => value !== null).sort((a, b) => a - b);
  const valueMin = metricValues[0] ?? 0;
  const valueMax = metricValues[metricValues.length - 1] ?? 1;
  const robustMin = quantile(metricValues, 0.05) ?? valueMin;
  const robustMax = quantile(metricValues, 0.95) ?? valueMax;
  const fixedDomain = activeMetric.fixedDomain || null;
  const domainMin = fixedDomain ? fixedDomain[0] : robustMin;
  const domainMax = fixedDomain ? fixedDomain[1] : Math.max(robustMax, domainMin + 0.001);

  const rowHeight = activeRows.length > 40 ? 12 : activeRows.length > 24 ? 15 : 18;
  const heatWidth = Math.max(430, periodOrder.length * 88);
  const heatHeight = Math.max(120, activeRows.length * rowHeight);
  const margin = { top: 44, right: 96, bottom: 90, left: 220 };
  const summaryBandHeight = 18;
  const svgWidth = margin.left + heatWidth + margin.right;
  const svgHeight = margin.top + heatHeight + margin.bottom;

  const xScale = scaleBand().domain(periodOrder).range([0, heatWidth]).padding(0.08);
  const yScale = scaleBand().domain(activeRows.map((row) => row.station)).range([0, heatHeight]).padding(0.08);
  const colorScale = scaleSequential(interpolateRdYlGn).domain([domainMax, domainMin]);
  const summaryScale = scaleLinear().domain([domainMin, domainMax]).range([0, 56]);

  const periodAverages = periodOrder.map((period) => {
    let weightedTotal = 0;
    let weight = 0;
    for (const row of activeRows) {
      const cell = row.valuesByPeriod.get(period);
      if (!cell || cell.metricValue === null) {
        continue;
      }
      const cellWeight = Math.max(1, cell.sampleCount);
      weightedTotal += cell.metricValue * cellWeight;
      weight += cellWeight;
    }
    return {
      period,
      value: weight > 0 ? weightedTotal / weight : null,
    };
  });

  const middleLabel = activeMetric.legendTicks?.[1] || activeMetric.formatter((domainMin + domainMax) / 2);
  const lowLabel = activeMetric.legendTicks?.[0] || activeMetric.formatter(domainMin);
  const highLabel = activeMetric.legendTicks?.[2] || activeMetric.formatter(domainMax);

  return (
    <section className="chart-card wait-heatmap-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}

      <div className="otp-heatmap-controls">
        <div className="otp-heatmap-control-group">
          <span className="otp-heatmap-controls-label">Metric</span>
          <div className="toggle-pill-group" role="tablist" aria-label="Wait-time heatmap metric">
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
          <div className="toggle-pill-group" role="tablist" aria-label="Wait-time heatmap station subset">
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

        <span className="otp-heatmap-direction">{activeMetric.label} · Lower is better</span>
      </div>

      <div className="otp-heatmap-scroll">
        <svg width={svgWidth} height={svgHeight} role="img" aria-label={title}>
          <defs>
            <pattern id="wait-missing-pattern" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--surface-muted)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="color-mix(in srgb, var(--line) 88%, transparent)" strokeWidth="1" />
            </pattern>
            <linearGradient id="wait-legend-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={interpolateRdYlGn(0)} />
              <stop offset="25%" stopColor={interpolateRdYlGn(0.25)} />
              <stop offset="50%" stopColor={interpolateRdYlGn(0.5)} />
              <stop offset="75%" stopColor={interpolateRdYlGn(0.75)} />
              <stop offset="100%" stopColor={interpolateRdYlGn(1)} />
            </linearGradient>
          </defs>

          <g transform={`translate(${margin.left},${margin.top})`}>
            {activeRows.flatMap((row) =>
              periodOrder.map((period) => {
                const cell = row.valuesByPeriod.get(period) || null;
                const x = xScale(period) || 0;
                const y = yScale(row.station) || 0;
                const value = cell?.metricValue ?? null;
                const obs = cell?.sampleCount ?? 0;
                return (
                  <rect
                    key={`${row.station}||${period}`}
                    x={x}
                    y={y}
                    width={xScale.bandwidth()}
                    height={yScale.bandwidth()}
                    rx={2}
                    fill={value === null ? "url(#wait-missing-pattern)" : colorScale(value)}
                    onMouseEnter={(event) => {
                      const bounds = event.currentTarget.ownerSVGElement.getBoundingClientRect();
                      setTooltip({
                        visible: true,
                        x: event.clientX - bounds.left + 12,
                        y: event.clientY - bounds.top - 10,
                        title: "Wait-Time Cell",
                        rows: [
                          { label: "Station", value: row.station },
                          { label: "Time Period", value: period },
                          { label: activeMetric.label, value: formatValue(value, activeMetric) },
                          { label: "Avg Headway", value: formatValue(cell?.headwayMin ?? null, METRIC_OPTIONS[0]) },
                          { label: "P90 Headway", value: formatValue(cell?.p90HeadwayMin ?? null, METRIC_OPTIONS[1]) },
                          { label: "CV", value: formatValue(cell?.headwayCvPct ?? null, METRIC_OPTIONS[2]) },
                          { label: "Bunching", value: formatValue(cell?.bunchingRatePct ?? null, METRIC_OPTIONS[3]) },
                          { label: "Observations", value: String(obs) },
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
              const dotX = avg === null ? heatWidth + 6 : heatWidth + 6 + summaryScale(avg);
              return (
                <g key={`row-summary-${row.station}`}>
                  <line x1={heatWidth + 6} x2={heatWidth + 62} y1={y} y2={y} className="metric-cell-track" />
                  {avg !== null ? <circle cx={dotX} cy={y} r={2.8} fill="var(--accent)" /> : null}
                  <text x={heatWidth + 68} y={y + 3} className="axis-tick-label">
                    {formatValue(avg, activeMetric)}
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
                    fill={period.value === null ? "url(#wait-missing-pattern)" : colorScale(period.value)}
                    className="calendar-cell"
                  />
                  <text
                    x={x + xScale.bandwidth() / 2}
                    y={heatHeight + 56}
                    className="axis-tick-label"
                    textAnchor="middle"
                  >
                    {formatValue(period.value, activeMetric)}
                  </text>
                </g>
              );
            })}

            <g transform={`translate(0,${heatHeight + 72})`}>
              <rect x={0} y={0} width={120} height={8} rx={3} fill="url(#wait-legend-gradient)" className="calendar-cell" />
              <text x={0} y={22} className="axis-tick-label">
                {highLabel}
              </text>
              <text x={60} y={22} className="axis-tick-label" textAnchor="middle">
                {middleLabel}
              </text>
              <text x={120} y={22} className="axis-tick-label" textAnchor="end">
                {lowLabel}
              </text>
              <text x={170} y={8} className="axis-tick-label">
                {activeMetric.label} · lower values map greener · NA shown with hatch
              </text>
            </g>
          </g>
        </svg>
      </div>

      <p className="card-footnote">
        Source: headway_station_time_month dataset. Worst/Best ranking uses rows with at least {minCoveragePeriods} time periods and {minObservations}+ observations when enough dense stations exist; All mode preserves station order.
      </p>

      <Tooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} title={tooltip.title} rows={tooltip.rows} />
    </section>
  );
}

export default WaitTimeStationHeatmap;
