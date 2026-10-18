#!/usr/bin/env bash
# Quick review stills on the box (low priority). Usage: scripts/stills.sh <comp> <outdir> <frame> [frame...]
# e.g. scripts/stills.sh S-record out/dev 30 120 240
set -euo pipefail
cd "$(dirname "$0")/.."
comp=$1; out=$2; shift 2
mkdir -p "$out"
nice -n 19 npx remotion bundle src/index.ts --out-dir build --log=error >/dev/null
for f in "$@"; do
  nice -n 19 npx remotion still build "$comp" "$out/$comp-$(printf %04d "$f").png" --frame="$f" --scale=0.5 --log=error >/dev/null
done
ls "$out" | tail -n "$#"
