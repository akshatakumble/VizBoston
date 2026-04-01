.PHONY: setup test ingest samples eda clean transform export all web-install web-dev

setup:
	$(MAKE) -C pipeline setup

test:
	$(MAKE) -C pipeline test

ingest:
	$(MAKE) -C pipeline ingest

samples:
	$(MAKE) -C pipeline samples

eda:
	$(MAKE) -C pipeline eda

clean:
	$(MAKE) -C pipeline clean

transform:
	$(MAKE) -C pipeline transform

export:
	$(MAKE) -C pipeline export

all:
	$(MAKE) -C pipeline all

web-install:
	cd web && npm install

web-dev:
	cd web && npm run dev
