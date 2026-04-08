import { useEffect, useState } from "react";
import BostonMap from "../components/BostonMap";
import LineChart from "../charts/LineChart";
import BarChart from "../charts/BarChart";
import AreaTrendChart from "../charts/AreaTrendChart";
import RadarComparisonChart from "../charts/RadarComparisonChart";
import SystemScorecards from "../charts/SystemScorecards";
import OtpCalendarHeatmap from "../charts/OtpCalendarHeatmap";
import OtpStationHeatmap from "../charts/OtpStationHeatmap";
import OnTimeWindowBreakdown from "../charts/OnTimeWindowBreakdown";
import StationOtpRanking from "../charts/StationOtpRanking";
import WaitTimeStationHeatmap from "../charts/WaitTimeStationHeatmap";
import HeadwayBoxPlot from "../charts/HeadwayBoxPlot";
import BunchingScatterChart from "../charts/BunchingScatterChart";
import GreenBranchComparisonChart from "../charts/GreenBranchComparisonChart";
import AnnotatedTimelineChart from "../charts/AnnotatedTimelineChart";
import Legend from "../charts/components/Legend";
import LoadingState from "../charts/components/LoadingState";
import TimeFilter from "../filters/TimeFilter";
import HighlightsPanel from "../components/HighlightsPanel";
import TravelSegmentDetailPanel from "../components/TravelSegmentDetailPanel";
import SlowZoneTable, { sortSlowZoneRows } from "../components/SlowZoneTable";
import { getLineLegendItems } from "../design/transit";
import { useDashboard } from "../context/DashboardContext";
import useDashboardData from "../data/useDashboardData";

function SectionHeading({ title, subtitle }) {
  return (
    <section className="section-heading">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </section>
  );
}

function DataErrorState({ message, onRetry }) {
  return (
    <section className="error-card" role="alert">
      <h3>Data could not be loaded</h3>
      <p>{message}</p>
      <button type="button" className="retry-button" onClick={onRetry}>
        Retry
      </button>
    </section>
  );
}

function SilverCoverageNotice({ selectedLine }) {
  if (selectedLine !== "Silver") {
    return null;
  }

  return (
    <section className="chart-card">
      <div className="card-header">
        <h2>Silver Line Coverage</h2>
      </div>
      <p className="card-subtitle">
        Silver views are powered by MBTA observed bus arrival/departure data (SL1-SL5 and legacy aliases),
        so OTP and reliability metrics remain observation-based end-to-end.
      </p>
    </section>
  );
}

function DashboardFilters({
  timePeriod,
  selectedStation,
  timePeriodOptions,
  stationOptions,
  onTimePeriodChange,
  onStationChange,
}) {
  return (
    <TimeFilter
      timePeriod={timePeriod}
      selectedStation={selectedStation}
      onTimePeriodChange={onTimePeriodChange}
      onStationChange={onStationChange}
      periodOptions={timePeriodOptions}
      stationOptions={stationOptions}
      showDateInputs={false}
    />
  );
}

function ReliabilityControls({
  dayType,
  onDayTypeChange,
}) {
  return (
    <section className="reliability-control-card">
      <div className="reliability-control-group">
        <h3>Day Type</h3>
        <div className="toggle-pill-group" role="tablist" aria-label="Weekday weekend toggle">
          {["All", "Weekday", "Weekend"].map((option) => (
            <button
              key={option}
              type="button"
              className={dayType === option ? "active" : ""}
              onClick={() => onDayTypeChange(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function DashboardPage() {
  const {
    selectedLine,
    setSelectedLine,
    activeSection,
    setActiveSection,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    timePeriod,
    setTimePeriod,
    selectedStation,
    setSelectedStation,
    timePeriodOptions,
  } = useDashboard();

  const [reliabilityDayType, setReliabilityDayType] = useState("All");
  const [otpHeatmapRowMode, setOtpHeatmapRowMode] = useState("worst20");
  const [reliabilityHeatmapMetric, setReliabilityHeatmapMetric] = useState("otp");
  const [waitHeatmapMetric, setWaitHeatmapMetric] = useState("headwayMin");
  const [waitHeatmapRowMode, setWaitHeatmapRowMode] = useState("worst20");
  const [selectedHeatmapCell, setSelectedHeatmapCell] = useState(null);
  const [selectedTravelSegmentId, setSelectedTravelSegmentId] = useState(null);
  const [slowZoneSortBy, setSlowZoneSortBy] = useState("travelTimeIndex");
  const [slowZoneSortDirection, setSlowZoneSortDirection] = useState("desc");
  const [commuterOriginKey, setCommuterOriginKey] = useState("");
  const [commuterPairKey, setCommuterPairKey] = useState("");
  const [commuterDepartureHour, setCommuterDepartureHour] = useState(8);
  const [historicalLeftPeriod, setHistoricalLeftPeriod] = useState("");
  const [historicalRightPeriod, setHistoricalRightPeriod] = useState("");

  const {
    loading,
    error,
    retry,
    overviewScorecards,
    overviewSystemTrend,
    overviewRadar,
    overviewHighlights,
    overviewGoalPct,
    reliabilityStationHourHeatmap,
    reliabilityCalendarHeatmap,
    reliabilityOnTimeWindowBreakdown,
    reliabilityWorstStations,
    reliabilityRankingMinEvents,
    reliabilitySelectedCell,
    waitTimesHeadwayHeatmap,
    waitTimesDistribution,
    waitTimesBunchingScatter,
    waitTimesGreenBranchComparison,
    waitTimesExcessTrend,
    travelMapSegments,
    travelLinePaths,
    travelStationPoints,
    travelSlowZoneTable,
    travelSegmentIds,
    travelTimeTrendData,
    commuterOriginOptions,
    commuterDestinationOptions,
    commuterSelectedPair,
    commuterSummaryMetrics,
    commuterTimeProfile,
    commuterWeekdayBreakdown,
    commuterEffectiveOriginKey,
    commuterEffectivePairKey,
    historicalYoyOtp,
    historicalYoyCoverage,
    historicalFrequencyBars,
    historicalPredictionAccuracy,
    historicalServiceDeliveryTrend,
    historicalTimelineSeries,
    historicalTimelineMarkers,
    historicalPeriodOptions,
    historicalSideBySideBars,
    historicalScheduleChangeNotes,
    historicalEffectiveLeftPeriod,
    historicalEffectiveRightPeriod,
    stationOptions,
    availableLines,
    year,
  } = useDashboardData({
    selectedLine,
    startDate,
    endDate,
    timePeriod,
    selectedStation,
    reliabilityDayType,
    selectedReliabilityCell: selectedHeatmapCell,
    commuterOriginKey,
    commuterPairKey,
    commuterDepartureHour,
    historicalLeftPeriod,
    historicalRightPeriod,
  });

  const handleRadarLineClick = (line) => {
    setSelectedLine(line);
    setActiveSection("reliability");
  };

  useEffect(() => {
    if (!loading && selectedLine !== "All" && !availableLines.includes(selectedLine)) {
      setSelectedLine("All");
    }
  }, [loading, selectedLine, availableLines, setSelectedLine]);

  useEffect(() => {
    if (!stationOptions.includes(selectedStation)) {
      setSelectedStation("All");
    }
  }, [stationOptions, selectedStation, setSelectedStation]);

  useEffect(() => {
    if (
      selectedHeatmapCell &&
      !reliabilityStationHourHeatmap.some(
        (cell) =>
          cell.station === selectedHeatmapCell.row && cell.hour === selectedHeatmapCell.column
      )
    ) {
      setSelectedHeatmapCell(null);
    }
  }, [reliabilityStationHourHeatmap, selectedHeatmapCell]);

  useEffect(() => {
    if (travelSegmentIds.length === 0) {
      setSelectedTravelSegmentId(null);
      return;
    }
    if (!selectedTravelSegmentId || !travelSegmentIds.includes(selectedTravelSegmentId)) {
      setSelectedTravelSegmentId(travelSegmentIds[0]);
    }
  }, [travelSegmentIds, selectedTravelSegmentId]);

  useEffect(() => {
    if (commuterEffectiveOriginKey && commuterEffectiveOriginKey !== commuterOriginKey) {
      setCommuterOriginKey(commuterEffectiveOriginKey);
    }
  }, [commuterEffectiveOriginKey, commuterOriginKey]);

  useEffect(() => {
    if (commuterEffectivePairKey && commuterEffectivePairKey !== commuterPairKey) {
      setCommuterPairKey(commuterEffectivePairKey);
    }
  }, [commuterEffectivePairKey, commuterPairKey]);

  useEffect(() => {
    if (!historicalPeriodOptions.length) {
      return;
    }
    if (
      historicalEffectiveLeftPeriod &&
      historicalEffectiveLeftPeriod !== historicalLeftPeriod
    ) {
      setHistoricalLeftPeriod(historicalEffectiveLeftPeriod);
    }
    if (
      historicalEffectiveRightPeriod &&
      historicalEffectiveRightPeriod !== historicalRightPeriod
    ) {
      setHistoricalRightPeriod(historicalEffectiveRightPeriod);
    }
  }, [
    historicalPeriodOptions,
    historicalEffectiveLeftPeriod,
    historicalEffectiveRightPeriod,
    historicalLeftPeriod,
    historicalRightPeriod,
  ]);

  const lineLabel = selectedLine === "All" ? "all lines" : `${selectedLine} line`;
  const selectedTravelSegment =
    travelMapSegments.find((segment) => segment.segmentId === selectedTravelSegmentId) || null;
  const sortedSlowZoneRows = sortSlowZoneRows(
    travelSlowZoneTable,
    slowZoneSortBy,
    slowZoneSortDirection
  );
  const travelTrendSeries = travelTimeTrendData.map((row) => ({
    month: row.month,
    line: row.line,
    value: row.index,
  }));
  const travelSegmentsWithIndex = travelMapSegments.filter((segment) => Number.isFinite(segment.travelTimeIndex));
  const severeTravelSegments = travelSegmentsWithIndex.filter((segment) => segment.travelTimeIndex >= 1.3);
  const travelMeanIndex =
    travelSegmentsWithIndex.length > 0
      ? travelSegmentsWithIndex.reduce((accumulator, segment) => accumulator + segment.travelTimeIndex, 0) /
        travelSegmentsWithIndex.length
      : null;
  const topTravelBottlenecks = sortedSlowZoneRows.slice(0, 5);

  if (activeSection === "reliability") {
    return (
      <div className="dashboard-grid">
        <SectionHeading
          title="Reliability Deep Dive"
          subtitle={`Detailed on-time performance analysis for ${lineLabel}`}
        />
        <SilverCoverageNotice selectedLine={selectedLine} />

        <DashboardFilters
          timePeriod={timePeriod}
          selectedStation={selectedStation}
          stationOptions={stationOptions}
          timePeriodOptions={timePeriodOptions}
          onTimePeriodChange={setTimePeriod}
          onStationChange={setSelectedStation}
        />

        <ReliabilityControls
          dayType={reliabilityDayType}
          onDayTypeChange={setReliabilityDayType}
        />

        {error ? <DataErrorState message={error} onRetry={retry} /> : null}
        {!error && loading ? <LoadingState title="OTP Heatmap" rows={6} /> : null}
        {!error && loading ? <LoadingState title="OTP Calendar Heatmap" rows={6} /> : null}
        {!error && loading ? <LoadingState title="On-Time Window Composition" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Worst Stations Ranking" rows={6} /> : null}

        {!error && !loading ? (
          <OtpStationHeatmap
            title="Reliability Heatmap (Station × Time Period)"
            subtitle={`Station-by-time reliability view for ${lineLabel}. Pick a metric and click a cell for delay drilldown.`}
            data={reliabilityStationHourHeatmap}
            selectedCell={selectedHeatmapCell}
            metricId={reliabilityHeatmapMetric}
            onMetricChange={(metric) => {
              setReliabilityHeatmapMetric(metric);
              setSelectedHeatmapCell(null);
            }}
            rowMode={otpHeatmapRowMode}
            onRowModeChange={(mode) => {
              setOtpHeatmapRowMode(mode);
              setSelectedHeatmapCell(null);
            }}
            onCellClick={(cell) => setSelectedHeatmapCell({ row: cell.row, column: cell.column })}
          />
        ) : null}

        {!error && !loading ? (
          <OtpCalendarHeatmap
            title="OTP Calendar Heatmap"
            subtitle={`Day-of-year reliability for ${lineLabel}`}
            data={reliabilityCalendarHeatmap}
          />
        ) : null}

        {!error && !loading ? (
          <OnTimeWindowBreakdown
            title="On-Time Window Composition"
            subtitle={
              reliabilitySelectedCell
                ? `Drilldown: ${reliabilitySelectedCell.row} at ${reliabilitySelectedCell.column} (${reliabilitySelectedCell.totalEvents} events)`
                : `Early / on-time / late shares for ${lineLabel}`
            }
            breakdown={reliabilityOnTimeWindowBreakdown}
          />
        ) : null}

        {!error && !loading ? (
          <StationOtpRanking
            title="Worst Stations Ranking (Sample-Size Aware)"
            subtitle="Lowest OTP stations under current filters with raw late-rate context"
            data={reliabilityWorstStations}
            minEvents={reliabilityRankingMinEvents}
            otpTarget={overviewGoalPct}
          />
        ) : null}

        <Legend title="Line Colors" />
      </div>
    );
  }

  if (activeSection === "wait-times") {
    return (
      <div className="dashboard-grid">
        <SectionHeading
          title="Wait Time Regularity"
          subtitle={`How long passengers actually wait on ${lineLabel}`}
        />
        <SilverCoverageNotice selectedLine={selectedLine} />

        <DashboardFilters
          timePeriod={timePeriod}
          selectedStation={selectedStation}
          stationOptions={stationOptions}
          timePeriodOptions={timePeriodOptions}
          onTimePeriodChange={setTimePeriod}
          onStationChange={setSelectedStation}
        />

        {error ? <DataErrorState message={error} onRetry={retry} /> : null}
        {!error && loading ? <LoadingState title="Headway Heatmap" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Headway Distribution" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Train Bunching Indicator" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Green Line Branch Comparison" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Excess Wait Time Trend" rows={6} /> : null}

        {!error && !loading ? (
          <WaitTimeStationHeatmap
            title="Wait-Time Heatmap (Station × Time Period)"
            subtitle={`Metric view for ${lineLabel}. Source: headway_station_time_month dataset.`}
            data={waitTimesHeadwayHeatmap}
            metricId={waitHeatmapMetric}
            onMetricChange={setWaitHeatmapMetric}
            rowMode={waitHeatmapRowMode}
            onRowModeChange={setWaitHeatmapRowMode}
          />
        ) : null}

        {!error && !loading ? (
          <HeadwayBoxPlot
            title="Headway Distribution (Robust)"
            subtitle={`IQR with P10-P90 whiskers for ${timePeriod === "All" ? "Peak and Off-Peak periods" : timePeriod}`}
            data={waitTimesDistribution}
          />
        ) : null}

        {!error && !loading ? (
          <BunchingScatterChart
            title="Train Bunching Indicator"
            subtitle="Sample-weighted station averages (core service periods); sparse and extreme outliers are excluded to preserve comparability."
            data={waitTimesBunchingScatter}
          />
        ) : null}

        {!error && !loading ? (
          <GreenBranchComparisonChart
            title="Green Line Branch Comparison"
            subtitle="Sample-weighted observed headway by branch (B/C/D/E). Source: headway_green_branch_month."
            data={waitTimesGreenBranchComparison}
          />
        ) : null}

        {!error && !loading ? (
          <LineChart
            title="Excess Wait Time Trend"
            subtitle="Sample-weighted monthly excess wait by line (core service periods, sparse buckets excluded)"
            data={waitTimesExcessTrend}
            xKey="month"
            yKey="value"
            seriesKey="line"
            yLabel="Excess Wait (min)"
            metricFormatter={(value) => `${value.toFixed(1)} min`}
          />
        ) : null}
      </div>
    );
  }

  if (activeSection === "travel-times") {
    return (
      <div className="dashboard-grid">
        <SectionHeading
          title="Travel Times & Slow Zones"
          subtitle={`Where the system slows down for ${lineLabel}`}
        />
        <SilverCoverageNotice selectedLine={selectedLine} />

        <DashboardFilters
          timePeriod={timePeriod}
          selectedStation={selectedStation}
          stationOptions={stationOptions}
          timePeriodOptions={timePeriodOptions}
          onTimePeriodChange={setTimePeriod}
          onStationChange={setSelectedStation}
        />

        {error ? <DataErrorState message={error} onRetry={retry} /> : null}
        {!error && loading ? <LoadingState title="Travel Snapshot" rows={4} /> : null}
        {!error && loading ? <LoadingState title="Segment Delay Ladder" rows={8} /> : null}
        {!error && loading ? <LoadingState title="Monthly Travel Time Trend" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Segment Detail Panel" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Slow Zone Table" rows={6} /> : null}

        {!error && !loading ? (
          <section className="chart-card travel-summary-card">
            <div className="card-header">
              <h2>Travel Snapshot</h2>
            </div>
            <p className="card-subtitle">
              Based on cleaned observed segment travel-time exports (`travel_time_segment_time_period_month`) under current filters.
            </p>
            <div className="travel-summary-grid">
              <article>
                <h3>Segments in View</h3>
                <strong>{travelSegmentsWithIndex.length.toLocaleString()}</strong>
              </article>
              <article>
                <h3>Mean Segment TTI</h3>
                <strong>{travelMeanIndex !== null ? `${travelMeanIndex.toFixed(2)}x` : "NA"}</strong>
              </article>
              <article>
                <h3>High-Delay Segments (TTI ≥ 1.30)</h3>
                <strong>{severeTravelSegments.length.toLocaleString()}</strong>
              </article>
              <article>
                <h3>Flagged Slow-Zone Candidates</h3>
                <strong>
                  {travelSlowZoneTable.filter((row) => row.slowZoneCandidate).length.toLocaleString()}
                </strong>
              </article>
            </div>
            {topTravelBottlenecks.length > 0 ? (
              <ol className="travel-bottleneck-list">
                {topTravelBottlenecks.map((row) => (
                  <li key={row.segmentId}>
                    <button
                      type="button"
                      className="travel-bottleneck-btn"
                      onClick={() => setSelectedTravelSegmentId(row.segmentId)}
                    >
                      {row.segmentName}
                    </button>
                    <span>{row.travelTimeIndex?.toFixed(2)}x</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
        ) : null}

        {!error && !loading ? (
          <section className="chart-card segment-delay-ladder-card">
            <div className="card-header">
              <h2>Segment Delay Ladder</h2>
            </div>
            <p className="card-subtitle">
              Dense ranking of slowest segments under current filters. Click any segment to inspect detailed period and month behavior.
            </p>
            <div className="segment-delay-table-wrap">
              <table className="segment-delay-table">
                <thead>
                  <tr>
                    <th scope="col">Segment</th>
                    <th scope="col">TTI</th>
                    <th scope="col">Buffer</th>
                    <th scope="col">Worst Period</th>
                    <th scope="col">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSlowZoneRows.slice(0, 20).map((row) => {
                    const selected = row.segmentId === selectedTravelSegmentId;
                    const tti = Number.isFinite(row.travelTimeIndex) ? row.travelTimeIndex : null;
                    const cappedTti = tti !== null ? Math.min(2.5, tti) : 0;
                    const ttiPct = Math.max(0, Math.min(100, (cappedTti / 2.5) * 100));
                    return (
                      <tr key={row.segmentId} className={selected ? "segment-delay-row-selected" : ""}>
                        <td>
                          <button
                            type="button"
                            className="slow-zone-segment-btn"
                            onClick={() => setSelectedTravelSegmentId(row.segmentId)}
                          >
                            {row.segmentName}
                          </button>
                        </td>
                        <td>
                          <div className="segment-delay-tti-cell">
                            <span>{tti !== null ? `${tti.toFixed(2)}x` : "NA"}</span>
                            <div className="segment-delay-tti-track" aria-hidden="true">
                              <div className="segment-delay-tti-fill" style={{ width: `${ttiPct}%` }} />
                            </div>
                          </div>
                        </td>
                        <td>{Number.isFinite(row.bufferMin) ? `${row.bufferMin.toFixed(1)} min` : "NA"}</td>
                        <td>{row.worstPeriod || "NA"}</td>
                        <td className={`trend-${row.trendDirection || "stable"}`}>{row.trendDirection || "stable"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {!error && !loading ? (
          <LineChart
            title="Monthly Travel Time Trend"
            subtitle="Line-level monthly Travel Time Index (TTI) from observed segment travel records"
            data={travelTrendSeries}
            xKey="month"
            yKey="value"
            seriesKey="line"
            yLabel="Travel Time Index"
            metricFormatter={(value) => `${value.toFixed(2)}x`}
            xTickFormatter={(tick) =>
              tick instanceof Date ? tick.toLocaleDateString(undefined, { month: "short" }) : String(tick)
            }
          />
        ) : null}

        {!error && !loading ? (
          <TravelSegmentDetailPanel
            segment={selectedTravelSegment}
            onClear={() => setSelectedTravelSegmentId(null)}
          />
        ) : null}

        {!error && !loading ? (
          <SlowZoneTable
            rows={sortedSlowZoneRows}
            sortBy={slowZoneSortBy}
            sortDirection={slowZoneSortDirection}
            selectedSegmentId={selectedTravelSegmentId}
            onSegmentSelect={setSelectedTravelSegmentId}
            onSortChange={(column) => {
              if (column === slowZoneSortBy) {
                setSlowZoneSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
              } else {
                setSlowZoneSortBy(column);
                setSlowZoneSortDirection("desc");
              }
            }}
          />
        ) : null}

        <section className="chart-card">
          <div className="card-header">
            <h2>Marey Diagram (Stretch Goal)</h2>
          </div>
          <p className="card-subtitle">
            Time-space visualization placeholder. Will plot train trajectories over 24h in a follow-up pass.
          </p>
        </section>
      </div>
    );
  }

  if (activeSection === "commuter-tool") {
    return (
      <div className="dashboard-grid">
        <SectionHeading
          title="Commuter Tool"
          subtitle={`Personal trip-planning insights for ${lineLabel}`}
        />
        <SilverCoverageNotice selectedLine={selectedLine} />

        <section className="commuter-controls-card">
          <div className="card-header">
            <h2>Trip Selector</h2>
          </div>
          <p className="card-subtitle">
            Choose a valid origin and destination pair, then set your typical departure time.
          </p>
          <div className="commuter-controls-grid">
            <label>
              Origin
              <select
                value={commuterOriginKey}
                onChange={(event) => setCommuterOriginKey(event.target.value)}
                disabled={commuterOriginOptions.length === 0}
              >
                {commuterOriginOptions.length === 0 ? (
                  <option value="">No valid origin stops available</option>
                ) : (
                  commuterOriginOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label>
              Destination
              <select
                value={commuterPairKey}
                onChange={(event) => setCommuterPairKey(event.target.value)}
                disabled={commuterDestinationOptions.length === 0}
              >
                {commuterDestinationOptions.length === 0 ? (
                  <option value="">No valid destination stops available</option>
                ) : (
                  commuterDestinationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label>
              Typical Departure
              <input
                type="range"
                min={5}
                max={22}
                step={1}
                value={commuterDepartureHour}
                onChange={(event) => setCommuterDepartureHour(Number(event.target.value))}
              />
              <span className="commuter-hour-readout">
                {String(commuterDepartureHour).padStart(2, "0")}:00
              </span>
            </label>
          </div>
          {commuterSelectedPair ? (
            <p className="commuter-pair-meta">
              {commuterSelectedPair.line}
              {commuterSelectedPair.directionName && commuterSelectedPair.directionName !== "Unknown Direction"
                ? ` · ${commuterSelectedPair.directionName}`
                : ""}{" "}
              ·{" "}
              {commuterSelectedPair.fromStopName} to {commuterSelectedPair.toStopName}
            </p>
          ) : null}
        </section>

        {error ? <DataErrorState message={error} onRetry={retry} /> : null}
        {!error && loading ? <LoadingState title="Commuter Insights" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Time-of-Day Profile" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Day-of-Week Breakdown" rows={6} /> : null}

        {!error && !loading ? (
          <section className="chart-card commuter-summary-card">
            <div className="card-header">
              <h2>Trip Reliability Snapshot</h2>
            </div>
            {commuterSummaryMetrics ? (
              <>
                <div className="commuter-metrics-grid">
                  <article>
                    <h3>Expected Travel Time</h3>
                    <strong>{commuterSummaryMetrics.medianMin.toFixed(1)} min</strong>
                  </article>
                  <article>
                    <h3>Worst-Case (P95)</h3>
                    <strong>
                      {commuterSummaryMetrics.p95Min !== null
                        ? `${commuterSummaryMetrics.p95Min.toFixed(1)} min`
                        : "N/A"}
                    </strong>
                  </article>
                  <article>
                    <h3>Recommended Buffer</h3>
                    <strong>
                      {commuterSummaryMetrics.bufferMin !== null
                        ? `${commuterSummaryMetrics.bufferMin.toFixed(1)} min`
                        : "N/A"}
                    </strong>
                  </article>
                  <article>
                    <h3>Reliability Score</h3>
                    <strong>
                      {commuterSummaryMetrics.reliabilityPct !== null
                        ? `${commuterSummaryMetrics.reliabilityPct.toFixed(1)}%`
                        : "N/A"}
                    </strong>
                  </article>
                </div>
                <p className="commuter-recommendation">{commuterSummaryMetrics.recommendation}</p>
                <p className="commuter-sample-size">
                  Based on {commuterSummaryMetrics.sampleCount} trips in this time window.
                </p>
                {commuterSummaryMetrics.isEstimatedFallback ? (
                  <p className="commuter-sample-size">
                    This line currently uses estimated segment travel times derived from observed headway patterns.
                  </p>
                ) : null}
              </>
            ) : (
              <p>Select a valid origin and destination to view commute reliability insights.</p>
            )}
          </section>
        ) : null}

        {!error && !loading ? (
          <LineChart
            title="Time-of-Day Profile"
            subtitle="Median and P95 travel time by departure hour for this OD pair"
            data={commuterTimeProfile}
            xKey="hour"
            yKey="value"
            seriesKey="series"
            yLabel="Travel Time"
            metricFormatter={(value) => `${value.toFixed(1)} min`}
          />
        ) : null}

        {!error && !loading ? (
          <BarChart
            title="Day-of-Week Breakdown"
            subtitle="Weekday commute variability (Mon–Fri) for the selected trip"
            data={commuterWeekdayBreakdown}
            categoryKey="day"
            valueKey="value"
            groupKey="metric"
            metricFormatter={(value) => `${value.toFixed(1)} min`}
          />
        ) : null}
      </div>
    );
  }

  if (activeSection === "historical-trends") {
    return (
      <div className="dashboard-grid">
        <SectionHeading
          title="Historical Trends & Schedule Changes"
          subtitle={`How service changed over time for ${lineLabel}`}
        />
        <SilverCoverageNotice selectedLine={selectedLine} />

        <section className="historical-compare-card">
          <div className="card-header">
            <h2>Period Comparison</h2>
          </div>
          <p className="card-subtitle">
            Compare any two seasons side by side and inspect schedule changes against outcomes.
          </p>
          <div className="historical-compare-grid">
            <label>
              Selected Period A
              <select
                value={historicalLeftPeriod}
                onChange={(event) => setHistoricalLeftPeriod(event.target.value)}
              >
                {historicalPeriodOptions.map((period) => (
                  <option key={period} value={period}>
                    {period}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Selected Period B
              <select
                value={historicalRightPeriod}
                onChange={(event) => setHistoricalRightPeriod(event.target.value)}
              >
                {historicalPeriodOptions.map((period) => (
                  <option key={period} value={period}>
                    {period}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {error ? <DataErrorState message={error} onRetry={retry} /> : null}
        {!error && loading ? <LoadingState title="Year-over-Year OTP" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Scheduled vs Actual Frequency" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Schedule Prediction Accuracy" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Service Delivery Trend" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Annotated Timeline" rows={6} /> : null}

        {!error && !loading ? (
          <LineChart
            title="Year-over-Year OTP"
            subtitle="Compare same months across years (missing years are shown as gaps)"
            data={historicalYoyOtp}
            xKey="month"
            yKey="value"
            seriesKey="year"
            yLabel="OTP"
            metricFormatter={(value) => `${value.toFixed(1)}%`}
          />
        ) : null}

        {!error && !loading ? (
          <section className="chart-card">
            <div className="card-header">
              <h2>Historical Data Coverage</h2>
            </div>
            <p className="card-subtitle">
              Graceful fallback is active where historical line-month data is unavailable.
            </p>
            <ul className="historical-coverage-list">
              {historicalYoyCoverage.map((row) => (
                <li key={row.year}>
                  <strong>{row.year}</strong>
                  <span>{row.availableMonths} month(s) available</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {!error && !loading ? (
          <BarChart
            title="Scheduled vs Actual Frequency"
            subtitle="Planned trains/hour versus delivered trains/hour by season and line"
            data={historicalFrequencyBars}
            categoryKey="seasonLine"
            valueKey="value"
            groupKey="metric"
            metricFormatter={(value) => `${value.toFixed(2)} tph`}
          />
        ) : null}

        {!error && !loading ? (
          <LineChart
            title="Schedule Prediction Accuracy"
            subtitle="Accuracy proxy = 100 - |actual tph - scheduled tph| / scheduled tph (weighted by observed samples)"
            data={historicalPredictionAccuracy}
            xKey="season"
            yKey="value"
            seriesKey="line"
            yLabel="Accuracy"
            metricFormatter={(value) => `${value.toFixed(1)}%`}
          />
        ) : null}

        {!error && !loading ? (
          <LineChart
            title="Service Delivery Rate Trend"
            subtitle="Actual trips delivered as a share of scheduled trips over time"
            data={historicalServiceDeliveryTrend}
            xKey="season"
            yKey="value"
            seriesKey="line"
            yLabel="Delivery Rate"
            metricFormatter={(value) => `${value.toFixed(1)}%`}
          />
        ) : null}

        {!error && !loading ? (
          <BarChart
            title="Side-by-Side Period Comparison"
            subtitle={`${historicalEffectiveLeftPeriod} vs ${historicalEffectiveRightPeriod} service delivery by line`}
            data={historicalSideBySideBars}
            categoryKey="line"
            valueKey="value"
            groupKey="comparison"
            metricFormatter={(value) => `${value.toFixed(1)}%`}
          />
        ) : null}

        {!error && !loading ? (
          <AnnotatedTimelineChart
            title="Annotated Timeline"
            subtitle="Key events overlaid as vertical markers on system service-delivery performance"
            data={historicalTimelineSeries}
            markers={historicalTimelineMarkers}
            xKey="season"
            yKey="value"
            metricFormatter={(value) => `${value.toFixed(1)}%`}
          />
        ) : null}

        {!error && !loading ? (
          <section className="chart-card historical-note-card">
            <div className="card-header">
              <h2>Schedule Change Signals</h2>
            </div>
            <p className="card-subtitle">
              Seasons where the planned schedule materially changed.
            </p>
            <ul className="historical-change-list">
              {historicalScheduleChangeNotes.map((note) => (
                <li key={`${note.season}-${note.line}-${note.change}`}>
                  <strong>{note.season}</strong>
                  <span>
                    {note.line}: {note.change}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="dashboard-grid">
      <SectionHeading
        title="System Overview"
        subtitle={`${year} high-level snapshot of system health for ${lineLabel}`}
      />
      <SilverCoverageNotice selectedLine={selectedLine} />

      {error ? <DataErrorState message={error} onRetry={retry} /> : null}
      {!error && loading ? <LoadingState title="System Scorecards" rows={6} /> : null}
      {!error && loading ? <LoadingState title="Daily Reliability Trend" rows={6} /> : null}
      {!error && loading ? <LoadingState title="Line Comparison Matrix" rows={6} /> : null}
      {!error && loading ? <LoadingState title="Recent Highlights" rows={4} /> : null}

      {!error && !loading ? (
        <SystemScorecards title="System Scorecard" cards={overviewScorecards} />
      ) : null}

      {!error && !loading ? (
        <AreaTrendChart
          title="Daily Reliability Trend"
          subtitle={`System-wide OTP with ${overviewGoalPct.toFixed(0)}% goal line over the last 12 months`}
          data={overviewSystemTrend}
          xKey="date"
          yKey="value"
          goalKey="goal"
          xTickFormatter={(tick) =>
            tick instanceof Date ? tick.toLocaleDateString(undefined, { month: "short" }) : String(tick)
          }
          metricFormatter={(value) => `${value.toFixed(1)}%`}
        />
      ) : null}

      {!error && !loading ? (
        <RadarComparisonChart
          title="Line Comparison Matrix"
          subtitle="Raw metric comparison by line (Avg OTP over selected period) with aligned scales and normalized composite score"
          data={overviewRadar}
          onLineClick={handleRadarLineClick}
        />
      ) : null}

      {!error && !loading ? <HighlightsPanel highlights={overviewHighlights} /> : null}

      <Legend title="Line Legend" items={getLineLegendItems()} />

      <BostonMap
        selectedLine={selectedLine}
        mapMode="overview"
        linePaths={travelLinePaths}
        stationPoints={travelStationPoints}
      />
    </div>
  );
}

export default DashboardPage;
