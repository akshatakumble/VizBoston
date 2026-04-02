import { getLineLegendItems } from "../../design/transit";

function Legend({ title = "Legend", items = getLineLegendItems(), gradient = null }) {
  return (
    <section className="chart-legend" aria-label={title}>
      <h4>{title}</h4>

      {gradient ? (
        <div className="legend-gradient-block">
          <div
            className="legend-gradient"
            style={{
              background: `linear-gradient(90deg, ${gradient.from}, ${gradient.to})`,
            }}
          />
          <div className="legend-gradient-labels">
            <span>{gradient.minLabel}</span>
            <span>{gradient.maxLabel}</span>
          </div>
        </div>
      ) : null}

      <ul>
        {items.map((item) => (
          <li key={item.label}>
            <span className="swatch" style={{ background: item.color }} aria-hidden="true" />
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default Legend;
