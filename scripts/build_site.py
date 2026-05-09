#!/usr/bin/env python3
# Created by claude
# Inject JSON exports into index.template.html → site/index.html.
# Run from project root.
import sys, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB  = ROOT / 'web'
BUILD = ROOT / 'build'
SITE  = ROOT / 'site'
SITE.mkdir(exist_ok=True)

template = (WEB / 'index.template.html').read_text()

mapping = {
    '__META_JSON__':         'meta.json',
    '__TWEETS_MIN_JSON__':   'tweets_min.json',
    '__SESSIONS_JSON__':     'sessions.json',
    '__DAILY_JSON__':        'daily.json',
    '__MONTHLY_JSON__':      'monthly.json',
    '__HOURLY_JSON__':       'hourly.json',
    '__YEAR_HOUR_JSON__':    'year_hour.json',
    '__TOP_SESSIONS_JSON__': 'top_sessions.json',
    '__TOP_DAYS_JSON__':     'top_days.json',
}

missing = [n for n in mapping.values() if not (BUILD / n).exists()]
if missing:
    sys.exit(f'missing build artifacts: {missing}. Run `make data` first.')

for placeholder, fname in mapping.items():
    content = (BUILD / fname).read_text().strip()
    template = template.replace(placeholder, content)

# sanity: any placeholders left?
import re
leftover = re.findall(r'__[A-Z_]+_JSON__', template)
if leftover:
    sys.exit(f'unfilled placeholders remain: {leftover}')

(SITE / 'index.html').write_text(template)
shutil.copy(WEB / 'app.js', SITE / 'app.js')
# OG image: ship pre-rendered file (regenerate manually via web/og-card.html if it changes)
if (WEB / 'og.png').exists():
    shutil.copy(WEB / 'og.png', SITE / 'og.png')

print(f'wrote {SITE/"index.html"} ({len(template)/1024:.1f} KB)')
print(f'wrote {SITE/"app.js"}')
if (SITE / 'og.png').exists():
    print(f'copied {SITE/"og.png"}')
