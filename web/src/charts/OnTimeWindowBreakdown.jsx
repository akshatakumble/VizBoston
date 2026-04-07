function formatPct(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "NA";
  }
  return `${numeric.toFixed(1)}%`;
}

function formatCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  return numeric.toLocaleString();
}

function clampPct(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(100, numeric));
}

function OnTimeWindowBreakdown({
  title = "On-Time Window Composition",
  subtitle = "",
  breakdown = null,
}) {
  if (!breakdown || !Number.isFinite(Number(breakdown.totalEvents)) || Number(breakdown.totalEvents) <= 0) {
    return (
      <section className="chart-card">
        <h2>{title}</h2>
        <p>No reliability composition data available.</p>
      </section>
    );
  }

  const earlyPct = clampPct(breakdown.earlyPct);
  const onTimePct = clampPct(breakdown.onTimePct);
  const latePct = clampPct(breakdown.latePct);

  const rows = [
    {
      key: "early",
      label: "Early (< -60s)",
      pct: earlyPct,
      count: breakdown.earlyEvents,
      className: "composition-early",
    },
    {
      key: "on-time",
      label: "On-Time (-60s to +300s)",
      pct: onTimePct,
      count: breakdown.onTimeEvents,
      className: "composition-on-time",
    },
    {
      key: "late",
      label: "Late (> +300s)",
      pct: latePct,
      count: breakdown.lateEvents,
      className: "composition-late",
    },
  ];

  return (
    <section className="chart-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}

      <div className="composition-bar" role="img" aria-label="Early, on-time, and late trip shares">
        {rows.map((row) => (
          <div
            key={row.key}
            className={`composition-segment ${row.className}`}
            style={{ width: `${row.pct}%` }}
            title={`${row.label}: ${formatPct(row.pct)} (${formatCount(row.count)} events)`}
          />
        ))}
      </div>

      <table className="composition-table" aria-label="On-time window composition table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Share</th>
            <th>Events</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">
                <span className={`composition-dot ${row.className}`} aria-hidden="true" />
                {row.label}
              </th>
              <td>{formatPct(row.pct)}</td>
              <td>{formatCount(row.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="card-footnote">
        Total observed trips: {formatCount(breakdown.totalEvents)}. This view is directly event-weighted under your current filters.
      </p>
    </section>
  );
}

export default OnTimeWindowBreakdown;
