#!/bin/bash
# Review pack for a render (on a Linux render machine): frames every 3 s, 4x4 contact sheets, loudness, duration.
#   scripts/review.sh out/clify-submission-v1.mp4 out/review-v1
set -euo pipefail
in=$1; out=$2
FF=${FF:-ffmpeg}; FP=${FP:-ffprobe}
mkdir -p "$out/frames"
rm -f "$out"/frames/*.jpg "$out"/sheet-*.jpg
$FP -v error -show_entries format=duration,size,bit_rate:stream=codec_name,width,height,r_frame_rate,nb_frames -of default=nw=1 "$in" > "$out/probe.txt"
$FF -nostdin -loglevel error -i "$in" -vf "fps=1/3,scale=960:-1" -q:v 3 "$out/frames/f%03d.jpg"
$FF -nostdin -loglevel error -pattern_type glob -i "$out/frames/f*.jpg" -vf "tile=4x4:padding=6:color=black" -q:v 3 "$out/sheet-%02d.jpg"
$FF -nostdin -hide_banner -i "$in" -af ebur128=peak=true -f null - > "$out/ebur.txt" 2>&1 || true
grep -A14 "Summary" "$out/ebur.txt" > "$out/loudness.txt" || true
$FF -nostdin -hide_banner -i "$in" -vf "blackdetect=d=0.5:pix_th=0.05" -an -f null - 2>&1 | grep blackdetect > "$out/black.txt" || true
cat "$out/probe.txt" "$out/loudness.txt" "$out/black.txt"
