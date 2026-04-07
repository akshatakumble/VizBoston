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

## Windows Reproducibility

Windows users can fully reproduce the dataset outputs in two ways:

### Option A (Recommended): WSL2 Ubuntu

Use WSL2 and run the same commands as Linux/macOS (`make setup`, `make all`, etc.).
This is the lowest-friction path and keeps parity with the rest of the team.

### Option B: Native PowerShell (No `make` required)

From repo root, run:

```powershell
# 1) Python env + deps
py -3 -m venv pipeline\.venv
.\pipeline\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r pipeline\requirements.txt

# 2) Frontend deps
cd web
npm install
cd ..

# 3) Force-download raw datasets (reproducible ingest)
python pipeline\src\ingest.py --year 2025 --raw-dir data\raw --sample-dir data\samples --force-download --timeout-sec 900

# 4) Clean -> Transform -> Export
python pipeline\src\orchestrate.py --step clean --year 2025 --raw-dir data\raw --sample-dir data\samples --processed-dir data\processed --web-data-dir web\src\data --log-dir pipeline\logs
python pipeline\src\orchestrate.py --step transform --year 2025 --raw-dir data\raw --sample-dir data\samples --processed-dir data\processed --web-data-dir web\src\data --log-dir pipeline\logs
python pipeline\src\orchestrate.py --step export --year 2025 --raw-dir data\raw --sample-dir data\samples --processed-dir data\processed --web-data-dir web\src\data --log-dir pipeline\logs
```

Run the dashboard:

```powershell
cd web
npm run dev
```

If script execution is blocked in PowerShell, run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

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

### Reproducible From Fresh Clone (Recommended)

This path is the most reproducible for someone pulling the repo for the first time.
It explicitly force-downloads all source datasets, then runs clean/transform/export.

```bash
make setup
make web-install

# Force a fresh download of every raw source dataset for the target year
cd pipeline
.venv/bin/python src/ingest.py \
  --year 2025 \
  --raw-dir ../data/raw \
  --sample-dir ../data/samples \
  --force-download \
  --timeout-sec 900
cd ..

# Build all downstream artifacts used by the dashboard
make clean YEAR=2025
make transform YEAR=2025
make export YEAR=2025
```

Notes:
- This is large and slower (can use tens of GB in `data/raw`).
- Network access is required.
- ArcGIS metadata and checksums are persisted in `data/raw/download_manifest.json`.
- Per-run ingest details are written to `data/raw/ingest_manifest_{year}.json`.

### Datasets Downloaded by Ingest

`pipeline/src/ingest.py` downloads all of the following by default:

1. `rapid_transit_events_{year}.csv`
2. `rapid_transit_headways_{year}.csv`
3. `rapid_transit_travel_times_{year}.csv`
4. `gtfs_schedules_{year}.csv` (plus extracted GTFS recap files under `data/raw/gtfs_recaps/`)
5. `silver_line_bus_observations_{year}.csv`

### Verify Raw Downloads (Required Files Present)

Run after ingest:

```bash
python3 - <<'PY'
from pathlib import Path

year = 2025
required = [
    "rapid_transit_events",
    "rapid_transit_headways",
    "rapid_transit_travel_times",
    "gtfs_schedules",
    "silver_line_bus_observations",
]

missing = []
for key in required:
    path = Path("data/raw") / f"{key}_{year}.csv"
    if not path.exists() or path.stat().st_size == 0:
        missing.append(str(path))

gtfs_stop_times = list(Path("data/raw").rglob("stop_times.txt"))
if not gtfs_stop_times:
    missing.append("data/raw/**/stop_times.txt (GTFS recap extraction)")

if missing:
    raise SystemExit("Missing required ingest outputs:\\n- " + "\\n- ".join(missing))

print("All required raw datasets are present.")
PY
```

You can also run step-by-step:

```bash
make ingest USE_SAMPLE=0 YEAR=2025
make clean YEAR=2025
make transform YEAR=2025
make export YEAR=2025
```

### Verify Frontend Data Assets (What the UI Actually Loads)

After export, verify every file listed in the export manifest exists:

```bash
python3 - <<'PY'
import json
from pathlib import Path

year = 2025
root = Path("web/src/data")
manifest_path = root / f"data_manifest_{year}.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

missing = []
for entry in manifest.get("files", []):
    rel = entry.get("path")
    if not rel:
        continue
    full = root / rel
    if not full.exists():
        missing.append(str(full))

if missing:
    raise SystemExit("Missing exported frontend assets:\\n- " + "\\n- ".join(missing))

print(f"Manifest OK: {manifest_path}")
print(f"Files listed: {len(manifest.get('files', []))}")
PY
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
cd pipeline
.venv/bin/python src/ingest.py --year 2022 --raw-dir ../data/raw --sample-dir ../data/samples --force-download --timeout-sec 900
.venv/bin/python src/ingest.py --year 2023 --raw-dir ../data/raw --sample-dir ../data/samples --force-download --timeout-sec 900
.venv/bin/python src/ingest.py --year 2024 --raw-dir ../data/raw --sample-dir ../data/samples --force-download --timeout-sec 900
.venv/bin/python src/ingest.py --year 2025 --raw-dir ../data/raw --sample-dir ../data/samples --force-download --timeout-sec 900
cd ..

make clean YEAR=2022 && make transform YEAR=2022 && make export YEAR=2022
make clean YEAR=2023 && make transform YEAR=2023 && make export YEAR=2023
make clean YEAR=2024 && make transform YEAR=2024 && make export YEAR=2024
make clean YEAR=2025 && make transform YEAR=2025 && make export YEAR=2025
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
