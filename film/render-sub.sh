#!/bin/bash
# Submission cut (~2 min). Run on a Linux render machine: ./render-sub.sh v1 [COMPOSITION]
# (composition Submission = the v10 cut, SubmissionV11 = the v11 cut)
set -euo pipefail
v=${1:-v1}; comp=${2:-Submission}
npx remotion render src/index.ts $comp out/raw-$v.mp4 --codec h264 --crf 19 --audio-bitrate 192k --concurrency 3 --offthreadvideo-cache-size-in-bytes 400000000 --log=error
# loudness to -16 LUFS (web), picture copied untouched
ffmpeg -nostdin -loglevel error -y -i out/raw-$v.mp4 -c:v copy -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 48000 -c:a aac -b:a 192k -movflags +faststart out/clify-submission-$v.mp4
rm out/raw-$v.mp4
ls -la out/clify-submission-$v.mp4
