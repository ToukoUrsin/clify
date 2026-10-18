#!/bin/bash
# on any Linux machine with Chrome and ffmpeg (we used a Daytona sandbox): render, then the review pack (frames every 3 s, sheets, loudness, black frames)
set -euo pipefail
v=${1:-v8}
command -v ffmpeg >/dev/null || (sudo apt-get update -qq && sudo apt-get install -y -qq ffmpeg >/dev/null)
./render-sub.sh $v
scripts/review.sh out/clify-submission-$v.mp4 out/review-$v
