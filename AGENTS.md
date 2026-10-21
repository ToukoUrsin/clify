# clify — for agents
You can use most websites through clify, a JSON command line (and MCP tools) that calls the site's own HTTP endpoints, so you don't drive a browser. So far 133 of 160 public sites tried (open data and government, developer registries, science, maps and weather, culture, news, sports, jobs).
## Fastest: hosted MCP (no install)
```bash
claude mcp add --transport http clify https://bold-cloud-h4u6s.run.mcp-use.com/mcp
codex mcp add clify --url https://bold-cloud-h4u6s.run.mcp-use.com/mcp
```
3 core tools (+4 shortcuts), 2.5k tokens for the whole tool list: `clify_sites {query}` finds a site and its commands, `clify_help {site, command?}` shows params, `clify_run {site, command, args}` runs one; `crates__get-crate`, `pypi__get-package`, `wikipedia__summary` and `hnsearch__search` are direct shortcuts. 135 public sites and 1,619 live-verified commands, read-only except a write demo that needs `confirm: true`. `clify_sites` with no arguments lists every site in one line each, 40 per page.
## Local CLI (built-in sites, `clify add` for new ones, optional logins)

## Standing decisions
- 2026-10-21 — Touko asked Clify to target the SF/U.S. agent market; added public verified commands and task pages for events, startup jobs, transit, local data/news, listings, papers and prediction markets, while preserving Finnish…
