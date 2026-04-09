import { useMemo, useState } from "react";
import { interpolateRdYlGn, max, min } from "d3";
import Tooltip from "./components/Tooltip";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfWeek(date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const mondayOffset = (day + 6) % 7;
  copy.setDate(copy.getDate() - mondayOffset);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function formatShortDate(date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatLongDate(date) {
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "NA";
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function OtpCalendarHeatmap({
  title = "OTP Calendar Heatmap",
  subtitle = "",
  cardClassName = "",
  data = [],
  width = 760,
  height = 320,
  targetPct = 85,
  worstDayCount = 10,
}) {
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, rows: [], title: "" });

  const normalized = useMemo(
    () =>
      data
        .map((row) => ({
          ...row,
          __date: parseDate(row.date),
          __value: Number(row.value),
          __events: Number(row.totalEvents || 0),
        }))
        .filter((row) => row.__date && Number.isFinite(row.__value))
        .sort((left, right) => left.__date - right.__date),
    [data]
  );

  if (normalized.length === 0) {
    return (
      <section className={`chart-card ${cardClassName}`.trim()}>
        <h2>{title}</h2>
        <p>No calendar values available.</p>
      </section>
    );
  }

  const minDate = normalized[0].__date;
  const maxDate = normalized[normalized.length - 1].__date;
  const origin = startOfWeek(minDate);
  const valueByDate = new Map(normalized.map((row) => [row.__date.toISOString().slice(0, 10), row]));

  const values = normalized.map((row) => row.__value);
  const low = min(values) ?? 0;
  const high = max(values) ?? 100;
  const target = Number.isFinite(targetPct) ? Math.max(0, Math.min(100, targetPct)) : 85;

  // Tufte: use a data-adaptive, target-centered diverging encoding so real variation and threshold deviations are visible.
  const colorForValue = (value) => {
    if (!Number.isFinite(value)) {
      return "url(#calendar-missing-pattern)";
    }

    if (high <= low) {
      return interpolateRdYlGn(0.5);
    }

    if (value <= target) {
      const denom = Math.max(1e-6, target - low);
      const ratio = clamp01((value - low) / denom);
      return interpolateRdYlGn(ratio * 0.5);
    }

    const denom = Math.max(1e-6, high - target);
    const ratio = clamp01((value - target) / denom);
    return interpolateRdYlGn(0.5 + ratio * 0.5);
  };

  const cellSize = 13;
  const cellGap = 3;
  const cellPitch = cellSize + cellGap;
  const weekCount = Math.floor((maxDate - origin) / (7 * DAY_MS)) + 1;
  const leftGutter = 64;
  const rightPanelWidth = 250;
  const heatmapWidth = weekCount * cellPitch;
  const svgWidth = Math.max(width, leftGutter + heatmapWidth + rightPanelWidth);
  const svgHeight = Math.max(height, 60 + 7 * cellPitch + 86);

  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const monthBuckets = new Map();
  for (const row of normalized) {
    const monthKey = `${row.__date.getFullYear()}-${String(row.__date.getMonth() + 1).padStart(2, "0")}`;
    const existing = monthBuckets.get(monthKey) || { total: 0, count: 0 };
    existing.total += row.__value;
    existing.count += 1;
    monthBuckets.set(monthKey, existing);
  }

  const monthLabels = [];
  let cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  const maxCursor = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
  while (cursor <= maxCursor) {
    const monthStartWeek = Math.floor((startOfWeek(cursor) - origin) / (7 * DAY_MS));
    const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const monthStat = monthBuckets.get(monthKey);
    monthLabels.push({
      week: monthStartWeek,
      key: monthKey,
      label: cursor.toLocaleDateString(undefined, { month: "short" }),
      average: monthStat && monthStat.count > 0 ? monthStat.total / monthStat.count : null,
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  const monthCells = monthLabels.map((month, index) => {
    const nextWeek = monthLabels[index + 1]?.week ?? weekCount;
    return {
      ...month,
      width: Math.max(cellPitch, (nextWeek - month.week) * cellPitch - cellGap),
    };
  });

  const monthlyLow = min(monthCells.map((row) => row.average).filter((value) => Number.isFinite(value))) ?? low;
  const monthlyHigh = max(monthCells.map((row) => row.average).filter((value) => Number.isFinite(value))) ?? high;

  const monthlySummarySubtitle =
    Number.isFinite(monthlyLow) && Number.isFinite(monthlyHigh)
      ? `Monthly avg range: ${monthlyLow.toFixed(1)}% to ${monthlyHigh.toFixed(1)}%`
      : "Monthly averages unavailable";

  // Tufte: explicit anomaly layer so rare events stand out from trend texture.
  const worstDays = normalized
    .filter((row) => row.__events > 0)
    .slice()
    .sort((left, right) => left.__value - right.__value)
    .slice(0, worstDayCount)
    .map((row) => ({
      key: row.__date.toISOString().slice(0, 10),
      date: row.__date,
      value: row.__value,
    }));
  const worstDaySet = new Set(worstDays.map((row) => row.key));

  const avgOtp = values.reduce((acc, value) => acc + value, 0) / Math.max(1, values.length);
  const kpiThreshold = 85;
  const daysAboveTarget = normalized.filter((row) => row.__value >= kpiThreshold).length;
  const bestDay = normalized.slice().sort((left, right) => right.__value - left.__value)[0] || null;
  const worstDay = normalized.slice().sort((left, right) => left.__value - right.__value)[0] || null;

  const legendWidth = 170;
  const targetLegendRatio = clamp01((target - low) / Math.max(1e-6, high - low));

  return (
    <section className={`chart-card otp-calendar-card ${cardClassName}`.trim()}>
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}

      <div className="otp-calendar-kpis" role="list" aria-label="OTP calendar summary statistics">
        <div className="otp-calendar-kpi" role="listitem">
          <span className="otp-calendar-kpi-label">Average OTP</span>
          <strong className="otp-calendar-kpi-value">{formatPercent(avgOtp)}</strong>
        </div>
        <div className="otp-calendar-kpi" role="listitem">
          <span className="otp-calendar-kpi-label">Days Above 85%</span>
          <strong className="otp-calendar-kpi-value">
            {daysAboveTarget} / {normalized.length}
          </strong>
        </div>
        <div className="otp-calendar-kpi" role="listitem">
          <span className="otp-calendar-kpi-label">Worst Day</span>
          <strong className="otp-calendar-kpi-value otp-calendar-kpi-value-critical">
            {worstDay ? formatPercent(worstDay.__value) : "NA"}
          </strong>
        </div>
        <div className="otp-calendar-kpi" role="listitem">
          <span className="otp-calendar-kpi-label">Best Day</span>
          <strong className="otp-calendar-kpi-value otp-calendar-kpi-value-best">
            {bestDay ? formatPercent(bestDay.__value) : "NA"}
          </strong>
        </div>
      </div>

      <p className="card-footnote">
        Diverging scale is centered on the {target.toFixed(0)}% target. Green is above target, red is below target, and hatched cells indicate missing observations.
      </p>

      <div className="chart-frame otp-calendar-frame">
        <svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} role="img" aria-label={title}>
          <defs>
            <pattern id="calendar-missing-pattern" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--surface-muted)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="color-mix(in srgb, var(--line) 88%, transparent)" strokeWidth="1" />
            </pattern>
            <linearGradient id="calendar-legend-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={colorForValue(low)} />
              <stop offset="50%" stopColor={colorForValue(target)} />
              <stop offset="100%" stopColor={colorForValue(high)} />
            </linearGradient>
          </defs>

          <g transform={`translate(${leftGutter},60)`}>
            <text x={-10} y={-26} className="axis-tick-label" textAnchor="end">
              Monthly Avg
            </text>
            {monthCells.map((month) => (
              <g key={`summary-${month.key}`}>
                <rect
                  x={month.week * cellPitch}
                  y={-36}
                  width={month.width}
                  height={10}
                  rx={2}
                  fill={month.average === null ? "url(#calendar-missing-pattern)" : colorForValue(month.average)}
                  className="calendar-cell"
                />
              </g>
            ))}
            <text x={heatmapWidth + 8} y={-28} className="axis-tick-label">
              {monthlySummarySubtitle}
            </text>

            {dayLabels.map((label, idx) => (
              <text key={label} x={-10} y={idx * cellPitch + cellSize - 2} textAnchor="end" className="axis-tick-label">
                {label}
              </text>
            ))}

            {monthLabels.map((label) => (
              <text key={`${label.label}-${label.week}`} x={label.week * cellPitch} y={-10} className="axis-tick-label">
                {label.label}
              </text>
            ))}

            {Array.from({ length: weekCount }).map((_, weekIndex) =>
              Array.from({ length: 7 }).map((__, dayIndex) => {
                const date = new Date(origin.getTime() + (weekIndex * 7 + dayIndex) * DAY_MS);
                if (date > maxDate || date < minDate) {
                  return null;
                }

                const key = date.toISOString().slice(0, 10);
                const row = valueByDate.get(key);
                const value = row ? row.__value : null;
                const fill = value === null ? "url(#calendar-missing-pattern)" : colorForValue(value);
                const isWorst = worstDaySet.has(key);
                const x = weekIndex * cellPitch;
                const y = dayIndex * cellPitch;

                return (
                  <g key={key}>
                    <rect
                      x={x}
                      y={y}
                      width={cellSize}
                      height={cellSize}
                      rx={2}
                      fill={fill}
                      stroke={isWorst ? "var(--critical)" : "transparent"}
                      strokeWidth={isWorst ? 2.2 : 0}
                      className="calendar-cell"
                      onMouseEnter={(event) => {
                        const bounds = event.currentTarget.ownerSVGElement.getBoundingClientRect();
                        setTooltip({
                          visible: true,
                          x: event.clientX - bounds.left + 12,
                          y: event.clientY - bounds.top - 10,
                          title: "Daily OTP",
                          rows: [
                            { label: "Date", value: formatLongDate(date) },
                            { label: "OTP", value: formatPercent(value) },
                            { label: "Target", value: `${target.toFixed(0)}%` },
                            { label: "Events", value: String(row ? row.__events : 0) },
                            ...(value === null
                              ? [{ label: "NA", value: "No observations recorded for this date." }]
                              : []),
                            ...(isWorst && value !== null ? [{ label: "Flag", value: `Worst ${worstDayCount} day` }] : []),
                          ],
                        });
                      }}
                      onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
                    />
                    {isWorst ? (
                      <circle
                        cx={x + cellSize - 2.3}
                        cy={y + 2.3}
                        r={1.6}
                        fill="var(--critical)"
                        pointerEvents="none"
                      />
                    ) : null}
                  </g>
                );
              })
            )}

            <g transform={`translate(0,${7 * cellPitch + 20})`}>
              <rect x={0} y={0} width={legendWidth} height={8} rx={3} fill="url(#calendar-legend-gradient)" className="calendar-cell" />
              <line
                x1={targetLegendRatio * legendWidth}
                x2={targetLegendRatio * legendWidth}
                y1={-2}
                y2={10}
                className="otp-target-tick"
              />
              <text x={0} y={22} className="axis-tick-label">
                {formatPercent(low)}
              </text>
              <text x={legendWidth / 2} y={22} className="axis-tick-label" textAnchor="middle">
                Target {target.toFixed(0)}%
              </text>
              <text x={legendWidth} y={22} className="axis-tick-label" textAnchor="end">
                {formatPercent(high)}
              </text>
              <text x={legendWidth + 40} y={8} className="axis-tick-label">
                Worst {worstDayCount} days outlined + marked
              </text>
            </g>

            <g transform={`translate(${heatmapWidth - 2},${7 * cellPitch + 16})`}>
              <text x={0} y={0} className="axis-tick-label" style={{ fontWeight: 700 }}>
                Worst Days
              </text>
              {worstDays.slice(0, 5).map((day, index) => (
                <text key={day.key} x={0} y={16 + index * 13} className="axis-tick-label">
                  {`${index + 1}. ${formatShortDate(day.date)} ${formatPercent(day.value)}`}
                </text>
              ))}
            </g>
          </g>
        </svg>
      </div>

      <Tooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} title={tooltip.title} rows={tooltip.rows} />
    </section>
  );
}

export default OtpCalendarHeatmap;
