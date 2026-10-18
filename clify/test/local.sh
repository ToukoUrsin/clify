#!/usr/bin/env bash
# `npm test`: everything that runs offline on a fresh clone (local mock servers,
# headless Chromium for the login suites). Live-site suites: test/real/run.sh, test/sites/run.sh.
set -u
cd "$(dirname "$0")/.."
fail=0
run() { echo "=== $1"; if bash "$2" > "/tmp/clify-test-$$.log" 2>&1; then tail -n 1 "/tmp/clify-test-$$.log"; echo "PASS $1"; else tail -n 25 "/tmp/clify-test-$$.log"; echo "FAIL $1"; fail=1; fi; }
npx tsc --noEmit && echo "PASS typecheck" || { echo "FAIL typecheck"; fail=1; }
run "smoke (CLI + MCP against a mock site)" test/smoke/smoke.sh
run "discovery (guide, --version, aliases, did-you-mean, list --query)" test/smoke/discovery.sh
run "login smoke (existing-account login, scoped session)" test/smoke/login-smoke.sh
run "accounts (TOTP login, JWT capture, refresh, logout)" test/accounts/local-auth.sh
rm -f "/tmp/clify-test-$$.log"
exit $fail
