#!/bin/bash
# Copy the repo files the Submission cut plays into public/ (run from the repo root's film/ dir).
set -euo pipefail
cd "$(dirname "$0")/.."
video=$(node -e "console.log(require('./race.json').video)")
mkdir -p public/sub public/ask
src="../$video"; [ -f "$src" ] || src="$RACE_ROOT/$video"
cp "$src" public/sub/race.mp4
rt=$(node -e "console.log(require('./race.json').realtime || '')")
[ -n "$rt" ] && cp "../$rt" public/sub/race-realtime.mp4
for c in claude codex mcp-use inspector; do cp "../mcp/demo/out/$c.mp4" "public/sub/mcp-$c.mp4"; done
cp ../agent/proofs/video/clify-agent.mp4 public/sub/agent.mp4
cp evidence/ask/tally-captcha.jpg public/ask/tally-captcha.jpg
echo "staged $src -> public/sub/race.mp4, MCP clips, agent video"
