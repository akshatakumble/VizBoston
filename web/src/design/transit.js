export const MBTA_LINE_COLORS = {
  Red: "#DA291C",
  Orange: "#ED8B00",
  Blue: "#003DA5",
  Green: "#00843D",
  "Green-B": "#00843D",
  "Green-C": "#00843D",
  "Green-D": "#00843D",
  "Green-E": "#00843D",
  Silver: "#7C878E",
  Mattapan: "#DA291C",
  All: "#4E6B95",
  Scheduled: "#2563EB",
  Actual: "#F59E0B",
  Median: "#0284C7",
  P95: "#DC2626",
  "2022": "#0F766E",
  "2023": "#0EA5E9",
  "2024": "#FB923C",
  "2025": "#334155",
  "Selected A": "#2563EB",
  "Selected B": "#DC2626",
};

export const TIME_PERIOD_OPTIONS = [
  "All",
  "AM Peak",
  "Midday",
  "PM Peak",
  "Evening",
  "Late Night",
  "Other",
];

export function getLineColor(lineId) {
  return MBTA_LINE_COLORS[lineId] || MBTA_LINE_COLORS.All;
}

export function getLineLegendItems() {
  return [
    { label: "Red", color: MBTA_LINE_COLORS.Red },
    { label: "Orange", color: MBTA_LINE_COLORS.Orange },
    { label: "Blue", color: MBTA_LINE_COLORS.Blue },
    { label: "Green", color: MBTA_LINE_COLORS.Green },
    { label: "Silver", color: MBTA_LINE_COLORS.Silver },
  ];
}
