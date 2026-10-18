// MCP server (stdio): one tool per site command, named <site>__<command>.
// Write commands take confirm:true to send; without it they return the
// dry-run preview, same as the CLI without --yes.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { listSites, readSpec } from "./store.ts";
import { VERSION } from "./version.ts";
import { defaultLoginScript, runLogin } from "./login.ts";
import { present, run } from "./runtime.ts";
import type { CommandSpec, SiteSpec } from "./types.ts";

function toolName(site: string, cmd: string): string {
  return `${site}__${cmd}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function inputSchema(c: CommandSpec, spec?: SiteSpec) {
  const properties: Record<string, any> = {};
  for (const p of c.params) {
    properties[p.name] = {
      type: p.type,
      ...(p.description ? { description: p.description } : {}),
      ...(p.enum ? { enum: p.enum } : {}),
      ...(p.context && spec?.context?.[p.context] ? { default: spec.context[p.context].value } : p.default !== undefined ? { default: p.default } : {}),
    };
  }
  properties.fields = { type: "string", description: `comma-separated fields to keep (dot paths ok, '*' = all)${c.defaultFields ? `; default: ${c.defaultFields.join(",")}` : ""}` };
  properties.limit = { type: "number", description: "return only the first N items" };
  if (c.mutates) properties.confirm = { type: "boolean", description: "true sends the write; otherwise a dry-run preview of the exact request is returned" };
  return { type: "object", properties, required: c.params.filter((p) => p.required && p.default === undefined && !(p.context && spec?.context?.[p.context])).map((p) => p.name) };
}

export function loadSpecs(sites: string[]): SiteSpec[] {
  const names = sites.length ? sites : listSites();
  return names.map((n) => readSpec<SiteSpec>(n)).filter((s): s is SiteSpec => !!s);
}

export function buildServer(specs: SiteSpec[]): Server {
  const tools = new Map<string, { spec: SiteSpec; cmd: CommandSpec }>();
  for (const spec of specs) for (const cmd of spec.commands) tools.set(toolName(spec.name, cmd.name), { spec, cmd });

  const server = new Server({ name: "clify", version: VERSION }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "clify__login",
        description: "Fill and submit a login form for an existing authorized account. Credentials come only from CLIFY_USERNAME/CLIFY_PASSWORD in the process environment; CAPTCHA and bot checks stop the flow.",
        inputSchema: {
          type: "object",
          properties: {
            site: { type: "string", description: "Installed site name" },
            url: { type: "string", description: "Optional login URL override" },
            script: { type: "array", description: "Optional scripted steps; default is fill_login, submit, logged_in." },
          },
          required: ["site"],
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      ...[...tools].map(([name, { spec, cmd }]) => ({
        name,
        description: `${spec.name}: ${cmd.summary}${cmd.mutates ? " (writes data: pass confirm:true to send)" : ""}${cmd.auth ? " (needs \`clify login\`)" : ""}${cmd.example && Object.keys(cmd.example).length ? ` Example args: ${JSON.stringify(cmd.example)}` : ""}`,
        inputSchema: inputSchema(cmd, spec) as any,
        annotations: { readOnlyHint: !cmd.mutates, destructiveHint: cmd.mutates, openWorldHint: true },
      })),
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === "clify__login") {
      const a = (req.params.arguments ?? {}) as Record<string, unknown>;
      if (typeof a.site !== "string") return { isError: true, content: [{ type: "text", text: "site is required" }] };
      try {
        const res = await runLogin({
          name: a.site,
          url: typeof a.url === "string" ? a.url : undefined,
          script: Array.isArray(a.script) ? (a.script as any) : defaultLoginScript(),
        });
        const body = { ok: res.loggedIn && res.blockers.length === 0, url: res.url, loggedIn: res.loggedIn, blockers: res.blockers, sessionFile: res.sessionFile };
        return { isError: !body.ok, content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, error: (e as Error).message }) }] };
      }
    }
    const t = tools.get(req.params.name);
    if (!t) return { isError: true, content: [{ type: "text", text: `unknown tool ${req.params.name}` }] };
    const { fields, limit, confirm, ...rest } = (req.params.arguments ?? {}) as Record<string, unknown>;
    const args = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, String(v)]));
    const res = await run(t.spec, t.cmd, args, { confirm: confirm === true, confirmHint: "confirm:true" });
    const { raw: _raw, ...failed } = res;
    const body = res.ok
      ? present(t.cmd, res, { fields: typeof fields === "string" ? fields.split(",").map((s) => s.trim()).filter(Boolean) : undefined, limit: typeof limit === "number" ? limit : undefined })
      : { ...failed, ...(res.needsConfirmation ? { next: "call again with confirm:true to send" } : {}) };
    return { isError: !res.ok, content: [{ type: "text", text: JSON.stringify(body) }] };
  });
  return server;
}

export async function serve(sites: string[]): Promise<void> {
  const server = buildServer(loadSpecs(sites));
  await server.connect(new StdioServerTransport());
}
