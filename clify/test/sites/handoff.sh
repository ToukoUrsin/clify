#!/usr/bin/env bash
# Hand freshly generated CLIs to a separate agent that has never seen clify:
# `claude -p` with only the Bash tool, and Bash limited to `clify ...`.
# Each task prompt is the task plus "use clify". Transcripts + answers go to $OUT/handoff/.
#   CLIFY_HOME=<home with generated sites> test/sites/handoff.sh tasks.txt
set -u
cd "$(dirname "$0")/../.."
tasks="${1:-test/sites/handoff-tasks.txt}"
out="${OUT:-$HOME/clify-runs/handoff-$(date +%H%M)}"; mkdir -p "$out"
export PATH="$PWD/bin:$PATH"
work=$(mktemp -d)   # empty cwd: no project files, no CLAUDE.md
n=0
while IFS= read -r task; do
  [[ -z "$task" || "$task" == \#* ]] && continue
  n=$((n+1))
  echo "== task $n: $task"
  ( cd "$work" && nice -n 10 timeout 900 claude -p "$task Use clify." \
      --model claude-opus-5-5 --tools Bash --allowedTools "Bash(clify:*)" \
      --strict-mcp-config --setting-sources "" \
      ${CLAUDE_KEY_HELPER:+--settings "{\"apiKeyHelper\":\"$CLAUDE_KEY_HELPER\"}"} \
      --output-format stream-json --verbose < /dev/null ) > "$out/task$n.jsonl" 2> "$out/task$n.err"
  python3 - "$out/task$n.jsonl" <<'PY'
import json, sys
calls, result, model, cost = [], None, set(), None
for line in open(sys.argv[1]):
    try: e = json.loads(line)
    except Exception: continue
    if e.get("type") == "assistant":
        m = e["message"]; model.add(m.get("model"))
        for c in m.get("content", []):
            if c.get("type") == "tool_use": calls.append(c["input"].get("command", ""))
    if e.get("type") == "result":
        result = e.get("result"); cost = (e.get("duration_ms"), e.get("num_turns"), e.get("usage", {}).get("output_tokens"))
print("models:", sorted(x for x in model if x))
print("tool calls:"); [print("  $", c[:200]) for c in calls]
print("answer:", (result or "").strip()[:1200])
print("duration_ms, turns, output_tokens:", cost)
PY
done < "$tasks"
