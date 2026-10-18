// Phase 4, after verification: make the generated CLI as cheap for an agent as
// a hand-written one.
// - Near-duplicate commands (same request) collapse into one with aliases.
// - Account context: ids that are constant for the signed-in account (current
//   organization, project, team, workspace, user...) become defaults, so the
//   agent does not look them up first. A value qualifies when the recording used
//   one value for it everywhere, and either several commands take it or a live
//   read confirms it (the only item of a list, or a field of the account object).
// - Every command gets a runnable example from its verified call; examples drop
//   the context params (they are defaults now) and writes reuse ids that a
//   verified read used.
import { log } from "./store.ts";
import { run } from "./runtime.ts";
import type { CommandSpec, ContextValue, Exchange, ParamSpec, SiteSpec } from "./types.ts";

// Words that name the account's scope (what a dashboard keeps "current").
const SCOPE = new Set(["org", "orgs", "organization", "organisation", "organizations", "project", "projects", "team", "teams", "workspace", "workspaces", "account", "tenant", "company", "space", "app", "application", "user", "owner", "region", "database", "db", "env", "environment", "instance", "store", "shop", "namespace", "group", "site", "board", "realm"]);
const ID_TAIL = new Set(["id", "uuid", "slug", "ref", "handle"]);
const SECRET = /(key|token|secret|password|passwd|csrf|xsrf|auth|session|cookie|signature|nonce)/i;
// Writes that remove or hand over something never get silent defaults.
const DESTRUCTIVE = /(delete|remove|destroy|archive|leave|transfer|reset|revoke|disable|purge|wipe)/i;

function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function isScopeParam(p: ParamSpec): boolean {
  const ws = words(p.key ?? p.name);
  const own = words(p.name);
  if ([...ws, ...own].some((w) => SECRET.test(w))) return false;
  if (p.enum?.length) return false;
  const last = ws[ws.length - 1];
  const prev = ws[ws.length - 2];
  return SCOPE.has(last) || (ID_TAIL.has(last) && !!prev && SCOPE.has(prev));
}

const destructive = (c: CommandSpec) => c.mutates && (c.method === "DELETE" || DESTRUCTIVE.test(c.name));

// Same method, URL (without query), body template and params → one command.
export function collapseDuplicates(commands: CommandSpec[]): CommandSpec[] {
  const out: CommandSpec[] = [];
  const key = (c: CommandSpec) =>
    JSON.stringify([c.method, c.urlTemplate.split("?")[0], c.bodyTemplate ?? null, c.params.map((p) => `${p.in}:${p.key ?? p.name}`).sort(), c.responseType]);
  for (const c of commands) {
    const twin = out.find((o) => key(o) === key(c));
    if (twin) {
      twin.aliases = [...new Set([...(twin.aliases ?? []), c.name, ...(c.aliases ?? [])])];
      if (!twin.verified && c.verified) Object.assign(twin, { verified: true, verifyNote: undefined, example: c.example, sample: c.sample, resultFields: c.resultFields });
      log(`  ⇉ ${c.name} is the same request as ${twin.name}: kept as an alias`);
      continue;
    }
    out.push(c);
  }
  return out;
}

function scalars(v: unknown, depth: number, acc: Map<string, string>, path = ""): Map<string, string> {
  if (v === null || v === undefined) return acc;
  if (typeof v === "string" || typeof v === "number") {
    if (String(v).length >= 2 && !acc.has(String(v))) acc.set(String(v), path);
    return acc;
  }
  if (depth <= 0 || typeof v !== "object") return acc;
  if (Array.isArray(v)) return acc; // only the account object or a single list item count
  for (const [k, x] of Object.entries(v)) scalars(x, depth - 1, acc, path ? `${path}.${k}` : k);
  return acc;
}

function recordedText(exchanges: Exchange[]): string {
  return exchanges
    .filter((e) => e.withSession !== false)
    .map((e) => `${e.url}\n${JSON.stringify(e.requestHeaders ?? {})}\n${e.requestBody ?? ""}\n${(e.responseSample ?? "").slice(0, 20000)}`)
    .join("\n");
}

// Finds the account context and wires it into the commands' params.
export async function deriveContext(spec: SiteSpec, o: { exchanges?: Exchange[]; live?: boolean; maxCalls?: number } = {}): Promise<SiteSpec> {
  const cmds = spec.commands;
  // Candidate values per scope-named param, from examples and model defaults.
  const byName = new Map<string, Set<string>>();
  const usedBy = new Map<string, Set<string>>(); // value -> commands
  for (const c of cmds) {
    for (const p of c.params) {
      if (!isScopeParam(p)) continue;
      const v = c.example?.[p.name] ?? (p.default !== undefined ? String(p.default) : p.example !== undefined ? String(p.example) : undefined);
      if (v === undefined || v === "") continue;
      if (!byName.has(p.name)) byName.set(p.name, new Set());
      byName.get(p.name)!.add(v);
      if (!usedBy.has(v)) usedBy.set(v, new Set());
      usedBy.get(v)!.add(c.name);
    }
  }
  // A name the recording saw with two values is per-object, not per-account.
  const values = new Map<string, string[]>(); // value -> param names
  for (const [n, vs] of byName) {
    if (vs.size !== 1) continue;
    const v = [...vs][0];
    values.set(v, [...(values.get(v) ?? []), n]);
  }
  const seen = o.exchanges?.length ? recordedText(o.exchanges) : undefined;
  const context: Record<string, ContextValue> = { ...(spec.context ?? {}) };
  const accept = (v: string, from: string) => {
    const names = values.get(v)!;
    // Context key: the param name most commands use for it.
    const count = (n: string) => cmds.filter((c) => c.params.some((p) => p.name === n)).length;
    const k = [...names].sort((a, b) => count(b) - count(a))[0];
    if (!context[k]) context[k] = { value: v, from };
    values.delete(v);
    for (const c of cmds) for (const p of c.params) if (names.includes(p.name) && isScopeParam(p) && !destructive(c)) p.context = k;
  };
  for (const v of [...values.keys()]) {
    if (seen !== undefined && !seen.includes(v)) {
      values.delete(v); // not in the recording: the model made it up
      continue;
    }
    if ((usedBy.get(v)?.size ?? 0) >= 2) accept(v, `same value on every recorded request (${[...usedBy.get(v)!].slice(0, 3).join(", ")})`);
  }
  // Confirm the rest live: reads that run with what is known return the
  // account object or a single-item list that holds the value.
  if (o.live !== false && values.size) {
    let calls = 0;
    const tried = new Set<string>();
    for (let round = 0; round < 3 && values.size && calls < (o.maxCalls ?? 10); round++) {
      const runnable = cmds.filter(
        (c) => !c.mutates && c.verified !== false && !tried.has(c.name) && c.params.every((p) => !p.required || p.default !== undefined || (p.context && context[p.context])),
      );
      if (!runnable.length) break;
      let found = false;
      for (const c of runnable) {
        if (!values.size || calls >= (o.maxCalls ?? 10)) break;
        tried.add(c.name);
        calls++;
        const res = await run(spec, c, {}).catch(() => null);
        if (!res?.ok) continue;
        const d = res.data;
        const pool = Array.isArray(d) ? (d.length === 1 ? scalars(d[0], 3, new Map()) : new Map<string, string>()) : scalars(d, 4, new Map());
        for (const v of [...values.keys()]) {
          if (!pool.has(v)) continue;
          accept(v, Array.isArray(d) ? `the only item of ${c.name}` : `${c.name} → ${pool.get(v)}`);
          found = true;
        }
      }
      if (!found && round > 0) break;
    }
  }
  if (Object.keys(context).length) {
    for (const [k, v] of Object.entries(context)) log(`  ⚑ context ${k} = ${v.value} (${v.from})`);
    spec.context = context;
  }
  return spec;
}

const mask = (s: string) => s.replace(/("(?:[^"]*(?:token|secret|password|api_?key|csrf)[^"]*)"\s*:\s*")([^"]{6})[^"]*"/gi, '$1$2…"');

// Examples: every command has one, context params are left out (they are
// defaults), and unverified writes take ids that a verified read used.
export function polishExamples(spec: SiteSpec): SiteSpec {
  const verifiedIds = new Map<string, string>();
  for (const c of spec.commands) if (c.verified) for (const [k, v] of Object.entries(c.example ?? {})) if (!verifiedIds.has(k)) verifiedIds.set(k, v);
  for (const c of spec.commands) {
    const ex: Record<string, string> = { ...(c.example ?? {}) };
    for (const p of c.params) {
      if (p.context && spec.context?.[p.context] && ex[p.name] === spec.context[p.context].value) delete ex[p.name];
      // Writes on an existing object: an id a verified read used (the recorded
      // one may be gone); never a real id for a delete-like command.
      if (c.mutates && !c.verified && p.in === "path" && ex[p.name] !== undefined && !p.context) {
        if (destructive(c)) {
          if (!isScopeParam(p)) ex[p.name] = `<${p.name}>`;
        } else if (verifiedIds.has(p.name)) ex[p.name] = verifiedIds.get(p.name)!;
      }
    }
    c.example = ex;
    if (c.sample) c.sample = mask(c.sample);
  }
  return spec;
}

export async function polish(spec: SiteSpec, o: { exchanges?: Exchange[]; loggedIn?: boolean; live?: boolean } = {}): Promise<SiteSpec> {
  spec.commands = collapseDuplicates(spec.commands);
  if (o.loggedIn) await deriveContext(spec, { exchanges: o.exchanges, live: o.live });
  return polishExamples(spec);
}
