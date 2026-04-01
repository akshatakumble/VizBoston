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

Run pipeline stages (sample mode by default):

```bash
make ingest
make clean
make transform
make export
make all
```

Use full/raw mode by setting `USE_SAMPLE=0`:

```bash
make ingest USE_SAMPLE=0 YEAR=2025
```

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
