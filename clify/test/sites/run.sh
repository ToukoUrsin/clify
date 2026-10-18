#!/usr/bin/env bash
# Fully automatic `clify add` on many real sites (no prior spec), then a table.
#   test/sites/run.sh sites.txt [jobs]      (on the Linux box with Chrome)
# sites.txt: one "url [goal...]" per line; # comments ok. Results: $OUT (default ~/clify-runs/<date>).
set -u
cd "$(dirname "$0")/../.."
list="${1:-test/sites/sites.txt}"; jobs="${2:-4}"
export OUT="${OUT:-$HOME/clify-runs/$(date +%Y%m%d-%H%M)}"; mkdir -p "$OUT"
export CLIFY_HOME="${CLIFY_HOME:-$OUT/home}"
one() {
  local url="$1"; shift; local goal="$*"
  local tag; tag=$(echo "$url" | sed -E 's#https?://##; s#[^A-Za-z0-9]+#_#g; s#_+$##')
  [ -s "$OUT/$tag.json" ] && return 0
  local t0=$(date +%s)
  # Test runs never create accounts unless asked: CLIFY_ADD_FLAGS="--account auto".
  nice -n 10 timeout 1800 bin/clify add "$url" ${goal:+--goal "$goal"} ${CLIFY_ADD_FLAGS:---account none} > "$OUT/$tag.json.tmp" 2> "$OUT/$tag.log"
  echo "{\"url\":\"$url\",\"wall\":$(( $(date +%s) - t0 ))}" > "$OUT/$tag.wall"
  mv "$OUT/$tag.json.tmp" "$OUT/$tag.json"
  echo "done $url ($(( $(date +%s) - t0 ))s)"
}
export -f one
grep -vE '^\s*(#|$)' "$list" | while read -r line; do printf '%s\0' "$line"; done | xargs -0 -P "$jobs" -I{} bash -c 'one {}'
python3 test/sites/table.py "$OUT"
