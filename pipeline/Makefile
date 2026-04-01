PYTHON ?= $(shell command -v python3.12 || command -v python3.11 || command -v python3)
VENV ?= .venv
PIP := $(VENV)/bin/pip
PY := $(VENV)/bin/python

YEAR ?= 2025
USE_SAMPLE ?= 1
RAW_DIR ?= ../data/raw
PROCESSED_DIR ?= ../data/processed
SAMPLE_DIR ?= ../data/samples
WEB_DATA_DIR ?= ../web/src/data
NOTEBOOK_DIR ?= notebooks
REPORT_PATH ?= ../docs/data_quality_report.md
SAMPLE_MONTH ?= 1
SAMPLE_ROUTES ?= Red,Orange
TARGET_SAMPLE_ROWS ?= 10000
MAX_SAMPLE_SIZE_MB ?= 5
EDA_SOURCE ?= raw

SAMPLE_FLAG := $(if $(filter 1,$(USE_SAMPLE)),--use-samples,)

.PHONY: setup test ingest samples eda clean transform export all

setup:
	$(PYTHON) -m venv --clear $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements.txt

test:
	$(PY) -m pytest -q tests

ingest:
	$(PY) src/ingest.py --year $(YEAR) --raw-dir $(RAW_DIR) --sample-dir $(SAMPLE_DIR) $(SAMPLE_FLAG)

samples:
	$(PY) src/create_samples.py --year $(YEAR) --raw-dir $(RAW_DIR) --sample-dir $(SAMPLE_DIR) --month $(SAMPLE_MONTH) --routes $(SAMPLE_ROUTES) --target-rows $(TARGET_SAMPLE_ROWS) --max-size-mb $(MAX_SAMPLE_SIZE_MB)

eda:
	$(PY) src/eda.py --year $(YEAR) --raw-dir $(RAW_DIR) --sample-dir $(SAMPLE_DIR) --notebook-dir $(NOTEBOOK_DIR) --report-path $(REPORT_PATH) --source $(EDA_SOURCE)

clean:
	$(PY) src/clean.py --year $(YEAR) --raw-dir $(RAW_DIR) --processed-dir $(PROCESSED_DIR)

transform:
	$(PY) src/transform.py --year $(YEAR) --processed-dir $(PROCESSED_DIR)

export:
	$(PY) src/export.py --year $(YEAR) --processed-dir $(PROCESSED_DIR) --web-data-dir $(WEB_DATA_DIR)

all: ingest clean transform export
