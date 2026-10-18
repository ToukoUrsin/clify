#!/bin/bash
# Deploys the server to Manufact Cloud without GitHub (managed upload). Stages
# only the server (no demo/ logs) in a temp dir. The server shares clify's
# runtime core (src/clify.ts re-exports ../clify/src); the managed build only
# sees mcp/, so the stage swaps that re-export for one bundled src/clify.js.
# The cloud link (.mcp-use/cloud/link.json, gitignored) is kept in mcp/
# between deploys.
#   ./scripts/deploy.sh            # first run creates the "clify" server
#   ./scripts/deploy.sh --stage    # only build the upload dir and print its path
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d /tmp/clify-mcp-deploy.XXXX)"
trap 'rm -rf "$STAGE"' EXIT
node "$ROOT/scripts/sync-specs.mjs" || echo "using committed specs"
rsync -a --exclude node_modules --exclude demo --exclude .mcp-use --exclude .env\* --exclude '*.log' "$ROOT/" "$STAGE/"
rm "$STAGE/src/clify.ts"
(cd "$ROOT" && node scripts/bundle-core.mjs "$STAGE/src/clify.js")
if [ "${1:-}" = "--stage" ]; then trap - EXIT; echo "$STAGE"; exit 0; fi
if [ -f "$ROOT/.mcp-use/cloud/link.json" ]; then
  mkdir -p "$STAGE/.mcp-use/cloud" && cp "$ROOT/.mcp-use/cloud/link.json" "$STAGE/.mcp-use/cloud/"
  args=(--json)
else
  args=(--no-github --name clify --json)
fi
(cd "$STAGE" && nice -n 10 npx -y mcp-use@2.10.1 deploy "${args[@]}")
mkdir -p "$ROOT/.mcp-use/cloud" && cp "$STAGE/.mcp-use/cloud/link.json" "$ROOT/.mcp-use/cloud/"
