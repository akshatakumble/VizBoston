import { TIME_PERIOD_OPTIONS } from "../design/transit";

function TimeFilter({
  startDate,
  endDate,
  timePeriod = "All",
  selectedStation = "All",
  onStartDateChange,
  onEndDateChange,
  onTimePeriodChange,
  onStationChange,
  periodOptions = TIME_PERIOD_OPTIONS,
  stationOptions = ["All"],
  showDateInputs = false,
}) {
  return (
    <section className="time-filter-card" aria-label="Time filters">
      <h3>Time Filter</h3>
      <div className={`time-filter-grid ${showDateInputs ? "" : "time-filter-grid-compact"}`.trim()}>
        {showDateInputs ? (
          <>
            <label>
              Start Date
              <input
                type="date"
                value={startDate}
                onChange={(event) => onStartDateChange?.(event.target.value)}
              />
            </label>
            <label>
              End Date
              <input
                type="date"
                value={endDate}
                onChange={(event) => onEndDateChange?.(event.target.value)}
              />
            </label>
          </>
        ) : null}
        <label>
          Time Period
          <select value={timePeriod} onChange={(event) => onTimePeriodChange?.(event.target.value)}>
            {periodOptions.map((period) => (
              <option key={period} value={period}>
                {period}
              </option>
            ))}
          </select>
        </label>
        <label>
          Station
          <select value={selectedStation} onChange={(event) => onStationChange?.(event.target.value)}>
            {stationOptions.map((station) => (
              <option key={station} value={station}>
                {station}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

export default TimeFilter;
