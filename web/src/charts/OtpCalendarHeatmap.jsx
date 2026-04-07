import { interpolateViridis, max, min, scaleSequential } from "d3";

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

function OtpCalendarHeatmap({
  title = "OTP Calendar Heatmap",
  subtitle = "",
  data = [],
  width = 760,
  height = 300,
  targetPct = 85,
}) {
  const normalized = data
    .map((row) => ({
      ...row,
      __date: parseDate(row.date),
      __value: Number(row.value),
      __events: Number(row.totalEvents || 0),
    }))
    .filter((row) => row.__date && Number.isFinite(row.__value))
    .sort((left, right) => left.__date - right.__date);

  if (normalized.length === 0) {
    return (
      <section className="chart-card">
        <h2>{title}</h2>
        <p>No calendar values available.</p>
      </section>
    );
  }

  const minDate = normalized[0].__date;
  const maxDate = normalized[normalized.length - 1].__date;
  const origin = startOfWeek(minDate);
  const valueByDate = new Map(
    normalized.map((row) => [row.__date.toISOString().slice(0, 10), row])
  );

  const values = normalized.map((row) => row.__value);
  const low = min(values) ?? 0;
  const high = max(values) ?? 100;
  const colorScale = scaleSequential(interpolateViridis).domain([0, 100]);

  const cellSize = 13;
  const cellGap = 3;
  const cellPitch = cellSize + cellGap;
  const weekCount = Math.floor((maxDate - origin) / (7 * DAY_MS)) + 1;

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

  const summaryColorScale = scaleSequential(interpolateViridis).domain([0, 100]);

  const monthlySummarySubtitle =
    Number.isFinite(monthlyLow) && Number.isFinite(monthlyHigh)
      ? `Monthly avg range: ${monthlyLow.toFixed(1)}% to ${monthlyHigh.toFixed(1)}%`
      : "Monthly averages unavailable";

  const worstDays = normalized
    .filter((row) => row.__events > 0)
    .slice()
    .sort((left, right) => left.__value - right.__value)
    .slice(0, 3)
    .map((row) => row.__date.toISOString().slice(0, 10));
  const worstDaySet = new Set(worstDays);

  const legendWidth = 120;

  return (
    <section className="chart-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}

      <p className="card-footnote">
        Fixed 0-100% color scale for comparability. Target marker at {targetPct}%. Missing days use hatched fill.
      </p>

      <div className="chart-frame">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <defs>
            <pattern id="calendar-missing-pattern" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--surface-muted)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="color-mix(in srgb, var(--line) 88%, transparent)" strokeWidth="1" />
            </pattern>
            <linearGradient id="calendar-legend-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={interpolateViridis(0)} />
              <stop offset="25%" stopColor={interpolateViridis(0.25)} />
              <stop offset="50%" stopColor={interpolateViridis(0.5)} />
              <stop offset="75%" stopColor={interpolateViridis(0.75)} />
              <stop offset="100%" stopColor={interpolateViridis(1)} />
            </linearGradient>
          </defs>

          <g transform="translate(64,58)">
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
                  fill={month.average === null ? "url(#calendar-missing-pattern)" : summaryColorScale(month.average)}
                  className="calendar-cell"
                />
                <title>
                  {`${month.label}: ${month.average === null ? "No data" : `${month.average.toFixed(1)}% OTP`}`}
                </title>
              </g>
            ))}
            <text x={weekCount * cellPitch + 6} y={-28} className="axis-tick-label">
              {monthlySummarySubtitle}
            </text>

            {dayLabels.map((label, idx) => (
              <text key={label} x={-10} y={idx * cellPitch + cellSize - 2} textAnchor="end" className="axis-tick-label">
                {label}
              </text>
            ))}

            {monthLabels.map((label) => (
              <text
                key={`${label.label}-${label.week}`}
                x={label.week * cellPitch}
                y={-10}
                className="axis-tick-label"
              >
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
                const fill = value === null ? "url(#calendar-missing-pattern)" : colorScale(value);
                const isWorst = worstDaySet.has(key);

                return (
                  <rect
                    key={key}
                    x={weekIndex * cellPitch}
                    y={dayIndex * cellPitch}
                    width={cellSize}
                    height={cellSize}
                    rx={2}
                    fill={fill}
                    stroke={isWorst ? "var(--accent-strong)" : undefined}
                    strokeWidth={isWorst ? 1.6 : undefined}
                    className="calendar-cell"
                  >
                    <title>
                      {`${formatShortDate(date)}: ${
                        value === null ? "No data" : `${value.toFixed(1)}% OTP`
                      }${row ? ` (${row.__events} events)` : ""}`}
                    </title>
                  </rect>
                );
              })
            )}

            <g transform={`translate(0,${7 * cellPitch + 20})`}>
              <rect x={0} y={0} width={legendWidth} height={8} rx={3} fill="url(#calendar-legend-gradient)" className="calendar-cell" />
              <line
                x1={(targetPct / 100) * legendWidth}
                x2={(targetPct / 100) * legendWidth}
                y1={-2}
                y2={10}
                className="otp-target-tick"
              />
              <text x={0} y={22} className="axis-tick-label">
                0%
              </text>
              <text x={legendWidth / 2} y={22} className="axis-tick-label" textAnchor="middle">
                50%
              </text>
              <text x={legendWidth} y={22} className="axis-tick-label" textAnchor="end">
                100%
              </text>
              <text x={(targetPct / 100) * legendWidth + 4} y={-4} className="axis-tick-label">
                Target {targetPct}%
              </text>
              <text x={legendWidth + 44} y={8} className="axis-tick-label">
                Lowest days outlined
              </text>
            </g>
          </g>
        </svg>
      </div>
    </section>
  );
}

export default OtpCalendarHeatmap;
