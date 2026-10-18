#!/usr/bin/env bash
# Finding a site, offline: guide size, --version, host aliases, did-you-mean, list --query.
# Uses only the shipped specs; nothing here touches the network.
set -u
here="$(cd "$(dirname "$0")" && pwd)"; clify="$here/../../bin/clify"
export CLIFY_HOME="$(mktemp -d)"; trap 'rm -rf "$CLIFY_HOME"' EXIT
pkg_version="$(node -p "require('$here/../../package.json').version")"
pass=0; fail=0
check() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then echo "PASS $name"; pass=$((pass+1)); else echo "FAIL $name"; fail=$((fail+1)); fi; }
j() { local filter="$1"; shift; "$clify" "$@" 2>/dev/null | python3 -c "import json,sys; raw=sys.stdin.read(); d=json.loads(raw); sys.exit(0 if ($filter) else 1)"; }

check "--version prints exactly the package.json version" bash -c "[ \"\$('$clify' --version)\" = '$pkg_version' ]"
check "guide is JSON under 3 KB, no site list"  j "len(raw) < 3072 and 'sites' not in d and 'contract' in d and 'findASite' in d" guide
check "no args = guide"                          j "'contract' in d and len(raw) < 3072"
check "guide: ask a human, CAPTCHA rule"        j "'clify ask|approve|forward' in d['commands'] and any('CAPTCHA' in x and 'clify ask' in x for x in d['contract'])" guide
check "ask|approve|forward --help: usage, ok"     bash -c "set -o pipefail; for c in ask approve forward; do '$clify' \$c --help | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d[\"ok\"] and d[\"usage\"] else 1)' || exit 1; done"
check "guide docs exist on disk"                 j "d['docs'] and all(__import__('os').path.exists(p) for p in d['docs'].values()) and 'SKILL.md' in d['docs']" guide
check "guide and mcp agree on version"           j "d['version'] == '$pkg_version'" guide
check "alias: clify crates.io -> crates help"    j "d['site'] == 'crates' and len(d['commands']) > 0" crates.io
check "alias: URL with www and path"             j "d['site'] == 'crates'" https://www.crates.io/crates/serde
check "alias: www.pypi.org -> pypi"              j "d['site'] == 'pypi'" www.pypi.org
check "did-you-mean: cratse -> crates"           j "not d['ok'] and d['didYouMean'][0] == 'crates' and len(d['didYouMean']) <= 10 and d['next'] == 'clify crates' and 'clify add' not in raw and 'sites' not in d" cratse
check "did-you-mean: never the whole catalogue"  j "not d['ok'] and len(d.get('didYouMean', [])) <= 10" a
check "list --query rust: crates in top 3, compact" j "d['ok'] and 'crates' in [x['site'] for x in d['data'][:3]] and len(raw) < 4000 and all(len(x['description']) <= 170 for x in d['data'])" list --query rust
check "list --category dev: only dev sites"      j "d['ok'] and d['count'] > 5 and all(x['category'] == 'dev' for x in d['data'])" list --category dev --limit 100
check "plain list: one line per site"            bash -c "n=\$('$clify' list | grep -c '^  {\"site\"'); [ \"\$n\" -ge 100 ]"
check "description keeps U.S. mid-sentence"      j "any('U.S. air quality' in x['description'] for x in d['data'])" list --query airnow
check "whoami on a public site: none needed"     j "d['ok'] and d['account'] == 'none needed'" whoami crates
echo "---- $pass passed, $fail failed"
[ $fail -eq 0 ]
