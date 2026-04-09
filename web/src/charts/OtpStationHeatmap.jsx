import { useMemo, useState } from "react";
import { interpolateRdYlGn, scaleBand, scaleLinear } from "d3";
import Tooltip from "./components/Tooltip";

const ROW_MODES = [
  { id: "worst20", label: "Worst 20" },
  { id: "best20", label: "Best 20" },
  { id: "all", label: "All (Scroll)" },
];

const GRANULARITY_OPTIONS = [
  { id: "2hour", label: "2h (12 bins)" },
  { id: "1hour", label: "1h (24 bins)" },
];

const PERIOD_TO_HOURS = {
  "AM Peak": [6, 7, 8, 9],
  Midday: [10, 11, 12, 13, 14],
  "PM Peak": [15, 16, 17, 18],
  Evening: [19, 20, 21],
  "Late Night": [22, 23, 0, 1],
  Other: [2, 3, 4, 5],
  Unknown: [2, 3, 4, 5],
};

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

function clampPct(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, value));
}

function padHour(hour) {
  return String(Math.max(0, Math.min(23, Math.floor(hour)))).padStart(2, "0");
}

function formatHourPair(startHour) {
  const start = Math.max(0, Math.min(23, Math.floor(startHour)));
  const end = (start + 1) % 24;
  return `${padHour(start)}-${padHour(end)}`;
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "NA";
}

function qualityScore(value, higherIsBetter) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return higherIsBetter ? value : 100 - value;
}

function dedupeByKey(values, keyAccessor) {
  const unique = new Map();
  for (const value of values) {
    unique.set(keyAccessor(value), value);
  }
  return Array.from(unique.values());
}

function expandPeriodBins(row, granularity) {
  const periodName = String(row.period || "Other");
  // Source data is period-level; we map each named period onto hours to restore temporal detail in the display.
  const mappedHours = PERIOD_TO_HOURS[periodName] || [Math.max(0, Math.min(23, Math.floor(row.hourValue ?? 0)))];

  if (granularity === "1hour") {
    // Tufte: increase data resolution to reduce hidden structure from coarse buckets.
    return dedupeByKey(
      mappedHours.map((hour) => ({
        period: padHour(hour),
        sortValue: hour,
      })),
      (item) => item.period
    );
  }

  // 2-hour bins provide more detail while keeping labels readable.
  return dedupeByKey(
    mappedHours.map((hour) => {
      const start = Math.floor(hour / 2) * 2;
      return {
        period: formatHourPair(start),
        sortValue: start,
      };
    }),
    (item) => item.period
  );
}

function OtpStationHeatmap({
  title = "Reliability Heatmap (Station × Time Period)",
  subtitle = "",
  cardClassName = "",
  data = [],
  selectedCell = null,
  onCellClick,
  metricId = "otp",
  onMetricChange,
  rowMode = "worst20",
  onRowModeChange,
}) {
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, rows: [], title: "" });
  const [granularity, setGranularity] = useState("2hour");
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
        stationSortOrder: toFinite(row.stationSortOrder) ?? Number.POSITIVE_INFINITY,
      })),
    [data]
  );

  const expandedRows = useMemo(() => {
    const rows = [];
    for (const row of normalized) {
      if (!row.station || !row.period) {
        continue;
      }
      for (const periodBin of expandPeriodBins(row, granularity)) {
        rows.push({ ...row, period: periodBin.period, periodSortValue: periodBin.sortValue });
      }
    }
    return rows;
  }, [normalized, granularity]);

  // Tufte: aggregate duplicates first so each cell encodes one clear value (no overplotting by overwrite).
  const aggregatedCells = useMemo(() => {
    const bucketMap = new Map();

    for (const row of expandedRows) {
      const key = `${row.station}||${row.period}`;
      const bucket = bucketMap.get(key) || {
        station: row.station,
        period: row.period,
        periodSortValue: row.periodSortValue,
        stationSortOrder: row.stationSortOrder,
        totalEvents: 0,
        onTimeEvents: 0,
        earlyEvents: 0,
        lateEvents: 0,
      };

      bucket.totalEvents += row.totalEvents;
      bucket.onTimeEvents += row.onTimeEvents;
      bucket.earlyEvents += row.earlyEvents;
      bucket.lateEvents += row.lateEvents;
      bucket.stationSortOrder = Math.min(bucket.stationSortOrder, row.stationSortOrder);
      bucket.periodSortValue = Math.min(bucket.periodSortValue, row.periodSortValue);
      bucketMap.set(key, bucket);
    }

    return Array.from(bucketMap.values()).map((bucket) => {
      const safeTotal = bucket.totalEvents > 0 ? bucket.totalEvents : null;
      const otpPct = safeTotal !== null ? (bucket.onTimeEvents / safeTotal) * 100 : null;
      const lateRatePct = safeTotal !== null ? (bucket.lateEvents / safeTotal) * 100 : null;
      const earlyRatePct = safeTotal !== null ? (bucket.earlyEvents / safeTotal) * 100 : null;
      const notLateRatePct = safeTotal !== null ? ((safeTotal - bucket.lateEvents) / safeTotal) * 100 : null;

      const cell = {
        ...bucket,
        otpPct,
        lateRatePct,
        earlyRatePct,
        notLateRatePct,
      };

      return {
        ...cell,
        metricValue: clampPct(activeMetric.valueAccessor(cell)),
        naReason:
          safeTotal === null
            ? "No observations for this station/time bucket (no scheduled service or missing data)."
            : null,
      };
    });
  }, [activeMetric, expandedRows]);

  const nonEmpty = aggregatedCells.filter((row) => row.station && row.period);
  const valueRows = nonEmpty.filter((row) => row.metricValue !== null);

  if (valueRows.length === 0) {
    return (
      <section className={`chart-card ${cardClassName}`.trim()}>
        <h2>{title}</h2>
        <p>No heatmap values available for {activeMetric.label}.</p>
      </section>
    );
  }

  const periodOrder = Array.from(new Set(nonEmpty.map((row) => row.period))).sort((left, right) => {
    const leftSort = toFinite(nonEmpty.find((row) => row.period === left)?.periodSortValue);
    const rightSort = toFinite(nonEmpty.find((row) => row.period === right)?.periodSortValue);
    if (leftSort !== null && rightSort !== null && leftSort !== rightSort) {
      return leftSort - rightSort;
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
      periodMetrics: [],
    };

    if (row.stationSortOrder < existing.stationSortOrder) {
      existing.stationSortOrder = row.stationSortOrder;
    }

    existing.valuesByPeriod.set(row.period, row);

    if (row.metricValue !== null) {
      const weight = Math.max(1, row.totalEvents);
      existing.weightedTotal += row.metricValue * weight;
      existing.weight += weight;
      existing.periodMetrics.push(row.metricValue);
    }

    stationMap.set(row.station, existing);
  }

  const stationRows = Array.from(stationMap.values()).map((row) => {
    const periodQualities = row.periodMetrics
      .map((value) => qualityScore(value, activeMetric.higherIsBetter))
      .filter((value) => value !== null);

    const worstPeriodQuality =
      periodQualities.length > 0
        ? periodQualities.reduce((minValue, current) => Math.min(minValue, current), Number.POSITIVE_INFINITY)
        : null;

    return {
      ...row,
      avgMetric: row.weight > 0 ? row.weightedTotal / row.weight : null,
      avgQuality: qualityScore(row.weight > 0 ? row.weightedTotal / row.weight : null, activeMetric.higherIsBetter),
      worstPeriodQuality,
    };
  });

  const structuredRows = stationRows
    .slice()
    .sort((left, right) => left.stationSortOrder - right.stationSortOrder || left.station.localeCompare(right.station));

  // Tufte: rank by worst-period quality, not overall average, so local extremes are visible instead of hidden by smoothing.
  const qualitySorted = stationRows
    .filter((row) => row.worstPeriodQuality !== null)
    .sort((left, right) => {
      if (left.worstPeriodQuality !== right.worstPeriodQuality) {
        return left.worstPeriodQuality - right.worstPeriodQuality;
      }
      if (left.avgQuality !== right.avgQuality) {
        return (left.avgQuality ?? Number.POSITIVE_INFINITY) - (right.avgQuality ?? Number.POSITIVE_INFINITY);
      }
      return right.weight - left.weight;
    });

  const worstRows = qualitySorted.slice(0, 20);
  const bestRows = qualitySorted.slice(-20).reverse();

  const activeRows = (() => {
    if (rowMode === "best20") {
      return bestRows;
    }
    if (rowMode === "all") {
      return structuredRows;
    }
    return worstRows;
  })();

  const systemValuesByPeriod = new Map();
  for (const period of periodOrder) {
    let weightedTotal = 0;
    let weight = 0;
    let totalEvents = 0;
    let onTimeEvents = 0;
    let earlyEvents = 0;
    let lateEvents = 0;

    for (const row of stationRows) {
      const cell = row.valuesByPeriod.get(period);
      if (!cell || cell.metricValue === null) {
        continue;
      }
      const cellWeight = Math.max(1, cell.totalEvents);
      weightedTotal += cell.metricValue * cellWeight;
      weight += cellWeight;
      totalEvents += cell.totalEvents;
      onTimeEvents += cell.onTimeEvents;
      earlyEvents += cell.earlyEvents;
      lateEvents += cell.lateEvents;
    }

    const value = weight > 0 ? weightedTotal / weight : null;
    systemValuesByPeriod.set(period, {
      station: "System Average",
      period,
      metricValue: value,
      totalEvents,
      onTimeEvents,
      earlyEvents,
      lateEvents,
      otpPct: totalEvents > 0 ? (onTimeEvents / totalEvents) * 100 : null,
      lateRatePct: totalEvents > 0 ? (lateEvents / totalEvents) * 100 : null,
      earlyRatePct: totalEvents > 0 ? (earlyEvents / totalEvents) * 100 : null,
      notLateRatePct: totalEvents > 0 ? ((totalEvents - lateEvents) / totalEvents) * 100 : null,
      naReason:
        value === null
          ? "No observations for this time bucket in the selected data scope."
          : null,
    });
  }

  const systemAvgMetric =
    Array.from(systemValuesByPeriod.values()).reduce(
      (acc, cell) => {
        if (cell.metricValue === null) {
          return acc;
        }
        const weight = Math.max(1, cell.totalEvents);
        return {
          weightedTotal: acc.weightedTotal + cell.metricValue * weight,
          weight: acc.weight + weight,
        };
      },
      { weightedTotal: 0, weight: 0 }
    );

  const systemRow = {
    station: "System Average",
    stationSortOrder: Number.NEGATIVE_INFINITY,
    valuesByPeriod: systemValuesByPeriod,
    avgMetric: systemAvgMetric.weight > 0 ? systemAvgMetric.weightedTotal / systemAvgMetric.weight : null,
    isSystemRow: true,
  };

  const displayRows = [systemRow, ...activeRows];
  const rowHeight = displayRows.length > 40 ? 11 : displayRows.length > 24 ? 13.5 : 16;
  const heatWidth = Math.max(500, periodOrder.length * 68);
  const heatHeight = Math.max(120, displayRows.length * rowHeight);

  // Tufte: prioritize legible labels over clipping important identifiers.
  const maxStationNameLength = displayRows.reduce((maxLength, row) => Math.max(maxLength, row.station.length), 0);
  const leftMargin = Math.max(230, Math.min(420, Math.round(maxStationNameLength * 7.1) + 26));
  // Extra bottom room keeps legend labels from clipping at the SVG boundary.
  const margin = { top: 44, right: 148, bottom: 114, left: leftMargin };

  const summaryBandHeight = 18;
  const svgWidth = margin.left + heatWidth + margin.right;
  const svgHeight = margin.top + heatHeight + margin.bottom;

  const xScale = scaleBand().domain(periodOrder).range([0, heatWidth]).padding(0.07);
  const yScale = scaleBand().domain(displayRows.map((row) => row.station)).range([0, heatHeight]).padding(0.08);

  // Tufte + semantics: green = good, red = bad regardless of metric direction.
  const colorForValue = (value) => {
    if (!Number.isFinite(value)) {
      return "url(#otp-missing-pattern)";
    }
    const t = Math.max(0, Math.min(1, value / 100));
    return interpolateRdYlGn(activeMetric.higherIsBetter ? t : 1 - t);
  };

  const summaryScale = scaleLinear().domain([0, 100]).range([0, 92]);

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
    <section className={`chart-card ${cardClassName}`.trim()}>
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
          <span className="otp-heatmap-controls-label">Time Bins</span>
          <div className="toggle-pill-group" role="tablist" aria-label="Reliability heatmap time granularity">
            {GRANULARITY_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={granularity === option.id ? "active" : ""}
                onClick={() => setGranularity(option.id)}
              >
                {option.label}
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
          Green = better, Red = worse · {rowMode === "worst20" ? "Sorted by each station's worst period" : ""}
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
              <stop offset="0%" stopColor={colorForValue(0)} />
              <stop offset="25%" stopColor={colorForValue(25)} />
              <stop offset="50%" stopColor={colorForValue(50)} />
              <stop offset="75%" stopColor={colorForValue(75)} />
              <stop offset="100%" stopColor={colorForValue(100)} />
            </linearGradient>
          </defs>

          <g transform={`translate(${margin.left},${margin.top})`}>
            {displayRows.flatMap((row) =>
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
                    fill={colorForValue(value)}
                    stroke={row.isSystemRow ? "var(--accent-strong)" : isSelected ? "var(--accent-strong)" : "transparent"}
                    strokeWidth={row.isSystemRow || isSelected ? 1.5 : 0}
                    className={value !== null && onCellClick && !row.isSystemRow ? "heatmap-clickable-cell" : undefined}
                    onClick={() => {
                      if (value === null || row.isSystemRow) {
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
                        title: row.isSystemRow ? "System Benchmark" : "Reliability Cell",
                        rows: [
                          { label: "Station", value: row.station },
                          { label: "Time Period", value: period },
                          { label: activeMetric.label, value: formatPercent(value) },
                          { label: "OTP %", value: formatPercent(cell?.otpPct) },
                          { label: "Late Rate %", value: formatPercent(cell?.lateRatePct) },
                          { label: "Early Rate %", value: formatPercent(cell?.earlyRatePct) },
                          { label: "Events", value: String(events) },
                          ...(value === null ? [{ label: "NA", value: cell?.naReason || "No observations for this station/time bucket." }] : []),
                        ],
                      });
                    }}
                    onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
                  />
                );
              })
            )}

            {displayRows.map((row) => (
              <text
                key={`label-${row.station}`}
                x={-10}
                y={(yScale(row.station) || 0) + yScale.bandwidth() / 2}
                className="axis-tick-label axis-tick-label-y"
                textAnchor="end"
                dominantBaseline="middle"
                style={row.isSystemRow ? { fontWeight: 700 } : undefined}
              >
                {row.station}
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
            {displayRows.map((row) => {
              const avg = row.avgMetric;
              const y = (yScale(row.station) || 0) + yScale.bandwidth() / 2;
              const barWidth = avg === null ? 0 : summaryScale(avg);
              const barHeight = Math.max(5, Math.min(9, Math.floor(yScale.bandwidth() * 0.62)));
              const barTop = y - barHeight / 2;

              return (
                <g key={`row-summary-${row.station}`}>
                  <rect x={heatWidth + 6} y={barTop} width={92} height={barHeight} rx={2} className="metric-cell-track" />
                  {Number.isFinite(activeMetric.targetPct) ? (
                    <line
                      x1={heatWidth + 6 + summaryScale(activeMetric.targetPct)}
                      x2={heatWidth + 6 + summaryScale(activeMetric.targetPct)}
                      y1={barTop - 2}
                      y2={barTop + barHeight + 2}
                      className="otp-target-tick"
                    />
                  ) : null}
                  {avg !== null ? (
                    <rect
                      x={heatWidth + 6}
                      y={barTop}
                      width={barWidth}
                      height={barHeight}
                      rx={2}
                      fill={colorForValue(avg)}
                      opacity={row.isSystemRow ? 1 : 0.9}
                    />
                  ) : null}
                  <text x={heatWidth + 104} y={y + 3} className="axis-tick-label" style={row.isSystemRow ? { fontWeight: 700 } : undefined}>
                    {formatPercent(avg)}
                  </text>
                </g>
              );
            })}

            <text x={-10} y={heatHeight + 38} className="axis-tick-label axis-tick-label-y" textAnchor="end">
              Row Avg by Period
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
                    fill={colorForValue(period.value)}
                    className="calendar-cell"
                  />
                  <text x={x + xScale.bandwidth() / 2} y={heatHeight + 56} className="axis-tick-label" textAnchor="middle">
                    {formatPercent(period.value)}
                  </text>
                </g>
              );
            })}

            <g transform={`translate(0,${heatHeight + 72})`}>
              <rect x={0} y={0} width={140} height={8} rx={3} fill="url(#otp-legend-gradient)" className="calendar-cell" />
              {Number.isFinite(activeMetric.targetPct) ? (
                <line
                  x1={(activeMetric.targetPct / 100) * 140}
                  x2={(activeMetric.targetPct / 100) * 140}
                  y1={-2}
                  y2={10}
                  className="otp-target-tick"
                />
              ) : null}
              <text x={0} y={22} className="axis-tick-label">
                0%
              </text>
              <text x={70} y={22} className="axis-tick-label" textAnchor="middle">
                50%
              </text>
              <text x={140} y={22} className="axis-tick-label" textAnchor="end">
                100%
              </text>
              {Number.isFinite(activeMetric.targetPct) ? (
                <text x={(activeMetric.targetPct / 100) * 140 + 4} y={-4} className="axis-tick-label">
                  Target {activeMetric.targetPct}%
                </text>
              ) : null}
              <text x={176} y={8} className="axis-tick-label">
                Hatched = no observations (no service or missing data)
              </text>
            </g>
          </g>
        </svg>
      </div>

      <p className="card-footnote">
        Fixed 0-100% scale for comparability. Ranking uses each station's worst period (not overall average), and the top row is the system benchmark. 2h/1h bins are expanded from source time-period aggregates.
      </p>

      <Tooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} title={tooltip.title} rows={tooltip.rows} />
    </section>
  );
}

export default OtpStationHeatmap;
