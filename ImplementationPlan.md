# Visualizing Boston's MBTA — Implementation Plan

## Project Overview

This document breaks down every coding task required to build the MBTA interactive visualization dashboard, organized into **Epics** (major workstreams) and **Stories** (discrete, deliverable units of work). Each story includes acceptance criteria so the team knows when it's done.

---

## Data Schema Reference (Quick Look)

Before diving in, here are the key fields the team will be working with across all four datasets:

**Shared fields:** `service_date`, `route_id`, `trunk_route_id`, `trip_id`, `direction_id`, `direction`

| Dataset | Unique Key Fields | Core Metric Fields |
|---|---|---|
| **Events** | `stop_id`, `event_type` (ARR/DEP) | `event_time_sec` (epoch), `schedule_deviation_sec` |
| **Headways** | `stop_id`, `prev_trip_id` | `headway_trunk_sec`, `headway_branch_sec`, `benchmark_headway_sec` |
| **Travel Times** | `from_stop_id`, `to_stop_id` | `travel_time_sec`, `benchmark_travel_time_sec` |
| **GTFS Schedules** | `stop_id`, `arrival_time`, `departure_time` | `stop_sequence`, `shape_dist_traveled` |

---

## Epic 1: Project Scaffolding & Environment Setup

**Goal:** Establish a reproducible dev environment with all tooling in place so any team member can clone the repo and start working.

### Story 1.1 — Initialize Repository & Project Structure

Create the monorepo structure that separates data processing from the frontend visualization layer.

```
mbta-viz/
├── data/                  # Raw + processed data (gitignored for large files)
│   ├── raw/
│   ├── processed/
│   └── samples/           # Small sample CSVs for dev/testing
├── pipeline/              # Python data processing
│   ├── src/
│   │   ├── ingest.py
│   │   ├── clean.py
│   │   ├── transform.py
│   │   └── export.py
│   ├── notebooks/         # Exploratory Jupyter notebooks
│   ├── tests/
│   ├── requirements.txt
│   └── Makefile
├── web/                   # JavaScript visualization frontend
│   ├── src/
│   │   ├── components/
│   │   ├── charts/
│   │   ├── utils/
│   │   └── data/          # JSON/Parquet outputs consumed by frontend
│   ├── public/
│   ├── package.json
│   └── vite.config.js
├── docs/                  # Data dictionaries, design specs
├── .gitignore
└── README.md
```

**Acceptance criteria:**
- Repo is cloneable and runnable with `make setup` (Python) and `npm install` (JS)
- README documents how to get started
- `.gitignore` excludes raw CSV files (too large for git)

### Story 1.2 — Python Environment & Dependencies

Set up the Python data pipeline environment.

**Key dependencies:** `pandas`, `pyarrow`, `numpy`, `scipy`, `jupyter`, `pytest`, `great_expectations` (or a lighter validator)

**Acceptance criteria:**
- `requirements.txt` or `pyproject.toml` pins all versions
- Virtual environment creation is documented
- `make test` runs the test suite successfully

### Story 1.3 — Frontend Tooling & Framework Setup

Initialize the web visualization app.

**Key dependencies:** `D3.js` (core viz), `Vite` (bundler), `Svelte` or `React` (UI shell — the team should pick one), `Mapbox GL JS` or `Leaflet` (geo layer)

**Acceptance criteria:**
- `npm run dev` serves a local dev page with hot reload
- A placeholder dashboard page loads with correct routing
- Map library renders a blank Boston-area map

---

## Epic 2: Data Ingestion & Exploration

**Goal:** Download all four datasets, understand their quirks, and document data quality issues before writing any cleaning code.

### Story 2.1 — Automated Data Download Script

Write a Python script that downloads the 2025 CSVs (and optionally historical years) from the MBTA Open Data Portal.

**Implementation notes:**
- The portal serves CSVs via ArcGIS Hub URLs. The script should use `requests` or `urllib` to fetch them programmatically.
- The year should be parameterized so the team can pull 2024, 2023, etc. for historical comparisons.
- Raw files should be stored under `data/raw/{dataset}_{year}.csv`.

**Acceptance criteria:**
- Running `python pipeline/src/ingest.py --year 2025` downloads all four dataset CSVs
- Script logs file sizes and row counts after download
- Checksums or timestamps are stored to avoid redundant re-downloads

### Story 2.2 — Exploratory Data Analysis Notebooks

Create Jupyter notebooks (one per dataset) that profile the data before any cleaning.

**For each dataset, the notebook should document:**
- Row counts and column dtypes
- Null/missing value rates per column
- Value distributions for key fields (e.g., `route_id` values, `direction` values)
- Date range coverage — are there gaps in `service_date`?
- Outlier detection (e.g., `travel_time_sec` values that are negative or absurdly large)
- Green Line branch coverage (historically less reliable per MBTA documentation)

**Acceptance criteria:**
- Four notebooks in `pipeline/notebooks/` with outputs saved
- A summary table of data quality findings is written to `docs/data_quality_report.md`

### Story 2.3 — Create Sample Datasets for Development

Extract small, representative subsets (~10K rows each) for fast iteration during development.

**Approach:** Filter to one month (e.g., January 2025) and one or two lines (Red + Orange) to create manageable dev samples.

**Acceptance criteria:**
- Sample CSVs in `data/samples/` are under 5MB each
- Samples are used as the default data source in all pipeline tests
- A flag or env variable toggles between sample and full data

---

## Epic 3: Data Cleaning Pipeline

**Goal:** Build a robust, testable pipeline that transforms raw CSVs into analysis-ready datasets.

### Story 3.1 — Events Dataset Cleaning

Process raw `rapid_transit_events_{year}.csv` into a clean events table.

**Cleaning steps:**
1. Parse `service_date` as date type and `event_time_sec` as integer (seconds since midnight)
2. Drop rows where `event_time_sec` is null (track circuit failures)
3. Validate `event_type` is one of `ARR` or `DEP` — flag unknowns
4. Compute `event_datetime` by combining `service_date` + `event_time_sec` for full timestamps
5. Add derived field: `hour_of_day` from `event_time_sec` (for temporal aggregations)
6. Validate `route_id` against known set: `Red`, `Orange`, `Blue`, `Green-B`, `Green-C`, `Green-D`, `Green-E`, `Mattapan`
7. Standardize `stop_id` to canonical station names using GTFS `stops.txt` lookup
8. Handle overnight service: `event_time_sec` values > 86400 indicate post-midnight service on the previous `service_date`

**Acceptance criteria:**
- Output Parquet file with no null `event_time_sec` values
- Unit tests validate cleaning logic on sample data
- Logged metrics: rows dropped, null rates before/after

### Story 3.2 — Headways Dataset Cleaning

Process `rapid_transit_headways_{year}.csv`.

**Cleaning steps:**
1. Parse core fields same as Events
2. Handle branch vs. trunk headways: for Red and Green lines, both `headway_trunk_sec` and `headway_branch_sec` exist; for Blue/Orange, `headway_branch_sec` is NULL — the pipeline should fill or flag accordingly
3. Drop rows where `headway_trunk_sec` is null or negative
4. Cap extreme outliers: headways > 3600 sec (1 hour) are almost certainly data errors — the pipeline should flag but not drop them (they may indicate service disruptions worth documenting)
5. Compute `headway_deviation_sec` = `headway_trunk_sec - benchmark_headway_sec` (positive = longer wait than planned)
6. Add `time_period` classification: AM Peak (6:30–9:00), Midday (9:00–15:30), PM Peak (15:30–18:30), Evening (18:30–23:00), Late Night (23:00–1:00)

**Acceptance criteria:**
- Output Parquet preserves both trunk and branch headways
- Branch headway nulls are documented, not silently dropped
- Outlier headways are flagged in a separate column, not removed

### Story 3.3 — Travel Times Dataset Cleaning

Process `rapid_transit_travel_times_{year}.csv`.

**Cleaning steps:**
1. Parse and validate `from_stop_id` and `to_stop_id` against GTFS stops
2. Drop rows with null `travel_time_sec`
3. Compute `travel_time_deviation_sec` = `travel_time_sec - benchmark_travel_time_sec`
4. Create `segment_id` = `{from_stop_id}-{to_stop_id}` for easy grouping
5. Detect slow zones: segments where median `travel_time_deviation_sec` consistently exceeds a threshold (e.g., > 60 sec above benchmark)
6. Add `time_period` classification (same as Headways)

**Acceptance criteria:**
- Every row has a valid `segment_id`
- Slow zone candidates are flagged in output
- Unit tests check edge cases (same origin/destination, missing benchmark)

### Story 3.4 — GTFS Schedule Parsing & Joining

Parse the GTFS Pre-Rating Recap schedule snapshots and create a unified schedule reference table.

**Implementation notes:**
- GTFS is a set of related text files (`stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`, `calendar.txt`, etc.)
- The pipeline needs `stop_times.txt` (scheduled arrival/departure at each stop) joined with `trips.txt` (route and direction) and `calendar.txt` (which days the schedule applies)
- The output should be a lookup table: for each `route_id` + `stop_id` + `time_period` + `season`, what is the scheduled headway and scheduled travel time?

**Acceptance criteria:**
- Unified schedule table covers Fall 2018–2024 and other available seasons
- The table can answer: "What was the scheduled Orange Line headway at Downtown Crossing during AM Peak in Fall 2023?"
- Joins cleanly with performance data on `route_id`, `stop_id`, `direction_id`

### Story 3.5 — Station Metadata & Geography

Create a canonical station reference table with geographic coordinates.

**Data sources:**
- GTFS `stops.txt` for `stop_id`, `stop_name`, `stop_lat`, `stop_lon`
- MassGIS MBTA Rapid Transit shapefile for line geometry (MBTA_ARC for lines, MBTA_NODE for stations)

**Output fields:** `stop_id`, `stop_name`, `route_id`, `line_color`, `latitude`, `longitude`, `stop_sequence` (order along line), `is_transfer_station`

**Acceptance criteria:**
- GeoJSON file with all station points and line paths
- Transfer stations (e.g., Park Street, Downtown Crossing) are correctly flagged
- Station sequence numbers allow ordered rendering along each line

### Story 3.6 — Pipeline Orchestration & Testing

Wire all cleaning steps into a single reproducible pipeline.

**Implementation:**
- `Makefile` targets: `make ingest`, `make clean`, `make transform`, `make export`, `make all`
- Each step reads from the previous step's output directory
- Add `great_expectations` or custom validation checks between steps
- Logging: every step writes to a structured log with row counts, null rates, processing time

**Acceptance criteria:**
- `make all` runs the full pipeline from download to export in one command
- Pipeline is idempotent — running it twice produces the same output
- A failing validation check halts the pipeline with a clear error message

---

## Epic 4: Metric Computation & Aggregation

**Goal:** Transform cleaned event-level data into pre-computed aggregates that the frontend can consume without processing millions of rows in the browser.

### Story 4.1 — On-Time Performance (OTP) Metrics

Compute on-time percentages using the Events dataset.

**Definitions (aligned with the MBTA's own methodology):**
- **On-time:** `schedule_deviation_sec` between -60 and +300 seconds (1 min early to 5 min late)
- **Early:** `schedule_deviation_sec` < -60
- **Late:** `schedule_deviation_sec` > +300

**Aggregation levels:**
- By line, by day → daily OTP per line
- By line, by station, by time period → station-level OTP heatmaps
- By line, by month → trend lines
- System-wide by day → overall daily reliability score

**Output:** JSON files keyed by aggregation level, ready for frontend consumption.

**Acceptance criteria:**
- OTP percentages validated against the MBTA's published monthly scorecards (spot-check a few months)
- Aggregations cover all five lines plus system-wide
- JSON files are under 2MB each (optimized for browser loading)

### Story 4.2 — Headway Regularity Metrics

Compute wait time and service regularity metrics from the Headways dataset.

**Key metrics:**
- **Average headway** by line × station × time period × day type (weekday/weekend)
- **Headway coefficient of variation** (std dev / mean) — measures service regularity; lower = more predictable
- **Excess wait time** = actual avg headway − scheduled avg headway
- **P90 headway** — the wait time that 90% of passengers experience or better (worst-case planning metric)
- **Train bunching rate** — percentage of headways that are < 50% of the scheduled headway (indicates clustered trains)

**Acceptance criteria:**
- Metrics computed at station × time period × month granularity
- Green Line branch comparisons are possible (B vs. C vs. D vs. E)
- Output JSON structured for direct binding to heatmap and bar chart components

### Story 4.3 — Travel Time Reliability Metrics

Compute journey time metrics from the Travel Times dataset.

**Key metrics:**
- **Median travel time** per segment × time period
- **Travel time index** = actual median / benchmark (1.0 = on schedule, 1.3 = 30% slower)
- **Buffer time** = P95 travel time − median travel time (extra time a commuter should budget)
- **Planning time index** = P95 travel time / benchmark (worst-case scenario metric)
- **Slow zone detection:** segments where travel time index has been > 1.5 for 3+ consecutive months

**Acceptance criteria:**
- Segment-level metrics can be joined to station geometry for map rendering
- Time series of travel time index per segment enables trend analysis
- Buffer time is computed for the "commuter insights" dashboard view

### Story 4.4 — Scheduled vs. Actual Comparison Metrics

Join performance data with GTFS schedules to show planned vs. reality.

**Key comparisons:**
- Scheduled headway vs. actual headway by line × time period × season
- Scheduled frequency (trains/hour) vs. actual delivered frequency
- Service delivery rate = actual trips / scheduled trips per day per line

**Acceptance criteria:**
- Metrics cover multiple seasons (at least Fall 2022, 2023, 2024) for trend analysis
- Clear indication of schedule changes (e.g., a line that reduced scheduled service but improved its delivery rate)

### Story 4.5 — Data Export for Frontend

Export all computed metrics in optimized formats for the web frontend.

**Format strategy:**
- **Static JSON** for pre-computed aggregates (OTP trends, headway heatmaps)
- **TopoJSON** for geographic data (station points, line paths) — smaller than GeoJSON
- **CSV** for any datasets users can download
- Consider **Parquet + DuckDB-WASM** if the team wants to enable client-side querying of larger datasets

**Acceptance criteria:**
- All JSON files are minified and gzipped under 2MB per file
- The frontend can load the full dashboard dataset in < 3 seconds on a 4G connection
- A manifest file lists all available data files with descriptions and last-updated timestamps

---

## Epic 5: Frontend — Core Dashboard Shell

**Goal:** Build the application frame, navigation, theming, and shared components before creating individual visualizations.

### Story 5.1 — Dashboard Layout & Navigation

Build the main application shell with responsive layout.

**Components:**
- Top navigation bar with line selector (Red / Orange / Blue / Green / Silver / All)
- Sidebar or tab navigation for dashboard sections: Overview, Reliability, Wait Times, Travel Times, Commuter Tool
- Responsive grid layout that works on desktop (1200px+) and tablet (768px+)
- Dark/light theme toggle (transit data looks great on dark backgrounds)

**Acceptance criteria:**
- Navigation switches between dashboard sections without page reload
- Line selector filters all visible charts to the selected line
- Layout doesn't break between 768px and 1920px viewport widths

### Story 5.2 — Shared Chart Components & Design System

Build reusable chart primitives using D3.js.

**Components to build:**
- `LineChart` — time series with hover tooltip, configurable axes
- `HeatmapGrid` — station × hour matrix with color scale
- `BarChart` — horizontal and vertical variants with grouping support
- `Tooltip` — shared tooltip component with consistent styling
- `Legend` — color scale legend with line-color coding (Red=#DA291C, Orange=#ED8B00, Blue=#003DA5, Green=#00843D, Silver=#7C878E)
- `TimeFilter` — date range picker and time period selector (AM Peak, Midday, PM Peak, etc.)
- `LoadingState` — skeleton loaders for chart areas

**Acceptance criteria:**
- All chart components accept data as props and are reusable across dashboard views
- MBTA line colors are consistent and accessible (WCAG AA contrast)
- Tooltips display on hover with formatted metrics

### Story 5.3 — Data Loading & State Management

Build the data layer that fetches, caches, and filters JSON data for the charts.

**Implementation:**
- Fetch JSON from `/data/` directory (or a CDN in production)
- Client-side filtering by: line, date range, time period, station
- Caching layer so switching between tabs doesn't re-fetch data
- Loading states while data is fetching

**Acceptance criteria:**
- Switching lines or date ranges updates all visible charts
- No redundant network requests when toggling between tabs
- Graceful error state if data fails to load

---

## Epic 6: Frontend — Visualization Views

**Goal:** Build each dashboard section as a complete, interactive view. This is the core deliverable.

### Story 6.1 — System Overview Dashboard

The landing page: a high-level snapshot of system health.

**Charts on this page:**
1. **System Scorecard** — cards showing the latest available OTP by line, with sparkline trends
2. **Daily Reliability Trend** — area chart of system-wide OTP over the past 12 months, with a goal line at the MBTA's target
3. **Line Comparison Radar** — radar/spider chart comparing all lines across 4–5 metrics (OTP, avg headway, travel time index, headway variability, service delivery rate)
4. **Recent Highlights** — callout cards for notable patterns (e.g., "Orange Line OTP improved 8% since track repairs completed in March")

**Acceptance criteria:**
- Page loads with all charts populated in < 2 seconds
- Clicking a line on the radar chart navigates to that line's detail view
- Scorecard sparklines show 90-day trend

### Story 6.2 — Reliability Deep Dive View

Detailed on-time performance analysis.

**Charts on this page:**
1. **OTP Heatmap** — station (y-axis) × hour of day (x-axis), colored by OTP percentage. One heatmap per line, or a combined view with line selector
2. **OTP Calendar Heatmap** — day-of-year grid (like GitHub's contribution chart) colored by daily OTP per line
3. **Delay Distribution** — histogram or violin plot of `schedule_deviation_sec` for the selected line, with vertical lines marking on-time thresholds
4. **Worst Stations Ranking** — horizontal bar chart of stations with lowest OTP, filterable by time period

**Interactions:**
- Clicking a cell in the station × hour heatmap reveals the underlying distribution
- A toggle switches between weekday and weekend views
- A date range slider allows comparing periods (e.g., before vs. after a repair project)

**Acceptance criteria:**
- Heatmap renders all stations in correct geographic order (not alphabetical)
- Color scales are perceptually uniform (use viridis or similar)
- All interactions update smoothly without jank

### Story 6.3 — Wait Times (Headways) View

How long do passengers actually wait?

**Charts on this page:**
1. **Headway Heatmap** — station × hour matrix showing average headway in minutes
2. **Headway Distribution** — box plot or violin per line showing the spread of headways during peak vs. off-peak
3. **Train Bunching Indicator** — scatter plot of consecutive headways (current headway vs. previous headway) colored by regularity; tight clusters near the diagonal = regular service, scattered = unreliable
4. **Green Line Branch Comparison** — grouped bar chart comparing B/C/D/E branch headways at shared trunk stations (e.g., Copley, Park Street)
5. **Excess Wait Time Trend** — line chart of monthly excess wait time per line

**Acceptance criteria:**
- Headway values are shown in minutes (not raw seconds) with one decimal
- Branch comparison clearly shows which Green Line branch is most/least frequent
- Bunching scatter plot includes a reference line for "perfectly even" spacing

### Story 6.4 — Travel Times & Slow Zones View

Where does the system slow down?

**Charts on this page:**
1. **Interactive System Map** — geographic map of all lines with segments colored by travel time index (green = on schedule, yellow = somewhat slow, red = significantly delayed)
2. **Segment Detail Panel** — clicking a segment on the map displays: actual vs. benchmark travel time, buffer time, time-of-day profile, and 12-month trend
3. **Slow Zone Table** — sortable table of segments ranked by travel time index, showing current performance and trend direction (improving / degrading / stable)
4. **Marey Diagram** (stretch goal) — time-space diagram showing all trains on a line over 24 hours, where the slope of each line represents train speed. Slow zones appear as flattened slopes.

**Acceptance criteria:**
- Map segments are correctly positioned geographically using TopoJSON line geometry
- Clicking a segment highlights it and populates the detail panel
- Color scale on map matches the legend and is colorblind-accessible

### Story 6.5 — Commuter Insights Tool

The user-facing "How reliable is MY commute?" tool.

**Interaction flow:**
1. The user selects an origin station and destination station (dropdown or clickable map)
2. The user selects a typical departure time (slider or time picker)
3. The dashboard shows:
   - **Expected travel time** (median) and **worst-case travel time** (P95)
   - **Recommended buffer time** in minutes
   - **Reliability score** for this specific trip (% of trips within 5 min of median)
   - **Time-of-day profile** — chart showing how travel time varies throughout the day for this OD pair
   - **Day-of-week breakdown** — bar chart comparing Mon–Fri performance

**Acceptance criteria:**
- Origin/destination selector only shows valid pairs (same line, correct direction)
- Results update within 500ms of changing inputs
- Buffer time recommendation is actionable (e.g., "Add 7 minutes to this trip on weekday mornings")

### Story 6.6 — Historical Trends & Schedule Changes View

How has service changed over time?

**Charts on this page:**
1. **Year-over-Year OTP** — multi-line chart comparing same months across 2022, 2023, 2024, 2025
2. **Scheduled vs. Actual Frequency** — grouped bar chart showing planned trains/hour vs. delivered, by line and season
3. **Service Delivery Rate Trend** — line chart of (actual trips / scheduled trips) over time, per line
4. **Annotated Timeline** — key events overlaid on performance data (FTA investigation, track repair periods, schedule changes) as vertical markers

**Acceptance criteria:**
- Season/year selector allows comparing any two time periods side by side
- Annotations are sourced from a configurable JSON file (easy to add new events)
- Charts handle missing historical data gracefully (Green Line data gaps)

---

## Epic 7: Interactivity & Polish

**Goal:** Elevate the dashboard from "charts on a page" to a cohesive, polished data story.

### Story 7.1 — Cross-Chart Linking & Brushing

When a user interacts with one chart, related charts should respond.

**Behaviors:**
- Hovering over a station in any chart highlights that station across all charts on the page
- Brushing a date range on a time series filters all other charts to that range
- Selecting a line in the radar chart updates all charts to show that line

**Acceptance criteria:**
- Linked highlighting works across at least 3 charts on a single view
- Brush selection is smooth (debounced, not laggy)
- Clear visual feedback for which filter is active

### Story 7.2 — Responsive Design & Mobile Optimization

Ensure the dashboard works on tablets and large phones.

**Adjustments:**
- Charts stack vertically on narrow screens
- Tooltips reposition to stay on-screen
- Map interactions work with touch (pinch-to-zoom, tap-to-select)
- Commuter tool uses stacked layout instead of side-by-side

**Acceptance criteria:**
- All views are usable at 375px width (iPhone SE)
- No horizontal scrolling on any page
- Touch interactions don't conflict with page scrolling

### Story 7.3 — Accessibility (a11y)

Make the dashboard accessible to screen reader users and keyboard navigators.

**Requirements:**
- All charts have `aria-label` descriptions summarizing the data shown
- Keyboard navigation through interactive elements (tab, enter, arrow keys)
- Color is never the sole means of conveying information — patterns, labels, or icons should supplement it
- Sufficient contrast ratios (WCAG AA minimum)
- Tooltip content is accessible via keyboard focus, not just mouse hover

**Acceptance criteria:**
- Lighthouse accessibility score > 90
- Screen reader can describe each chart's purpose and key findings
- All interactive elements are reachable via keyboard

### Story 7.4 — Performance Optimization

Ensure the dashboard stays fast with large datasets.

**Techniques:**
- Lazy-load chart data per view (don't load travel times data until the user visits that tab)
- Use canvas rendering for scatter plots with > 10K points (D3 + canvas, not SVG)
- Debounce filter updates to prevent excessive re-renders
- Pre-aggregate on the Python side — the browser should never process > 50K rows
- Consider Web Workers for any client-side computation

**Acceptance criteria:**
- Initial page load < 3 seconds on throttled 4G
- Chart transitions complete in < 300ms
- Memory usage stays under 200MB even with all views visited

---

## Epic 8: Documentation, Testing & Deployment

**Goal:** Make the project reproducible, tested, and publicly accessible.

### Story 8.1 — Pipeline Unit & Integration Tests

**Test coverage targets:**
- Cleaning functions: test null handling, outlier flagging, dtype conversions
- Aggregation functions: test known inputs → expected outputs
- Integration: run pipeline on sample data and validate output schema
- Edge cases: empty DataFrames, single-row inputs, all-null columns

**Acceptance criteria:**
- `make test` passes with > 80% coverage on pipeline code
- Tests run in < 30 seconds using sample data
- CI runs tests on every push (GitHub Actions)

### Story 8.2 — Frontend Tests

**Test coverage:**
- Component rendering tests (React Testing Library or Svelte equivalent)
- Data loading and filtering logic (unit tests)
- Snapshot tests for chart component output (optional, can be brittle)
- E2E smoke test: page loads, charts render, filters work (Playwright or Cypress)

**Acceptance criteria:**
- `npm test` passes with coverage on utility functions
- E2E test navigates all five dashboard views without errors
- Tests run in CI alongside pipeline tests

### Story 8.3 — Deployment Setup

Deploy the static dashboard to a public URL.

**Recommended approach:** Static site on GitHub Pages, Vercel, or Netlify. The dashboard is pure frontend — no server is required if data is pre-computed.

**Steps:**
- Build step outputs static HTML/JS/CSS + data JSON files
- Deployment should be configured to serve from `/` with proper caching headers
- Data files get cache-busted by filename hash on update

**Acceptance criteria:**
- Dashboard is live at a public URL
- Page loads correctly without CORS or path issues
- Data files are served with gzip compression

### Story 8.4 — Project Documentation

**Documentation deliverables:**
- `README.md` — project overview, setup instructions, architecture diagram
- `docs/data_dictionary.md` — full schema docs for all raw and processed datasets
- `docs/methodology.md` — how each metric is calculated, with formulas and threshold definitions
- `docs/data_quality_report.md` — known gaps, limitations, and mitigation strategies
- Inline code comments on non-obvious logic (especially cleaning edge cases)

**Acceptance criteria:**
- A new team member can set up the project from the README alone
- Methodology doc is detailed enough for someone to reproduce the metrics independently
- Data quality report is honest about limitations (matches what the EDA notebooks found)

---

## Suggested Sprint Plan

| Sprint | Duration | Epics & Stories | Milestone |
|---|---|---|---|
| **Sprint 1** | 2 weeks | Epic 1 (all), Epic 2 (all) | Environment running, data downloaded, EDA complete |
| **Sprint 2** | 2 weeks | Epic 3 (Stories 3.1–3.4) | All four datasets cleaned and validated |
| **Sprint 3** | 1 week | Epic 3 (Stories 3.5–3.6), Epic 4 (Stories 4.1–4.3) | Station metadata built, core metrics computed |
| **Sprint 4** | 1 week | Epic 4 (Stories 4.4–4.5), Epic 5 (all) | Metrics exported, dashboard shell running |
| **Sprint 5** | 2 weeks | Epic 6 (Stories 6.1–6.3) | Overview, Reliability, and Wait Times views live |
| **Sprint 6** | 2 weeks | Epic 6 (Stories 6.4–6.6) | Travel Times, Commuter Tool, and Trends views live |
| **Sprint 7** | 1 week | Epic 7 (all) | Cross-linking, responsive, accessible, performant |
| **Sprint 8** | 1 week | Epic 8 (all) | Tested, documented, deployed |

**Total estimated timeline: 10–12 weeks**

---

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Green Line data gaps | Some visualizations may be incomplete | Document gaps transparently; show "data unavailable" states rather than hiding the line |
| CSV file sizes exceed memory | Pipeline crashes on full-year datasets | Process in chunks using pandas `chunksize` parameter; consider Dask for large files |
| GTFS schedule versions are hard to align | Scheduled vs. actual comparisons may be inaccurate | Use the Pre-Rating Recap snapshots (already curated by MBTA) rather than raw GTFS archive |
| Frontend performance with large datasets | Charts lag or browser crashes | Pre-aggregate aggressively; never send raw event data to the browser |
| MBTA changes data format mid-year | Pipeline breaks on new downloads | Add schema validation at ingest step; alert on unexpected columns or dtypes |