import { interpolateViridis } from "d3";
import { useEffect, useState } from "react";
import BostonMap from "../components/BostonMap";
import LineChart from "../charts/LineChart";
import HeatmapGrid from "../charts/HeatmapGrid";
import BarChart from "../charts/BarChart";
import AreaTrendChart from "../charts/AreaTrendChart";
import RadarComparisonChart from "../charts/RadarComparisonChart";
import SystemScorecards from "../charts/SystemScorecards";
import OtpCalendarHeatmap from "../charts/OtpCalendarHeatmap";
import DelayHistogram from "../charts/DelayHistogram";
import HeadwayBoxPlot from "../charts/HeadwayBoxPlot";
import BunchingScatterChart from "../charts/BunchingScatterChart";
import AnnotatedTimelineChart from "../charts/AnnotatedTimelineChart";
import Legend from "../charts/components/Legend";
import LoadingState from "../charts/components/LoadingState";
import TimeFilter from "../filters/TimeFilter";
import DateRangeSlider from "../filters/DateRangeSlider";
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

function DashboardFilters({
  startDate,
  endDate,
  timePeriod,
  selectedStation,
  timePeriodOptions,
  stationOptions,
  onStartDateChange,
  onEndDateChange,
  onTimePeriodChange,
  onStationChange,
}) {
  return (
    <TimeFilter
      startDate={startDate}
      endDate={endDate}
      timePeriod={timePeriod}
      selectedStation={selectedStation}
      onStartDateChange={onStartDateChange}
      onEndDateChange={onEndDateChange}
      onTimePeriodChange={onTimePeriodChange}
      onStationChange={onStationChange}
      periodOptions={timePeriodOptions}
      stationOptions={stationOptions}
    />
  );
}

function ReliabilityControls({
  dayType,
  onDayTypeChange,
  dates,
  startDate,
  endDate,
  onDateChange,
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

      <DateRangeSlider
        dates={dates}
        startDate={startDate}
        endDate={endDate}
        onChange={onDateChange}
      />
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
    reliabilityDelayValues,
    reliabilityWorstStations,
    reliabilitySelectedCell,
    reliabilityAvailableDates,
    waitTimesHeadwayHeatmap,
    waitTimesDistribution,
    waitTimesBunchingScatter,
    waitTimesGreenBranchComparison,
    waitTimesExcessTrend,
    travelMapSegments,
    travelLinePaths,
    travelSlowZoneTable,
    travelSegmentIds,
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
    historicalServiceDeliveryTrend,
    historicalTimelineSeries,
    historicalTimelineMarkers,
    historicalPeriodOptions,
    historicalSideBySideBars,
    historicalScheduleChangeNotes,
    historicalEffectiveLeftPeriod,
    historicalEffectiveRightPeriod,
    stationOptions,
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

  if (activeSection === "reliability") {
    return (
      <div className="dashboard-grid">
        <SectionHeading
          title="Reliability Deep Dive"
          subtitle={`Detailed on-time performance analysis for ${lineLabel}`}
        />

        <DashboardFilters
          startDate={startDate}
          endDate={endDate}
          timePeriod={timePeriod}
          selectedStation={selectedStation}
          stationOptions={stationOptions}
          timePeriodOptions={timePeriodOptions}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onTimePeriodChange={setTimePeriod}
          onStationChange={setSelectedStation}
        />

        <ReliabilityControls
          dayType={reliabilityDayType}
          onDayTypeChange={setReliabilityDayType}
          dates={reliabilityAvailableDates}
          startDate={startDate}
          endDate={endDate}
          onDateChange={(nextStart, nextEnd) => {
            setStartDate(nextStart);
            setEndDate(nextEnd);
          }}
        />

        {error ? <DataErrorState message={error} onRetry={retry} /> : null}
        {!error && loading ? <LoadingState title="OTP Heatmap" rows={6} /> : null}
        {!error && loading ? <LoadingState title="OTP Calendar Heatmap" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Delay Distribution" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Worst Stations Ranking" rows={6} /> : null}

        {!error && !loading ? (
          <HeatmapGrid
            title="OTP Heatmap (Station × Hour)"
            subtitle={`Viridis OTP map for ${lineLabel}. Click a cell for distribution drilldown.`}
            data={reliabilityStationHourHeatmap}
            rowKey="station"
            columnKey="hour"
            valueKey="value"
            colorInterpolator={interpolateViridis}
            selectedCell={selectedHeatmapCell}
            onCellClick={(cell) => setSelectedHeatmapCell({ row: cell.row, column: cell.column })}
            valueFormatter={(value) => `${value.toFixed(1)}% OTP`}
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
          <DelayHistogram
            title="Delay Distribution"
            subtitle={
              reliabilitySelectedCell
                ? `Drilldown: ${reliabilitySelectedCell.row} at ${reliabilitySelectedCell.column} (${reliabilitySelectedCell.totalEvents} events)`
                : `Schedule deviation distribution for ${lineLabel}`
            }
            values={reliabilityDelayValues}
          />
        ) : null}

        {!error && !loading ? (
          <BarChart
            title="Worst Stations Ranking"
            subtitle="Stations with lowest OTP under current filters"
            data={reliabilityWorstStations}
            categoryKey="station"
            valueKey="otpPct"
            groupKey="line"
            orientation="horizontal"
            metricFormatter={(value) => `${value.toFixed(1)}%`}
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

        <DashboardFilters
          startDate={startDate}
          endDate={endDate}
          timePeriod={timePeriod}
          selectedStation={selectedStation}
          stationOptions={stationOptions}
          timePeriodOptions={timePeriodOptions}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
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
          <HeatmapGrid
            title="Headway Heatmap (Station × Hour)"
            subtitle={`Average headway in minutes for ${lineLabel}`}
            data={waitTimesHeadwayHeatmap}
            rowKey="station"
            columnKey="hour"
            valueKey="value"
            colorInterpolator={interpolateViridis}
            valueFormatter={(value) => `${value.toFixed(1)} min`}
          />
        ) : null}

        {!error && !loading ? (
          <HeadwayBoxPlot
            title="Headway Distribution"
            subtitle="Box plots show spread during Peak vs Off-Peak by line"
            data={waitTimesDistribution}
          />
        ) : null}

        {!error && !loading ? (
          <BunchingScatterChart
            title="Train Bunching Indicator"
            subtitle="Current vs previous headway; diagonal represents perfectly even spacing"
            data={waitTimesBunchingScatter}
          />
        ) : null}

        {!error && !loading ? (
          <BarChart
            title="Green Line Branch Comparison"
            subtitle="Grouped branch headways at shared trunk stations (B/C/D/E)"
            data={waitTimesGreenBranchComparison}
            categoryKey="station"
            valueKey="headwayMin"
            groupKey="branch"
            metricFormatter={(value) => `${value.toFixed(1)} min`}
          />
        ) : null}

        {!error && !loading ? (
          <LineChart
            title="Excess Wait Time Trend"
            subtitle="Monthly average excess wait time by line"
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

        <DashboardFilters
          startDate={startDate}
          endDate={endDate}
          timePeriod={timePeriod}
          selectedStation={selectedStation}
          stationOptions={stationOptions}
          timePeriodOptions={timePeriodOptions}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onTimePeriodChange={setTimePeriod}
          onStationChange={setSelectedStation}
        />

        {error ? <DataErrorState message={error} onRetry={retry} /> : null}
        {!error && loading ? <LoadingState title="Interactive System Map" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Segment Detail Panel" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Slow Zone Table" rows={6} /> : null}

        {!error && !loading ? (
          <BostonMap
            selectedLine={selectedLine}
            mapMode="travel"
            linePaths={travelLinePaths}
            segmentData={travelMapSegments}
            selectedSegmentId={selectedTravelSegmentId}
            onSegmentSelect={setSelectedTravelSegmentId}
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
              >
                {commuterOriginOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Destination
              <select
                value={commuterPairKey}
                onChange={(event) => setCommuterPairKey(event.target.value)}
              >
                {commuterDestinationOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
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
              {commuterSelectedPair.line} · {commuterSelectedPair.directionName} ·{" "}
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

      {error ? <DataErrorState message={error} onRetry={retry} /> : null}
      {!error && loading ? <LoadingState title="System Scorecards" rows={6} /> : null}
      {!error && loading ? <LoadingState title="Daily Reliability Trend" rows={6} /> : null}
      {!error && loading ? <LoadingState title="Line Comparison Radar" rows={6} /> : null}
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
          title="Line Comparison Radar"
          subtitle="Compare OTP, headway, travel reliability, and service delivery across lines"
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
      />
    </div>
  );
}

export default DashboardPage;
