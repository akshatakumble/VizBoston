import { Link, useLocation } from "react-router-dom";
import { useDashboard } from "../context/DashboardContext";

function Layout({ children }) {
  const location = useLocation();
  const {
    selectedLine,
    setSelectedLine,
    activeSection,
    setActiveSection,
    theme,
    setTheme,
    sections,
    lineOptions,
  } = useDashboard();

  const onDashboardRoute = location.pathname === "/";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <h1>MBTA Operations Console</h1>
          <p>Boston rapid transit reliability and rider planning insights</p>
        </div>

        <div className="topbar-controls">
          <label className="line-selector-label" htmlFor="line-selector">
            Line
          </label>
          <select
            id="line-selector"
            className="line-selector"
            value={selectedLine}
            onChange={(event) => setSelectedLine(event.target.value)}
          >
            {lineOptions.map((line) => (
              <option
                key={line}
                value={line}
                disabled={line === "Silver"}
                title={line === "Silver" ? "Silver Line data is not available in this rapid-transit dataset." : undefined}
              >
                {line === "Silver" ? "Silver (no data)" : line}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? "Light Theme" : "Dark Theme"}
          </button>
        </div>
      </header>

      <div className="route-nav">
        <nav>
          <Link className={location.pathname === "/" ? "active" : ""} to="/">
            Dashboard
          </Link>
          <Link className={location.pathname === "/about" ? "active" : ""} to="/about">
            About
          </Link>
        </nav>
      </div>

      <div className="shell-content">
        {onDashboardRoute ? (
          <aside className="section-nav" aria-label="Dashboard sections">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={activeSection === section.id ? "active" : ""}
                onClick={() => setActiveSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </aside>
        ) : null}

        <main>{children}</main>
      </div>
    </div>
  );
}

export default Layout;
