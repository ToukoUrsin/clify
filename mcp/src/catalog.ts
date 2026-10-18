// The hosted catalogue: lookup, keyword search and compact descriptions of the
// bundled site specs, sized for an agent's context.
import type { CommandSpec, ParamSpec, SiteSpec } from "./clify.js";
import { SPECS } from "./specs.generated.js";

export type HostedSite = SiteSpec & { category: string; about?: string; verifiedAt?: string };

export const CATEGORIES = [...new Set(SPECS.map((s) => s.category))].sort();
export const CATEGORY_COUNTS = Object.fromEntries(CATEGORIES.map((c) => [c, SPECS.filter((s) => s.category === c).length]));
export const host = (s: SiteSpec) => new URL(s.origin).hostname.replace(/^www\./, "");

// First sentence of a text, never cut at the period of "U.S.", "e.g.", "Inc." or
// "v1.2"; cut at a word with "…" past max. (scripts/sync-specs.mjs precomputes
// each site's `about` the same way.)
const ABBREV = /(?:^|[\s(])(?:[A-Z]\.)+$|(?:^|[\s(])(?:e\.g|i\.e|etc|vs|Inc|Ltd|Co|Corp|Dr|Mr|Mrs|Ms|St|No|Jr|Sr|approx|incl|cf|al)\.$/i;
export const firstSentence = (t: string, max = 140) => {
  let s = "";
  for (const part of t.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"'(“])/)) {
    s = s ? `${s} ${part}` : part;
    if (!ABBREV.test(s)) break;
  }
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return cut.slice(0, sp > max * 0.6 ? sp : cut.length).replace(/[\s,;:(–—-]+$/, "") + "…";
};
export const about = (s: HostedSite) => s.about ?? firstSentence(s.description, 160);

export function findSite(name: string): HostedSite | undefined {
  const n = name.trim().toLowerCase();
  return SPECS.find((s) => s.name === n) ?? SPECS.find((s) => host(s) === n.replace(/^https?:\/\//, "").replace(/^www\.|\/.*$/g, ""));
}

export const findCommand = (s: SiteSpec, name: string): CommandSpec | undefined => s.commands.find((c) => c.name === name.trim());

// "name*:number=10 sort:a|b" — * required, :type when not a string, =default, |allowed values.
export function signature(c: CommandSpec): string {
  return c.params
    .map((p: ParamSpec) => {
      const req = p.required && p.default === undefined ? "*" : "";
      const type = p.enum?.length ? `:${p.enum.slice(0, 6).join("|")}${p.enum.length > 6 ? "|…" : ""}` : p.type !== "string" ? `:${p.type}` : "";
      const def = p.default !== undefined ? `=${p.default}` : "";
      return `${p.name}${req}${type}${def}`;
    })
    .join(" ");
}

const words = (q: string) =>
  q
    .toLowerCase()
    .split(/[^a-z0-9.+#-]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.replace(/(?<=..)(es|s)$/, ""));
const STOP = new Set(["the", "a", "an", "of", "for", "on", "in", "and", "or", "to", "find", "get", "latest", "current", "what", "is", "from", "with", "by"]);

// Keyword search over site names, hosts, categories, descriptions and command
// summaries. Returns sites by score with the commands that matched.
export function searchSites(query: string, category?: string) {
  const qs = words(query);
  const pool = SPECS.filter((s) => !category || s.category === category);
  if (!qs.length) return pool.map((s) => ({ site: s, score: 0, commands: [] as CommandSpec[] }));
  const scored = pool.map((s) => {
    const name = `${s.name} ${host(s)}`.toLowerCase();
    const desc = s.description.toLowerCase();
    let score = 0;
    const hits = new Map<CommandSpec, number>();
    for (const w of qs) {
      if (name.includes(w)) score += 6;
      if (s.category === w) score += 3;
      if (desc.includes(w)) score += 2;
      for (const c of s.commands) {
        const t = `${c.name} ${c.summary}`.toLowerCase();
        if (t.includes(w)) {
          hits.set(c, (hits.get(c) ?? 0) + 1);
          score += 0.5;
        }
      }
    }
    const commands = [...hits].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    return { site: s, score, commands };
  });
  return scored.filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
}

export function siteLine(s: HostedSite) {
  return { site: s.name, host: host(s), category: s.category, about: about(s), commands: s.commands.length };
}

// One compact line per site for the paged catalogue: "crates (dev, 7): crates.io, the Rust package registry."
export const siteRow = (s: HostedSite) => `${s.name} (${s.category}, ${s.commands.length}): ${about(s)}`;

export function commandLine(c: CommandSpec) {
  const fields = c.defaultFields ?? Object.keys(c.extract?.fields ?? {});
  return { command: c.name, params: signature(c), summary: firstSentence(c.summary, 160), ...(fields.length ? { returns: fields.slice(0, 8).join(",") } : {}), ...(c.mutates ? { writes: true } : {}) };
}

export function exampleArgs(c: CommandSpec): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const p of c.params) {
    const v = c.example?.[p.name] ?? p.example ?? (p.required && p.default === undefined ? p.enum?.[0] ?? `<${p.name}>` : undefined);
    if (v !== undefined) args[p.name] = p.type === "number" && !isNaN(Number(v)) ? Number(v) : v;
  }
  return args;
}

export function commandDetail(s: HostedSite, c: CommandSpec) {
  return {
    command: c.name,
    summary: c.summary,
    ...(c.mutates ? { writes: true, note: "dry-run preview unless confirm:true" } : {}),
    params: c.params.map((p) => ({
      name: p.name,
      type: p.type,
      ...(p.required && p.default === undefined ? { required: true } : {}),
      ...(p.description ? { description: p.description } : {}),
      ...(p.enum ? { oneOf: p.enum } : {}),
      ...(p.default !== undefined ? { default: p.default } : {}),
    })),
    ...(c.defaultFields?.length ? { defaultFields: c.defaultFields } : c.extract?.fields ? { fields: Object.keys(c.extract.fields) } : {}),
    example: { tool: "clify_run", arguments: { site: s.name, command: c.name, args: exampleArgs(c) } },
  };
}
