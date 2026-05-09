# How much time does Elon Musk spend on Twitter?

An interactive analysis of Elon Musk's public X.com posting history.
Pipeline: raw CSV → DuckDB → JSON exports → static HTML with live‑tunable knobs.

The website ships with the entire dataset inlined (~1 MB). Every
visualization that depends on time‑cost assumptions recomputes
client‑side when you move a slider, so users can plug in their own
estimates instead of arguing about mine.

## Data source

`data/musk_raw.csv` — a community‑maintained dataset of public posts
from `@elonmusk`, snapshot Aug 2025, covering **2010‑06‑04 → 2025‑04‑13**.
After dedupe: **55 099 posts**.

Re‑download with `make fetch`.

## Build

You need: `duckdb` (≥1.0), `python3`, `make`.

```bash
make fetch       # download upstream dataset (only first time)
make             # = make site
make serve       # local dev server on :8765
make clean       # rm build/ and site/
make nuke        # also drop the DuckDB
```

The site is fully static — `site/index.html` + `site/app.js` + `site/og.png` is the deployable output.

## Deploy to GitHub Pages

A workflow at `.github/workflows/deploy.yml` rebuilds and deploys on every push to `main`.

To turn it on for a fresh repo:

```bash
gh repo create <repo-name> --public --source=. --remote=origin --push
gh repo edit --enable-issues=false
# In the GitHub Settings → Pages → Source, pick "GitHub Actions"
```

The workflow installs DuckDB, runs `make fetch && make site`, and uploads `site/` as the Pages artifact. First deploy takes ~2 min.

The session gap is now a slider in the page itself, but the SQL side still has a default for the initial sessions table (used as a starting point):

```bash
make site SESSION_GAP_MIN=15   # different starting gap; the page slider can still override
```

## Layout

```
data/      raw inputs (musk_raw.csv, muskos_source.zip)
sql/       DuckDB pipeline (load → sessionize → export)
web/       site source — index.template.html, app.js
scripts/   build_site.py, fetch_data.sh
build/     intermediate artifacts (DuckDB, parquet, JSON)  — gitignored
site/      final static site (open site/index.html)         — gitignored
```

## How the time estimate works

Each post is classified as `original`, `reply`, `quote`, or `retweet`.
The page assigns a minimum cost per post:

```
post_cost = read_context (replies + quotes only)
          + think (kind‑specific)
          + chars / type_cps
          + send_overhead
```

Posts get grouped into **sessions** — consecutive posts with all gaps
≤ `session_gap_min` minutes. Per session:

```
session_time = max(span + 2*edge_pad, Σ post_cost)
```

Daily total = sum over sessions of session_time.

This is a **lower bound** — pure scrolling without posting is invisible.

## Visualizations on the page

- Headline cards (total, per‑day average, % of waking life, equivalent workyears…)
- Hours/day time series (28‑day rolling)
- 15‑year calendar heatmap (GitHub style)
- Hour‑of‑day clock plot
- Day‑of‑week × hour heatmap
- Year × hour "does he sleep" heatmap
- Tweet‑type composition stacked area
- Monthly hours bar chart
- Top binge sessions table
- Top single‑day post counts
