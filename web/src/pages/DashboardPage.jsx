import { useEffect } from "react";
import BostonMap from "../components/BostonMap";
import LineChart from "../charts/LineChart";
import HeatmapGrid from "../charts/HeatmapGrid";
import BarChart from "../charts/BarChart";
import Legend from "../charts/components/Legend";
import LoadingState from "../charts/components/LoadingState";
import TimeFilter from "../filters/TimeFilter";
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

function DashboardPage() {
  const {
    selectedLine,
    activeSection,
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

  const {
    loading,
    error,
    retry,
    otpTrendData,
    stationOtpHeatmapData,
    waitTimeHeatmapData,
    waitTimeBranchBars,
    serviceDeliveryBars,
    travelTimeTrendData,
    commuterBufferBars,
    commuterMatrixData,
    stationOptions,
    year,
  } = useDashboardData({
    selectedLine,
    startDate,
    endDate,
    timePeriod,
    selectedStation,
  });

  useEffect(() => {
    if (!stationOptions.includes(selectedStation)) {
      setSelectedStation("All");
    }
  }, [stationOptions, selectedStation, setSelectedStation]);

  const lineLabel = selectedLine === "All" ? "all lines" : `${selectedLine} line`;

  if (activeSection === "reliability") {
    return (
      <div className="dashboard-grid">
        <SectionHeading
          title="Reliability Snapshot"
          subtitle={`Service punctuality and consistency for ${lineLabel}`}
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

        {!error && loading ? <LoadingState title="On-Time Performance" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Service Delivery" rows={6} /> : null}

        {!error && !loading ? (
          <LineChart
            title="On-Time Performance Trend"
            subtitle={`Daily OTP for ${lineLabel}`}
            data={otpTrendData}
            xKey="date"
            yKey="value"
            seriesKey="series"
            yLabel="OTP %"
            metricFormatter={(value) => `${value.toFixed(1)}%`}
          />
        ) : null}

        {!error && !loading ? (
          <HeatmapGrid
            title="Station OTP by Time Period"
            subtitle={`On-time performance distribution for ${lineLabel}`}
            data={stationOtpHeatmapData}
            rowKey="station"
            columnKey="timePeriod"
            valueKey="value"
            valueFormatter={(value) => `${value.toFixed(1)}%`}
          />
        ) : null}

        {!error && !loading ? (
          <BarChart
            title="Service Delivery by Season"
            subtitle="Actual trips delivered as a share of scheduled service"
            data={serviceDeliveryBars}
            categoryKey="season"
            valueKey="rate"
            groupKey="line"
            metricFormatter={(value) => `${(value * 100).toFixed(1)}%`}
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
          subtitle={`Headway variability and bunching risk for ${lineLabel}`}
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
        {!error && loading ? <LoadingState title="Headway Reliability" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Worst-Case Wait Time" rows={5} /> : null}

        {!error && !loading ? (
          <HeatmapGrid
            title="Station Wait-Time Reliability"
            subtitle={`Reliability score (100 - headway CV%) for ${lineLabel}`}
            data={waitTimeHeatmapData}
            rowKey="station"
            columnKey="timePeriod"
            valueKey="value"
            valueFormatter={(value) => `${value.toFixed(1)}%`}
          />
        ) : null}

        {!error && !loading ? (
          <BarChart
            title="Worst-Case Wait by Branch"
            subtitle="Average P90 headway by route/branch"
            data={waitTimeBranchBars}
            categoryKey="branch"
            valueKey="p90"
            groupKey="line"
            orientation="horizontal"
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
          title="Travel Time Reliability"
          subtitle={`Segment speed and planning reliability for ${lineLabel}`}
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

        <BostonMap selectedLine={selectedLine} mapMode="travel" />

        {error ? <DataErrorState message={error} onRetry={retry} /> : null}
        {!error && loading ? <LoadingState title="Travel Time Trends" rows={6} /> : null}

        {!error && !loading ? (
          <LineChart
            title="Travel Time Index Trends"
            subtitle={`Monthly average travel time index for ${lineLabel}`}
            data={travelTimeTrendData}
            xKey="month"
            yKey="index"
            seriesKey="line"
            yLabel="Travel Time Index"
            metricFormatter={(value) => `${value.toFixed(2)}x`}
          />
        ) : null}
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
        {!error && loading ? <LoadingState title="Buffer Time Planner" rows={6} /> : null}
        {!error && loading ? <LoadingState title="Worst-Case Commute Matrix" rows={6} /> : null}

        {!error && !loading ? (
          <BarChart
            title="Buffer Time Planner"
            subtitle="Recommended extra minutes for corridor planning"
            data={commuterBufferBars}
            categoryKey="corridor"
            valueKey="buffer"
            groupKey="line"
            orientation="horizontal"
            metricFormatter={(value) => `${value.toFixed(1)} min`}
          />
        ) : null}

        {!error && !loading ? (
          <HeatmapGrid
            title="Worst-Case Commute Matrix"
            subtitle="Planning time index by station and time period"
            data={commuterMatrixData}
            rowKey="station"
            columnKey="timePeriod"
            valueKey="value"
            valueFormatter={(value) => `${value.toFixed(2)}x`}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="dashboard-grid">
      <SectionHeading
        title="System Overview"
        subtitle={`${year} dashboard shell filtered to ${lineLabel}`}
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

      <BostonMap selectedLine={selectedLine} mapMode="overview" />

      {error ? <DataErrorState message={error} onRetry={retry} /> : null}
      {!error && loading ? <LoadingState title="System Trend" rows={6} /> : null}
      {!error && loading ? <LoadingState title="Station Reliability" rows={6} /> : null}

      {!error && !loading ? (
        <LineChart
          title="System OTP Trend"
          subtitle={`Daily network reliability for ${lineLabel}`}
          data={otpTrendData}
          xKey="date"
          yKey="value"
          seriesKey="series"
          yLabel="OTP %"
          metricFormatter={(value) => `${value.toFixed(1)}%`}
        />
      ) : null}

      {!error && !loading ? (
        <HeatmapGrid
          title="Station Reliability Matrix"
          subtitle={`On-time performance by station and time period for ${lineLabel}`}
          data={stationOtpHeatmapData}
          rowKey="station"
          columnKey="timePeriod"
          valueKey="value"
          valueFormatter={(value) => `${value.toFixed(1)}%`}
        />
      ) : null}

      <Legend title="Line Legend" items={getLineLegendItems()} />
    </div>
  );
}

export default DashboardPage;
