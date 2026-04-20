# VizBoston 🚇

**An interactive visualization dashboard for MBTA rapid-transit reliability analysis.**

VizBoston turns ~8 million rows of MBTA operational data into a single interactive dashboard that answers the question every Boston commuter asks: *how reliable is my line, my station, my commute?*

Built as the final project for EECE 5642 Data Visualization at Northeastern University (Spring 2026).

---

## Overview

The MBTA publishes rich operational data through its open-data portal, but it's distributed across multi-million-row CSVs with inconsistent schemas, and key metrics like on-time performance (OTP) and excess wait time must be computed from scratch by joining events against schedules. VizBoston closes that gap by:

1. **Ingesting** four MBTA feeds (Events, Headways, Travel Times, GTFS Schedules) in one reproducible pipeline
2. **Computing** a consistent set of reliability metrics (OTP, Not-Late, TTI, Headway CV, Excess Wait)
3. **Exposing** the results through twelve complementary visualizations organized from system overview to segment-level detail

---

## Key Findings

At the December 2025 measurement horizon, VizBoston surfaces:

- **System-wide OTP sits near 50%**, well below the MBTA's 85% target — yet the 12-month delta is positive at +9 points/year
- **The 06–07 window is the worst time slice system-wide** at 40.9% OTP, nearly 20 points below mid-day
- **The Silver Line exhibits the most severe train bunching** — four stations have a P90 headway >7 minutes above their mean
- **Green-B runs 19% over scheduled headway, Green-D only 6%** — a 3× operational gap invisible in line-level metrics
- **Excess wait times improved by ~53% system-wide** from December to November
- Only **two track segments are in Critical TTI band**: Hynes→Kenmore (1.41× and degrading) and Milton→Central Ave (1.35× and stable)

---

## Visualizations

The dashboard is organized into four analytical tiers:

### Tier 1 — System-level overview
- **System Scorecard** — five line cards with current OTP, Not-Late rate, Excess Wait, and 90-day sparklines
- **Line Comparison Matrix** — normalized small-multiples across five metrics with a 0–100 composite score
- **System Reliability Trend** — 12-month OTP trajectory per line against the 85% target

### Tier 2 — Geographic and temporal reliability
- **System Map** — Leaflet geographic view, station size = event volume, color = OTP band
- **Reliability Heatmap** — station × 2-hour-bin matrix with a diverging color ramp

### Tier 3 — Service-consistency diagnostics
- **On-Time Window Composition** — early / on-time / late decomposition per line
- **Worst Stations Ranking** — lollipop chart with dot size encoding sample count
- **Train Bunching Indicator** — mean vs. P90 headway scatter
- **Headway Distribution** — peak vs. off-peak IQR box plots with P10–P90 whiskers

### Tier 4 — Temporal trend and segment-level detail
- **Excess Wait Time Trend** — monthly observed-minus-scheduled headway per line
- **Green Line Branch Comparison** — B/C/D/E head-to-head against the 6.5-min schedule
- **Segment Delay Ladder** — track segments ranked by TTI with severity bands and trend arrows

---

## Data Sources

All data drawn from the [MBTA Open Data Portal](https://mbta-massdot.opendata.arcgis.com) (monthly cadence, historical coverage back to 2016):

| Dataset | Description | Approx. rows |
|---|---|---|
| Rapid Transit Events | Arrival/departure at each station | ~2M |
| Rapid Transit Headways | Time between consecutive train departures | ~2M |
| Rapid Transit Travel Times | Duration between station pairs | ~3M |
| GTFS Pre-Rating Schedules | Planned timetables per season | ~1M |

---

## Tech Stack

- **Data pipeline** — Python (Pandas, NumPy)
- **Interactive charts** — D3.js
- **Statistical distributions** — Plotly
- **Geographic view** — Leaflet over OpenStreetMap/CARTO basemap
- **Narrative flow** — Observable conventions

---

## Design Principles

1. **MBTA-aligned color semantics** — each line encoded in its official agency color, consistent across all twelve views
2. **Dark theme with deliberate accent use** — saturated color reserved for data marks; gridlines and basemap desaturated
3. **Dual encoding where channels are ambiguous** — station circles pair size (events) with color (OTP); lollipops pair position with sample-count dot size
4. **Overview → detail → granular funnel** — progressive disclosure from five-line scorecard to station-, segment-, and branch-level drilldowns

---

## Preprocessing Pipeline

The pipeline proceeds in six stages:

1. **Ingestion** — download monthly CSVs from the MBTA Open Data Portal
2. **Filtering & cleaning** — remove records with null timestamps, invalid `stop_id`s, or incomplete trip metadata
3. **Schema standardization** — timezone-aware dates; seconds → minutes where appropriate
4. **Metric computation** — delay, OTP (−60s to +300s tolerance), Not-Late variant, Travel Time Index, Headway CV
5. **Aggregation** — roll up to hourly/daily/weekly buckets and to station and segment granularities
6. **Joining** — link events, headways, travel times by `trip_id` and `stop_id` against the GTFS schedule

Aggregated outputs are serialized to compact JSON so the front end can fetch pre-computed summaries without re-scanning raw rows.

---

## Repository Structure
VizBoston/
├── data/              # raw MBTA CSVs (gitignored; pipeline downloads on run)
├── pipeline/          # Python ingestion, cleaning, metric computation
├── public/            # static JSON outputs served to the front end
├── src/               # JavaScript dashboard (D3, Plotly, Leaflet)
├── notebooks/         # analysis notebooks
└── report/            # final project report (LaTeX source + PDF)

---

## Getting Started

### Prerequisites
- Python 3.10+
- Node.js 18+ (for the dashboard front end)

### Run the pipeline
```bash
cd pipeline
pip install -r requirements.txt
python run_pipeline.py
```

### Run the dashboard
```bash
cd src
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

---

## Contributors

- **[Vidya Kalyandurg](https://github.com/Vidya1811)** — Data ingestion and CSV parsing; processed the Rapid Transit Events and GTFS Schedules datasets; built the System Scorecard, Line Comparison Matrix, System Map, Reliability Heatmap, On-Time Window Composition, and Worst Stations Ranking visualizations.
- **[Akshata Kumble](https://github.com/akshatakumble)** — Data cleaning and schema standardization; processed the Travel Times and Headways datasets; built the System Reliability Trend, Train Bunching Indicator, Headway Distribution, Excess Wait Trend, and Green Line Branch Comparison visualizations.

Both authors contributed equally to the JavaScript interactive shell, Plotly-based statistical charts, Python analysis notebooks, slides, and the final report.

---

## Course

EECE 5642 Data Visualization • Spring 2026 • Instructor: Prof. Y. Raymond Fu • Northeastern University

---

## References

1. Massachusetts Bay Transportation Authority. MBTA Open Data Portal. https://mbta-massdot.opendata.arcgis.com
2. Massachusetts Bay Transportation Authority. Performance Dashboard. https://www.mbta.com/performance
3. M. Barry and B. Card. *Visualizing MBTA Data.* WPI Data Visualization project, 2014. http://mbtaviz.github.io
4. E. R. Tufte. *The Visual Display of Quantitative Information.* Graphics Press, 2nd edition, 2001.
5. S. Few. *Show Me the Numbers: Designing Tables and Graphs to Enlighten.* Analytics Press, 2nd edition, 2012.
