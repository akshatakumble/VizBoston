import { max, mean, scaleBand, scaleLinear } from "d3";
import { getLineColor } from "../design/transit";

function HeadwayBoxPlot({
  title = "Headway Distribution",
  subtitle = "",
  data = [],
  cardClassName = "",
  width = 1120,
  height = 380,
  sortByMedian = true,
}) {
  const margin = { top: 18, right: 20, bottom: 90, left: 56 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const periodOrder = ["Peak", "Off-Peak"];
  const normalizePeriod = (value) => {
    const text = String(value || "").trim().toLowerCase();
    if (text.includes("peak") && text.includes("off")) {
      return "Off-Peak";
    }
    if (text === "peak" || text.includes("pk")) {
      return "Peak";
    }
    if (text.includes("off")) {
      return "Off-Peak";
    }
    return "Peak";
  };

  if (!Array.isArray(data) || data.length === 0) {
    return (
      <section className={`chart-card ${cardClassName}`.trim()}>
        <h2>{title}</h2>
        <p>No distribution data available.</p>
      </section>
    );
  }

  const rows = data
    .map((row) => ({
      line: String(row.line || "").trim(),
      period: normalizePeriod(row.periodGroup),
      p10: Number(row.p10),
      p90: Number(row.p90),
      q1: Number(row.q1),
      q3: Number(row.q3),
      median: Number(row.median),
      max: Number(row.max),
      count: Number(row.count) || 0,
    }))
    .filter(
      (row) =>
        row.line &&
        Number.isFinite(row.p10) &&
        Number.isFinite(row.p90) &&
        Number.isFinite(row.q1) &&
        Number.isFinite(row.q3) &&
        Number.isFinite(row.median)
    );

  if (rows.length === 0) {
    return (
      <section className={`chart-card ${cardClassName}`.trim()}>
        <h2>{title}</h2>
        <p>No valid distribution rows available.</p>
      </section>
    );
  }

  const lineSet = Array.from(new Set(rows.map((row) => row.line)));
  const lineScores = new Map(
    lineSet.map((line) => [
      line,
      mean(
        rows
          .filter((row) => row.line === line)
          .map((row) => row.median)
      ) || 0,
    ])
  );
  const lineOrder = sortByMedian
    ? lineSet.slice().sort((left, right) => (lineScores.get(left) || 0) - (lineScores.get(right) || 0))
    : lineSet.slice().sort((left, right) => left.localeCompare(right));

  const xLineScale = scaleBand().domain(lineOrder).range([0, innerWidth]).padding(0.28);
  const xPeriodScale = scaleBand().domain(periodOrder).range([0, xLineScale.bandwidth()]).padding(0.34);

  const yCoreMax = max(rows, (row) => Math.max(row.p90, row.q3, row.median)) ?? 1;
  const yDomainMax = yCoreMax * 1.12;
  const yScale = scaleLinear().domain([0, yDomainMax]).range([innerHeight, 0]).nice();
  const yTicks = yScale.ticks(5);
  const lineIqrMap = new Map(
    lineOrder.map((line) => {
      const iqrs = rows.filter((row) => row.line === line).map((row) => row.q3 - row.q1);
      return [line, mean(iqrs) || 0];
    })
  );
  const silverIqr = lineIqrMap.get("Silver") || null;
  const nonSilverIqrs = Array.from(lineIqrMap.entries())
    .filter(([line]) => line !== "Silver")
    .map(([, iqr]) => iqr);
  const nonSilverAvgIqr = nonSilverIqrs.length ? mean(nonSilverIqrs) : null;
  const silverRatio =
    silverIqr !== null && nonSilverAvgIqr !== null && nonSilverAvgIqr > 0
      ? silverIqr / nonSilverAvgIqr
      : null;
  const peakSilverMedian =
    rows.find((row) => row.line === "Silver" && row.period === "Peak")?.median ?? null;
  const bestPeakMedian = minFinite(
    rows.filter((row) => row.period === "Peak").map((row) => row.median)
  );

  return (
    <section className={`chart-card ${cardClassName}`.trim()}>
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
      <div className="headway-box-legend" aria-label="Headway period and marker legend">
        <span>
          <i className="peak" />
          Peak hours (filled)
        </span>
        <span>
          <i className="offpeak" />
          Off-peak (outline)
        </span>
        <span>
          <i className="triangle">▲</i>
          Max beyond scale (extreme waits)
        </span>
      </div>

      <div className="chart-frame">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {yTicks.map((tick) => (
              <g key={tick} transform={`translate(0,${yScale(tick)})`}>
                <line x1={0} x2={innerWidth} className="axis-grid-line" />
                <text x={-10} y={4} className="axis-tick-label axis-tick-label-y" textAnchor="end">
                  {tick.toFixed(1)} min
                </text>
              </g>
            ))}

            {rows.map((row) => {
              const lineX = xLineScale(row.line) || 0;
              const periodX = xPeriodScale(row.period) || 0;
              const x = lineX + periodX;
              const boxWidth = xPeriodScale.bandwidth();
              const center = x + boxWidth / 2;
              const lineColor = getLineColor(row.line);
              const whiskerLow = row.p10;
              const whiskerHigh = row.p90;
              const isPeak = row.period === "Peak";
              const isClipped = Number.isFinite(row.max) && row.max > yScale.domain()[1];
              return (
                <g key={`${row.line}-${row.period}`}>
                  <line x1={center} x2={center} y1={yScale(whiskerLow)} y2={yScale(whiskerHigh)} className="boxplot-whisker" />
                  <line x1={x + 4} x2={x + boxWidth - 4} y1={yScale(whiskerLow)} y2={yScale(whiskerLow)} className="boxplot-cap" />
                  <line x1={x + 4} x2={x + boxWidth - 4} y1={yScale(whiskerHigh)} y2={yScale(whiskerHigh)} className="boxplot-cap" />
                  <rect
                    x={x}
                    y={yScale(row.q3)}
                    width={boxWidth}
                    height={Math.max(1, yScale(row.q1) - yScale(row.q3))}
                    fill={isPeak ? lineColor : "transparent"}
                    fillOpacity={isPeak ? 0.25 : 0}
                    stroke={lineColor}
                    strokeWidth={1.5}
                    strokeDasharray={isPeak ? "none" : "4 2"}
                  />
                  <line x1={x} x2={x + boxWidth} y1={yScale(row.median)} y2={yScale(row.median)} className="boxplot-median" />
                  {isClipped ? (
                    <path
                      d={`M ${center - 4} 2 L ${center + 4} 2 L ${center} 8 Z`}
                      fill="#d18a21"
                      opacity={0.9}
                    />
                  ) : null}
                  <text
                    x={center}
                    y={yScale(row.median) - 6}
                    className="headway-box-median-label"
                    textAnchor="middle"
                  >
                    {`${row.median.toFixed(0)}m`}
                  </text>
                  <title>
                    {`${row.line} ${row.period}: p10 ${whiskerLow.toFixed(1)}m, q1 ${row.q1.toFixed(
                      1
                    )}m, median ${row.median.toFixed(1)}m, q3 ${row.q3.toFixed(1)}m, max ${row.max.toFixed(
                      1
                    )}m, n=${row.count}`}
                  </title>
                </g>
              );
            })}

            {lineOrder.map((line) => {
              const lineX = xLineScale(line) || 0;
              const center = lineX + xLineScale.bandwidth() / 2;
              return (
                <g key={`line-label-${line}`}>
                  <line
                    x1={lineX}
                    x2={lineX + xLineScale.bandwidth()}
                    y1={innerHeight + 20}
                    y2={innerHeight + 20}
                    className="axis-line"
                  />
                  <text
                    x={lineX + (xPeriodScale("Peak") || 0) + xPeriodScale.bandwidth() / 2}
                    y={innerHeight + 13}
                    className="axis-tick-label axis-tick-label-x"
                    textAnchor="middle"
                  >
                    Peak
                  </text>
                  <text
                    x={lineX + (xPeriodScale("Off-Peak") || 0) + xPeriodScale.bandwidth() / 2}
                    y={innerHeight + 13}
                    className="axis-tick-label axis-tick-label-x"
                    textAnchor="middle"
                  >
                    Off-pk
                  </text>
                  <text
                    x={center}
                    y={innerHeight + 36}
                    className="axis-tick-label axis-tick-label-x headway-box-line-label"
                    textAnchor="middle"
                    fill={getLineColor(line)}
                  >
                    {line}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {silverRatio !== null && peakSilverMedian !== null && bestPeakMedian !== null ? (
        <div className="headway-box-insight">
          <strong>Key finding:</strong> Silver Line IQR spread is about {silverRatio.toFixed(1)}x other lines, and its peak median headway
          ({peakSilverMedian.toFixed(0)} min) is substantially above the best peak performer ({bestPeakMedian.toFixed(0)} min).
        </div>
      ) : null}

      <p className="card-footnote">
        Whiskers show P10-P90. Triangles mark cases where observed maximum headway exceeds the plotted y-range.
        {sortByMedian ? " Line groups are ordered by median headway (best to worst)." : ""}
      </p>
    </section>
  );
}

function minFinite(values = []) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) {
    return null;
  }
  return valid.reduce((minimum, value) => Math.min(minimum, value), Number.POSITIVE_INFINITY);
}

export default HeadwayBoxPlot;
