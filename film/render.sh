#!/bin/bash
# Full renders (on a Linux render machine). Usage: ./render.sh v1
set -euo pipefail
v=${1:-v1}
node scripts/check-real-data.mjs
npx remotion render src/index.ts Main out/clify-demo-$v-musicbed.mp4 --codec h264 --crf 18 --concurrency 4 --log=error
npx remotion render src/index.ts MainVO out/clify-demo-$v.mp4 --codec h264 --crf 23 --audio-bitrate 192k --concurrency 4 --log=error
ls -la out
