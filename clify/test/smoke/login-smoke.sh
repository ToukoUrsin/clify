#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/../.."
export CLIFY_HOME="$(mktemp -d)"
port=$((19000 + RANDOM % 500))
log="$CLIFY_HOME/server.log"
python3 test/smoke/login-server.py "$port" "$log" &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; rm -rf "$CLIFY_HOME" /tmp/clify-login-result.json' EXIT
sleep 0.2

CLIFY_USERNAME='fixture@example.test' CLIFY_PASSWORD='fixture-secret' \
  bin/clify login fixture --url "http://127.0.0.1:$port/login" >/tmp/clify-login-result.json

CLIFY_USERNAME='fixture@example.test' CLIFY_PASSWORD='fixture-secret' \
  node test/smoke/login-mcp-smoke.mjs bin/clify "http://127.0.0.1:$port/login"

bin/clify vault show fixture > "$CLIFY_HOME/vault-show.json"

python3 - "$CLIFY_HOME" "$log" <<'PY'
import json, pathlib, sys
home, log = sys.argv[1:]
result = json.loads(pathlib.Path('/tmp/clify-login-result.json').read_text())
assert result['loggedIn'], result
shown = json.loads(pathlib.Path(home, 'vault-show.json').read_text())
assert shown['loggedIn'] and shown['hasPassword'] and shown['createdBy'] == 'user', shown
for f in pathlib.Path(home).rglob('*'):
    if f.is_file() and f.name != 'server.log':
        assert b'fixture-secret' not in f.read_bytes() and b'fixture-session' not in f.read_bytes(), f
request = json.loads(pathlib.Path(log).read_text().splitlines()[0])
assert request['fields'] == ['email', 'password']
assert 'fixture-secret' not in pathlib.Path(log).read_text()
print('PASS login: fills existing-account fields, submits once, session + password only in the encrypted vault')
PY
