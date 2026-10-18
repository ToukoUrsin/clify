// Phase 2: the recording becomes a spec. The recorded requests are grouped into
// endpoints and described compactly (digest.ts); Claude writes the commands,
// and normalize() makes the result safe to run: valid names, params that match
// the URL template, writes marked as writes, nothing secret hard-coded.
import { askJson } from "./llm.ts";
import { digestRecording, type Endpoint } from "./digest.ts";
import { isSocialNetwork } from "./policy.ts";
import { log } from "./store.ts";
import type { CommandSpec, Exchange, ParamSpec, SiteSpec } from "./types.ts";

export const SPEC_FORMAT = `interface ParamSpec {
  name: string;            // flag name, [A-Za-z_][A-Za-z0-9_]*: the agent types --name
  key?: string;            // wire name when different ("filter[type]", "page.size", "X-Version")
  in: "query" | "path" | "body" | "header";
  required: boolean;
  type: "string" | "number" | "boolean";
  description: string;     // what it means + format, e.g. "ISO date, e.g. 2024-01-31"
  enum?: string[];         // allowed values the UI offered (select options, facets, sort keys)
  default?: string | number | boolean; // sent when omitted (what the UI sent by default)
  example?: string;
}
interface CommandSpec {
  name: string;            // kebab-case verb-noun: search-packages, get-package, list-categories
  summary: string;         // one line an agent reads to pick the command
  method: string;
  urlTemplate: string;     // path relative to the site origin, {param} for path params; absolute URL only for another host. Fixed query params may be written into it.
  params: ParamSpec[];
  bodyTemplate?: object;   // fixed JSON/form envelope; values may be "{param}" (typed) or contain {param}
  bodyEncoding?: "json" | "form" | "none";
  headers?: Record<string,string>; // only non-standard headers the endpoint needs; never cookie/authorization
  responseType: "json" | "html" | "text";
  resultPath?: string;     // dot path to the useful array/object in the JSON (also used after extract.jsonScript)
  extract?: { list?: string; fields?: Record<string,string>; jsonScript?: string };
  defaultFields?: string[];// ≤8 most useful fields per result (dot paths ok); include the id/slug/url detail commands take
  pagination?: { type: "page"|"offset"|"cursor"; param: string; step?: number; nextPath?: string };
  csrf?: { from: string; selector?: string; jsonPath?: string; cookie?: string; field?: string; header?: string };
  mutates: boolean;        // creates/changes/deletes data
  auth?: boolean;          // needs the logged-in session
  example: Record<string,string>; // real args from the recording that return non-empty results
  source: string;          // endpoint id(s) it came from, e.g. "E3"
}`;

const RULES = `Rules
- Cover every distinct capability in the recording: search, listings, filters, sorting, pagination, detail lookups, related data, exports, the signed-in user's own data, and every write. Usually 4-15 commands. One command per capability; fold filters/sort/page into params of the same command instead of separate commands.
- Prefer JSON endpoints (xhr/fetch) over HTML pages for the same data. If a page embeds its data as JSON (embedded JSON, e.g. script#__NEXT_DATA__), prefer extract.jsonScript + resultPath over CSS. Server-rendered sites: responseType "html" with extract.
- HTML extract: list = CSS selector matching each result item (use the "repeated items" hints), fields = {field: "sel" | "sel@attr" | "@attr" | "" | "selA || selB"} relative to the item. Only use tags, ids, classes and attributes visible in the outline; no :nth-child, :contains or :has. Detail pages: omit list; fields are relative to the document. List items should include a "url" (a@href) and the id/slug the detail command takes.
- urlTemplate: the path the site really uses. Drop tracking/cache-busting params (utm_*, fbclid, gclid, _=<timestamp>, session ids). Path params as {name} with in:"path".
- Params: only what an agent would vary. Fixed values the web app always sends (api version, locale, client id, fields lists, public search keys) go into urlTemplate / bodyTemplate / headers. Never hard-code cookies, session ids, bearer tokens, CSRF tokens or timestamps; use csrf for form tokens.
- enum: values the UI offered (sort options, facet values, select options) when the set is small and fixed. default: what the UI sent when the user did not choose. required: true only for the essential input (query, id).
- example: string args copied from the recording that returned results. Every required param must have one. The verifier runs each read command with exactly these args.
- resultPath / defaultFields keep output small for agents: point at the result array or main object; pick fields an agent needs.
- pagination: page-number params → {type:"page",param}; offset → {type:"offset",param,step}; cursor tokens → {type:"cursor",param,nextPath} (nextPath is in the raw JSON, before resultPath).
- GraphQL: one command per operationName: method POST, bodyEncoding "json", bodyTemplate {"operationName":..., "query": <full query string>, "variables": {"v": "{v}"}} (keep persisted-query "extensions" verbatim), a body param per variable.
- Form posts: bodyEncoding "form"; hidden inputs with fixed values go into bodyTemplate; an authenticity/CSRF token goes into csrf {from: page with the form, selector: "input[name=TOKEN]@value", field: "TOKEN"}.
- Writes (marked WRITE in the digest): mutates true, params for user-provided fields, summary says exactly what it changes. Never mark a pure read as mutates; search/filter POSTs are reads.
- auth: true when the request is about the signed-in user's own data (recorded logged-in and fails without the session).
- Skip: analytics, ads, consent, telemetry, feature flags, A/B tests, app config, i18n bundles, health checks, autocomplete for site navigation only, error responses, duplicate endpoints.
- XML/RSS/Atom responses are converted to JSON (elements → keys, repeats → arrays, attributes "@name", mixed text "#text"): use responseType "json" with resultPath, e.g. "rss.channel.item".
- If the site exposes a documented public API that you saw in the recording (e.g. /api/v1/... with clean JSON), use it.
- Order commands most useful first: the site's core listing/search and its main create action(s), then detail lookups, then minor ones. One command per request: never two commands for the same URL and method.
- Account scope: ids the signed-in account carries on many requests (current organization, project, team, workspace, user) get the same param name in every command (e.g. projectId) with the recorded value as example; clify turns them into account defaults.
- Writes should show what they created: if the site answers with a redirect to a page that lists the objects, give the write that page's extract (or resultPath) so the new object (its id, URL, token) is in the output.
- defaultFields: the id plus every field users ask for (name, url, token, status, ping/webhook URL, author username, created date).
- notes: at most 4 short lines an agent needs across commands. Command-specific advice goes in that command's summary or param description. Never put recorded ids or test object names in notes or summaries.`;

function systemPrompt(): string {
  return `You are clify's spec writer. clify turns a website into a JSON command-line tool (and MCP server) for AI agents: each command replays one HTTP request the site's own web app makes, so agents never need a browser. You get a digest of the requests a headless browser recorded while exploring the site, and you write the commands.

${SPEC_FORMAT}

${RULES}

Answer with one JSON object only: {"description": "<one line: what the site is and what the CLI does>", "commands": [CommandSpec...], "notes": ["<anything an agent must know>"]}`;
}

export interface SynthInput {
  name: string;
  url: string;
  exchanges: Exchange[];
  goal?: string;
  summary?: string; // explorer's summary of what it did
  loggedIn?: boolean;
  focus?: string[]; // only (re)write commands for these capabilities
  existing?: CommandSpec[]; // commands already in the spec (for focus runs)
}

export async function synthesize(o: SynthInput): Promise<{ description: string; commands: CommandSpec[]; notes: string[]; endpoints: Endpoint[] }> {
  const { text, endpoints } = digestRecording(o.exchanges);
  if (!endpoints.length) return { description: "", commands: [], notes: ["nothing usable was recorded"], endpoints };
  const prompt = [
    `Site: ${o.url} (CLI name "${o.name}")`,
    o.goal ? `User's goal for this CLI: ${o.goal}` : "",
    o.summary ? `Explorer's summary: ${o.summary}` : "",
    o.loggedIn ? "The explorer was logged in (requests marked logged-in carried the session)." : "The explorer was not logged in.",
    o.focus?.length ? `Only write commands for these capabilities (others already exist): ${o.focus.join("; ")}` : "",
    o.existing?.length ? `Existing command names (do not duplicate): ${o.existing.map((c) => c.name).join(", ")}` : "",
    `Recorded endpoints (${endpoints.length}), most API-like first:\n\n${text}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  log(`🧠 synthesizing from ${endpoints.length} endpoints (${Math.round(prompt.length / 1000)}k chars)`);
  const out = await askJson<{ description?: string; commands?: any[]; notes?: string[] }>(prompt, "high", 48000, systemPrompt());
  const commands = normalizeCommands(out.commands ?? [], { url: o.url, endpoints });
  return { description: out.description ?? "", commands, notes: out.notes ?? [], endpoints };
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_HEADER = /^(cookie|authorization|x-csrf-token|x-xsrf-token|csrf-token|x-auth-token|x-access-token|x-session-token|content-length|host|user-agent|origin|referer)$/i;

function kebab(s: string): string {
  return String(s ?? "")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function flagName(s: string): string {
  let n = String(s ?? "").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!n) n = "value";
  if (/^\d/.test(n)) n = "p" + n;
  return n;
}

const RESERVED = new Set(["yes", "fields", "limit", "full", "help", "confirm"]);

// Make model output safe and runnable. Throws nothing: bad commands are dropped.
export function normalizeCommands(raw: any[], ctx: { url: string; endpoints?: Endpoint[]; social?: boolean }): CommandSpec[] {
  const origin = new URL(ctx.url).origin;
  const social = ctx.social ?? isSocialNetwork(ctx.url);
  const held = new Set((ctx.endpoints ?? []).filter((e) => e.held || e.sent).map((e) => e.id));
  const seen = new Set<string>();
  const out: CommandSpec[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    try {
      if (!r || typeof r !== "object" || !r.urlTemplate) continue;
      let name = kebab(r.name);
      if (!name) continue;
      while (seen.has(name)) name = name.replace(/(-\d+)?$/, (m: string) => `-${(Number(m.slice(1)) || 1) + 1}`);
      const method = String(r.method ?? "GET").toUpperCase();
      let urlTemplate = String(r.urlTemplate).trim();
      if (/^https?:/i.test(urlTemplate)) {
        const u = new URL(urlTemplate.replace(/\{(\w+)\}/g, "__P_$1__"));
        if (u.origin === origin) urlTemplate = (u.pathname + u.search).replace(/__P_(\w+)__/g, "{$1}");
      } else if (!urlTemplate.startsWith("/")) urlTemplate = "/" + urlTemplate;
      const params: ParamSpec[] = [];
      const pnames = new Set<string>();
      for (const p of Array.isArray(r.params) ? r.params : []) {
        if (!p?.name) continue;
        const flag = flagName(p.name);
        const clash = RESERVED.has(flag.toLowerCase());
        const pname = clash ? `api_${flag}` : flag;
        if (pnames.has(pname)) continue;
        const where = ["query", "path", "body", "header"].includes(p.in) ? p.in : method === "GET" ? "query" : "body";
        let key: string | undefined = p.key ? String(p.key) : pname !== p.name && where !== "path" ? String(p.name) : undefined;
        if (key === pname) key = undefined;
        if (where === "path" && pname !== p.name) urlTemplate = urlTemplate.replaceAll(`{${p.name}}`, `{${pname}}`);
        if (where === "body" && pname !== p.name && r.bodyTemplate) r.bodyTemplate = JSON.parse(JSON.stringify(r.bodyTemplate).replaceAll(`{${p.name}}`, `{${pname}}`));
        const type = ["string", "number", "boolean"].includes(p.type) ? p.type : "string";
        const enumv = Array.isArray(p.enum) && p.enum.length ? p.enum.map(String).slice(0, 60) : undefined;
        params.push({
          name: pname,
          ...(key ? { key } : {}),
          in: where,
          required: where === "path" ? p.default === undefined : !!p.required,
          type,
          ...(p.description || clash ? { description: `${String(p.description ?? "").slice(0, 200)}${clash ? `${p.description ? " " : ""}(sent to the site as "${p.name}"; clify's own --${flag.toLowerCase()} only shapes the output)` : ""}` } : {}),
          ...(enumv ? { enum: enumv } : {}),
          ...(p.default !== undefined && p.default !== null && p.default !== "" ? { default: p.default } : {}),
          ...(p.example !== undefined && p.example !== null && p.example !== "" ? { example: String(p.example) } : {}),
        });
        pnames.add(pname);
      }
      // Every {x} in the URL must be a path param.
      for (const m of urlTemplate.matchAll(/\{(\w+)\}/g)) {
        if (!pnames.has(m[1])) {
          params.push({ name: m[1], in: "path", required: true, type: "string" });
          pnames.add(m[1]);
        }
      }
      // Path params that are not in the URL are dead.
      const live = params.filter((p) => p.in !== "path" || urlTemplate.includes(`{${p.name}}`));
      const example: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.example ?? {})) {
        const f = flagName(k);
        const target = live.find((p) => p.name === f || p.name === `api_${f}` || p.key === k);
        if (target && v !== undefined && v !== null) example[target.name] = String(v);
      }
      for (const p of live) if (p.required && example[p.name] === undefined && p.example !== undefined) example[p.name] = String(p.example);
      for (const p of live) if (p.enum && p.default !== undefined && !p.enum.includes(String(p.default))) p.enum.push(String(p.default));
      const headers = Object.fromEntries(Object.entries(r.headers ?? {}).filter(([k, v]) => !SECRET_HEADER.test(k) && typeof v === "string")) as Record<string, string>;
      const sources = String(r.source ?? "").match(/E\d+/g) ?? [];
      const mutates = method !== "GET" && method !== "HEAD" ? !!r.mutates || sources.some((s) => held.has(s)) : false;
      if (mutates && social) continue; // never generate writes for real-identity social networks
      const responseType = ["json", "html", "text"].includes(r.responseType) ? r.responseType : "json";
      const cmd: CommandSpec = {
        name,
        summary: String(r.summary ?? name).slice(0, 200),
        method,
        urlTemplate,
        params: live,
        ...(r.bodyTemplate && typeof r.bodyTemplate === "object" ? { bodyTemplate: r.bodyTemplate } : {}),
        ...(method !== "GET" ? { bodyEncoding: ["json", "form", "none"].includes(r.bodyEncoding) ? r.bodyEncoding : "json" } : {}),
        ...(Object.keys(headers).length ? { headers } : {}),
        responseType,
        ...(r.resultPath ? { resultPath: String(r.resultPath).replace(/^\$\.?/, "") } : {}),
        ...(r.extract && typeof r.extract === "object" && (r.extract.list || r.extract.fields || r.extract.jsonScript) ? { extract: r.extract } : {}),
        ...(Array.isArray(r.defaultFields) && r.defaultFields.length ? { defaultFields: r.defaultFields.map(String).slice(0, 12) } : {}),
        ...(r.pagination?.param && pnames.has(flagName(r.pagination.param)) ? { pagination: { ...r.pagination, param: flagName(r.pagination.param) } } : {}),
        ...(r.csrf?.from && (r.csrf.selector || r.csrf.jsonPath || r.csrf.cookie) ? { csrf: r.csrf } : {}),
        mutates,
        ...(r.auth ? { auth: true } : {}),
        ...(Object.keys(example).length ? { example } : {}),
        source: [
          ...sources,
          ...sources
            .map((s) => ctx.endpoints?.find((e) => e.id === s))
            .filter(Boolean)
            .slice(0, 1)
            .map((e) => `${e!.method} ${e!.url}`),
        ].join(" "),
      };
      // GET bodies are meaningless; mutating flag only for non-GET.
      if (method === "GET") for (const p of cmd.params) if (p.in === "body") p.in = "query";
      seen.add(name);
      out.push(cmd);
    } catch (e) {
      log(`  ✗ dropped malformed command ${r?.name}: ${(e as Error).message}`);
    }
  }
  return out;
}

export function emptySpec(name: string, url: string): SiteSpec {
  return { name, startUrl: url, origin: new URL(url).origin, createdAt: new Date().toISOString(), description: "", commands: [] };
}
