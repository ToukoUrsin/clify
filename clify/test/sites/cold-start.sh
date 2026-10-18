#!/usr/bin/env bash
# Cold start: a fresh `claude -p` (Bash only) in an empty directory, with no clify
# installed and an empty CLIFY_HOME, gets one sentence: clone the repo and use
# clify for a task on a site with no spec. Transcript → $OUT/cold-start.jsonl.
#   test/sites/cold-start.sh <repo path or URL> "<task>"
set -u
repo="$1"; task="$2"
out="${OUT:-$HOME/clify-runs/cold-$(date +%H%M)}"; mkdir -p "$out"
work=$(mktemp -d); home=$(mktemp -d)
command -v clify >/dev/null && { echo "clify is already on PATH; not a cold start"; exit 1; }
echo "cwd=$work CLIFY_HOME=$home"
( cd "$work" && CLIFY_HOME="$home" nice -n 10 timeout 3600 claude -p "Clone $repo and use clify to $task" \
    --model claude-opus-5-5 --tools Bash --allowedTools Bash \
    --strict-mcp-config --setting-sources "" \
    ${CLAUDE_KEY_HELPER:+--settings "{\"apiKeyHelper\":\"$CLAUDE_KEY_HELPER\"}"} \
    --output-format stream-json --verbose < /dev/null ) > "$out/cold-start.jsonl" 2> "$out/cold-start.err"
echo "exit=$? transcript=$out/cold-start.jsonl"
