#!/bin/bash
# Validate a render and write evidence/<name>-validation.md.
# Usage: scripts/verify-mp4.sh out/clify-primary-v2.mp4 [expected_seconds]
set -euo pipefail
cd "$(dirname "$0")/.."
f=$1; exp=${2:-72}
name=$(basename "$f" .mp4)
dir=out/stills/$name
mkdir -p "$dir" evidence
probe=$(ffprobe -v error -show_entries format=duration,size,bit_rate:stream=codec_name,codec_type,width,height,r_frame_rate,pix_fmt,nb_frames -of json "$f")
dur=$(echo "$probe" | python3 -c "import json,sys;print(round(float(json.load(sys.stdin)['format']['duration']),3))")
size=$(stat -c %s "$f")
sha=$(sha256sum "$f" | cut -d' ' -f1)
# black frames (fully black >0.5 s) and frozen picture (>4 s) are flagged, not fatal
black=$(nice -n 19 ffmpeg -nostdin -i "$f" -vf "blackdetect=d=0.5:pix_th=0.05" -an -f null - 2>&1 | grep -c black_start || true)
freeze=$(nice -n 19 ffmpeg -nostdin -i "$f" -vf "freezedetect=n=0.001:d=4" -an -f null - 2>&1 | grep freeze_start | sed 's/.*freeze_start: //' | tr '\n' ' ' || true)
# representative frames: one per second-band of the frame plan + every 3 s sheet
for t in 1.5 6 15 22 27 33 42 50 55 62 70; do
  nice -n 19 ffmpeg -nostdin -loglevel error -y -ss $t -i "$f" -frames:v 1 -q:v 3 "$dir/t$(printf %05.1f $t).jpg"
done
rm -f "$dir"/sheet-*.jpg
nice -n 19 ffmpeg -nostdin -loglevel error -i "$f" -vf "fps=1/3,scale=640:-1,tile=4x3:padding=4" -q:v 3 "$dir/sheet-%02d.jpg"
ok=PASS
python3 - "$dur" "$exp" <<'EOF' || ok=FAIL
import sys; d, e = float(sys.argv[1]), float(sys.argv[2]); sys.exit(0 if abs(d - e) < 0.5 else 1)
EOF
cat > "evidence/$name-validation.md" <<EOF
# $name validation ($(date -u +%Y-%m-%dT%H:%M:%SZ))

- Artifact: \`$(hostname):$(pwd)/$f\`
- sha256: \`$sha\`
- Size: $size bytes ($(python3 -c "print(round($size/1048576,1))") MiB)
- Duration: ${dur}s (expected ${exp}s): $ok
- Fully black stretches >0.5 s: $black
- Frozen picture >4 s starts at (s): ${freeze:-none}
- Representative frames: \`$dir/t*.jpg\`; contact sheets \`$dir/sheet-*.jpg\` (one frame every 3 s)

\`\`\`json
$probe
\`\`\`
EOF
cat "evidence/$name-validation.md" | head -12
