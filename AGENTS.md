# clify — for agents

You can use most websites through clify, a JSON command line (and MCP tools) that calls the site's own HTTP endpoints, so you don't drive a browser. So far 133 of 160 public sites tried (open data and government, developer registries, science, maps and weather, culture, news, sports, jobs).

## Fastest: hosted MCP (no install)

```bash
claude mcp add --transport http clify https://bold-cloud-h4u6s.run.mcp-use.com/mcp
codex mcp add clify --url https://bold-cloud-h4u6s.run.mcp-use.com/mcp
```

3 core tools (+4 shortcuts), 2.5k tokens for the whole tool list: `clify_sites {query}` finds a site and its commands, `clify_help {site, command?}` shows params, `clify_run {site, command, args}` runs one; `crates__get-crate`, `pypi__get-package`, `wikipedia__summary` and `hnsearch__search` are direct shortcuts. 135 public sites and 1,619 live-verified commands, read-only except a write demo that needs `confirm: true`. `clify_sites` with no arguments lists every site in one line each, 40 per page.

## Local CLI (built-in sites, `clify add` for new ones, optional logins)

clify is not on npm (`npm i clify` is an unrelated package): clone the repo.

```bash
git clone https://github.com/ToukoUrsin/clify && cd clify
cd clify && npm install                         # Node 22+
npx playwright install chromium                 # only for `clify add` / `repair` / login
export PATH="$PWD/bin:$HOME/.clify/bin:$PATH"
clify guide                                     # short JSON guide (under 3 KB)
clify list --query rust                         # find a site; 132 sites ship built in (`--category dev`, or no flag for all)
clify <site>                                    # commands, params, examples
clify <site> <command> --param value            # run; stdout is one JSON object
clify add <url> --goal "what you need"          # a site that doesn't ship (needs ANTHROPIC_API_KEY; 2–6 min typical, up to ~15 on big sites)
```

- Errors are `{"ok":false,"error":"...","next":"<exact command to run next>"}`; run `next`.
- Commands with `"writes": true` return a dry-run `preview`; re-run with `--yes` only when your user asked for that change.
- A CAPTCHA or bot check is reported as a blocker. Never try to get around it: tell your user, or `clify ask "<question>"`.

Full guide with a troubleshooting table: [clify/AGENTS.md](clify/AGENTS.md). Accounts, logins and ask-a-human: [clify/ACCOUNTS.md](clify/ACCOUNTS.md). Drop-in skill: [clify/SKILL.md](clify/SKILL.md).

## Working on this repo

- `clify/` is the product (TypeScript, run with tsx; `npm test` runs the offline suites). `mcp/` is the hosted MCP server and shares `clify/src/core.ts`. `race/`, `bench/`, `agent/` and `film/` are demos and evidence.
- Live tests open headless Chrome only and run on a Linux machine; `test/real/run.sh` and `test/sites/run.sh` hit real sites, so keep them polite (they obey robots.txt and pace requests).
- Keep the safety rules intact: no CAPTCHA solving, no bot evasion, writes need confirmation, sessions stay on their own domain.

Public curl API (no install/key/account): https://clify-dev.netlify.app
