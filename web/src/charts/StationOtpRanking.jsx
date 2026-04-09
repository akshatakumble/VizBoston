import { getLineColor } from "../design/transit";

function pct(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "NA";
  }
  return `${numeric.toFixed(1)}%`;
}

function count(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  return numeric.toLocaleString();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function StationOtpRanking({
  title = "Lowest OTP Stations",
  subtitle = "",
  cardClassName = "",
  data = [],
  minEvents = 200,
  otpTarget = 85,
}) {
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <section className={`chart-card ${cardClassName}`.trim()}>
        <h2>{title}</h2>
        <p>No stations meet the current ranking threshold under these filters.</p>
      </section>
    );
  }

  const targetLeft = `${clamp(Number(otpTarget) || 0, 0, 100)}%`;

  return (
    <section className={`chart-card ${cardClassName}`.trim()}>
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}

      <div className="station-ranking-wrap">
        <table className="station-ranking-table" aria-label={title}>
          <thead>
            <tr>
              <th>Station</th>
              <th>OTP % (lower is worse)</th>
              <th>Late Rate %</th>
              <th>Events</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const otpValue = Number(row.otpPct);
              const markerLeft = `${clamp(Number.isFinite(otpValue) ? otpValue : 0, 0, 100)}%`;
              const lineColor = getLineColor(row.line);
              return (
                <tr key={`${row.line}-${row.station}`}>
                  <th scope="row">
                    <span className="station-ranking-line" style={{ "--line-color": lineColor }}>
                      {row.line} · {row.station}
                    </span>
                  </th>
                  <td>
                    <div className="station-ranking-otp-cell">
                      <span className="station-ranking-otp-value">{pct(row.otpPct)}</span>
                      <span className="station-ranking-track" aria-hidden="true">
                        <span className="station-ranking-target" style={{ left: targetLeft }} />
                        <span
                          className="station-ranking-dot"
                          style={{ left: markerLeft, backgroundColor: lineColor }}
                        />
                      </span>
                    </div>
                  </td>
                  <td>{pct(row.lateRatePct)}</td>
                  <td>{count(row.totalEvents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="card-footnote">
        Ranked by lowest OTP under current filters. Only stations with at least {count(minEvents)} events are included. Target marker at {pct(otpTarget)}.
      </p>
    </section>
  );
}

export default StationOtpRanking;
