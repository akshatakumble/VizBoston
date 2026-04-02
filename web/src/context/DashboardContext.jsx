import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { TIME_PERIOD_OPTIONS } from "../design/transit";

const LINE_OPTIONS = ["All", "Red", "Orange", "Blue", "Green", "Silver"];
const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "reliability", label: "Reliability" },
  { id: "wait-times", label: "Wait Times" },
  { id: "travel-times", label: "Travel Times" },
  { id: "commuter-tool", label: "Commuter Tool" },
];

const DashboardContext = createContext(null);

function getInitialTheme() {
  const stored = window.localStorage.getItem("mbta-theme");
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function DashboardProvider({ children }) {
  const [selectedLine, setSelectedLine] = useState("All");
  const [activeSection, setActiveSection] = useState("overview");
  const [theme, setTheme] = useState(getInitialTheme);
  const [startDate, setStartDate] = useState("2025-01-01");
  const [endDate, setEndDate] = useState("2025-12-31");
  const [timePeriod, setTimePeriod] = useState("All");
  const [selectedStation, setSelectedStation] = useState("All");

  useEffect(() => {
    window.document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("mbta-theme", theme);
  }, [theme]);

  const value = useMemo(
    () => ({
      selectedLine,
      setSelectedLine,
      activeSection,
      setActiveSection,
      theme,
      setTheme,
      startDate,
      setStartDate,
      endDate,
      setEndDate,
      timePeriod,
      setTimePeriod,
      selectedStation,
      setSelectedStation,
      timePeriodOptions: TIME_PERIOD_OPTIONS,
      sections: SECTIONS,
      lineOptions: LINE_OPTIONS,
    }),
    [selectedLine, activeSection, theme, startDate, endDate, timePeriod, selectedStation]
  );

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error("useDashboard must be used within DashboardProvider");
  }
  return context;
}
