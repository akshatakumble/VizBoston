# Visualizing Boston's MBTA

Monorepo scaffold for an MBTA reliability and performance dashboard. This repo includes:
- A Python data pipeline (`pipeline/`)
- A Vite + React frontend (`web/`)
- Local data directories for raw, processed, and sample datasets (`data/`)

## Project Structure

```
VizBoston/
├── data/
│   ├── raw/
│   ├── processed/
│   └── samples/
├── pipeline/
│   ├── src/
│   ├── notebooks/
│   ├── tests/
│   ├── requirements.txt
│   └── Makefile
├── web/
│   ├── src/
│   │   ├── components/
│   │   ├── charts/
│   │   ├── utils/
│   │   └── data/
│   ├── public/
│   ├── package.json
│   └── vite.config.js
└── docs/
```

## Prerequisites

- Python 3.10+
- Node.js 18+
- npm

## Python Setup

From repo root:

```bash
make setup
```

This creates `pipeline/.venv` and installs pinned dependencies.

Run tests:

```bash
make test
```

Run pipeline stages:

```bash
make ingest
make samples
make eda
make clean
make transform
make export
make all
```

`make ingest` uses sample CSVs by default (`USE_SAMPLE=1`). To download full MBTA
datasets from ArcGIS Hub:

```bash
make ingest USE_SAMPLE=0 YEAR=2025
```

You can also run ingestion directly:

```bash
python pipeline/src/ingest.py --year 2025
```

Generate filtered development samples (January + Red/Orange by default):

```bash
make samples YEAR=2025
```

The sampling step enforces a 5MB max per sample CSV (`MAX_SAMPLE_SIZE_MB=5` by default).

Generate one EDA notebook per dataset and a quality report:

```bash
make eda YEAR=2025 EDA_SOURCE=samples
```

Outputs:
- `pipeline/notebooks/*_eda.ipynb` (four profiling notebooks with saved outputs)
- `docs/data_quality_report.md` (summary table across datasets)

## Frontend Setup

```bash
cd web
npm install
npm run dev
```

Open the local URL printed by Vite to see:
- A placeholder dashboard route (`/`)
- An additional route (`/about`)
- A Leaflet map centered on Boston

## Notes

- Raw CSV files are intentionally gitignored to keep repository size small.
- Sample datasets for development should be placed in `data/samples/`.
