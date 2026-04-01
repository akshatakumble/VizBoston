import { Link, useLocation } from "react-router-dom";

function Layout({ children }) {
  const location = useLocation();

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>MBTA Reliability Dashboard</h1>
        <nav>
          <Link className={location.pathname === "/" ? "active" : ""} to="/">
            Dashboard
          </Link>
          <Link
            className={location.pathname === "/about" ? "active" : ""}
            to="/about"
          >
            About
          </Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}

export default Layout;
