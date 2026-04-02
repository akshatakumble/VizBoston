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
  segmentData = [],
  selectedSegmentId = null,
  onSegmentSelect,
}) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const lineLayerRef = useRef(null);
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
    if (!map || !lineLayerRef.current || !segmentLayerRef.current) {
      return;
    }

    lineLayerRef.current.clearLayers();
    segmentLayerRef.current.clearLayers();

    const lineRows = (linePaths || []).filter((linePath) =>
      selectedLine === "All" ? true : linePath.routeId === selectedLine
    );
    for (const linePath of lineRows) {
      L.polyline(linePath.coordinates, {
        color: linePath.lineColor || "#4E6B95",
        weight: mapMode === "travel" ? 2.5 : 4,
        opacity: mapMode === "travel" ? 0.45 : 0.75,
      }).addTo(lineLayerRef.current);
    }

    if (mapMode === "travel") {
      const filteredSegments = (segmentData || []).filter((segment) =>
        selectedLine === "All" ? true : segment.line === selectedLine
      );
      for (const segment of filteredSegments) {
        const polyline = L.polyline(segment.coordinates, {
          color: colorForTravelIndex(segment.travelTimeIndex),
          weight: selectedSegmentId === segment.segmentId ? 8 : 5,
          opacity: 0.95,
          lineCap: "round",
        }).addTo(segmentLayerRef.current);

        polyline.on("click", () => onSegmentSelect?.(segment.segmentId));
        polyline.bindTooltip(
          `${segment.segmentName}<br/>TTI: ${segment.travelTimeIndex.toFixed(2)}x`,
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
    if (mapMode === "travel") {
      segmentData.forEach((segment) => segment.coordinates.forEach((point) => bounds.push(point)));
    }
    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24], maxZoom: 13 });
    }
  }, [linePaths, mapMode, segmentData, selectedLine, selectedSegmentId, onSegmentSelect]);

  return (
    <section className="map-card">
      <div className="card-header">
        <h2>{mapMode === "travel" ? "Interactive System Map" : "System Map"}</h2>
        <span className="line-chip">{selectedLine}</span>
      </div>
      <p className="card-subtitle">
        {mapMode === "travel"
          ? "Segments are colored by travel time index and selectable for detail analysis."
          : "Station and corridor layers render here."}
      </p>
      <div ref={containerRef} className="map-container" aria-label="Boston area map" />
    </section>
  );
}

export default BostonMap;
