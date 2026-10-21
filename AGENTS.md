# clify — for agents

## What it is
A JSON command-line tool and hosted MCP that calls websites’ own HTTP endpoints. It supports public data, government, developer, science, maps, culture, news, sports, and jobs sites without driving a browser.

## Where things live
- Hosted MCP: `https://bold-cloud-h4u6s.run.mcp-use.com/mcp`; use `clify_sites`, `clify_help`, and `clify_run`.
- This repo contains the TypeScript product, `mcp/` hosted server, and `test/real/` and `test/sites/` live suites. `npm test` runs offline tests.
- Install locally with `npm install`; use `clify guide`, `clify list`, and `clify <site> <command>`.

## Owners
Touko owns distribution and publication. Agents maintain the product and run polite, robots-compliant checks.

## Standing decisions
- 2026-10-21 — Target the San Francisco and US agent market; keep Finnish entries in the catalog but do not make them the headline — Touko.
- 2026-10-20 — List the hosted MCP in registries and skip directories blocked by CAPTCHAs; never solve CAPTCHAs or evade bot checks — Touko.
