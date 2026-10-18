#!/usr/bin/env bash
# Real-site end-to-end check. Run on a Linux box with Chrome:
#   test/real/run.sh            → prints PASS/FAIL per check, exit 1 on any FAIL
# Uses a throwaway CLIFY_HOME. Sites: scraping sandboxes (books/quotes.toscrape.com),
# HN Search public API, Wikipedia (/wiki + REST API), scrapethissite.com (sandbox), httpbin echo form (write path), Google's reCAPTCHA demo page
# (to prove clify stops at CAPTCHAs). No logins, no accounts.
set -u
cd "$(dirname "$0")/../.."
export CLIFY_HOME="$(mktemp -d)"
pass=0; fail=0
check() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then echo "PASS $name"; pass=$((pass+1)); else echo "FAIL $name"; fail=$((fail+1)); fi; }
run_with_timeout() {
  local seconds="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout "$seconds" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$seconds" "$@"
  else "$@"
  fi
}
jq_ok() { local filter="$1"; shift; bin/clify "$@" 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($filter) else 1)"; }

# 1. record real browser flows (headless), then install the hand-written specs
for s in books:https://books.toscrape.com/ quotes:https://quotes.toscrape.com/ hnsearch:https://hn.algolia.com/ wikipedia:https://en.wikipedia.org/wiki/Main_Page scrapethis:https://www.scrapethissite.com/pages/ httpbinform:https://httpbin.org/forms/post; do
  n=${s%%:*}; u=${s#*:}; sf=test/real/$n.script.json; [ $n = httpbinform ] && sf=test/real/httpbin-form.script.json
  check "record $n" run_with_timeout 180 bin/clify record "$u" --name $n --script $sf
  cp test/real/$n.spec.json "$CLIFY_HOME/sites/$n/spec.json"
done
check "recorder: books captured category + page 2 + detail" bash -c "grep -q mystery_3/page-2.html $CLIFY_HOME/sites/books/recording.jsonl && grep -q _452/index.html $CLIFY_HOME/sites/books/recording.jsonl"
check "recorder: hnsearch captured search XHR" grep -q 'indexes/Item_dev/query' "$CLIFY_HOME/sites/hnsearch/recording.jsonl"
check "write guard: httpbin POST held, not sent" python3 -c "
import json; es=[json.loads(l) for l in open('$CLIFY_HOME/sites/httpbinform/recording.jsonl') if l.strip()]
posts=[e for e in es if e['method']=='POST']; assert posts and all(e.get('held') for e in posts)"

# 2. CAPTCHA page: must stop, report, and not run the click
echo '[{"tool":"click","input":{"selector":"#recaptcha-demo-submit","intent":"must not run"}}]' > "$CLIFY_HOME/cap.json"
check "captcha: stops and reports blocker" bash -c "! bin/clify record https://www.google.com/recaptcha/api2/demo --name cap --script $CLIFY_HOME/cap.json > $CLIFY_HOME/cap.out 2>$CLIFY_HOME/cap.err; grep -q '\"captcha at' $CLIFY_HOME/cap.out && ! grep -q 'must not run' $CLIFY_HOME/cap.err"

# 3. CLI reads against live sites
check "books list-books"     jq_ok "len(d['data'])==3 and d['data'][0]['price'].startswith('£')" books list-books --page 2 --limit 3
check "books get-book"       jq_ok "d['data']['upc']=='2da5edf8b5776c9a'" books get-book --slug the-mysterious-affair-at-styles-hercule-poirot-1_452
check "quotes get-author"    jq_ok "d['data']['born']=='March 14, 1879'" quotes get-author --slug Albert-Einstein
check "quotes by-tag"        jq_ok "len(d['data'])>0 and all('author' in q for q in d['data'])" quotes by-tag --tag love
check "hnsearch search"      jq_ok "len(d['data'])==3 and all('title' in h for h in d['data'])" hnsearch search --query playwright --limit 3 --fields title,points
check "wikipedia summary"    jq_ok "d['data']['description']=='American startup accelerator'" wikipedia summary --title Y_Combinator --fields title,description
check "wikipedia article"    jq_ok "d['data']['lead'].startswith('Hacker News (HN)')" wikipedia article --title Hacker_News
check "recorder: wikipedia followed in-article link" grep -q '"triggeredBy":"follow a link to another article"' "$CLIFY_HOME/sites/wikipedia/recording.jsonl"
check "scrapethis oscar-films (xhr JSON)" jq_ok "any(f['title'].strip()=='Spotlight' and f['best_picture'] for f in d['data'])" scrapethis oscar-films --year 2015
check "scrapethis search-teams"          jq_ok "d['count']>0 and all('New York' in t['name'] for t in d['data'])" scrapethis search-teams --q "new york" --per_page 25
check "recorder: scrapethis xhr captured, analytics not held" python3 -c "
import json; es=[json.loads(l) for l in open('$CLIFY_HOME/sites/scrapethis/recording.jsonl') if l.strip()]
assert any('ajax=true&year=2015' in e['url'] and e['resourceType']=='xhr' for e in es)
assert not [e for e in es if e.get('held')], [e['url'] for e in es if e.get('held')]"
check "hnsearch get-item"    jq_ok "d['data']['author']=='pg'" hnsearch get-item --id 1 --fields title,author

# 4. errors an agent can act on
check "error: missing param" jq_ok "not d['ok'] and 'missing --slug' in d['error']" quotes get-author
check "error: bad enum"      jq_ok "not d['ok'] and 'must be one of' in d['error']" hnsearch search --query x --tags job
check "error: unknown flag"  jq_ok "not d['ok'] and 'valid: --page' in d['error']" books list-books --wat 1

# 5. write confirmation on a real endpoint (httpbin echoes, stores nothing)
check "write: dry-run preview, nothing sent" jq_ok "d.get('needsConfirmation') and d['preview']['body']['custname']=='e2e'" httpbinform place-order --custname e2e --size small
check "write: --yes sends"                   jq_ok "d['ok'] and d['data']['custname']=='e2e'" httpbinform place-order --custname e2e --size small --yes

# 6. MCP server over stdio against the same live sites
check "mcp: read tool + write preview" bash -c "node test/smoke/mcp-smoke.mjs bin/clify httpbinform httpbinform__place-order '{\"custname\":\"m\"}' | grep -q 'needsConfirmation'"
check "mcp: live read"                  bash -c "node test/smoke/mcp-smoke.mjs bin/clify books books__get-book '{\"slug\":\"the-mysterious-affair-at-styles-hercule-poirot-1_452\"}' | grep -q 2da5edf8b5776c9a"

echo "---- $pass passed, $fail failed"
[ $fail -eq 0 ]
