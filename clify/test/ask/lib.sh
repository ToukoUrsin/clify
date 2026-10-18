# Shared helpers for the ask proofs. Each run-*.sh prints a Markdown transcript.
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1
export PATH="$PWD/bin:$PATH"
HUMAN=clify-agent-b3d326@inkboxmail.com   # Inkbox mailbox: plays the human (1, 2) or the peer agent (3)
nodets() { nice -n 10 node --no-warnings --import ./node_modules/tsx/dist/esm/index.mjs "$@"; }
noansi() { sed -E 's/\x1b\[[0-9;]*m//g'; }
# run "<title>" cmd args...  → heading, the command, its stderr log and stdout JSON
run() {
  local title=$1; shift
  printf '\n### %s\n\n```console\n$' "$title"; printf ' %q' "$@"; printf '\n'
  "$@" 2>&1 | noansi
  local rc=${PIPESTATUS[0]}
  printf '(exit %s)\n```\n' "$rc"
  return 0
}
# side "<title>" logfile → what the other mailbox did, from its log
side() { printf '\n### %s\n\n```console\n' "$1"; noansi < "$2"; printf '```\n'; }
# whoami_brief <site>: clify whoami, trimmed to who/how (the page text is long)
whoami_brief() { clify whoami "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps({k: d.get(k) for k in ("ok","site","via","account","probe","status")}, indent=2))'; }
# thread_summary <ask-id>: what clify stored for an ask (every message it sent, who may answer, the answer)
thread_summary() {
  CLIFY_QUIET=1 clify ask show "$1" | python3 -c 'import json,sys
a=json.load(sys.stdin)["ask"]
keep={k:a.get(k) for k in ("id","to","cc","acceptFrom","status","delegated","answer","ignored")}
keep["sent"]=[{k:s.get(k) for k in ("kind","to","cc","subject","threadId","at")} for s in a["sent"]]
print(json.dumps(keep, indent=2))'
}
