# clify MCP server (mcp-use, on Manufact)

clify turns websites into typed, JSON-first commands for agents. This is the
hosted MCP version, built with [mcp-use](https://docs.mcp-use.com) (TypeScript
v2) and deployed on Manufact Cloud. It serves clify's whole verified catalogue:
**156 real sites, 1,802 live-verified commands**, through 3 core tools (+4 shortcuts),
2.5k tokens for the whole tool list.

**Live endpoint:** `https://bold-cloud-h4u6s.run.mcp-use.com/mcp` (server name `clify`, streamable HTTP, no auth)

```bash
claude mcp add --transport http clify https://bold-cloud-h4u6s.run.mcp-use.com/mcp
codex mcp add clify --url https://bold-cloud-h4u6s.run.mcp-use.com/mcp
npx @mcp-use/inspector --url https://bold-cloud-h4u6s.run.mcp-use.com/mcp
```

## The catalogue

The 132 real-site CLIs built into clify (`clify/specs`, each made by `clify add`
and every command run live before it was kept) plus Wikipedia and HN Algolia
search from `clify/test/real`, and one echo form (httpbin) that exists to show
the write gate. Categories come from the verification wall
(`clify/proofs/wall.json`):

| Category | Sites | Examples |
| - | - | - |
| dev | 29 | crates.io, PyPI, docs.rs, Docker Hub, Hugging Face, Terraform Registry, pub.dev |
| science | 15 | arXiv, PubMed, PubChem, UniProt, RCSB PDB, Ensembl, Zenodo |
| gov-us | 15 | USAspending, Federal Register, FEC, FRED, ClinicalTrials.gov, NOAA tides, NPS |
| maps-weather | 14 | weather.gov, Open-Meteo, yr.no, OpenStreetMap, USGS earthquakes, AirNow |
| culture | 14 | Wikipedia, Internet Archive, Art Institute of Chicago, Rijksmuseum, MusicBrainz |
| news | 12 | Hacker News, BBC, The Guardian, Ars Technica, Yle, NRK |
| gov-nordic | 10 | Digitraffic, Finlex, PRH company data, Statistics Finland, Riksdagen, SSB |
| sports-ent | 9 | NHL, TMDB, TVmaze, Lichess, TheSportsDB, AniList |
| jobs-market | 8 | YC startup directory, Remote OK, USAJOBS, Arbeitnow, Platsbanken |
| gov-eu | 8 | data.europa.eu, Eurostat, ECB, CORDIS, Companies House, data.police.uk |
| sandbox | 1 | httpbin form (the one write command) |

Login-only commands (`auth`) and commands that failed verification are left
out; the hosted server holds no sessions. `npm run sync-specs` rebuilds the
bundle from `clify/specs` and `clify/test/real`.

## Tools: small and fixed, however many sites

| Tool | Purpose |
| - | - |
| `clify_sites {query?, category?, limit?, offset?}` | Keyword search over sites and their commands ("rust crate versions" → crates.io with `get-crate`, `list-versions`…). Without a query it pages through the catalogue: 40 sites per page, one line each (`crates (dev, 19): crates.io, the Rust package registry.`), with `total`, per-category counts and `nextPage` (the args for the next page); `category` narrows it. A page is ~5k characters. |
| `clify_help {site, command?}` | Every command of a site with a one-line signature (`wfo* x*:number units:us\|si`), what it returns by default; with `command`, full param docs and a ready `clify_run` call. |
| `clify_run {site, command, args, fields?, limit?, confirm?}` | Runs one command through clify's runtime and returns shaped JSON. |
| `crates__get-crate`, `pypi__get-package`, `wikipedia__summary`, `hnsearch__search` | Direct typed tools for a few popular commands (one call instead of three). Set with `CLIFY_FEATURED`; `CLIFY_TOOLS=core` turns them off. |

Plus the `clify://guide` resource, the `clify://sites/{site}` resource template
(the full spec behind a site) and the `use-clify` prompt.

**What the tool list costs** (Claude Opus 5.5 input tokens on every request,
`count_tokens` with the tools minus without; `scripts/measure-tools.mjs`,
[demo/tool-tokens.json](demo/tool-tokens.json)):

| Tool set | Tools | Tokens |
| - | - | - |
| deployed: 3 core + 4 direct | 7 | **2,538** |
| 3 core only | 3 | 1,360 |
| every command as its own tool (the round-1 design, at 135 sites) | 1,622 | 568,912 |
| round 1 as deployed (6 sandbox sites) | 18 | 4,969 |

One tool per command would cost 569k tokens before the agent reads its task,
more than most context windows; the deployed set costs 2.5k (1.4k for the three
core tools) and stays flat as sites are added. A discovery round (`clify_sites`
with a query, then `clify_help` or a direct call) returns 0.5–7k characters.

## Built for agents

- **One runtime.** `clify_run` executes through `clify/src/core.ts`, the same
  request building, JSON/XML/HTML parsing, pagination, totals and shaping the
  `clify` CLI uses (`src/clify.ts` re-exports it; nothing is copied). The CLI
  adds sessions on top in `clify/src/runtime.ts`; the hosted server runs the
  core without them and with `sameSiteOnly`, so requests go only to each spec's
  own site.
- **Small outputs.** Default fields per command (`fields="*"` for all), `limit`,
  `count`/`total`/`nextPage` on lists, strings cut at 400 chars and responses at
  ~6k with `truncated:true`. A field that exists on no item comes back as
  `unknownFields` with the `availableFields`, so a wrong guess costs one retry.
- **Fixable errors.** `ok:false` names the fix (`missing name (Crate name), e.g.
  name "reqwest"`, allowed values, unknown command with the list) and a `next`
  call. Unknown sites get `didYouMean`; hosts work as site names (`crates.io`).
- **Safe writes.** Write commands return `needsConfirmation` and a preview of
  the exact method, URL and body; nothing is sent without `confirm:true`.
- **Public only.** No sessions, cookies or credentials; CAPTCHAs and bot checks
  are never bypassed.

## Adding sites: `clify add` runs locally

`clify add <url>` explores a site in headless Chromium, has Claude write the
spec from the recorded requests, and runs every command live before keeping it
(2–6 minutes typical, up to ~15 on big sites, with a browser and model calls per site). That does not fit a hosted,
anonymous MCP endpoint: Manufact's runtime has no browser, and an open
`clify_add` would let any caller spend model budget and point a crawler at any
URL. So there is no `clify_add` tool. Add sites locally (`clify add`, served
by `clify mcp`), and verified specs reach this server through `clify/specs` and
a redeploy.

## Layout

- `index.ts`: the server (tools, resources, prompt).
- `src/clify.ts`: re-exports clify's runtime core and spec types from `../clify/src`.
- `src/catalog.ts`: site lookup, keyword search, compact site lines and signatures.
- `src/specs.generated.ts`: the bundled catalogue with each site's category and one-line `about` (`npm run sync-specs`).
- `scripts/deploy.sh`: managed-upload deploy without GitHub; stages mcp/ without demo/ and logs, and swaps `src/clify.ts` for a bundle of the same clify code (`scripts/bundle-core.mjs`), because the managed build only sees mcp/.
- `scripts/probe.mjs`: 18 live checks against a running server (catalogue paging, search, two real sites, errors, write gate); `scripts/measure-tools.mjs`: tool-list token cost.
- `demo/`: the multi-client proof (below).

## Develop and deploy

```bash
npm install                 # and npm install in ../clify for the shared core's deps
npm run dev                 # http://localhost:3000/mcp and /inspector
npx tsc --noEmit -p . && npm run build
npm run probe -- http://localhost:3000/mcp
./scripts/deploy.sh         # Manufact Cloud; reuses .mcp-use/cloud/link.json
```

`deploy.sh` needs the mcp-use CLI signed in to a Manufact account. The
deployed server passes all 18 probe checks ([demo/probe-deployed.txt](demo/probe-deployed.txt)).

## Multi-client proof

One task, two real sites in one conversation: *the latest serde version on
crates.io, and the NWS forecast for San Francisco (next two periods)*. Run
headless against the deployed URL in four clients, one of them a GUI. Every
client used 4 clify calls and answered correctly (serde 1.0.229; Overnight 58°F
Mostly Clear, Sunday 68°F Sunny; checked against crates.io's and api.weather.gov's
own APIs). Crates went through a direct tool or `clify_run`; the weather site was
found with `clify_sites` and chained `get-point` → `get-forecast` through
`clify_run`.

| Client | Model | Transcript | Video (15 s, 1080p) |
| - | - | - | - |
| Claude Code 2.1.302 (`claude -p --mcp-config`) | claude-opus-5-5 | [demo/transcript-claude-code.md](demo/transcript-claude-code.md) | `demo/out/claude.mp4` |
| Codex CLI 0.163.0 (`codex exec`) | gpt-6.1-sol | [demo/transcript-codex.md](demo/transcript-codex.md) | `demo/out/codex.mp4` |
| mcp-use TS agent (`@mcp-use/agent` MCPAgent) | claude-opus-5-5 | [demo/transcript-mcp-use.md](demo/transcript-mcp-use.md) | `demo/out/mcp-use.mp4` |
| mcp-use Inspector (Manufact's browser client, its Chat tab, in headless Chromium) | openai/gpt-5.6-luna (the Inspector's hosted chat) | [demo/transcript-inspector.md](demo/transcript-inspector.md) | `demo/out/inspector.mp4` (the real browser recording, 2.3× speed) |

Reproduce on a Linux box with Claude Code, Codex CLI and Chromium:
`cd demo && npm install && ANTHROPIC_API_KEY=... ./run-clients.sh && node to-md.mjs`;
videos: `python3 render.py` (needs ffmpeg, Pillow, DejaVu fonts).

Codex prompts before any `destructiveHint` tool (`clify_run` can write) and
`codex exec` has no human to answer, so the demo sets
`default_tools_approval_mode="approve"` for clify; the server-side
`confirm:true` gate is what keeps writes unsent. The Inspector chat, with no
sign-in or API key, runs on Manufact's hosted model; no key or account of ours
is sent (`inspector-gui.mjs`).
