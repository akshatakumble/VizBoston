import { max, min, scaleLinear } from "d3";
import { getLineColor } from "../design/transit";

function Sparkline({ points = [], yDomain = [0, 100], target = null }) {
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
  const targetValue = Number.isFinite(target) ? Number(target) : null;
  const showTarget = targetValue !== null && targetValue >= low && targetValue <= high;
  const targetY = showTarget ? yScale(targetValue) : null;

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
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="scorecard-sparkline"
      role="img"
      aria-label="90-day OTP trend (0-100% scale with 85% target guide)"
    >
      {showTarget ? (
        <line
          x1={padding}
          x2={width - padding}
          y1={targetY}
          y2={targetY}
          className="scorecard-sparkline-target"
        />
      ) : null}
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

function formatDateLabel(value) {
  if (!value) {
    return "No date";
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function daysBetween(start, end) {
  if (!start || !end) {
    return null;
  }
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }
  const diffMs = endDate.getTime() - startDate.getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

function SystemScorecards({ title = "System Scorecards", cards = [] }) {
  const sharedSparkDomain = [0, 100];
  const otpTargetPct = 85;
  const deltaExplanation =
    "90d points = average OTP in the most recent 30 days minus average OTP in the first 30 days of the trailing 90-day window.";
  const latestDates = cards
    .map((card) => card.latestDate)
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort();
  const newestDate = latestDates.length > 0 ? latestDates[latestDates.length - 1] : null;
  const staleCards = newestDate
    ? cards
        .filter((card) => card.latestDate && card.latestDate < newestDate)
        .map((card) => ({
          line: card.line,
          latestDate: card.latestDate,
          lagDays: daysBetween(card.latestDate, newestDate),
        }))
    : [];
  const freshnessSummary =
    staleCards.length > 0
      ? staleCards
          .map((card) =>
            Number.isFinite(card.lagDays)
              ? `${card.line} (${formatDateLabel(card.latestDate)}, ${card.lagDays}d earlier)`
              : `${card.line} (${formatDateLabel(card.latestDate)})`
          )
          .join("; ")
      : null;

  return (
    <section className="chart-card scorecard-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      <p className="card-subtitle">
        OTP is the primary reliability metric. Not Late is more lenient because it ignores early arrivals and
        counts trips up to 5 minutes late as acceptable. Excess Wait is actual headway minus scheduled headway
        (positive values mean riders waited longer than expected).
      </p>
      <p className="card-footnote">
        OTP sparklines use a fixed 0-100% scale with an {otpTargetPct}% target guide. "pts (90d)" means:
        recent 30-day average OTP minus earliest 30-day average OTP in the same trailing 90-day window.
      </p>
      {freshnessSummary ? (
        <p className="card-footnote">
          Latest common data date is {formatDateLabel(newestDate)}. Older line snapshots: {freshnessSummary}.
        </p>
      ) : null}

      <div className="scorecard-grid">
        {cards.map((card) => (
          <article key={card.line} className="line-scorecard" style={{ "--line-color": getLineColor(card.line) }}>
            <div className="line-scorecard-head">
              <h3>{card.line}</h3>
              <span className="line-scorecard-date">{formatDateLabel(card.latestDate)}</span>
            </div>
            <div className="line-scorecard-metrics">
              <div className="line-scorecard-metric-row line-scorecard-metric-row-primary">
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
                <span
                  className={`line-scorecard-metric-value ${
                    Number.isFinite(card.avgExcessWaitMin)
                      ? card.avgExcessWaitMin > 0
                        ? "negative"
                        : card.avgExcessWaitMin < 0
                          ? "positive"
                          : ""
                      : ""
                  }`}
                >
                  {formatMinutes(card.avgExcessWaitMin)}
                </span>
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
            <Sparkline points={card.sparkline90d} yDomain={sharedSparkDomain} target={otpTargetPct} />
          </article>
        ))}
      </div>
    </section>
  );
}

export default SystemScorecards;
