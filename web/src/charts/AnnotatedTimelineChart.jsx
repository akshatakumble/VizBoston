import { useMemo } from "react";
import { line as d3Line, max, min, scaleLinear, scalePoint } from "d3";

function AnnotatedTimelineChart({
  title = "Annotated Timeline",
  subtitle = "",
  data = [],
  markers = [],
  xKey = "season",
  yKey = "value",
  yTickFormatter = (value) => `${Number(value).toFixed(1)}%`,
  metricFormatter = (value) => `${Number(value).toFixed(1)}%`,
  width = 760,
  height = 320,
}) {
  const margin = { top: 26, right: 24, bottom: 56, left: 56 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const normalized = useMemo(
    () =>
      data
        .map((row) => ({
          ...row,
          __x: String(row[xKey]),
          __y: Number(row[yKey]),
        }))
        .filter((row) => row.__x && Number.isFinite(row.__y)),
    [data, xKey, yKey]
  );

  if (normalized.length === 0) {
    return (
      <section className="chart-card">
        <h2>{title}</h2>
        <p>No timeline data available.</p>
      </section>
    );
  }

  const xDomain = Array.from(new Set(normalized.map((row) => row.__x)));
  const xScale = scalePoint().domain(xDomain).range([0, innerWidth]).padding(0.35);
  const yMin = min(normalized, (row) => row.__y) ?? 0;
  const yMax = max(normalized, (row) => row.__y) ?? 1;
  const yFloor = yMin > 0 ? 0 : yMin;
  const yScale = scaleLinear().domain([yFloor, yMax]).nice().range([innerHeight, 0]);
  const yTicks = yScale.ticks(5);

  const linePath = d3Line()
    .x((row) => xScale(row.__x))
    .y((row) => yScale(row.__y))(normalized);

  const markerRows = markers.filter((row) => xScale(String(row[xKey])) !== undefined);

  return (
    <section className="chart-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}

      <div className="chart-frame">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {yTicks.map((tick) => (
              <g key={tick} transform={`translate(0,${yScale(tick)})`}>
                <line x1={0} x2={innerWidth} className="axis-grid-line" />
                <text x={-10} y={4} className="axis-tick-label axis-tick-label-y" textAnchor="end">
                  {yTickFormatter(tick)}
                </text>
              </g>
            ))}

            {xDomain.map((season) => (
              <g key={season} transform={`translate(${xScale(season)},${innerHeight})`}>
                <line y1={0} y2={6} className="axis-tick-mark" />
                <text y={20} className="axis-tick-label axis-tick-label-x" textAnchor="middle">
                  {season}
                </text>
              </g>
            ))}

            {markerRows.map((marker) => {
              const x = xScale(String(marker[xKey]));
              return (
                <g key={`${marker[xKey]}-${marker.label || marker.title || "event"}`}>
                  <line x1={x} x2={x} y1={0} y2={innerHeight} className="timeline-marker-line" />
                  <text
                    x={x}
                    y={-6}
                    textAnchor="middle"
                    className="timeline-marker-label"
                    transform={`rotate(-35 ${x} -6)`}
                  >
                    {marker.label || marker.title || "Event"}
                  </text>
                </g>
              );
            })}

            <path d={linePath || ""} className="timeline-main-line" />
            {normalized.map((row, index) => (
              <circle
                key={`${row.__x}-${index}`}
                cx={xScale(row.__x)}
                cy={yScale(row.__y)}
                r={4}
                className="timeline-point"
              >
                <title>{`${row.__x}: ${metricFormatter(row.__y)}`}</title>
              </circle>
            ))}
          </g>
        </svg>
      </div>

      {markerRows.length > 0 ? (
        <div className="timeline-notes">
          {markerRows.map((marker) => (
            <article key={`${marker[xKey]}-${marker.label || marker.title || "event"}-note`}>
              <h3>
                {marker[xKey]}: {marker.label || marker.title || "Event"}
              </h3>
              <p>{marker.description || marker.note || ""}</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default AnnotatedTimelineChart;
