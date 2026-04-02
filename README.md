# Visualizing Boston's MBTA

MBTA reliability dashboard monorepo with:
- A Python data pipeline (`pipeline/`)
- A Vite + React frontend (`web/`)
- Local data workspaces (`data/raw`, `data/processed`, `data/samples`)

## Prerequisites

- Python 3.10+
- Node.js 18+
- npm
- `make`

## Fresh Clone Quickstart (Fast Path)

This path is best for first-time setup and uses sample data so you can run everything quickly.

From repo root:

```bash
make setup
make web-install
make all USE_SAMPLE=1 YEAR=2025
make web-dev
```

Open the Vite URL shown in terminal (usually `http://localhost:5173`).

What this does:
- Creates `pipeline/.venv` and installs Python dependencies
- Installs frontend dependencies
- Runs ingest -> clean -> transform -> export with sample datasets
- Writes frontend-ready assets to `web/src/data/`

## Full Data Regeneration (Real MBTA Downloads)

Use this when you want full ArcGIS MBTA data instead of samples.

```bash
make all USE_SAMPLE=0 YEAR=2025
```

Notes:
- This is large and slower (can use tens of GB in `data/raw`).
- Network access is required.
- Default in `pipeline/Makefile` is `USE_SAMPLE=0`.

You can also run step-by-step:

```bash
make ingest USE_SAMPLE=0 YEAR=2025
make clean YEAR=2025
make transform YEAR=2025
make export YEAR=2025
```

## Pipeline Flow

`make all` runs the orchestrator in this order:

1. `ingest`
2. `clean`
3. `transform`
4. `export`

Main entrypoint: `pipeline/src/orchestrate.py`

Structured step logs:
- `pipeline/logs/pipeline_steps.jsonl`

## Key Outputs

### Processed outputs (`data/processed/`)

- `clean_rapid_transit_events_{year}.parquet`
- `clean_rapid_transit_headways_{year}.parquet`
- `clean_rapid_transit_travel_times_{year}.parquet`
- `clean_gtfs_schedules_{year}.parquet`
- `schedule_reference_{year}.parquet`
- `station_reference_{year}.parquet`
- metric JSONs like `otp_*`, `headway_*`, `travel_time_*`, `scheduled_vs_actual_*`, `service_delivery_*`
- `summary_{year}.json`

### Frontend assets (`web/src/data/`)

The UI reads precomputed assets only (no raw event/headway/travel CSVs in-browser).

- `dashboard_summary_{year}.json(.gz)`
- `data_manifest_{year}.json(.gz)`
- `otp_*.json(.gz)`
- `headway_*.json(.gz)`
- `travel_time_*.json(.gz)`
- `scheduled_vs_actual_*.json(.gz)`
- `service_delivery_*.json(.gz)`
- `mbta_transit_geography_{year}.topojson(.gz)`
- `downloads/station_reference_{year}.csv`

## Running the UI

From repo root:

```bash
make web-install
make web-dev
```

Or manually:

```bash
cd web
npm install
npm run dev
```

## Choosing Dashboard Year

Frontend default is `2025`.

If you generated another year, run with matching env var:

```bash
cd web
VITE_DASHBOARD_YEAR=2024 npm run dev
```

## Historical Data (Multi-Year Views)

To populate year-over-year views, generate multiple years:

```bash
make all USE_SAMPLE=0 YEAR=2022
make all USE_SAMPLE=0 YEAR=2023
make all USE_SAMPLE=0 YEAR=2024
make all USE_SAMPLE=0 YEAR=2025
```

## Validation and Tests

Run pipeline tests:

```bash
make test
```

Quick sanity checks after pipeline run:

```bash
cat pipeline/logs/pipeline_steps.jsonl
cat data/processed/summary_2025.json
cat web/src/data/dashboard_summary_2025.json
```

## Troubleshooting

- UI shows "Data could not be loaded": run `make export YEAR=2025` and confirm files exist in `web/src/data/`.
- UI shows empty charts for a year: ensure `VITE_DASHBOARD_YEAR` matches generated assets.
- If you need fast local iteration, always pass `USE_SAMPLE=1` explicitly.
