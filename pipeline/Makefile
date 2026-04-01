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

SAMPLE_FLAG := $(if $(filter 1,$(USE_SAMPLE)),--use-samples,)

.PHONY: setup test ingest clean transform export all

setup:
	$(PYTHON) -m venv --clear $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements.txt

test:
	$(PY) -m pytest -q tests

ingest:
	$(PY) src/ingest.py --year $(YEAR) --raw-dir $(RAW_DIR) --sample-dir $(SAMPLE_DIR) $(SAMPLE_FLAG)

clean:
	$(PY) src/clean.py --year $(YEAR) --raw-dir $(RAW_DIR) --processed-dir $(PROCESSED_DIR)

transform:
	$(PY) src/transform.py --year $(YEAR) --processed-dir $(PROCESSED_DIR)

export:
	$(PY) src/export.py --year $(YEAR) --processed-dir $(PROCESSED_DIR) --web-data-dir $(WEB_DATA_DIR)

all: ingest clean transform export
