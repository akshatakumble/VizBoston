import { getLineColor } from "../design/transit";

const METRICS = [
  { key: "otp_pct", label: "OTP %" },
  { key: "avg_headway_min", label: "Headway (min)" },
  { key: "travel_time_index", label: "Travel Index" },
  { key: "headway_cv_pct", label: "Headway CV %" },
  { key: "service_delivery_pct", label: "Delivery %" },
];

function polarToCartesian(centerX, centerY, radius, angleRadians) {
  return {
    x: centerX + radius * Math.cos(angleRadians),
    y: centerY + radius * Math.sin(angleRadians),
  };
}

function formatMetric(metricKey, value) {
  if (!Number.isFinite(value)) {
    return "No data";
  }
  if (metricKey.includes("pct")) {
    return `${value.toFixed(1)}%`;
  }
  if (metricKey.includes("index")) {
    return `${value.toFixed(2)}x`;
  }
  return `${value.toFixed(1)}`;
}

function RadarComparisonChart({
  title = "Line Comparison Radar",
  subtitle = "",
  data = [],
  width = 760,
  height = 360,
  onLineClick,
}) {
  const centerX = width / 2;
  const centerY = height / 2 + 8;
  const radius = Math.min(width, height) * 0.28;
  const angleStep = (Math.PI * 2) / METRICS.length;

  if (!Array.isArray(data) || data.length === 0) {
    return (
      <section className="chart-card">
        <h2>{title}</h2>
        <p>No comparison data available.</p>
      </section>
    );
  }

  const rings = [20, 40, 60, 80, 100];

  return (
    <section className="chart-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}

      <div className="chart-frame">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <g>
            {rings.map((ring) => (
              <circle
                key={ring}
                cx={centerX}
                cy={centerY}
                r={(ring / 100) * radius}
                fill="none"
                className="radar-ring"
              />
            ))}

            {METRICS.map((metric, index) => {
              const angle = -Math.PI / 2 + index * angleStep;
              const outer = polarToCartesian(centerX, centerY, radius + 16, angle);
              const axisEnd = polarToCartesian(centerX, centerY, radius, angle);
              return (
                <g key={metric.key}>
                  <line x1={centerX} y1={centerY} x2={axisEnd.x} y2={axisEnd.y} className="radar-axis" />
                  <text x={outer.x} y={outer.y} className="radar-axis-label" textAnchor="middle">
                    {metric.label}
                  </text>
                </g>
              );
            })}

            {data.map((lineRow) => {
              const points = METRICS.map((metric, index) => {
                const angle = -Math.PI / 2 + index * angleStep;
                const normalized = Number(lineRow.normalized?.[metric.key]);
                const scaled = Number.isFinite(normalized) ? Math.max(0, Math.min(100, normalized)) : 0;
                return polarToCartesian(centerX, centerY, (scaled / 100) * radius, angle);
              });
              const path = points
                .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
                .join(" ")
                .concat(" Z");

              return (
                <g
                  key={lineRow.line}
                  className="radar-line-group"
                  onClick={() => onLineClick?.(lineRow.line)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onLineClick?.(lineRow.line);
                    }
                  }}
                  role={onLineClick ? "button" : undefined}
                  tabIndex={onLineClick ? 0 : undefined}
                  aria-label={onLineClick ? `Open ${lineRow.line} detail view` : undefined}
                >
                  <path
                    d={path}
                    fill={getLineColor(lineRow.line)}
                    fillOpacity={0.14}
                    stroke={getLineColor(lineRow.line)}
                    strokeWidth={2}
                  />
                  {points.map((point, index) => (
                    <circle
                      key={`${lineRow.line}-${index}`}
                      cx={point.x}
                      cy={point.y}
                      r={3.2}
                      fill={getLineColor(lineRow.line)}
                      className="radar-point"
                    />
                  ))}
                  <text
                    x={centerX}
                    y={centerY + 16 + data.findIndex((item) => item.line === lineRow.line) * 16}
                    className="radar-line-label"
                    fill={getLineColor(lineRow.line)}
                  >
                    {lineRow.line}:{" "}
                    {METRICS.map((metric) => formatMetric(metric.key, lineRow.metrics?.[metric.key])).join(" | ")}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </section>
  );
}

export default RadarComparisonChart;
