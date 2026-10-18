#!/usr/bin/env bash
# Runs agent signups for "name url" lines, N at a time; one JSON result per site in $OUT.
# Usage: test/accounts/batch.sh sites.txt [concurrency]
set -u
cd "$(dirname "$0")/../.."
OUT=${OUT:-$HOME/acct-runs/batch}
mkdir -p "$OUT"
grep -vE '^\s*(#|$)' "$1" | xargs -P "${2:-4}" -L 1 bash -c 'nice -n 10 bin/clify signup "$0" --url "$1" > "'"$OUT"'/$0.json" 2> "'"$OUT"'/$0.log"; echo "$0 $(grep -m1 "\"ok\"" "'"$OUT"'/$0.json")"'
