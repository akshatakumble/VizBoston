import BostonMap from "../components/BostonMap";
import PerformanceChartPlaceholder from "../charts/PerformanceChartPlaceholder";

function DashboardPage() {
  return (
    <div className="dashboard-grid">
      <BostonMap />
      <PerformanceChartPlaceholder />
    </div>
  );
}

export default DashboardPage;
