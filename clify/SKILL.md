---
name: clify
description: Use websites through generated JSON CLIs instead of a browser. Use when a task needs data or actions from a website (search, listings, details, forms) — `clify list` shows ready sites; `clify add <url>` makes a CLI for a new one.
---

# clify

## Install (once)

clify is not on npm (`npm i clify` is an unrelated package): clone the repo.

```bash
git clone https://github.com/ToukoUrsin/clify && cd clify/clify
npm install && npx playwright install chromium   # Chromium only needed for `clify add`
export PATH="$PWD/bin:$HOME/.clify/bin:$PATH"
clify guide                                      # compact JSON guide
```

`clify add`/`repair` need model access: `ANTHROPIC_API_KEY` (or `ANTHROPIC_BASE_URL` + key). Using an existing CLI needs nothing.

## Use

1. `clify list --query <words>` (or `clify <host>`, e.g. `clify crates.io`) — 132 verified sites ship built in. Missing? `clify add <url> --goal "<what the task needs>"` (2–6 min typical, up to ~15 on big sites; prints a JSON summary).
2. `clify <site>` — one line per command with a runnable example. Read it once; `clify <site> <command> --help` only when you need every flag. Account ids (project, org, team) are filled in for you.
3. `clify <site> <command> --param value --fields a,b --limit 10`.

Example:

```bash
clify crates search-crates --q "http client" --sort downloads --limit 3 --fields name,max_version,downloads
```

## JSON contract

- stdout is one JSON object. Success: `{"ok":true,"count":N,"total":T,"nextPage":"--page 2","data":...}`. Failure: `{"ok":false,"error":"...","next":"<exact command to run next>"}`, exit 1. Run `next`.
- `--fields a,b.c` (dot paths, `'*'` = all), `--limit N`. Pass `nextPage` args for more. Pass ids, slugs or the item `url` from list output to `get-*` commands.

## Rules

- **Writes** (`writes: true`) return a dry-run `preview`; nothing is sent. Add `--yes` only when your user asked for that change. To get a human's OK by email: `clify approve <site> <command> --param v ...`.
- **CAPTCHA or bot check = ask a human.** clify never solves or evades them. Report the blocker to your user, or `clify ask "<question>" --attach shot.png` and wait for the reply.
- Broken or missing command: `clify repair <site> --command <name>` or `clify repair <site> --goal "<what you need>"`.
