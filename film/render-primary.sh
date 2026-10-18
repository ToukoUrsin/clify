#!/bin/bash
# Primary judge cut (72 s). Run on a Linux render machine: ./render-primary.sh v2
set -euo pipefail
v=${1:-v2}
node scripts/check-real-data.mjs
npx remotion render src/index.ts Primary out/clify-primary-$v.mp4 --codec h264 --crf 20 --audio-bitrate 192k --concurrency 4 --log=error
npx remotion render src/index.ts PrimarySilent out/clify-primary-$v-silent-master.mp4 --codec h264 --crf 16 --concurrency 4 --log=error
ls -la out
