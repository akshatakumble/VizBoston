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
  height = 250,
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
  const colorScale = scaleSequential(interpolateViridis).domain([low, high || low + 1]);

  const cellSize = 13;
  const cellGap = 3;
  const cellPitch = cellSize + cellGap;
  const weekCount = Math.floor((maxDate - origin) / (7 * DAY_MS)) + 1;

  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const monthLabels = [];
  for (let week = 0; week < weekCount; week += 1) {
    const date = new Date(origin.getTime() + week * 7 * DAY_MS);
    if (date.getDate() <= 7) {
      monthLabels.push({ week, label: date.toLocaleDateString(undefined, { month: "short" }) });
    }
  }

  return (
    <section className="chart-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}

      <div className="chart-frame">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <g transform="translate(64,28)">
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
                const fill = value === null ? "var(--surface-muted)" : colorScale(value);

                return (
                  <rect
                    key={key}
                    x={weekIndex * cellPitch}
                    y={dayIndex * cellPitch}
                    width={cellSize}
                    height={cellSize}
                    rx={2}
                    fill={fill}
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
          </g>
        </svg>
      </div>
    </section>
  );
}

export default OtpCalendarHeatmap;
