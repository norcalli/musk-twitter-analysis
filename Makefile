# Created by claude
# Reproducible pipeline: raw CSV → DuckDB → JSON exports → site/.
# Override knobs from the CLI, e.g.:
#   make site SESSION_GAP_MIN=15

SHELL := /usr/bin/env bash
DUCKDB ?= duckdb

# session gap threshold for SQL-side sessionization (minutes)
SESSION_GAP_MIN ?= 30
SESSION_GAP_SEC := $(shell echo $$(( $(SESSION_GAP_MIN) * 60 )))

DB        := build/musk.db
RAW_CSV   := data/musk_raw.csv
EXPORT_STAMP := build/.exports.stamp
EXPORT_JSONS := \
  build/meta.json build/sessions.json build/daily.json build/monthly.json \
  build/hourly.json build/year_hour.json build/top_sessions.json build/top_days.json
SITE_HTML := site/index.html

.DEFAULT_GOAL := all

.PHONY: all data fetch site serve clean nuke

all: site

# Step 0 (optional): re-download upstream dataset.
fetch:
	bash scripts/fetch_data.sh

# Step 1: ingest CSV → DuckDB.
$(DB): $(RAW_CSV) sql/load.sql
	@mkdir -p build
	rm -f $(DB)
	$(DUCKDB) $(DB) -c ".read sql/load.sql"

# Step 2: sessionize using $(SESSION_GAP_SEC).
build/.sessions.stamp: $(DB) sql/sessions.sql
	$(DUCKDB) $(DB) -cmd "SET VARIABLE session_gap_sec=$(SESSION_GAP_SEC);" -c ".read sql/sessions.sql"
	@touch $@

# Step 3: export JSON + parquet (stamp prevents parallel re-runs).
$(EXPORT_STAMP): build/.sessions.stamp sql/exports.sql
	$(DUCKDB) $(DB) -c ".read sql/exports.sql"
	@touch $@

# All export files depend on the stamp.
$(EXPORT_JSONS): $(EXPORT_STAMP)

data: $(EXPORT_STAMP)

# Step 4: build the static site.
$(SITE_HTML): $(EXPORT_JSONS) web/index.template.html web/app.js scripts/build_site.py
	python3 scripts/build_site.py

site: $(SITE_HTML)
	@echo "site ready: $(SITE_HTML)"
	@echo "  serve with: make serve"

# Local dev server.
serve: site
	@echo "→ open http://localhost:8765 (Ctrl+C to stop)"
	cd site && python3 -m http.server 8765

# Light clean — keep raw data + DB.
clean:
	rm -rf build/*.json site

# Nuke everything that can be regenerated.
nuke: clean
	rm -f $(DB) build/*.parquet build/.sessions.stamp $(EXPORT_STAMP)
