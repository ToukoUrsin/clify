#!/usr/bin/env bash
# Local smoke test: static mock server + hand-written spec. No browser, no network.
set -u
here="$(cd "$(dirname "$0")" && pwd)"; clify="$here/../../bin/clify"
export CLIFY_HOME="$(mktemp -d)"; log="$CLIFY_HOME/requests.jsonl"; : > "$log"
mkdir -p "$CLIFY_HOME/sites/demo" && cp "$here/demo.spec.json" "$CLIFY_HOME/sites/demo/spec.json"
python3 "$here/server.py" 18731 "$log" & srv=$!; trap 'kill $srv' EXIT; sleep 0.7
step() { echo "\$ clify $*"; "$clify" "$@"; echo "exit=$?"; echo; }
step list
step demo list-items --limit 2 --fields name,price
step demo get-item --id 1
step demo get-item
step demo sort-items --sort colour
step demo list-items --bogus 1
step demo missing
step demo add-item --name "Test lamp" --price 10
echo "POSTs seen by server after dry-run: $(grep -c '"POST"' "$log")"
step demo add-item --name "Test lamp" --price 10 --yes
echo "POSTs seen by server after --yes: $(grep -c '"POST"' "$log")"
step demo my-items
printf '{"cookies":[{"name":"sid","value":"smoke-secret","domain":"127.0.0.1","path":"/","expires":-1}],"headers":{},"updatedAt":"x"}' > "$CLIFY_HOME/sites/demo/session.json"
step demo my-items --limit 1
echo "cookie on same-host (127.0.0.1) auth request: $(grep '"host": "127.0.0.1' "$log" | tail -1)"
step demo other-host
echo "cookie on localhost (other host) request: $(grep '"host": "localhost' "$log" | tail -1)"
echo "\$ MCP smoke"; node "$here/mcp-smoke.mjs" "$clify" demo demo__list-items '{"limit":1}' demo__add-item '{"name":"MCP lamp"}' | tee "$CLIFY_HOME/mcp.out"
echo "POSTs seen by server after MCP dry-run: $(grep -c '"POST"' "$log")"

# Assertions (exit 1 on any failure)
pass=0; fail=0
check() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then echo "PASS $name"; pass=$((pass+1)); else echo "FAIL $name"; fail=$((fail+1)); fi; }
j() { local filter="$1"; shift; "$clify" "$@" 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($filter) else 1)"; }
check "guide is JSON with the contract"     j "'contract' in d and 'findASite' in d" guide
check "list finds the installed demo site"   j "d['data'][0]['site']=='demo' and d['data'][0].get('local')" list --query demo
check "read: fields + limit"                 j "d['ok'] and d['count']==1 and d['data']==[{'name':'Desk lamp','price':49}] and '2 more rows' in d['more']" demo list-items --limit 1 --fields name,price
check "error: missing param names the flag"  j "not d['ok'] and 'missing --id' in d['error'] and d['next']=='clify demo get-item --help'" demo get-item
check "error: bad enum lists values"         j "not d['ok'] and 'must be one of: name, price' in d['error']" demo sort-items --sort colour
check "error: unknown site suggests add"     j "not d['ok'] and 'clify add' in d['next'] and 'didYouMean' not in d" nosuchsite
check "write: dry-run gives preview + next"  j "d.get('needsConfirmation') and d['preview']['body']['name']=='x' and '--yes' in d['next']" demo add-item --name x
check "url arg fills path param"             j "d['ok'] and d['data']['id']==1" demo get-item --id http://127.0.0.1:18731/item/1.json
check "MCP server version = clify --version" bash -c "grep -qx \"serverVersion: \$('$clify' --version)\" '$CLIFY_HOME/mcp.out'"
check "session cookie only to own host"      bash -c "grep '\"host\": \"localhost' '$log' | tail -1 | grep -q '\"cookie\": null'"
check "help: compact, one line per command"  j "isinstance(d['commands'][0], str) and d['commands'][0].startswith('list-items')" demo
check "command help: params + example"       j "d['example']=='clify demo get-item' and d['params'][0]['name']=='--id' and d['params'][0]['required']" demo get-item --help
check "context: --set fills the omitted flag" bash -c "'$clify' demo context --set id=1 >/dev/null && '$clify' demo get-item | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d[\"ok\"] and d[\"data\"][\"id\"]==1 else 1)'"
check "polish: aliases, account context"      npx tsx "$here/polish-check.ts"
check "present: --limit count, more, nextPage" npx tsx "$here/present-check.ts"
echo "---- $pass passed, $fail failed"
[ $fail -eq 0 ]
