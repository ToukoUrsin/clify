#!/usr/bin/env python3
"""Markdown transcript of a `claude -p --output-format stream-json` run: each shell
command with its output (long outputs trimmed), then the final answer.
  python3 test/sites/transcript-md.py run.jsonl [max output lines, default 25]"""
import json, sys

path = sys.argv[1]; keep = int(sys.argv[2]) if len(sys.argv) > 2 else 25
calls, results, models, final = [], {}, set(), None
for line in open(path):
    try: e = json.loads(line)
    except ValueError: continue
    if e.get("type") == "assistant":
        m = e["message"]; models.add(m.get("model"))
        for c in m.get("content", []):
            if c.get("type") == "tool_use": calls.append((c["id"], c["input"].get("command", json.dumps(c["input"]))))
    elif e.get("type") == "user":
        for c in e["message"].get("content", []):
            if isinstance(c, dict) and c.get("type") == "tool_result":
                body = c.get("content")
                if isinstance(body, list): body = "\n".join(x.get("text", "") for x in body if isinstance(x, dict))
                results[c["tool_use_id"]] = (body or "", c.get("is_error", False))
    elif e.get("type") == "result":
        final = e

def trim(text):
    lines = text.rstrip("\n").split("\n")
    return "\n".join(lines[:keep] + ([f"… ({len(lines) - keep} more lines)"] if len(lines) > keep else []))

print(f"Model: {', '.join(sorted(m for m in models if m))}. Duration {round(final['duration_ms'] / 1000)} s, "
      f"{final['num_turns']} turns, {len(calls)} shell commands.\n")
for n, (cid, cmd) in enumerate(calls, 1):
    out, err = results.get(cid, ("", False))
    flag = "(tool error)\n" if err and not out.startswith("Exit code") else ""
    print(f"### {n}\n````bash\n{cmd}\n````\n````\n{flag}{trim(out)}\n````\n")
print("## Final answer\n")
print(final.get("result", "").strip())
