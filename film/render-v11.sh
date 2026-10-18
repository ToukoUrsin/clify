#!/bin/bash
# on any Linux machine with Chrome and ffmpeg (we used a Daytona sandbox): the v11 cut (composition SubmissionV11): typecheck, render, then the review pack
# (frames every 3 s, sheets, loudness, black frames) plus full-resolution frames at the seconds given as arguments
set -euo pipefail
v=${1:-v11}; shift || true
command -v ffmpeg >/dev/null || (sudo apt-get update -qq && sudo apt-get install -y -qq ffmpeg >/dev/null)
npx tsc --noEmit -p . && echo "typecheck OK" || echo "typecheck FAILED"
./render-sub.sh $v SubmissionV11
scripts/review.sh out/clify-submission-$v.mp4 out/review-$v
mkdir -p out/review-$v/full
for t in "$@"; do ffmpeg -nostdin -loglevel error -y -ss "$t" -i out/clify-submission-$v.mp4 -frames:v 1 -q:v 3 "out/review-$v/full/t$t.jpg"; done
ls out/review-$v/full
