import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

function colorForTravelIndex(index) {
  if (!Number.isFinite(index)) {
    return "#7C878E";
  }
  if (index <= 1.1) {
    return "#1A9850";
  }
  if (index <= 1.3) {
    return "#FDAE61";
  }
  return "#D73027";
}

function addLegendControl(map) {
  const legend = L.control({ position: "bottomright" });
  legend.onAdd = () => {
    const container = L.DomUtil.create("div", "map-legend-control");
    container.innerHTML = `
      <h4>Travel Time Index</h4>
      <div><span style="background:#1A9850"></span> On schedule (<= 1.10)</div>
      <div><span style="background:#FDAE61"></span> Somewhat slow (<= 1.30)</div>
      <div><span style="background:#D73027"></span> Significantly delayed (> 1.30)</div>
    `;
    return container;
  };
  legend.addTo(map);
  return legend;
}

function BostonMap({
  selectedLine = "All",
  mapMode = "overview",
  linePaths = [],
  stationPoints = [],
  segmentData = [],
  selectedSegmentId = null,
  onSegmentSelect,
  cardClassName = "",
}) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const lineLayerRef = useRef(null);
  const stationLayerRef = useRef(null);
  const segmentLayerRef = useRef(null);
  const legendRef = useRef(null);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) {
      return;
    }

    mapRef.current = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView([42.3601, -71.0589], 11);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>',
    }).addTo(mapRef.current);

    lineLayerRef.current = L.layerGroup().addTo(mapRef.current);
    stationLayerRef.current = L.layerGroup().addTo(mapRef.current);
    segmentLayerRef.current = L.layerGroup().addTo(mapRef.current);

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !lineLayerRef.current || !stationLayerRef.current || !segmentLayerRef.current) {
      return;
    }

    lineLayerRef.current.clearLayers();
    stationLayerRef.current.clearLayers();
    segmentLayerRef.current.clearLayers();

    const lineRows = (linePaths || []).filter((linePath) =>
      selectedLine === "All" ? true : linePath.routeId === selectedLine
    );
    for (const linePath of lineRows) {
      L.polyline(linePath.coordinates, {
        color: linePath.lineColor || "#4E6B95",
        weight: mapMode === "travel" ? 2.2 : 3.4,
        opacity: mapMode === "travel" ? 0.35 : 0.78,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(lineLayerRef.current);
    }

    const stationRows = (stationPoints || []).filter((station) =>
      selectedLine === "All" ? true : station.routeId === selectedLine
    );
    for (const station of stationRows) {
      if (!Array.isArray(station.coordinates) || station.coordinates.length < 2) {
        continue;
      }
      const marker = L.circleMarker(station.coordinates, {
        radius: station.isTransferStation ? 4.4 : 3.1,
        color: station.lineColor || "#4E6B95",
        fillColor: station.lineColor || "#4E6B95",
        fillOpacity: station.isTransferStation ? 0.95 : 0.82,
        weight: station.isTransferStation ? 1.5 : 0.9,
      }).addTo(stationLayerRef.current);

      const lineLabel =
        station.rawRouteId && station.rawRouteId !== station.routeId
          ? `${station.routeId} (${station.rawRouteId})`
          : station.routeId;
      const labelText = `${station.stopName} - ${lineLabel}`;

      const showPermanentLabel =
        mapMode === "overview" && (selectedLine !== "All" || station.isTransferStation);

      marker.bindTooltip(labelText, {
        direction: "top",
        sticky: !showPermanentLabel,
        permanent: showPermanentLabel,
        offset: [0, showPermanentLabel ? -2 : -6],
        className: showPermanentLabel ? "station-label-tooltip" : "station-hover-tooltip",
      });
    }

    if (mapMode === "travel") {
      const filteredSegments = (segmentData || []).filter((segment) =>
        selectedLine === "All" ? true : segment.line === selectedLine
      );
      for (const segment of filteredSegments) {
        const medianMin = Number.isFinite(segment.medianTravelTimeSec)
          ? segment.medianTravelTimeSec / 60
          : null;
        const benchmarkMin = Number.isFinite(segment.benchmarkMedianSec)
          ? segment.benchmarkMedianSec / 60
          : null;
        const addedMin =
          medianMin !== null && benchmarkMin !== null
            ? Math.max(0, medianMin - benchmarkMin)
            : null;
        const polyline = L.polyline(segment.coordinates, {
          color: colorForTravelIndex(segment.travelTimeIndex),
          weight: selectedSegmentId === segment.segmentId ? 8 : 5,
          opacity: selectedSegmentId && selectedSegmentId !== segment.segmentId ? 0.45 : 0.95,
          lineCap: "round",
        }).addTo(segmentLayerRef.current);

        polyline.on("click", () => onSegmentSelect?.(segment.segmentId));
        polyline.bindTooltip(
          `${segment.segmentName}<br/>TTI: ${segment.travelTimeIndex.toFixed(2)}x${
            addedMin !== null ? `<br/>Added vs benchmark: ${addedMin.toFixed(1)} min` : ""
          }`,
          { direction: "top", sticky: true }
        );
      }
    }

    if (legendRef.current) {
      map.removeControl(legendRef.current);
      legendRef.current = null;
    }
    if (mapMode === "travel") {
      legendRef.current = addLegendControl(map);
    }

    const bounds = [];
    lineRows.forEach((path) => path.coordinates.forEach((point) => bounds.push(point)));
    stationRows.forEach((station) => {
      if (Array.isArray(station.coordinates) && station.coordinates.length >= 2) {
        bounds.push(station.coordinates);
      }
    });
    if (mapMode === "travel") {
      const filteredSegments = (segmentData || []).filter((segment) =>
        selectedLine === "All" ? true : segment.line === selectedLine
      );
      filteredSegments.forEach((segment) =>
        segment.coordinates.forEach((point) => bounds.push(point))
      );
    }
    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24], maxZoom: 13 });
    }
  }, [
    linePaths,
    mapMode,
    segmentData,
    selectedLine,
    selectedSegmentId,
    onSegmentSelect,
    stationPoints,
  ]);

  return (
    <section className={`map-card${cardClassName ? ` ${cardClassName}` : ""}`}>
      <div className="card-header">
        <h2>{mapMode === "travel" ? "Interactive System Map" : "System Map"}</h2>
        <span className="line-chip">{selectedLine}</span>
      </div>
      <p className="card-subtitle">
        {mapMode === "travel"
          ? "Real segment travel times are encoded by Travel Time Index; click a segment to inspect where and when it slows."
          : "Simplified MBTA line topology with station markers. Transfer labels are always shown; choose one line to label every stop."}
      </p>
      <div ref={containerRef} className="map-container" aria-label="Boston area map" />
    </section>
  );
}

export default BostonMap;
