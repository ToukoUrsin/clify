// clify MCP server (mcp-use, hosted on Manufact). The whole verified catalogue
// (every bundled real site and command) goes through 3 core tools so the tool
// list stays small: clify_sites (find a site), clify_help (its commands and
// params), clify_run (call one). A few popular commands are also direct tools.
// Requests run through clify's own runtime core (clify/src/core.ts), without
// sessions; specs are bundled at build time (src/specs.generated.ts).
import { MCPServer } from "mcp-use";
import { z } from "zod";
import { CATEGORIES, CATEGORY_COUNTS, commandDetail, commandLine, findCommand, findSite, host, searchSites, siteLine, siteRow, type HostedSite } from "./src/catalog.js";
import { dig, present, run, type CommandSpec, type ParamSpec } from "./src/clify.js";
import { GUIDE, INSTRUCTIONS } from "./src/guide.js";
import { SPECS } from "./src/specs.generated.js";

const MAX_CHARS = 6000;
// Direct tools besides the three core ones: site/command pairs. CLIFY_TOOLS=core
// turns them off, CLIFY_TOOLS=all registers every command (for measuring).
const FEATURED = (process.env.CLIFY_FEATURED ?? "crates/get-crate,pypi/get-package,wikipedia/summary,hnsearch/search").split(",").filter(Boolean);
const MODE = process.env.CLIFY_TOOLS ?? "featured";

const server = new MCPServer({
  name: "clify",
  title: "clify — websites as agent tools",
  version: "0.3.0",
  description: `${SPECS.length} real websites (${SPECS.reduce((a, s) => a + s.commands.length, 0)} verified commands) as typed, JSON-first calls for agents, through 3 core tools${MODE === "featured" && FEATURED.length ? ` (+${FEATURED.length} shortcuts)` : ""}.`,
  instructions: INSTRUCTIONS,
});

const json = (v: unknown) => JSON.stringify(v);
const text = (v: unknown, isError = false) => ({ content: [{ type: "text" as const, text: json(v) }], ...(isError ? { isError: true } : {}) });
const toolName = (site: string, cmd: string) => `${site}__${cmd}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
const helpCall = (site: string, command?: string) => `clify_help ${json(command ? { site, command } : { site })}`;

function budget(data: unknown): { data: unknown; truncated?: true } {
  if (json(data).length <= MAX_CHARS) return { data };
  if (Array.isArray(data)) {
    let n = data.length;
    while (n > 1 && json(data.slice(0, n)).length > MAX_CHARS) n = Math.floor(n * 0.7);
    if (json(data.slice(0, n)).length <= MAX_CHARS) return { data: data.slice(0, n), truncated: true };
  }
  return { data: json(data).slice(0, MAX_CHARS) + "…", truncated: true };
}

const unknownSite = (site: string) => {
  const close = searchSites(site).slice(0, 5).map((r) => r.site.name);
  return text({ ok: false, error: `unknown site "${site}"`, ...(close.length ? { didYouMean: close } : {}), next: 'clify_sites {"query":"<what you need>"}' }, true);
};

async function runCommand(spec: HostedSite, c: CommandSpec, input: { args?: Record<string, unknown>; fields?: string; limit?: number; confirm?: boolean }) {
  const args = Object.fromEntries(Object.entries(input.args ?? {}).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]));
  const res = await run(spec, c, args, { confirm: input.confirm === true, confirmHint: "confirm:true", sameSiteOnly: true });
  if (!res.ok) {
    const { raw: _raw, next: _next, ...rest } = res;
    const err = { ...rest, ...(rest.error ? { error: rest.error.replace(/--(\w)/g, "$1") } : {}) }; // CLI flags → param names
    if (res.needsConfirmation) return text({ ...err, next: "call again with confirm:true to send" });
    return text({ ...err, next: helpCall(spec.name, c.name) }, true);
  }
  const fields = input.fields?.split(",").map((s) => s.trim()).filter(Boolean);
  const out = present(c, res, { fields, limit: input.limit });
  // Name the requested fields that exist on no item, with the keys that do.
  const sample = (Array.isArray(res.data) ? res.data.slice(0, 5) : [res.data]).filter((x) => x && typeof x === "object");
  const unknown = sample.length && fields && !fields.includes("*") ? fields.filter((f) => sample.every((x) => dig(x, f) === undefined)) : [];
  const { data, truncated } = budget(out.data);
  return text({
    ...out,
    ...(Array.isArray(data) && Array.isArray(res.data) && data.length !== res.data.length ? { returned: data.length } : {}),
    ...(!fields?.length && c.defaultFields?.length ? { fields: `${c.defaultFields.join(",")} (default; fields="*" for all)` } : {}),
    ...(unknown.length ? { unknownFields: unknown, availableFields: Object.keys(sample[0] as object).slice(0, 40) } : {}),
    ...(truncated ? { truncated, hint: "narrow with fields and limit" } : {}),
    data,
  });
}

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const PAGE = 40;

server.tool(
  {
    name: "clify_sites",
    title: "Find a clify site",
    description: `Search the catalogue of ${SPECS.length} real websites clify can call (package registries, government data, science, news, jobs, weather, culture…). Pass a keyword query to get the best sites with their matching commands. Without a query it pages through the catalogue, one line per site ("name (category, commands): about"); filter with category. Start here.`,
    inputSchema: z.object({
      query: z.string().optional().describe('what you need, e.g. "rust crate versions" or "weather forecast"'),
      category: z.enum(CATEGORIES as [string, ...string[]]).optional(),
      limit: z.number().int().positive().optional().describe(`max sites (default 6 with a query, ${PAGE} per page without)`),
      offset: z.number().int().nonnegative().optional().describe("skip this many sites when paging the catalogue (see nextPage)"),
    }),
    annotations: RO,
  },
  async ({ query, category, limit, offset }) => {
    if (!query?.trim()) {
      const pool = SPECS.filter((s) => !category || s.category === category);
      const from = Math.min(offset ?? 0, pool.length);
      const page = pool.slice(from, from + (limit ?? PAGE));
      const end = from + page.length;
      return text({
        total: pool.length,
        offset: from,
        count: page.length,
        ...(category ? {} : { categories: CATEGORY_COUNTS }),
        sites: page.map(siteRow),
        ...(end < pool.length ? { nextPage: { ...(category ? { category } : {}), ...(limit ? { limit } : {}), offset: end } } : {}),
        next: 'clify_sites {"query":"<what you need>"} to search; clify_help {"site":"<site>"} for a site\'s commands',
      });
    }
    const hits = searchSites(query, category).slice(0, limit ?? 6);
    if (!hits.length) return text({ ok: false, error: `no site matches "${query}"`, categories: CATEGORY_COUNTS, next: "clify_sites with a category, or no query, pages through every site" });
    return text({
      sites: hits.map((h) => ({ ...siteLine(h.site), matches: h.commands.slice(0, 4).map(commandLine) })),
      next: 'clify_help {"site":"<site>"} for every command, or clify_run directly',
    });
  },
);

server.tool(
  {
    name: "clify_help",
    title: "Commands and params of a site",
    description: 'A site\'s commands with params ("name*" = required, ":a|b" = allowed values, "=x" = default). Pass command for full param docs, default fields and a ready clify_run call.',
    inputSchema: z.object({
      site: z.string().describe("site name from clify_sites, e.g. crates, weather"),
      command: z.string().optional().describe("one command name for full details"),
    }),
    annotations: RO,
  },
  async ({ site, command }) => {
    const spec = findSite(site);
    if (!spec) return unknownSite(site);
    if (command) {
      const c = findCommand(spec, command);
      if (!c) return text({ ok: false, error: `unknown command "${command}" on ${spec.name}`, commands: spec.commands.map((c) => c.name) }, true);
      return text({ site: spec.name, host: host(spec), ...commandDetail(spec, c) });
    }
    return text({
      site: spec.name,
      host: host(spec),
      about: spec.description,
      ...(spec.notes?.length ? { notes: spec.notes.slice(0, 4) } : {}),
      commands: spec.commands.map(commandLine),
      next: `clify_run {"site":"${spec.name}","command":"<command>","args":{...}}; ${helpCall(spec.name, "<command>")} for one command's details`,
    });
  },
);

server.tool(
  {
    name: "clify_run",
    title: "Run a site command",
    description:
      'Call one command of a clify site and get JSON back. args holds the command\'s params (see clify_help). Lists return count, total and nextPage (args for the next page). Write commands return a dry-run preview unless confirm:true.',
    inputSchema: z.object({
      site: z.string().describe("site name, e.g. crates"),
      command: z.string().describe("command name, e.g. get-crate"),
      args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe('params, e.g. {"name":"serde"}'),
      fields: z.string().optional().describe('comma-separated keys to keep (dot paths ok); "*" for all'),
      limit: z.number().int().positive().optional().describe("first N items of a list"),
      confirm: z.boolean().optional().describe("true sends a write; otherwise writes return a preview"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  async ({ site, command, args, fields, limit, confirm }) => {
    const spec = findSite(site);
    if (!spec) return unknownSite(site);
    const c = findCommand(spec, command);
    if (!c) return text({ ok: false, error: `unknown command "${command}" on ${spec.name}`, commands: spec.commands.map((c) => c.name), next: helpCall(spec.name) }, true);
    return runCommand(spec, c, { args, fields, limit, confirm });
  },
);

// Direct tools: typed params from the spec.
function paramZod(p: ParamSpec) {
  let s: z.ZodType =
    p.enum?.length ? z.enum(p.enum as [string, ...string[]]) : p.type === "number" ? z.coerce.number() : p.type === "boolean" ? z.boolean() : z.string();
  const hint = [p.description, p.default !== undefined ? `default ${p.default}` : ""].filter(Boolean).join("; ");
  if (hint) s = s.describe(hint);
  return p.required && p.default === undefined ? s : s.optional();
}

const direct =
  MODE === "all" ? SPECS.flatMap((s) => s.commands.map((c) => [s, c] as const))
  : MODE === "core" ? []
  : FEATURED.map((f) => f.split("/")).map(([s, c]) => [findSite(s), findSite(s) && findCommand(findSite(s)!, c)] as const).filter((x): x is readonly [HostedSite, CommandSpec] => !!x[0] && !!x[1]);

for (const [spec, c] of direct) {
  const shape: Record<string, z.ZodType> = {};
  for (const p of c.params) shape[p.name] = paramZod(p);
  shape.fields = z.string().optional().describe('keys to keep; "*" for all');
  shape.limit = z.number().int().positive().optional();
  if (c.mutates) shape.confirm = z.boolean().optional().describe("true sends the write");
  server.tool(
    {
      name: toolName(spec.name, c.name),
      title: `${spec.name} ${c.name}`,
      description: `${host(spec)}: ${c.summary}${c.defaultFields?.length ? ` Returns ${c.defaultFields.join(", ")} by default.` : ""}${c.mutates ? " WRITES: preview unless confirm:true." : ""} (Same as clify_run site=${spec.name} command=${c.name}.)`,
      inputSchema: z.object(shape),
      annotations: { readOnlyHint: !c.mutates, destructiveHint: c.mutates, idempotentHint: !c.mutates, openWorldHint: true },
    },
    async (input: Record<string, unknown>) => {
      const { fields, limit, confirm, ...args } = input;
      return runCommand(spec, c, { args: args as Record<string, unknown>, fields: fields as string | undefined, limit: limit as number | undefined, confirm: confirm as boolean | undefined });
    },
  );
}

server.resource(
  { name: "clify-guide", title: "How to use clify", uri: "clify://guide", mimeType: "text/markdown", description: "Workflow, output shaping and write-safety rules for agents." },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: GUIDE }] }),
);

server.resourceTemplate(
  {
    name: "clify-site-spec",
    title: "clify site spec",
    uriTemplate: "clify://sites/{site}",
    mimeType: "application/json",
    description: "The full JSON spec (commands, params, extractors) behind one site.",
    complete: { site: SPECS.map((s) => s.name) },
  },
  async (uri, { site }) => {
    const name = Array.isArray(site) ? site[0] : site;
    const spec = findSite(String(name));
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: json(spec ?? { error: `unknown site ${name}`, sites: SPECS.map((s) => s.name) }) }] };
  },
);

server.prompt(
  {
    name: "use-clify",
    title: "Do a web task with clify",
    description: "Instructions for answering a web task through clify tools instead of a browser.",
    schema: z.object({ task: z.string().describe("what the user wants from the web") }),
  },
  async ({ task }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `${GUIDE}\n---\nTask: ${task}\n\nUse the clify tools: clify_sites → clify_help → clify_run with fields/limit. Never send a write without the user's OK; show the dry-run preview first. Answer with the exact values the tools returned.`,
        },
      },
    ],
  }),
);

export default server;
