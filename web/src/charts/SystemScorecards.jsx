import { max, min, scaleLinear } from "d3";
import { getLineColor } from "../design/transit";

function Sparkline({ points = [] }) {
  if (!Array.isArray(points) || points.length === 0) {
    return <div className="scorecard-sparkline-empty">No trend data</div>;
  }

  const width = 132;
  const height = 42;
  const padding = 4;
  const values = points.map((point) => Number(point.value)).filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return <div className="scorecard-sparkline-empty">No trend data</div>;
  }

  const low = min(values) ?? 0;
  const high = max(values) ?? 100;
  const yScale = scaleLinear()
    .domain([low === high ? low - 1 : low, low === high ? high + 1 : high])
    .range([height - padding, padding]);

  const xStep = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const path = points
    .map((point, index) => {
      const x = padding + index * xStep;
      const y = yScale(Number(point.value));
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="scorecard-sparkline" role="img" aria-label="90-day trend">
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  );
}

function formatDelta(delta, label = "pts (90d)") {
  if (!Number.isFinite(delta)) {
    return `No ${label} baseline`;
  }
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)} ${label}`;
}

function SystemScorecards({ title = "System Scorecards", cards = [] }) {
  return (
    <section className="chart-card scorecard-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      <p className="card-subtitle">Latest available OTP by line with a trailing 90-day trend sparkline</p>

      <div className="scorecard-grid">
        {cards.map((card) => (
          <article key={card.line} className="line-scorecard" style={{ "--line-color": getLineColor(card.line) }}>
            <div className="line-scorecard-head">
              <h3>{card.line}</h3>
              <span className="line-scorecard-date">{card.latestDate || "No date"}</span>
            </div>
            <div className="line-scorecard-main">
              <strong>
                {card.valueDisplay
                  ? card.valueDisplay
                  : Number.isFinite(card.latestOtpPct)
                    ? `${card.latestOtpPct.toFixed(1)}%`
                    : "No data"}
              </strong>
              <span>{card.metricLabel || "OTP"}</span>
            </div>
            <div
              className={`line-scorecard-delta ${
                Number.isFinite(card.delta90dPct) ? (card.delta90dPct >= 0 ? "positive" : "negative") : ""
              }`}
            >
              {formatDelta(card.delta90dPct, card.deltaLabel || "pts (90d)")}
            </div>
            <Sparkline points={card.sparkline90d} />
          </article>
        ))}
      </div>
    </section>
  );
}

export default SystemScorecards;
