function LoadingState({ title = "Loading chart", rows = 5 }) {
  return (
    <section className="chart-card" aria-busy="true" aria-live="polite">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      <div className="loading-skeleton">
        {Array.from({ length: rows }).map((_, idx) => (
          <div key={idx} className="loading-bar" />
        ))}
      </div>
    </section>
  );
}

export default LoadingState;
