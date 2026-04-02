import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

function BostonMap({ selectedLine = "All", mapMode = "overview" }) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);

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

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  return (
    <section className="map-card">
      <div className="card-header">
        <h2>{mapMode === "travel" ? "Segment Map" : "System Map"}</h2>
        <span className="line-chip">{selectedLine}</span>
      </div>
      <p className="card-subtitle">
        {mapMode === "travel"
          ? "Travel-time segments and slow-zone overlays will render here."
          : "Station and corridor layers will render here."}
      </p>
      <div ref={containerRef} className="map-container" aria-label="Boston area map" />
    </section>
  );
}

export default BostonMap;
