#!/usr/bin/env bash
# Packs clify (sources + production node_modules) for the in-sandbox `clify check`.
#   test/blaxel/bundle.sh [out.tgz]   (on Linux x64, like the sandbox)
set -eu
cd "$(dirname "$0")/../.."
out="${1:-/tmp/clify-bundle.tgz}"
tmp=$(mktemp -d)
cp -r bin src package.json package-lock.json "$tmp/"
(cd "$tmp" && npm ci --omit=dev --silent --ignore-scripts >/dev/null)
tar czf "$out" -C "$tmp" .
rm -rf "$tmp"
echo "$out $(du -h "$out" | cut -f1)"
