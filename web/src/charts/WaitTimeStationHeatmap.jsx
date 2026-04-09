import { scaleBand, scaleSequential, quantile, interpolateRgb } from "d3";
import { useMemo, useState } from "react";
import Tooltip from "./components/Tooltip";

const ROW_MODES = [
  { id: "worst20", label: "Worst 20" },
  { id: "best20", label: "Best 20" },
  { id: "all", label: "All" },
];

const METRIC_OPTIONS = [
  {
    id: "headwayMin",
    label: "Avg Headway (min)",
    shortLabel: "Headway",
    unit: "min",
    higherIsBetter: false,
    valueAccessor: (row) => row.headwayMin,
    formatter: (value) => `${value.toFixed(1)} min`,
    legendMin: "5 min",
    legendMax: "30+ min",
    fixedDomain: [5, 30],
    colorStart: "#f7fbff",
    colorEnd: "#084594",
    definition: "Headway: average time between vehicle arrivals at a station. Lower is better (shorter waits).",
  },
  {
    id: "p90HeadwayMin",
    label: "P90 Headway (min)",
    shortLabel: "P90",
    unit: "min",
    higherIsBetter: false,
    valueAccessor: (row) => row.p90HeadwayMin,
    formatter: (value) => `${value.toFixed(1)} min`,
    fixedDomain: [8, 45],
    colorStart: "#fff5eb",
    colorEnd: "#8c2d04",
    definition: "P90 Headway: 90th percentile wait between arrivals. Lower is better (fewer long waits).",
  },
  {
    id: "headwayCvPct",
    label: "Headway CV %",
    shortLabel: "CV%",
    unit: "%",
    higherIsBetter: false,
    valueAccessor: (row) => row.headwayCvPct,
    formatter: (value) => `${value.toFixed(1)}%`,
    fixedDomain: [0, 100],
    colorStart: "#f7fcf5",
    colorEnd: "#005a32",
    definition: "CV%: coefficient of variation for headways (regularity). Lower is better (more even spacing).",
  },
  {
    id: "bunchingRatePct",
    label: "Bunching Rate %",
    shortLabel: "Bunching",
    unit: "%",
    higherIsBetter: false,
    valueAccessor: (row) => row.bunchingRatePct,
    formatter: (value) => `${value.toFixed(1)}%`,
    fixedDomain: [0, 100],
    colorStart: "#fcfbfd",
    colorEnd: "#4a1486",
    definition: "Bunching: share of arrivals that are bunched (too close together). Lower is better.",
  },
];

function toFinite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function hourLabel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 23) {
    return "";
  }
  return String(numeric).padStart(2, "0");
}

function formatLegendBound(value, metric) {
  if (!Number.isFinite(value)) {
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
      data.map((row) => {
        const hourValue = toFinite(row.hourValue ?? row.hour);
        const period = hourValue !== null ? hourLabel(hourValue) : String(row.hour || row.timePeriod || "");
        return {
          station: String(row.station || ""),
          period,
          hourValue,
          line: String(row.line || ""),
          stationSortOrder: toFinite(row.stationSortOrder) ?? Number.POSITIVE_INFINITY,
          sampleCount: Math.max(0, toFinite(row.sampleCount) ?? 0),
          headwayMin: toFinite(row.headwayMin ?? row.value),
          p90HeadwayMin: toFinite(row.p90HeadwayMin),
          headwayCvPct: toFinite(row.headwayCvPct),
          bunchingRatePct: toFinite(row.bunchingRatePct),
        };
      }),
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
    };
  });

  const sortedByMetric = stationRows
    .filter((row) => row.avgMetric !== null)
    .sort((left, right) => {
      if (activeMetric.higherIsBetter) {
        if (right.avgMetric !== left.avgMetric) {
          return right.avgMetric - left.avgMetric;
        }
      } else if (right.avgMetric !== left.avgMetric) {
        return right.avgMetric - left.avgMetric;
      }
      if (right.weight !== left.weight) {
        return right.weight - left.weight;
      }
      return left.stationSortOrder - right.stationSortOrder || left.station.localeCompare(right.station);
    });

  const activeRows =
    rowMode === "best20"
      ? sortedByMetric.slice(-20).reverse()
      : rowMode === "all"
        ? sortedByMetric
        : sortedByMetric.slice(0, 20);

  const metricValues = metricRows.map((row) => row.metricValue).sort((a, b) => a - b);
  const valueMin = metricValues[0] ?? 0;
  const valueMax = metricValues[metricValues.length - 1] ?? 1;
  const robustMin = quantile(metricValues, 0.05) ?? valueMin;
  const robustMax = quantile(metricValues, 0.95) ?? valueMax;
  const fixedDomain = activeMetric.fixedDomain || null;
  const domainMin = fixedDomain ? fixedDomain[0] : robustMin;
  const domainMax = fixedDomain ? fixedDomain[1] : Math.max(robustMax, domainMin + 0.001);

  const rowHeight = activeRows.length > 36 ? 12 : activeRows.length > 22 ? 14 : 16;
  const heatWidth = Math.max(360, periodOrder.length * 34);
  const leftLabelChars = Math.max(...activeRows.map((row) => row.station.length), 12);
  const leftLabelWidth = Math.min(460, Math.max(210, Math.round(leftLabelChars * 7.2)));
  const avgColumnWidth = 74;
  const margin = { top: 38, right: 14, bottom: 28, left: leftLabelWidth };
  const heatHeight = Math.max(100, activeRows.length * rowHeight);
  const svgWidth = margin.left + heatWidth + avgColumnWidth + margin.right;
  const svgHeight = margin.top + heatHeight + margin.bottom;

  const xScale = scaleBand().domain(periodOrder).range([0, heatWidth]).padding(0.02);
  const yScale = scaleBand().domain(activeRows.map((row) => row.station)).range([0, heatHeight]).padding(0.02);

  const colorScale = scaleSequential(interpolateRgb(activeMetric.colorStart, activeMetric.colorEnd))
    .domain([domainMin, domainMax])
    .clamp(true);

  const handleHover = (event, row, period, value, obs) => {
    const bounds = event.currentTarget.ownerSVGElement.getBoundingClientRect();
    setTooltip({
      visible: true,
      x: event.clientX - bounds.left + 10,
      y: event.clientY - bounds.top - 12,
      title: `${row.station} · ${period}`,
      rows: [
        { label: activeMetric.shortLabel, value: value === null ? "No service" : activeMetric.formatter(value) },
        { label: "Events", value: String(obs) },
      ],
    });
  };

  const legendMinLabel = activeMetric.legendMin || formatLegendBound(domainMin, activeMetric);
  const legendMaxLabel = activeMetric.legendMax || formatLegendBound(domainMax, activeMetric);

  return (
    <section className="chart-card wait-heatmap-card wait-heatmap-tufte-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}

      <div className="wait-heatmap-controls-minimal" aria-label="Wait-time heatmap controls">
        <div className="wait-heatmap-control-group">
          <span className="wait-heatmap-control-label">Metric</span>
          <div className="wait-heatmap-toggle-group" role="tablist" aria-label="Wait-time metric">
            {METRIC_OPTIONS.map((metric) => (
              <button
                key={metric.id}
                type="button"
                className={metricId === metric.id ? "is-active" : ""}
                onClick={() => onMetricChange?.(metric.id)}
              >
                {metric.shortLabel}
              </button>
            ))}
          </div>
        </div>

        <div className="wait-heatmap-control-group">
          <span className="wait-heatmap-control-label">Rows</span>
          <div className="wait-heatmap-toggle-group" role="tablist" aria-label="Station subset">
            {ROW_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={rowMode === mode.id ? "is-active" : ""}
                onClick={() => onRowModeChange?.(mode.id)}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="wait-heatmap-legend" aria-label="Heatmap legend">
        <span>{legendMinLabel}</span>
        <svg width="180" height="10" aria-hidden="true">
          <defs>
            <linearGradient id="wait-tufte-legend-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={activeMetric.colorStart} />
              <stop offset="100%" stopColor={activeMetric.colorEnd} />
            </linearGradient>
            <pattern id="wait-no-service-pattern-legend" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--surface)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--line)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect x="0" y="0" width="180" height="10" fill="url(#wait-tufte-legend-gradient)" />
        </svg>
        <span>{legendMaxLabel}</span>
        <span className="wait-no-service-key">
          <svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" fill="url(#wait-no-service-pattern-legend)" /></svg>
          No service
        </span>
      </div>

      <div className="otp-heatmap-scroll wait-heatmap-scroll-minimal chart-frame">
        <svg width={svgWidth} height={svgHeight} role="img" aria-label={title}>
          <defs>
            <pattern id="wait-no-service-pattern-grid" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--surface)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--line)" strokeWidth="1" />
            </pattern>
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
                    fill={value === null ? "url(#wait-no-service-pattern-grid)" : colorScale(value)}
                    stroke="var(--line)"
                    strokeWidth="0.6"
                    onMouseEnter={(event) => handleHover(event, row, period, value, obs)}
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
                title={row.station}
              >
                {row.station}
              </text>
            ))}

            {periodOrder.map((period) => (
              <text
                key={`column-${period}`}
                x={(xScale(period) || 0) + xScale.bandwidth() / 2}
                y={heatHeight + 14}
                className="axis-tick-label axis-tick-label-x"
                textAnchor="middle"
              >
                {period}
              </text>
            ))}

            <text x={heatWidth + 6} y={-8} className="axis-tick-label">
              Avg
            </text>
            {activeRows.map((row) => {
              const y = (yScale(row.station) || 0) + yScale.bandwidth() / 2;
              return (
                <text
                  key={`row-summary-${row.station}`}
                  x={heatWidth + 6}
                  y={y + 3}
                  className="axis-tick-label"
                  textAnchor="start"
                >
                  {row.avgMetric === null ? "NA" : activeMetric.formatter(row.avgMetric)}
                </text>
              );
            })}
          </g>
        </svg>

        <Tooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} title={tooltip.title} rows={tooltip.rows} />
      </div>

      <p className="card-footnote wait-heatmap-definition">
        {activeMetric.definition} Values above the legend maximum are capped to the darkest tone.
      </p>
    </section>
  );
}

export default WaitTimeStationHeatmap;
