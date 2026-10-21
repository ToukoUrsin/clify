# clify

Turn a website into a CLI and an MCP server your agent can use instead of a browser.

```bash
clify add https://crates.io/          # explore, generate, verify, install: about 3 minutes
crates search-crates --q "http client" --sort downloads --limit 3
```

A headless browser explores the site once and records the requests behind what it clicks. Claude turns the recording into typed commands, each read command is run live and repaired until it returns real data, and the CLI is installed as `clify <site>` (plus a `~/.clify/bin/<site>` shim) and as MCP tools. Agents then call the site's own endpoints directly. Output is JSON, errors name the exact next command, and anything that changes data needs explicit confirmation.

**What is proven** (live, 2026-10-18, details in [proofs/](proofs/)):
- `clify add` with no hand-written spec on 44 public sites it had never seen (package registries, docs, government data portals, science catalogs, news, search-heavy SPAs): 41 (93%) ended with 3 or more live-verified commands, 514 verified commands in total, 2–6 minutes per site. The 3 misses are sites behind bot walls (AWS WAF, Cloudflare), which clify reports and does not get around.
- Then 116 more unseen sites (dev registries, US/EU/Nordic open data, science, museums and libraries, maps and weather, sports, jobs, news) with each site's browser in its own [Blaxel](https://blaxel.ai) sandbox and every generated CLI re-verified inside that sandbox: 92 (79%) with 3 or more commands verified on Blaxel, 1,120 verified commands. Together: **133 of 160 sites with ≥3 verified commands, 1,634 verified commands** ([proofs/sites-blaxel.md](proofs/sites-blaxel.md), [proofs/wall.json](proofs/wall.json)).
- A separate agent (`claude -p`, Bash restricted to `clify`) given only the task and "Use clify" solved 6/6 real tasks on those generated CLIs.
- In the repo's 20-task benchmark, agents using clify were 1.8× faster with 4.8× fewer tokens than agents clicking through a browser ([../bench](../bench/README.md)).
- It does not work on every site: bot walls, CAPTCHAs, pages whose data only exists after heavy client-side rendering with no API, and robots.txt-disallowed sections are reported as blockers.

Agents: start with [AGENTS.md](AGENTS.md), [llms.txt](llms.txt), [SKILL.md](SKILL.md) or `clify guide`.

## Install

```bash
cd clify
npm install                                   # Node 22+
npx playwright install chromium               # for `clify add` / `repair` / login (or point CLIFY_CHROME at Chrome)
export PATH="$PWD/bin:$HOME/.clify/bin:$PATH" # or: npm install -g .
export ANTHROPIC_API_KEY=...                  # only for `clify add` / `repair`
npm test                                      # offline suites
clify list                                    # 153 verified site CLIs ship built in (specs/)
```

## How `clify add` works

1. **Explore** (`src/explore.ts`, `src/browser.ts`). Claude drives headless Chrome like a power user: search with a real query, each filter, sort, page 2, two detail pages, secondary listings, API-docs links, and the signed-in features when there is an account. The recorder keeps every XHR/fetch/document request with its response; page navigations that robots.txt disallows are blocked. Writes are held (recorded, never sent) unless `--allow-writes`; on real-identity social networks (LinkedIn, X, Facebook, Instagram, ...) writes are always held and no write commands are generated.
2. **Synthesize** (`src/digest.ts`, `src/synth.ts`). The recording is grouped into endpoints and described compactly: JSON as schema plus sample, HTML as a selector outline with repeated-item hints, embedded JSON (`__NEXT_DATA__`, ld+json) called out. Claude writes the commands: kebab-case names, typed params with enums/defaults/examples, `resultPath` or CSS `extract`, default fields, pagination (page/offset/cursor), GraphQL operations, form posts with fetch-then-submit CSRF, `auth` and `mutates` flags. `normalizeCommands` makes the output safe: valid names, path params that match the template, no cookies or auth headers hard-coded, writes marked as writes.
3. **Verify + repair** (`src/verify.ts`). Every read command runs live with its example args. Output must be non-empty data (not a login page, an empty list, page text or an error payload). Failures, and passing output that looks wrong, go back to Claude with evidence from the live response; up to 3 rounds. Bot checks are reported, never retried around. What still fails moves to `spec.dropped` (hidden from agents, kept for `clify repair`). Writes are never sent here; their dry-run preview is built.
4. **Polish** (`src/polish.ts`). Commands that replay the same request collapse into one with aliases. On a signed-in site, ids that are constant for the account (current organization, project, team, workspace, user) become `context`: the recording used one value for them on several commands, or a live read confirms it (the only item of a list, a field of the account object). Those flags then default to the account's value (`clify <site> context`; never on delete-like writes), so the agent does not look them up. Every command keeps a runnable example from its verified call, without the context flags, and a sample of its output.
5. **Install** (`src/add.ts`). `spec.json` goes to `~/.clify/sites/<site>/`, the shim to `~/.clify/bin/<site>`, and `clify mcp` serves it. The summary (also in `add-report.json`) lists generated, verified and dropped commands with reasons, blockers, time and `next` commands.

Accounts: when the explorer reports that the useful features need a login, `clify add` calls `ensureAccount()` (`src/accounts.ts`, the accounts module) with `--account auto|agent|user|none` and explores again signed in. A saved session in the vault is used from the start. At run time a 401/403 or a redirect to the login page triggers one automatic re-login and retry.

## Remote browser (Blaxel)

`clify add` can explore with a Chrome that runs somewhere else: set `CLIFY_CDP_URL` (or pass `--cdp <url>`) to a DevTools endpoint (`ws://`, `wss://` or `http://host:9222`) and the explorer connects over CDP (`chromium.connectOverCDP`) instead of launching a local Chrome. Recording, the write guard and robots.txt blocking work the same. `CLIFY_CDP_HEADERS='{"X-Token":"..."}'` adds headers to the handshake. Without the variable, the local headless Chrome is used.

`test/blaxel/` runs each site's browser in its own [Blaxel](https://blaxel.ai) sandbox and verifies the generated CLI there too:

```bash
cd test/blaxel && npm install && cd ../..          # @blaxel/core
export BL_API_KEY=... BL_WORKSPACE=...               # Blaxel credentials
node test/blaxel/try-one.mjs                         # smoke: sandbox Chrome over CDP, then deleted
test/blaxel/bundle.sh /tmp/clify-bundle.tgz          # clify + production deps for the in-sandbox check
node test/blaxel/run.mjs test/blaxel/sites.txt 5     # per site: sandbox → clify add over CDP → clify check in the sandbox → delete
python3 test/blaxel/report.py ~/clify-runs/blaxel-*  # proofs/sites-blaxel.md, proofs/wall.json, specs/
```

Each sandbox (`blaxel/playwright-chromium`) starts stock headless Chrome and `test/blaxel/cdp-proxy.mjs`, which serves the DevTools endpoint on port 9300; clify connects through the sandbox API's authenticated port route (`wss://<sandbox>/port/9300/`, Blaxel key as bearer in `CLIFY_CDP_HEADERS`; `BL_CDP_VIA=preview` uses a private preview URL with a short-lived token instead). `clify add` keeps running locally (the model calls stay where your API key is); only the pages load in the sandbox. Afterwards the spec and clify are copied in and `clify check <site>` runs every read command live from the sandbox, without model calls. Results: [proofs/sites-blaxel.md](proofs/sites-blaxel.md).

## Commands

```bash
clify guide                                   # compact agent guide (JSON)
clify list --query <words>                    # find a site (--category dev|science|..., or no flag for all)
clify add <url> [--goal G] [--name N] [--account auto|agent|user|none] [--allow-writes] [--steps 30] [--rounds 3] [--cdp ws-url]
clify repair <site> [--command C] [--goal G]  # re-verify, repair, re-explore for what fails or is missing
clify check <site>                            # re-run every example, no model calls
clify <site>                                  # commands, params, examples (JSON)
clify <site> <command> --param v [--fields a,b|'*'] [--limit N] [--full] [--yes]
clify mcp [site ...]                          # stdio MCP server, tools <site>__<command>
clify install <site> | clify remove <site>
clify record <url> --name <site> --script steps.json   # deterministic scripted recording (tests)
clify login <site> [--user --url URL]         # log in (your own account with --user); see ACCOUNTS.md
clify whoami|session|vault|signup|ask|approve ...   # accounts and ask-a-human, see ACCOUNTS.md
```

- stdout is always one JSON object: `{"ok":true,"status":200,"count":N,"nextPage":"--page 2","data":...}` or `{"ok":false,"error":"...","next":"..."}` with exit code 1.
- `--fields a,b` keeps those fields (dot paths work), `--fields '*'` shows all (default: the spec's `defaultFields`). `--limit N` keeps N items. `--full` turns off trimming of long strings.
- A full item `url` passed to a detail command's path param is matched against the URL template, so list output feeds straight into `get-*` commands.
- **Writes are dry-run by default.** A `"writes": true` command returns `needsConfirmation` and a `preview` of the exact request; `--yes` (MCP: `confirm: true`) sends it.

Model access for `add`/`repair`: `ANTHROPIC_API_KEY`, or `ANTHROPIC_BASE_URL` plus a key or `CLIFY_LLM_KEY_CMD` (a command that prints the key). Model: `CLIFY_MODEL` (default `claude-opus-5-5`); answers from any other model are discarded and retried, so a proxy's silent fallback can't produce a spec.

## Safety rules (enforced in code)

- **CAPTCHAs and bot checks stop the flow.** reCAPTCHA, hCaptcha, Turnstile, Arkose or a "verify you are human" page is reported as `captcha at <url>`; clify never interacts with it. A bot-check answer during verification drops that command with the reason. No stealth plugins, UA spoofing or proxies: the runtime identifies itself as `clify/0.1`.
- **robots.txt** is obeyed for the exploration crawl (rules for `clify`, else `*`); a disallowed start page means no exploration.
- **Writes never leave the browser while exploring** unless `--allow-writes` (never on social networks). Held requests are recorded for the CLI and answered locally. Analytics/beacon writes are dropped.
- **Sessions** are stored in the encrypted vault and sent only to the site's own domain.
- Headless only.

## Tests

```bash
npm test                  # offline: typecheck, smoke (CLI + MCP vs a mock site), login smoke, accounts suite (TOTP, JWT refresh)
test/real/run.sh          # live: scripted headless recordings on 6 real sites, CLI/MCP checks, CAPTCHA stop
test/sites/run.sh test/sites/sites.txt 4   # live: fully automatic `clify add` on 44 real sites + table (never creates accounts unless CLIFY_ADD_FLAGS="--account auto")
node test/blaxel/run.mjs test/blaxel/sites.txt 6   # live: the same with each site's browser and check in a Blaxel sandbox (see above)
test/sites/handoff.sh test/sites/handoff-tasks.txt   # a fresh `claude -p`, Bash limited to clify, solves real tasks
```
