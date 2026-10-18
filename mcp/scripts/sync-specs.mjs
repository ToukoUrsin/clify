// Bundles the verified site catalogue into src/specs.generated.ts so the hosted
// server needs no filesystem access. Sources:
//   clify/specs/*.json   the real-site CLIs built into clify (verified live by `clify add`)
//   clify/test/real      wikipedia + hnsearch (real sites, verified by test/real/run.sh)
//                        and httpbinform (an echo test service; the one write, to show the confirm gate)
// The toy scraping sandboxes (books, quotes, scrapethis) are left out. Session-bound
// commands (auth:true) and commands that failed verification are dropped: the
// hosted server never holds logins.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const BUILTIN = path.join(repo, "clify/specs");
const REAL = path.join(repo, "clify/test/real");
const REAL_SITES = ["wikipedia", "hnsearch", "httpbinform"];

// One category per site, for clify_sites filtering. Built-in sites take the
// category from clify/proofs/wall.json (the verification wall); the rest fall
// back to this map, then to a host-based guess, then "other".
const WALL = path.join(repo, "clify/proofs/wall.json");
const WALL_CATEGORY = fs.existsSync(WALL) ? Object.fromEntries(JSON.parse(fs.readFileSync(WALL, "utf8")).map((e) => [e.site, e.category])) : {};
const CATEGORY = { wikipedia: "culture", hnsearch: "news", httpbinform: "sandbox" };
const HOST_CATEGORY = [
  [/\.(gov|mil)(\.|$)|\.gov\.us$/, "gov-us"],
  [/\.europa\.eu$|\.gov\.uk$|\.gouv\.fr$|\.bund\.de$/, "gov-eu"],
  [/\.(fi|se|no|dk|is)$/, "gov-nordic"],
  [/npm|pypi|crates|github|gitlab|docker|registry|pkg|dev\b/, "dev"],
  [/news|times|post|guardian|bbc|reuters/, "news"],
  [/weather|meteo|maps?\b|osm|geo/, "maps-weather"],
  [/jobs?|career|work/, "jobs-market"],
  [/museum|art|library|archive|music|film|book/, "culture"],
  [/arxiv|pubmed|science|nasa|ncbi|bio|chem/, "science"],
  [/sport|game|chess|league|tv/, "sports-ent"],
];
const categoryOf = (s) => {
  if (WALL_CATEGORY[s.name]) return WALL_CATEGORY[s.name];
  if (CATEGORY[s.name]) return CATEGORY[s.name];
  const h = `${s.name} ${new URL(s.origin).hostname}`;
  return HOST_CATEGORY.find(([re]) => re.test(h))?.[1] ?? "other";
};

// A one-line "about" from the description: whole sentences, never cut at a
// period inside "U.S.", "e.g.", "Inc.", "v1.2" or a domain; one sentence, or two
// when the first is short; at most ~160 chars, else cut at a word with "…".
const ABBREV = /(?:^|[\s(])(?:[A-Z]\.)+$|(?:^|[\s(])(?:e\.g|i\.e|etc|vs|Inc|Ltd|Co|Corp|Dr|Mr|Mrs|Ms|St|No|Jr|Sr|approx|incl|cf|al)\.$/i;
function sentences(text) {
  const out = [];
  let cur = "";
  for (const part of text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"'(“])/)) {
    cur = cur ? `${cur} ${part}` : part;
    if (!ABBREV.test(cur)) {
      out.push(cur);
      cur = "";
    }
  }
  if (cur) out.push(cur);
  return out;
}
function about(text, max = 160) {
  const ss = sentences(text ?? "");
  let a = ss[0] ?? "";
  if (ss[1] && a.length < 70 && a.length + 1 + ss[1].length <= max) a = `${a} ${ss[1]}`;
  if (a.length <= max) return a;
  const cut = a.slice(0, max - 1);
  return cut
    .slice(0, cut.lastIndexOf(" ") > max * 0.6 ? cut.lastIndexOf(" ") : cut.length)
    .replace(/(?:[\s,;:(–—-]+|\s(?:and|or|of|from|the|for|to|in|by|with|a|an|such as))+$/i, "") + "…";
}

// Default output fields for the test/real specs, which predate defaultFields.
const DEFAULT_FIELDS = {
  "wikipedia/summary": ["title", "description", "extract", "content_urls.desktop.page"],
  "wikipedia/random": ["title", "description", "extract", "content_urls.desktop.page"],
  "hnsearch/search": ["title", "points", "num_comments", "author", "created_at", "url", "objectID"],
  "hnsearch/search-by-date": ["title", "points", "num_comments", "author", "created_at", "url", "objectID"],
};

const files = [
  ...(fs.existsSync(BUILTIN) ? fs.readdirSync(BUILTIN).filter((f) => f.endsWith(".json")).sort().map((f) => [path.join(BUILTIN, f), true]) : []),
  ...REAL_SITES.map((n) => [path.join(REAL, `${n}.spec.json`), false]).filter(([f]) => fs.existsSync(f)),
];

const specs = [];
for (const [file, builtin] of files) {
  const s = JSON.parse(fs.readFileSync(file, "utf8"));
  const commands = s.commands
    .filter((c) => !c.auth && (!builtin || c.verified === true))
    .map(({ verified, verifyNote, source, ...c }) => ({ ...c, ...(DEFAULT_FIELDS[`${s.name}/${c.name}`] && !c.defaultFields ? { defaultFields: DEFAULT_FIELDS[`${s.name}/${c.name}`] } : {}) }));
  if (!commands.length) continue;
  const { dropped, auth, blockers, generated, ...rest } = s;
  specs.push({ ...rest, category: categoryOf(s), about: about(s.description), ...(generated?.verifiedAt ? { verifiedAt: generated.verifiedAt } : {}), commands });
}

// Outside a full repo checkout keep the committed bundle instead of overwriting it with nothing.
if (!specs.length) {
  console.error("no spec sources found; keeping src/specs.generated.ts");
  process.exit(1);
}

const out = path.join(here, "../src/specs.generated.ts");
fs.writeFileSync(
  out,
  `// Generated by scripts/sync-specs.mjs from clify/specs and clify/test/real. Do not edit.\n// A JSON string, not a literal: some request bodies are arrays the spec type does not\n// model, and tsc need not infer a type for 1.5 MB of data.\nimport type { HostedSite } from "./catalog.js";\n\nexport const SPECS: HostedSite[] = JSON.parse(${JSON.stringify(JSON.stringify(specs))});\n`,
);
const n = specs.reduce((a, s) => a + s.commands.length, 0);
const cats = Object.entries(specs.reduce((m, s) => ({ ...m, [s.category]: (m[s.category] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
console.log(`wrote ${specs.length} sites, ${n} commands to ${path.relative(process.cwd(), out)}`);
console.log(`categories: ${cats.map(([c, k]) => `${c} ${k}`).join(", ")}`);
