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
