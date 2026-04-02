function HighlightsPanel({ title = "Recent Highlights", highlights = [] }) {
  return (
    <section className="chart-card highlights-card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      <p className="card-subtitle">Automatically generated callouts from latest metric aggregates</p>

      <div className="highlights-grid">
        {highlights.map((highlight) => (
          <article key={highlight.id} className={`highlight-item ${highlight.tone || "neutral"}`}>
            <h3>{highlight.title}</h3>
            <p>{highlight.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export default HighlightsPanel;
