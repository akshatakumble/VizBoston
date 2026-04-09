import { getLineColor } from "../design/transit";

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

function normalizeRows(lineBreakdown = [], breakdown = null) {
  const rows = (lineBreakdown || [])
    .map((row) => {
      const earlyPct = clampPct(row.earlyPct);
      const onTimePct = clampPct(row.onTimePct);
      const latePct = clampPct(row.latePct);
      const totalEvents = Number(row.totalEvents) || 0;
      return {
        line: String(row.line || ""),
        totalEvents,
        earlyEvents: Number(row.earlyEvents) || 0,
        onTimeEvents: Number(row.onTimeEvents) || 0,
        lateEvents: Number(row.lateEvents) || 0,
        earlyPct,
        onTimePct,
        latePct,
        offSchedulePct: clampPct(earlyPct + latePct),
      };
    })
    .filter((row) => row.line && row.totalEvents > 0);

  if (!breakdown || !Number.isFinite(Number(breakdown.totalEvents)) || Number(breakdown.totalEvents) <= 0) {
    return rows;
  }

  return [
    ...rows,
    {
      line: "System Avg",
      totalEvents: Number(breakdown.totalEvents) || 0,
      earlyEvents: Number(breakdown.earlyEvents) || 0,
      onTimeEvents: Number(breakdown.onTimeEvents) || 0,
      lateEvents: Number(breakdown.lateEvents) || 0,
      earlyPct: clampPct(breakdown.earlyPct),
      onTimePct: clampPct(breakdown.onTimePct),
      latePct: clampPct(breakdown.latePct),
      offSchedulePct: clampPct((Number(breakdown.earlyPct) || 0) + (Number(breakdown.latePct) || 0)),
      isSystem: true,
    },
  ];
}

function OnTimeWindowBreakdown({
  title = "On-Time Window Composition",
  subtitle = "",
  breakdown = null,
  lineBreakdown = [],
  windowLabel = "On-time window: -60s to +300s from schedule",
}) {
  const rows = normalizeRows(lineBreakdown, breakdown);

  if (rows.length === 0) {
    return (
      <section className="chart-card">
        <h2>{title}</h2>
        <p>No reliability composition data available.</p>
      </section>
    );
  }

  const topEarlyRow = rows
    .filter((row) => !row.isSystem)
    .slice()
    .sort((left, right) => right.earlyPct - left.earlyPct || right.totalEvents - left.totalEvents)[0];

  return (
    <section className="chart-card reliability-composition-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}

      <p className="otw-window-callout">
        <strong>{windowLabel}.</strong> Early arrivals are treated as off-schedule (same reliability concern family as late trips) because riders can miss trains.
        A stricter late tolerance comparison (e.g., +120s vs +300s) can be added when second-level delay bins are available in this view.
      </p>

      <div className="otw-legend" aria-label="Legend">
        <span><i className="composition-dot composition-early" />Early (passengers miss train)</span>
        <span><i className="composition-dot composition-on-time" />On-time</span>
        <span><i className="composition-dot composition-late" />Late (passengers wait)</span>
      </div>

      <div className="otw-grid" role="table" aria-label="Line-level on-time window breakdown">
        <div className="otw-grid-head" role="row">
          <span role="columnheader">Line</span>
          <span role="columnheader">Distribution</span>
          <span role="columnheader">Off-schedule</span>
          <span role="columnheader">Sample</span>
        </div>

        {rows.map((row) => {
          const lineColor = row.isSystem ? "var(--muted)" : getLineColor(row.line);
          return (
            <div key={row.line} className={`otw-grid-row ${row.isSystem ? "is-system" : ""}`} role="row">
              <span className="otw-line-cell" role="cell">
                <i className="otw-line-swatch" style={{ backgroundColor: lineColor }} aria-hidden="true" />
                {row.line}
              </span>

              <div className="otw-bar-wrap" role="cell">
                <div className="composition-bar">
                  <div
                    className="composition-segment composition-early"
                    style={{ width: `${row.earlyPct}%` }}
                    title={`Early: ${formatPct(row.earlyPct)} (${formatCount(row.earlyEvents)} events)`}
                  />
                  <div
                    className="composition-segment composition-on-time"
                    style={{ width: `${row.onTimePct}%` }}
                    title={`On-time: ${formatPct(row.onTimePct)} (${formatCount(row.onTimeEvents)} events)`}
                  />
                  <div
                    className="composition-segment composition-late"
                    style={{ width: `${row.latePct}%` }}
                    title={`Late: ${formatPct(row.latePct)} (${formatCount(row.lateEvents)} events)`}
                  />
                </div>
                <div className="otw-row-metrics">
                  <span className="otw-early-text">E {formatPct(row.earlyPct)}</span>
                  <span className="otw-ontime-text">O {formatPct(row.onTimePct)}</span>
                  <span className="otw-late-text">L {formatPct(row.latePct)}</span>
                </div>
              </div>

              <span className="otw-offschedule" role="cell">{formatPct(row.offSchedulePct)}</span>
              <span className="otw-sample" role="cell">{formatCount(row.totalEvents)} trips</span>
            </div>
          );
        })}
      </div>

      <p className="card-footnote">
        {topEarlyRow
          ? `Early-arrival watch: ${topEarlyRow.line} has the highest early share at ${formatPct(topEarlyRow.earlyPct)}.`
          : "Early-arrival watch unavailable."}{" "}
        Use this with the line-level heatmap to identify where these off-schedule events concentrate.
      </p>
    </section>
  );
}

export default OnTimeWindowBreakdown;
