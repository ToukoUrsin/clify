#!/bin/bash
# Stills every 2 s from a render + 4x4 contact sheets (960x540 cells). Usage: scripts/contact.sh out/clify-demo-v2.mp4 out/stills
set -euo pipefail
in=$1; out=$2
mkdir -p "$out/frames"
rm -f "$out"/frames/*.jpg "$out"/sheet-*.jpg
nice -n 19 ffmpeg -nostdin -loglevel error -i "$in" -vf "fps=1/2,scale=960:-1" -q:v 3 "$out/frames/f%03d.jpg"
nice -n 19 ffmpeg -nostdin -loglevel error -pattern_type glob -i "$out/frames/f*.jpg" -vf "tile=4x4:padding=6:color=black" -q:v 3 "$out/sheet-%02d.jpg"
ls "$out" | grep sheet
