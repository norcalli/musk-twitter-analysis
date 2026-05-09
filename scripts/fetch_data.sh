#!/usr/bin/env bash
# Created by claude
# Re-download the public Musk tweet dataset (snapshot Aug 2025, 56 MB CSV).
set -euo pipefail
cd "$(dirname "$0")/.."

URL='https://raw.githubusercontent.com/MagdalenaRomaniecka/Decompiling-MuskOS/main/data/all_musk_posts%20(1).zip'

mkdir -p data
echo "downloading source dataset…"
curl -sL --max-time 180 "$URL" -o data/muskos_source.zip
echo "  $(wc -c < data/muskos_source.zip) bytes"

echo "extracting…"
( cd data && unzip -o muskos_source.zip >/dev/null && mv "all_musk_posts (1).csv" musk_raw.csv )
wc -l data/musk_raw.csv
