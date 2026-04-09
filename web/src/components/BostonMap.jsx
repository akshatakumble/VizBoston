import { useEffect, useRef, useState } from "react";
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

function colorForOtp(otp) {
  if (!Number.isFinite(otp)) {
    return "#94a3b8";
  }
  if (otp >= 85) {
    return "#1d4ed8";
  }
  if (otp >= 70) {
    return "#2563eb";
  }
  if (otp >= 55) {
    return "#60a5fa";
  }
  return "#93c5fd";
}

function addTravelLegendControl(map) {
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

function addOverviewLegendControl(map, metricMode, focusBelowTarget) {
  const legend = L.control({ position: "bottomright" });
  legend.onAdd = () => {
    const container = L.DomUtil.create("div", "map-legend-control");

    if (metricMode === "line") {
      container.innerHTML = `
        <h4>System Map</h4>
        <div><span style="background:#DA291C"></span> Red</div>
        <div><span style="background:#ED8B00"></span> Orange</div>
        <div><span style="background:#003DA5"></span> Blue</div>
        <div><span style="background:#00843D"></span> Green</div>
        <div><span style="background:#7C878E"></span> Silver</div>
      `;
      return container;
    }

    container.innerHTML = `
      <h4>Station OTP (size = events)</h4>
      <div><span style="background:#1d4ed8"></span> &ge; 85% (target met)</div>
      <div><span style="background:#2563eb"></span> 70% - 84.9%</div>
      <div><span style="background:#60a5fa"></span> 55% - 69.9%</div>
      <div><span style="background:#93c5fd"></span> &lt; 55%</div>
      <div><span style="background:#94a3b8"></span> No station OTP data</div>
      ${focusBelowTarget ? '<div class="map-legend-note">Showing below-target stations only</div>' : ""}
    `;
    return container;
  };
  legend.addTo(map);
  return legend;
}

function formatPct(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "No data";
}

function formatCount(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString() : "No data";
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
  const fitKeyRef = useRef("");

  const [metricMode, setMetricMode] = useState("otp");
  const [labelMode, setLabelMode] = useState("minimal");
  const [focusBelowTarget, setFocusBelowTarget] = useState(false);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) {
      return;
    }

    mapRef.current = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: true,
    }).setView([42.3601, -71.0589], 11);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
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
        weight: mapMode === "travel" ? 2.2 : selectedLine === "All" ? 4.8 : 6,
        opacity: mapMode === "travel" ? 0.35 : selectedLine === "All" ? 0.74 : 0.9,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(lineLayerRef.current);
    }

    let stationRows = (stationPoints || []).filter((station) =>
      selectedLine === "All" ? true : station.routeId === selectedLine
    );

    if (selectedLine === "All" && mapMode === "overview") {
      const mergedStations = new Map();
      for (const station of stationRows) {
        const lat = station.coordinates?.[0];
        const lon = station.coordinates?.[1];
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          continue;
        }
        const key = station.stopId || `${String(station.stopName || "").toLowerCase()}||${lat.toFixed(5)}||${lon.toFixed(5)}`;
        const bucket = mergedStations.get(key) || {
          ...station,
          lineSet: new Set(),
          totalEvents: 0,
          onTimeEvents: 0,
          lateEvents: 0,
          weightedOtpNumerator: 0,
          weightedOtpDenominator: 0,
          isTransferStation: false,
        };

        bucket.lineSet.add(station.routeId);
        bucket.isTransferStation = bucket.isTransferStation || Boolean(station.isTransferStation);

        if (Number.isFinite(station.totalEvents)) {
          bucket.totalEvents += station.totalEvents;
        }
        if (Number.isFinite(station.onTimeEvents)) {
          bucket.onTimeEvents += station.onTimeEvents;
        }
        if (Number.isFinite(station.lateEvents)) {
          bucket.lateEvents += station.lateEvents;
        }
        if (Number.isFinite(station.otpPct) && Number.isFinite(station.totalEvents) && station.totalEvents > 0) {
          bucket.weightedOtpNumerator += station.otpPct * station.totalEvents;
          bucket.weightedOtpDenominator += station.totalEvents;
        }
        mergedStations.set(key, bucket);
      }

      stationRows = Array.from(mergedStations.values()).map((bucket) => ({
        ...bucket,
        routeId: bucket.lineSet.size > 1 ? "Multi-line" : Array.from(bucket.lineSet)[0] || bucket.routeId,
        otpPct:
          bucket.weightedOtpDenominator > 0
            ? bucket.weightedOtpNumerator / bucket.weightedOtpDenominator
            : Number.isFinite(bucket.otpPct)
              ? bucket.otpPct
              : null,
      }));
    }

    if (mapMode === "overview" && metricMode === "otp" && focusBelowTarget) {
      stationRows = stationRows.filter((station) => !Number.isFinite(station.otpPct) || station.otpPct < 85);
    }

    const maxEvents = stationRows.reduce((currentMax, station) => {
      const value = Number.isFinite(station.totalEvents) ? station.totalEvents : 0;
      return Math.max(currentMax, value);
    }, 0);

    const sequenceExtentsByRoute = new Map();
    for (const station of stationRows) {
      const seq = Number.isFinite(station.stopSequence) ? station.stopSequence : null;
      if (seq === null) {
        continue;
      }
      const key = station.rawRouteId || station.routeId;
      const current = sequenceExtentsByRoute.get(key) || { min: seq, max: seq };
      current.min = Math.min(current.min, seq);
      current.max = Math.max(current.max, seq);
      sequenceExtentsByRoute.set(key, current);
    }

    const highVolumeStops = stationRows
      .filter((station) => Number.isFinite(station.totalEvents))
      .sort((left, right) => (right.totalEvents || 0) - (left.totalEvents || 0))
      .slice(0, 12)
      .map((station) => station.stopId);
    const highVolumeStopSet = new Set(highVolumeStops);

    for (const station of stationRows) {
      if (!Array.isArray(station.coordinates) || station.coordinates.length < 2) {
        continue;
      }

      const hasMetric = metricMode === "otp";
      const fillColor = hasMetric ? colorForOtp(station.otpPct) : station.lineColor || "#4E6B95";
      const scaleBase = maxEvents > 0 && Number.isFinite(station.totalEvents)
        ? Math.sqrt(station.totalEvents / maxEvents)
        : 0;
      const radius = hasMetric
        ? 2.8 + scaleBase * 3.2 + (station.isTransferStation ? 0.4 : 0)
        : station.isTransferStation
          ? 4.4
          : 2.9;

      const marker = L.circleMarker(station.coordinates, {
        radius,
        color: "#ffffff",
        fillColor,
        fillOpacity: 0.95,
        weight: 1.15,
      }).addTo(stationLayerRef.current);

      const lineLabel =
        station.rawRouteId && station.rawRouteId !== station.routeId
          ? `${station.routeId} (${station.rawRouteId})`
          : station.routeId;

      const sequenceKey = station.rawRouteId || station.routeId;
      const sequenceExtent = sequenceExtentsByRoute.get(sequenceKey);
      const isTerminus =
        Number.isFinite(station.stopSequence) &&
        sequenceExtent &&
        (station.stopSequence === sequenceExtent.min || station.stopSequence === sequenceExtent.max);

      const showPermanentLabel =
        mapMode === "overview" &&
        (labelMode === "minimal"
          ? station.isTransferStation
          : selectedLine === "All"
            ? station.isTransferStation || highVolumeStopSet.has(station.stopId)
            : station.isTransferStation || isTerminus);

      const detailTooltip = `
        <strong>${station.stopName}</strong><br/>
        Line: ${lineLabel}<br/>
        OTP: ${formatPct(station.otpPct)}<br/>
        Total events: ${formatCount(station.totalEvents)}<br/>
        On-time events: ${formatCount(station.onTimeEvents)}<br/>
        Late events: ${formatCount(station.lateEvents)}
      `;

      marker.bindTooltip(showPermanentLabel ? station.stopName : detailTooltip, {
        direction: "top",
        sticky: !showPermanentLabel,
        permanent: showPermanentLabel,
        offset: [0, showPermanentLabel ? -2 : -8],
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
      legendRef.current = addTravelLegendControl(map);
    } else {
      legendRef.current = addOverviewLegendControl(map, metricMode, focusBelowTarget);
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

    const nextFitKey = `${mapMode}|${selectedLine}|${lineRows.length}|${stationRows.length}|${segmentData?.length || 0}`;
    if (bounds.length > 0 && fitKeyRef.current !== nextFitKey) {
      fitKeyRef.current = nextFitKey;
      map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24], maxZoom: 13 });
    }
  }, [
    linePaths,
    mapMode,
    metricMode,
    labelMode,
    focusBelowTarget,
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

      {mapMode === "overview" ? (
        <div className="map-control-row" role="group" aria-label="Map controls">
          <label>
            Metric
            <select value={metricMode} onChange={(event) => setMetricMode(event.target.value)}>
              <option value="otp">Station OTP + volume</option>
              <option value="line">Line reference only</option>
            </select>
          </label>
          <label>
            Labels
            <select value={labelMode} onChange={(event) => setLabelMode(event.target.value)}>
              <option value="smart">Smart labels</option>
              <option value="minimal">Transfer-only labels</option>
            </select>
          </label>
          {metricMode === "otp" ? (
            <label className="map-checkbox">
              <input
                type="checkbox"
                checked={focusBelowTarget}
                onChange={(event) => setFocusBelowTarget(event.target.checked)}
              />
              Show below-target stations only
            </label>
          ) : null}
        </div>
      ) : null}

      <p className="card-subtitle">
        {mapMode === "travel"
          ? "Real segment travel times are encoded by Travel Time Index; click a segment to inspect where and when it slows."
          : "Station circles encode OTP and event volume so the map shows reliability hotspots, not just geography. Basemap labels are suppressed to keep focus on transit data."}
      </p>
      <div ref={containerRef} className="map-container" aria-label="Boston area map" />
    </section>
  );
}

export default BostonMap;
