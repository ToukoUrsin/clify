# clify — for agents

clify gives you a JSON command line (and MCP tools) for a website, so you call the site's own HTTP endpoints instead of driving a browser: faster, cheaper, and the output is already structured.

## Install (once)

clify is not on npm (`npm i clify` is an unrelated package): clone the repo.

```bash
cd clify && npm install                      # Node 22+
npx playwright install chromium              # only for `clify add` / `repair` / login (or set CLIFY_CHROME)
export PATH="$PWD/bin:$HOME/.clify/bin:$PATH"   # or: npm install -g .
clify guide                                  # compact JSON guide (<3 KB); find sites with clify list --query
npm test                                     # offline suites: smoke, login, accounts
```

132 verified site CLIs ship built in (`specs/`), so `clify list` works right after install. `clify --version` prints the version.

`clify add` needs model access: `ANTHROPIC_API_KEY`, or `ANTHROPIC_BASE_URL` plus a key (`CLIFY_LLM_KEY_CMD` may name a command that prints it). Using an already generated CLI needs nothing.

## Use a site

```bash
clify list --query "rust crates"             # find a site (ranked; --category dev|science|gov-us|..., --limit N)
clify list                                   # every site, one line each
clify crates.io                              # a host works too: same as clify crates
clify <site>                                 # one line per command: summary, runnable example, other flags
clify <site> <command> --param value         # run it
clify <site> <command> --help                # every flag, all result fields, a sample output
clify <site> context                         # your account's ids (project, org, team...) that commands fill in
```

- stdout is one JSON object. Success: `{"ok":true,"count":N,"nextPage":"--page 2","data":...}`. Failure: `{"ok":false,"error":"...","next":"<exact command to run next>"}`, exit 1.
- Lists show a few default fields. `--fields a,b.c` picks fields, `--fields '*'` shows all, `--limit N` trims, `--full` keeps long strings.
- `nextPage` holds the args for the next page; pass them to the same command.
- Detail commands (`get-*`) take the id/slug from list output; passing the item's full `url` to that param also works.
- Signed-in sites have an account `context` (current project/organization/team/user id). Commands fill those flags in when you leave them out; pass the flag to use another value.
- Commands with `"writes": true` return `needsConfirmation` and a `preview` of the exact request. Nothing is sent until you re-run with `--yes` (MCP: `confirm: true`).

## Add a site that is not installed

```bash
clify add https://example.com --goal "search listings, filter by city, open a listing"
```

Takes 2–6 minutes typically, up to ~15 on big sites. A headless browser explores the site (robots.txt respected), Claude writes the commands from the recorded requests, every read command is run live and repaired until it returns real data, and the CLI is installed. The JSON summary lists `commands`, `verified`, `dropped` (with reasons), `blockers` and `next`.

- `--goal` focuses exploration on what you need. `--name` sets the site name.
- `--account auto|agent|user|none` (default `auto`): if the useful features need a login, clify asks its accounts module for one and explores again signed in.
- `--allow-writes` lets exploration actually send writes (otherwise they are recorded but held). Never on real-identity social networks.

## When something breaks

| You see | Do |
|---|---|
| `unknown site "x"` | run the `next` it prints (`clify <closest match>`, up to 10 in `didYouMean`), or `clify list --query <words>`; `clify add <url>` only if nothing ships |
| `"cmd" failed verification ... disabled` | `clify repair <site> --command cmd` |
| a command returns wrong or empty data | `clify repair <site> --command cmd` |
| you need something the CLI lacks | `clify repair <site> --goal "what you need"` |
| `HTTP 401/403 ... next: clify login <site>` | `clify login <site>` (sessions also refresh automatically once per call) |
| `blockers: ["captcha at ..."]` or a bot check | stop; clify never solves CAPTCHAs or evades bot detection. Tell your user, or `clify ask "<question>"` (see ACCOUNTS.md). |
| `HTTP 429` | wait a minute, then retry |

`clify check <site>` re-runs every command's example without any model calls.

## MCP

```json
{ "mcpServers": { "clify": { "command": "clify", "args": ["mcp"] } } }
```

Tools are `<site>__<command>` with JSON-schema params plus `fields`/`limit`; write tools take `confirm: true`.

## Accounts

`clify login <site> --user --url <login url>` stores your own account (credentials from `CLIFY_USERNAME`/`CLIFY_PASSWORD`, `--password-cmd`, or a hidden prompt) in the encrypted vault. `clify whoami <site>` (public sites answer "none needed"), `clify session <site>`, `clify vault list`. Details: ACCOUNTS.md.

## Rules clify enforces

No CAPTCHA solving, no bot-detection evasion (honest `clify/<version>` user agent, headless Chrome as is), robots.txt obeyed while exploring, writes held during exploration unless allowed, sessions sent only to the site's own domain, credentials kept in an encrypted vault and never printed.
