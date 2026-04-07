import { max, min, scaleLinear } from "d3";
import { getLineColor } from "../design/transit";

function Sparkline({ points = [], yDomain = [0, 100] }) {
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

  const low = Number.isFinite(yDomain?.[0]) ? Number(yDomain[0]) : min(values) ?? 0;
  const high = Number.isFinite(yDomain?.[1]) ? Number(yDomain[1]) : max(values) ?? 100;
  const yScale = scaleLinear()
    .domain([low === high ? low - 1 : low, low === high ? high + 1 : high])
    .range([height - padding, padding]);

  const xStep = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const latestPoint = points[points.length - 1];
  const latestX = padding + (points.length - 1) * xStep;
  const latestY = yScale(Number(latestPoint.value));
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
      <circle cx={latestX} cy={latestY} r={2.1} fill="currentColor" />
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

function formatPct(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "NA";
}

function formatMinutes(value) {
  if (!Number.isFinite(value)) {
    return "NA";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} min`;
}

function SystemScorecards({ title = "System Scorecards", cards = [] }) {
  const sharedSparkDomain = [0, 100];
  const deltaExplanation =
    "90d points = average OTP in the most recent 30 days minus average OTP in the first 30 days of the trailing 90-day window.";

  return (
    <section className="chart-card scorecard-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      <p className="card-subtitle">
        OTP = share of trips within MBTA's on-time window (-60s early to +300s late). Not Late = share of
        trips not more than 5 minutes late. Excess Wait = average actual headway minus scheduled headway.
      </p>
      <p className="card-footnote">
        Values are raw units. OTP sparkline uses a fixed 0-100% scale across lines. "pts (90d)" means:
        recent 30-day average OTP minus earliest 30-day average OTP in the same trailing 90-day window.
      </p>

      <div className="scorecard-grid">
        {cards.map((card) => (
          <article key={card.line} className="line-scorecard" style={{ "--line-color": getLineColor(card.line) }}>
            <div className="line-scorecard-head">
              <h3>{card.line}</h3>
              <span className="line-scorecard-date">{card.latestDate || "No date"}</span>
            </div>
            <div className="line-scorecard-metrics">
              <div className="line-scorecard-metric-row">
                <span className="line-scorecard-metric-label">OTP</span>
                <strong className="line-scorecard-metric-value">
                  {card.valueDisplay || formatPct(card.latestOtpPct)}
                </strong>
              </div>
              <div className="line-scorecard-metric-row">
                <span className="line-scorecard-metric-label">Not Late</span>
                <span className="line-scorecard-metric-value">{formatPct(card.latestNotLatePct)}</span>
              </div>
              <div className="line-scorecard-metric-row">
                <span className="line-scorecard-metric-label">Excess Wait</span>
                <span className="line-scorecard-metric-value">{formatMinutes(card.avgExcessWaitMin)}</span>
              </div>
            </div>
            <div
              className={`line-scorecard-delta ${
                Number.isFinite(card.delta90dPct) ? (card.delta90dPct >= 0 ? "positive" : "negative") : ""
              }`}
              title={deltaExplanation}
            >
              {formatDelta(card.delta90dPct, card.deltaLabel || "OTP pts (90d)")}
            </div>
            <Sparkline points={card.sparkline90d} yDomain={sharedSparkDomain} />
          </article>
        ))}
      </div>
    </section>
  );
}

export default SystemScorecards;
