// The agent-facing guide, served as the clify://guide resource, the server
// instructions and the use-clify prompt.
export const INSTRUCTIONS =
  "clify turns real websites into typed commands. Find a site with clify_sites {query}, read its commands with clify_help {site} (add command for full params), then call clify_run {site, command, args}. Pass fields (comma-separated keys) and limit to keep results small. Writes never send without confirm:true; without it they return a dry-run preview of the exact request.";

export const GUIDE = `# Using clify (hosted)

clify records the HTTP calls behind a website's own UI and turns each one into a
typed, verified command. This server carries the whole verified catalogue
(package registries, government open data, science, news, reference sites) and
exposes it through 3 core tools (plus a few direct shortcuts), so your tool
list stays small however many sites there are.

## Workflow
1. \`clify_sites\` with a \`query\` ("rust crate versions", "weather forecast")
   — the best sites and the commands that matched. Without a query it pages
   through the catalogue, one line per site (\`offset\` from \`nextPage\`;
   \`category\` narrows it).
2. \`clify_help\` with \`site\` — every command with a one-line param
   signature (\`name*\` required, \`:a|b\` allowed values, \`=x\` default). Add
   \`command\` for full param docs, default fields and a ready call.
3. \`clify_run\` with \`site\`, \`command\` and \`args\`
   (e.g. \`{"site":"crates","command":"get-crate","args":{"name":"serde"}}\`).

A few popular commands are also direct tools (\`crates__get-crate\`,
\`pypi__get-package\`, \`wikipedia__summary\`, \`hnsearch__search\`).

Multi-step sites tell you the chain in their summaries: weather needs
\`get-point\` (lat/lon → office + grid x/y) before \`get-forecast\`.

## Keep results small
- Lists show a few default fields; \`fields\` picks others (dot paths work,
  \`"*"\` for all). \`limit\` keeps the first N items.
- Lists return \`count\`, \`total\` when the site reports one, and
  \`nextPage\` (the args for the next page).
- Long strings are cut at 400 chars and responses at ~6,000 chars;
  \`truncated:true\` tells you to narrow with fields/limit.

## Writes are safe by default
Commands marked \`writes\` return \`needsConfirmation:true\` and a \`preview\` of
the exact method, URL and body. Nothing is sent. Show the preview to the user;
call again with \`confirm:true\` only when they want it sent.

## Errors are fixable
\`ok:false\` comes with an \`error\` that names the fix (missing param, value
outside the allowed list, unknown param, 404 slug) and a \`next\` call. Correct
the call and retry; do not fall back to scraping.

## Limits of the hosted server
Public, logged-out pages only; requests go only to each site's own domain. No
sessions, cookies or credentials are stored or accepted. CAPTCHAs and bot
checks are never bypassed. To add a new site, run \`clify add <url>\` locally
(it needs a headless browser and a model); the hosted server serves the
verified catalogue.
`;
