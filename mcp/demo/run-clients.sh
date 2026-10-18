#!/bin/bash
# Runs the same task (demo/task.txt) against the DEPLOYED clify MCP server in
# four real clients, headless, and writes raw logs to demo/raw/.
#   ./demo/run-clients.sh [claude|codex|mcp-use|inspector ...]   (default: all four)
# Runs on a Linux box with Claude Code, Codex CLI and Chromium. Claude Code and
# the mcp-use agent use claude-opus-5-5; Codex uses its default model.
# The Inspector (Manufact's browser GUI client) runs in headless Chromium and
# chats through its own hosted model; see inspector-gui.mjs.
# Codex asks before any destructiveHint tool; with no human in exec mode we
# pre-approve clify tools (only one writes; its server-side dry-run gate holds).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
URL="${CLIFY_MCP_URL:-https://bold-cloud-h4u6s.run.mcp-use.com/mcp}"
TASK="$(cat "$HERE/task.txt")"
RAW="$HERE/raw"; mkdir -p "$RAW"
WORK="$(mktemp -d /tmp/clify-mcp-demo.XXXX)"
clients=("$@"); [ ${#clients[@]} -eq 0 ] && clients=(claude codex mcp-use inspector)

for c in "${clients[@]}"; do
  start=$(date +%s)
  case "$c" in
    claude)
      cfg="$WORK/mcp.json"
      printf '{"mcpServers":{"clify":{"type":"http","url":"%s"}}}' "$URL" > "$cfg"
      (cd "$WORK" && nice -n 10 claude -p "$TASK" --model claude-opus-5-5 \
        --mcp-config "$cfg" --strict-mcp-config --tools "" --allowedTools "mcp__clify" \
        --output-format stream-json --verbose) > "$RAW/claude.jsonl" 2> "$RAW/claude.stderr"
      ;;
    codex)
      (cd "$WORK" && nice -n 10 codex exec --json --skip-git-repo-check --ephemeral -s read-only \
        -c approval_policy='"never"' \
        -c mcp_servers.google.enabled=false -c mcp_servers.plaud.enabled=false -c mcp_servers.circleback.enabled=false \
        -c "mcp_servers.clify.url=\"$URL\"" \
        -c 'mcp_servers.clify.default_tools_approval_mode="approve"' \
        "$TASK" < /dev/null) > "$RAW/codex.jsonl" 2> "$RAW/codex.stderr"
      ;;
    mcp-use)
      (cd "$HERE" && ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY}" CLIFY_MCP_URL="$URL" \
        nice -n 10 node "$HERE/mcp-use-agent.mjs" "$TASK") > "$RAW/mcp-use.jsonl" 2> "$RAW/mcp-use.stderr"
      ;;
    inspector)
      (cd "$HERE" && exec nice -n 10 node node_modules/@mcp-use/inspector/dist/cli.js --url "$URL" --port 8091 --no-open > "$RAW/inspector-server.log" 2>&1) &
      insp=$!
      sleep 6
      (cd "$HERE" && INSPECTOR_URL=http://localhost:8091/inspector CLIFY_MCP_URL="$URL" \
        nice -n 10 node "$HERE/inspector-gui.mjs" "$TASK") > "$RAW/inspector.jsonl" 2> "$RAW/inspector.stderr"
      kill "$insp" 2>/dev/null
      ;;
    *) echo "unknown client $c" >&2; continue ;;
  esac
  echo "$c: exit $? in $(( $(date +%s) - start ))s → $RAW/$c.jsonl"
done
rm -rf "$WORK"
