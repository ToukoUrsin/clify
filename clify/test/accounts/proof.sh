#!/usr/bin/env bash
# For every account the agent created: with no browser, fetch the account's
# own profile via `clify whoami` and via the generated `clify <site> me`
# command, and check the reply shows the agent's email or username.
set -u
cd "$(dirname "$0")/../.."
sites=$(bin/clify vault list | python3 -c 'import json,sys; print(" ".join(s["site"] for s in json.load(sys.stdin)["sites"] if s.get("createdBy")=="agent" and s.get("loggedIn")))')
for s in $sites; do
  w=$(bin/clify whoami "$s" 2>/dev/null)
  m=$(bin/clify "$s" me 2>/dev/null)
  python3 - "$s" "$w" "$m" <<'PY'
import json, sys
site, w, m = sys.argv[1], json.loads(sys.argv[2] or "{}"), json.loads(sys.argv[3] or "{}")
acct = w.get("account") or {}
marks = [x.lower() for x in (acct.get("email"), acct.get("username")) if x]
shows = lambda d: any(k in json.dumps(d).lower() for k in marks)
print(json.dumps({
  "site": site,
  "whoami": w.get("ok", False), "via": w.get("via"), "probe": w.get("probe"),
  "whoamiShowsAccount": shows(w.get("data")),
  "meCommand": m.get("ok", False), "meShowsAccount": shows(m.get("data")),
  "email": acct.get("email"),
}))
PY
done
