import { scaleLinear } from "d3";
import { useEffect, useState } from "react";

const LINE_COLORS = {
  Red: "#DA291C",
  Orange: "#ED8B00",
  Blue: "#003DA5",
  Green: "#00843D",
  Silver: "#7D7D7D",
};


function clamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

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

function dotRadiusBySample(totalEvents) {
  if (totalEvents < 5000) {
    return 3;
  }
  if (totalEvents <= 50000) {
    return 5;
  }
  return 7;
}

function severityColor(gapToTarget) {
  const belowBy = Math.max(0, -gapToTarget);
  if (belowBy >= 55) {
    return "#b2182b";
  }
  if (belowBy >= 45) {
    return "#d6604d";
  }
  if (belowBy >= 25) {
    return "#f4a582";
  }
  return "#fddbc7";
}

function tooltipPosition(clientX, clientY) {
  const tooltipWidth = 232;
  const tooltipHeight = 162;
  const offset = 14;
  const maxLeft = window.innerWidth - tooltipWidth - 8;
  const maxTop = window.innerHeight - tooltipHeight - 8;
  return {
    left: clamp(clientX + offset, 8, Math.max(8, maxLeft)),
    top: clamp(clientY + offset, 8, Math.max(8, maxTop)),
  };
}

function StationOtpRanking({
  title = "Lowest OTP Stations",
  subtitle = "",
  cardClassName = "",
  data = [],
  minEvents = 200,
  otpTarget = 85,
  onStationSelect,
}) {
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  const [tooltip, setTooltip] = useState(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const safeTarget = clamp(Number(otpTarget) || 0, 0, 100);

  const rows = (Array.isArray(data) ? data : []).map((row, index) => {
    const otpValue = clamp(Number(row.otpPct) || 0, 0, 100);
    const totalEvents = Math.max(0, Number(row.totalEvents) || 0);
    const gap = otpValue - safeTarget;
    return {
      ...row,
      otpValue,
      totalEvents,
      gap,
      rank: index + 1,
    };
  });

  if (rows.length === 0) {
    return (
      <section className={`chart-card ${cardClassName}`.trim()}>
        <h2>{title}</h2>
        <p>No stations meet the current ranking threshold under these filters.</p>
      </section>
    );
  }

  const rowHeight = rows.length > 12 ? 26 : 30;
  const plotWidth = 620;
  const leftLabelWidth = viewportWidth < 900 ? 230 : 320;
  const margin = { top: 34, right: 16, bottom: 32, left: leftLabelWidth };
  const plotHeight = rows.length * rowHeight;
  const width = margin.left + plotWidth + margin.right;
  const height = margin.top + plotHeight + margin.bottom;

  const xScale = scaleLinear().domain([0, 100]).range([0, plotWidth]);
  const targetX = xScale(safeTarget);
  const ticks = [0, 20, 40, 60, 80, 100];

  const labelForRow = (row) => {
    const full = `${row.station}`;
    if (viewportWidth >= 900) {
      return full;
    }
    const maxChars = 28;
    return full.length > maxChars ? `${full.slice(0, maxChars - 1)}...` : full;
  };

  const handlePointerMove = (event, row, index) => {
    const nextPosition = tooltipPosition(event.clientX, event.clientY);
    setHoveredIndex(index);
    setTooltip({
      row,
      left: nextPosition.left,
      top: nextPosition.top,
    });
  };

  const clearHover = () => {
    setHoveredIndex(-1);
    setTooltip(null);
  };

  return (
    <section className={`chart-card ${cardClassName}`.trim()}>
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}

      <div className="station-lollipop-wrap">
        <svg
          className="station-lollipop-plot"
          width={Math.max(700, width)}
          height={height}
          role="img"
          aria-label={`${title}: lollipop chart of lowest station OTP versus ${safeTarget}% target`}
        >
          <g transform={`translate(${margin.left},${margin.top})`}>
            <text x={0} y={-16} className="station-lollipop-header">
              Station OTP vs {pct(safeTarget)} target
            </text>

            {/* Direct numeric x-scale and target line reduce chartjunk while preserving context. */}
            {ticks.map((tick) => (
              <g key={tick} transform={`translate(${xScale(tick)},0)`}>
                <line y1={0} y2={plotHeight} className="station-lollipop-grid" />
                <text y={plotHeight + 20} className="axis-tick-label" textAnchor="middle">
                  {tick}%
                </text>
              </g>
            ))}

            <line x1={targetX} x2={targetX} y1={0} y2={plotHeight} className="station-lollipop-target" />
            <text x={targetX + 6} y={-6} className="station-lollipop-target-label">
              {pct(safeTarget)} target
            </text>

            {rows.map((row, index) => {
              const y = index * rowHeight + rowHeight / 2;
              const dotX = xScale(row.otpValue);
              const lineColor = LINE_COLORS[row.line] || "#7D7D7D";
              const stemColor = severityColor(row.gap);
              const radius = dotRadiusBySample(row.totalEvents);
              const hovered = index === hoveredIndex;
              const rowLabel = labelForRow(row);

              return (
                <g
                  key={`${row.line}-${row.station}`}
                  className="station-lollipop-row"
                  onMouseMove={(event) => handlePointerMove(event, row, index)}
                  onMouseLeave={clearHover}
                  onClick={() => onStationSelect?.(row.station)}
                  role={onStationSelect ? "button" : undefined}
                  tabIndex={onStationSelect ? 0 : undefined}
                  onKeyDown={(event) => {
                    if (!onStationSelect) {
                      return;
                    }
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onStationSelect(row.station);
                    }
                  }}
                >
                  <rect
                    x={-margin.left}
                    y={y - rowHeight / 2 + 1}
                    width={margin.left + plotWidth + margin.right}
                    height={rowHeight - 2}
                    className={hovered ? "station-lollipop-row-highlight" : "station-lollipop-row-bg"}
                  />

                  <line x1={-margin.left + 10} x2={-margin.left + 10} y1={y - 8} y2={y + 8} stroke={lineColor} strokeWidth="4" />

                  <text
                    x={-margin.left + 22}
                    y={y + 4}
                    className="station-lollipop-label"
                    textAnchor="start"
                    title={row.station}
                  >
                    {rowLabel}
                  </text>

                  {/* Stem length is proportional to OTP; dot size encodes sample size confidence once. */}
                  <line x1={0} x2={dotX} y1={y} y2={y} className="station-lollipop-stem" style={{ stroke: stemColor }} />

                  <circle
                    cx={dotX}
                    cy={y}
                    r={radius}
                    className="station-lollipop-dot"
                    style={{ fill: stemColor }}
                  />

                  <text
                    x={dotX + 10}
                    y={y + 4}
                    className="station-lollipop-value"
                    textAnchor="start"
                  >
                    {pct(row.otpValue)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {tooltip ? (
          /* Single tooltip consolidates detail-on-demand without duplicating encodings in the chart body. */
          <>
          <div className="station-lollipop-tooltip" style={{ left: `${tooltip.left}px`, top: `${tooltip.top}px` }}>
            <h4>{tooltip.row.station}</h4>
            <ul>
              <li>
                <span>Line</span>
                <strong>{tooltip.row.line}</strong>
              </li>
              <li>
                <span>OTP</span>
                <strong>{pct(tooltip.row.otpValue)}</strong>
              </li>
              <li>
                <span>Gap to Target</span>
                <strong>{`${tooltip.row.gap >= 0 ? "+" : ""}${tooltip.row.gap.toFixed(1)} pts`}</strong>
              </li>
              <li>
                <span>Events</span>
                <strong>{count(tooltip.row.totalEvents)}</strong>
              </li>
              <li>
                <span>Rank</span>
                <strong>#{tooltip.row.rank}</strong>
              </li>
            </ul>
          </div>
          </>
        ) : null}
      </div>

      <p className="card-footnote">
        Lollipop length encodes OTP on a 0%-100% scale. Dot diameter encodes sample size (6px: &lt;5,000; 10px: 5,000-50,000; 14px: &gt;50,000). Minimum sample threshold: {count(minEvents)} events.
      </p>
    </section>
  );
}

export default StationOtpRanking;
