import { max, median, min } from "d3";

const BRANCH_LABELS = {
  "Green-B": "Boston College",
  "Green-C": "Cleveland Circle",
  "Green-D": "Riverside",
  "Green-E": "Heath Street",
};

function GreenBranchComparisonChart({
  title = "Green Line Branch Headway Comparison",
  subtitle = "Sample-weighted observed headway by branch. Scheduled headway is 6.5 min during peak hours.",
  data = [],
  targetMin = 6.5,
}) {
  const rows = data
    .map((row) => ({
      branch: String(row.branch || ""),
      headwayMin: Number(row.headwayMin),
      sampleCount: Math.max(0, Number(row.sampleCount) || 0),
      ciLowMin: Number.isFinite(Number(row.ciLowMin)) ? Number(row.ciLowMin) : null,
      ciHighMin: Number.isFinite(Number(row.ciHighMin)) ? Number(row.ciHighMin) : null,
    }))
    .filter((row) => row.branch && Number.isFinite(row.headwayMin))
    .sort((left, right) => left.headwayMin - right.headwayMin);

  if (rows.length === 0) {
    return (
      <section className="chart-card">
        <h2>{title}</h2>
        <p>No branch comparison data available.</p>
      </section>
    );
  }

  const maxObserved = max(rows, (row) => Math.max(row.headwayMin, row.ciHighMin ?? row.headwayMin, targetMin)) ?? 1;
  const minObserved = min(rows, (row) => Math.min(row.headwayMin, row.ciLowMin ?? row.headwayMin, targetMin)) ?? 0;
  const domainPadding = 0.12;
  const domainMin = Math.max(0, minObserved - domainPadding);
  const domainMax = maxObserved + domainPadding;
  const domainSpan = Math.max(0.01, domainMax - domainMin);
  const medianHeadway = median(rows, (row) => row.headwayMin);
  const systemAverageHeadway =
    rows.reduce((total, row) => total + row.headwayMin * Math.max(1, row.sampleCount), 0) /
    rows.reduce((total, row) => total + Math.max(1, row.sampleCount), 0);
  const minHeadway = rows[0]?.headwayMin ?? null;
  const maxHeadway = rows[rows.length - 1]?.headwayMin ?? null;
  const rangeSpan =
    minHeadway !== null && maxHeadway !== null ? Math.max(0, maxHeadway - minHeadway) : null;

  const branchCode = (branch) => branch.replace("Green-", "Green-");
  const pctOverScheduled = (value) =>
    targetMin > 0 ? Math.max(0, ((value - targetMin) / targetMin) * 100) : 0;
  const markerLeftPct = Math.min(100, Math.max(0, ((targetMin - domainMin) / domainSpan) * 100));

  const keyInsight =
    rows.length > 0
      ? `All branches run ${Math.round(pctOverScheduled(rows[0].headwayMin))}-${Math.round(
          pctOverScheduled(rows[rows.length - 1].headwayMin)
        )}% slower than scheduled. ${rows[rows.length - 1].branch} has the longest wait at ${rows[
          rows.length - 1
        ].headwayMin.toFixed(1)} min, while ${rows[0].branch} performs best at ${rows[0].headwayMin.toFixed(
          1
        )} min.`
      : "";

  return (
    <section className="chart-card green-branch-ref-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}

      <div className="green-branch-rows" role="img" aria-label={title}>
        {rows.map((row) => {
          const barWidthPct = Math.min(
            100,
            Math.max(2, ((row.headwayMin - domainMin) / domainSpan) * 100)
          );
          const overMin = row.headwayMin - targetMin;
          const overPct = pctOverScheduled(row.headwayMin);
          return (
            <article key={row.branch} className="green-branch-row">
              <div className="green-branch-left">
                <div className="green-branch-name-row">
                  <span className="green-branch-chip">{branchCode(row.branch)}</span>
                  <strong>{BRANCH_LABELS[row.branch] || row.branch}</strong>
                </div>
                <p>n = {(row.sampleCount / 1_000_000).toFixed(1)}M observations</p>
              </div>

              <div className="green-branch-bar-wrap">
                <div className="green-branch-bar-track">
                  <span className="green-branch-scheduled-marker" style={{ left: `${markerLeftPct}%` }} />
                  <span className="green-branch-bar-fill" style={{ width: `${barWidthPct}%` }}>
                    <title>{`${row.branch}: ${row.headwayMin.toFixed(2)} min`}</title>
                  </span>
                  {row.ciLowMin !== null && row.ciHighMin !== null ? (
                    <span
                      className="green-branch-ci-line"
                      style={{
                        left: `${((row.ciLowMin - domainMin) / domainSpan) * 100}%`,
                        width: `${Math.max(
                          0.3,
                          ((row.ciHighMin - row.ciLowMin) / domainSpan) * 100
                        )}%`,
                      }}
                    />
                  ) : null}
                </div>
              </div>

              <div className="green-branch-right">
                <strong>{row.headwayMin.toFixed(1)} min</strong>
              </div>
              <div className="green-branch-delta">
                <strong>{`+${overMin.toFixed(1)} min`}</strong>
                <span>{`${Math.round(overPct)}% over scheduled`}</span>
              </div>
            </article>
          );
        })}
      </div>

      <div className="green-branch-legend-row">
        <span>
          <i className="obs" /> Observed headway
        </span>
        <span>
          <i className="sched" /> Scheduled ({targetMin.toFixed(1)} min)
        </span>
      </div>

      <div className="green-branch-summary">
        <span>
          Scheduled headway: <strong>{targetMin.toFixed(1)} min</strong>
        </span>
        <span>
          System median: <strong>{medianHeadway?.toFixed(1) || "NA"} min</strong>
        </span>
        <span>
          System avg: <strong>{systemAverageHeadway.toFixed(1)} min</strong>
        </span>
        <span>
          Range:{" "}
          <strong>
            {rangeSpan !== null ? `${rangeSpan.toFixed(1)} min (${minHeadway?.toFixed(1)} - ${maxHeadway?.toFixed(1)})` : "NA"}
          </strong>
        </span>
      </div>

      <div className="green-branch-insight">
        <strong>Key insight:</strong> {keyInsight}
      </div>

      <p className="card-footnote">
        Branches are sorted best-to-worst (lowest to highest headway). Bars are scaled to the observed branch range to make differences easier to compare. CI markers render when confidence bounds are available.
      </p>
    </section>
  );
}

export default GreenBranchComparisonChart;
