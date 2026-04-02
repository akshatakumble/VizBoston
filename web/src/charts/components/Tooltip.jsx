function Tooltip({ visible, x = 0, y = 0, title, rows = [] }) {
  if (!visible) {
    return null;
  }

  return (
    <div
      className="chart-tooltip"
      style={{
        left: `${x}px`,
        top: `${y}px`,
      }}
      role="status"
      aria-live="polite"
    >
      {title ? <h4>{title}</h4> : null}
      <ul>
        {rows.map((row) => (
          <li key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Tooltip;
