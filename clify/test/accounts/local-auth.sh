#!/usr/bin/env bash
# Local proof: TOTP login, localStorage JWT capture, plain-HTTP session use,
# automatic refresh of an expired access token, logout. No model, no network.
set -u
cd "$(dirname "$0")/../.."
export CLIFY_HOME="$(mktemp -d)" CLIFY_VAULT_KEY="test-vault-key-$RANDOM"
port=$((19500 + RANDOM % 400))
secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP
python3 test/accounts/auth-server.py "$port" agent@example.test 's3cret-Pa55!' "$secret" 8 &
pid=$!
trap 'kill $pid 2>/dev/null; rm -rf "$CLIFY_HOME"' EXIT
sleep 0.5
c=bin/clify
step() { echo "── $*"; }
fail=0
check() { if eval "$1"; then echo "PASS $2"; else echo "FAIL $2"; fail=1; fi; }

step "login --user with TOTP 2FA (credentials + 2FA secret from env, stored encrypted)"
CLIFY_USERNAME=agent@example.test CLIFY_PASSWORD='s3cret-Pa55!' CLIFY_TOTP=$secret \
  $c login local --user --url "http://127.0.0.1:$port/login" > /tmp/la1.json
cat /tmp/la1.json
check 'grep -q "\"ok\": true" /tmp/la1.json' "TOTP login signs in and the saved session works over HTTP"
check '! grep -rq "s3cret-Pa55" "$CLIFY_HOME"' "password is not stored in plain text anywhere under CLIFY_HOME"

step "vault show"
$c vault show local | tee /tmp/la2.json
check 'grep -q "\"canRefresh\": true" /tmp/la2.json' "refresh request recorded from the app's own traffic"
check 'grep -q "api/me" /tmp/la2.json' "who-am-I probe found (/api/me)"

step "session check right away"
$c session local check

step "wait for the 8 s access token to expire"
sleep 10
$c session local check > /tmp/la3.json; cat /tmp/la3.json
check 'grep -q "\"valid\": false" /tmp/la3.json' "expired access token is detected (401)"

step "session refresh (replays the app's refresh request, no browser)"
$c session local refresh > /tmp/la4.json; cat /tmp/la4.json
check 'grep -q "\"refreshed\": true" /tmp/la4.json && grep -q "\"sessionValid\": true" /tmp/la4.json' "refresh renews the token and the session works again"

step "expire again; whoami goes through ensureAccount, which refreshes before any re-login"
sleep 10
$c whoami local > /tmp/la5.json; cat /tmp/la5.json
check 'grep -q "\"via\": \"refreshed\"" /tmp/la5.json && grep -q "agent@example.test" /tmp/la5.json' "ensureAccount refreshes instead of logging in again"

step "logout, then whoami logs in again (TOTP from the vault)"
$c logout local
$c whoami local > /tmp/la6.json; cat /tmp/la6.json
check 'grep -q "\"via\": \"login\"" /tmp/la6.json' "re-login with vault credentials + TOTP"
exit $fail
