function PerformanceChartPlaceholder({
  title = "Performance Trends",
  description = "Placeholder chart area for future D3 visualizations.",
  selectedLine = "All",
}) {
  return (
    <section className="chart-card">
      <div className="card-header">
        <h2>{title}</h2>
        <span className="line-chip">{selectedLine}</span>
      </div>
      <p>{description}</p>
      <div className="chart-placeholder-grid" aria-hidden="true">
        <div />
        <div />
        <div />
        <div />
      </div>
    </section>
  );
}

export default PerformanceChartPlaceholder;
