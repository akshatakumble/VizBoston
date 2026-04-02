const SORTABLE_COLUMNS = new Set(["travelTimeIndex", "bufferMin", "planningTimeIndex", "slowZoneMonths"]);

function arrow(sortBy, column, direction) {
  if (sortBy !== column) {
    return "";
  }
  return direction === "asc" ? " ↑" : " ↓";
}

function SlowZoneTable({
  rows = [],
  sortBy = "travelTimeIndex",
  sortDirection = "desc",
  onSortChange,
}) {
  return (
    <section className="chart-card slow-zone-table-card">
      <div className="card-header">
        <h2>Slow Zone Table</h2>
      </div>
      <p className="card-subtitle">Segments ranked by travel time index and trend direction</p>

      <div className="slow-zone-table-wrap">
        <table className="slow-zone-table">
          <thead>
            <tr>
              <th>Segment</th>
              <th>Line</th>
              <th>
                <button
                  type="button"
                  className="table-sort-btn"
                  onClick={() => onSortChange?.("travelTimeIndex")}
                >
                  Travel Index{arrow(sortBy, "travelTimeIndex", sortDirection)}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="table-sort-btn"
                  onClick={() => onSortChange?.("bufferMin")}
                >
                  Buffer (min){arrow(sortBy, "bufferMin", sortDirection)}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="table-sort-btn"
                  onClick={() => onSortChange?.("planningTimeIndex")}
                >
                  Planning Index{arrow(sortBy, "planningTimeIndex", sortDirection)}
                </button>
              </th>
              <th>Trend</th>
              <th>
                <button
                  type="button"
                  className="table-sort-btn"
                  onClick={() => onSortChange?.("slowZoneMonths")}
                >
                  Months {'>'} Threshold{arrow(sortBy, "slowZoneMonths", sortDirection)}
                </button>
              </th>
              <th>Candidate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.segmentId}>
                <td>{row.segmentName}</td>
                <td>{row.line}</td>
                <td>{row.travelTimeIndex?.toFixed(2)}x</td>
                <td>{row.bufferMin !== null ? row.bufferMin.toFixed(1) : "NA"}</td>
                <td>{row.planningTimeIndex !== null ? `${row.planningTimeIndex.toFixed(2)}x` : "NA"}</td>
                <td className={`trend-${row.trendDirection}`}>{row.trendDirection}</td>
                <td>{row.slowZoneMonths}</td>
                <td>{row.slowZoneCandidate ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function sortSlowZoneRows(rows, sortBy, sortDirection) {
  const direction = sortDirection === "asc" ? 1 : -1;
  const safeSortBy = SORTABLE_COLUMNS.has(sortBy) ? sortBy : "travelTimeIndex";
  return rows.slice().sort((left, right) => {
    const leftValue = left[safeSortBy];
    const rightValue = right[safeSortBy];
    const leftNumber = Number.isFinite(Number(leftValue)) ? Number(leftValue) : Number.NEGATIVE_INFINITY;
    const rightNumber = Number.isFinite(Number(rightValue)) ? Number(rightValue) : Number.NEGATIVE_INFINITY;
    if (leftNumber !== rightNumber) {
      return (leftNumber - rightNumber) * direction;
    }
    return left.segmentName.localeCompare(right.segmentName);
  });
}

export default SlowZoneTable;
