// Finding a site: compact listings, search by words or category, host/URL
// aliases (`clify crates.io` -> crates) and did-you-mean for unknown names.
import fs from "node:fs";
import path from "node:path";
import { HOME, listSites, readJson, readSpec } from "./store.ts";
import { PKG_DIR } from "./version.ts";
import type { SiteSpec } from "./types.ts";

export interface SiteEntry {
  site: string;
  host: string;
  description: string;
  commands: string[];
  category: string;
  local: boolean;
}

// "https://www.crates.io/crates/serde" | "www.crates.io" | "crates.io" -> "crates.io"
export function hostOf(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^[^@/]*@/, "")
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "")
    .replace(/^www\d?\./, "")
    .replace(/\.$/, "");
}

// First sentence, at most `max` chars. Abbreviations ("U.S.", "e.g.", "Inc.")
// and dotted names ("crates.io") don't end a sentence.
const ABBREV = /(^|[\s(])([A-Za-z]\.([A-Za-z]\.)*|e\.g|i\.e|etc|vs|Inc|Ltd|Co|Corp|St|Dr|Mr|Ms|No|approx|incl|Jr|Sr)\.?$/;
export function shortDescription(desc: string, max = 160): string {
  const d = (desc ?? "").replace(/\s+/g, " ").trim();
  let end = d.length;
  const re = /[.!?](?=\s+[A-Z0-9("'])/g;
  for (let m; (m = re.exec(d)); ) {
    if (ABBREV.test(d.slice(Math.max(0, m.index - 12), m.index + 1))) continue;
    end = m.index + 1;
    break;
  }
  let s = d.slice(0, end);
  if (s.length > max) s = s.slice(0, s.lastIndexOf(" ", max - 1) > max / 2 ? s.lastIndexOf(" ", max - 1) : max - 1).replace(/[,;:\s]+$/, "") + "…";
  return s;
}

// Categories: proofs/wall.json carries one per shipped site (read lazily; the
// file may be missing in a trimmed install). Others: a keyword guess.
let wallCats: Map<string, string> | null = null;
function wallCategory(site: string): string | undefined {
  if (!wallCats) {
    const wall = readJson<Array<{ site?: string; category?: string }>>(path.join(PKG_DIR, "proofs", "wall.json"), []);
    wallCats = new Map(Array.isArray(wall) ? wall.filter((w) => w?.site && w.category).map((w) => [w.site!, w.category!]) : []);
  }
  return wallCats.get(site);
}

const GUESS: Array<[string, RegExp]> = [
  ["dev", /\b(packages?|registry|crates?|npm|library|libraries|developer|docker|container|api docs?|source code|repositor|plugins?|sdk)\b/i],
  ["maps-weather", /\b(weather|forecasts?|maps?|geocod\w*|tides?|transit|bikes?|stations?|earthquakes?|air quality)\b/i],
  ["science", /\b(papers?|research|datasets?|species|genes?|proteins?|astronom\w*|chemi\w*|clinical|scientific)\b/i],
  ["news", /\b(news|headlines?|articles?)\b/i],
  ["culture", /\b(museums?|artworks?|art|books?|music|films?|archives?|collections?|librar\w*)\b/i],
  ["sports-ent", /\b(sports?|games?|movies?|tv|anime|league|football|soccer)\b/i],
  ["jobs-market", /\b(jobs?|prices?|market\w*|shop\w*|products?|listings?|real estate|tenders?|procurement)\b/i],
];
export function categoryOf(spec: Pick<SiteSpec, "name" | "origin" | "description"> & { category?: string }): string {
  if (spec.category) return spec.category;
  const fromWall = wallCategory(spec.name);
  if (fromWall) return fromWall;
  const host = hostOf(spec.origin ?? "");
  const gov = /\b(government|statistic\w*|public sector|official|agency|parliament|ministry|procurement|census)\b/i.test(spec.description ?? "");
  if (/\.gov$/.test(host) || (gov && /\.us$/.test(host))) return "gov-us";
  if (gov && /\.(fi|se|no|dk|is)$/.test(host)) return "gov-nordic";
  if (/(^|\.)europa\.eu$/.test(host) || (gov && /\.eu$/.test(host))) return "gov-eu";
  for (const [c, re] of GUESS) if (re.test(`${spec.name} ${spec.description ?? ""}`)) return c;
  return "other";
}

let cache: SiteEntry[] | null = null;
export function catalog(): SiteEntry[] {
  if (cache) return cache;
  cache = listSites().flatMap((n) => {
    const spec = readSpec<SiteSpec & { category?: string }>(n);
    if (!spec) return [];
    return [{
      site: n,
      host: hostOf(spec.origin || spec.startUrl || ""),
      description: spec.description ?? "",
      commands: (spec.commands ?? []).map((c) => c.name),
      category: categoryOf({ ...spec, name: n }),
      local: fs.existsSync(path.join(HOME, "sites", n, "spec.json")),
    }];
  });
  return cache;
}

export function categories(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of catalog()) counts[e.category] = (counts[e.category] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

// A site name, host or URL -> the installed site name (or null).
export function resolveSite(input: string | undefined): string | null {
  if (!input) return null;
  if (readSpec(input)) return input;
  const lower = input.toLowerCase();
  if (lower !== input && readSpec(lower)) return lower;
  const host = hostOf(input);
  if (!host || !host.includes(".")) return null;
  const all = catalog();
  const exact = all.find((e) => e.host === host);
  if (exact) return exact.site;
  // api.crates.io -> crates.io; prefer the longest (most specific) site host.
  const parent = all.filter((e) => e.host && host.endsWith("." + e.host)).sort((a, b) => b.host.length - a.host.length)[0];
  return parent?.site ?? null;
}

// Optimal string alignment distance (adjacent transpositions count as one edit).
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

// Close matches for an unknown site name (at most `max`, best first).
export function similarSites(input: string, max = 10): string[] {
  const q = hostOf(input).replace(/\.[a-z]{2,}$/, "") || input.toLowerCase();
  const allowed = Math.max(1, Math.floor(q.length / 3));
  const scored: Array<[string, number]> = [];
  for (const e of catalog()) {
    const label = e.host.split(".").slice(0, -1).join(".") || e.site;
    let best = Math.min(distance(q, e.site), distance(q, label), distance(q, e.host.replace(/\./g, "-")));
    if (q.length >= 3 && (e.site.includes(q) || e.host.includes(q))) best = Math.min(best, 0.5);
    if (e.site.length >= 3 && q.includes(e.site)) best = Math.min(best, 0.75);
    // "hackernews" -> news-ycombinator ("Hacker News (news.ycombinator.com) ...")
    if (q.length >= 5 && e.description.slice(0, 40).toLowerCase().replace(/[^a-z0-9]/g, "").includes(q)) best = Math.min(best, 1);
    if (best <= allowed) scored.push([e.site, best]);
  }
  return scored.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, max).map(([s]) => s);
}

// Ranked search over name, host, description, command names and category.
export function searchSites(query: string | undefined, category?: string): Array<SiteEntry & { score: number }> {
  const tokens = (query ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  const cat = category?.toLowerCase();
  const res: Array<SiteEntry & { score: number }> = [];
  for (const e of catalog()) {
    if (cat && e.category !== cat && !e.category.startsWith(cat)) continue;
    if (!tokens.length) {
      res.push({ ...e, score: 0 });
      continue;
    }
    const desc = e.description.toLowerCase();
    let score = 0;
    let hit = 0;
    for (const t of tokens) {
      let s = 0;
      if (e.site === t) s += 12;
      else if (e.site.includes(t)) s += 6;
      if (e.host.includes(t)) s += 4;
      if (new RegExp(`\\b${t}\\b`).test(desc)) s += 3;
      else if (new RegExp(`\\b${t}`).test(desc)) s += 1.5;
      s += Math.min(4, 2 * e.commands.filter((c) => c.split("-").includes(t)).length);
      if (e.category === t || e.category.split("-").includes(t)) s += 2;
      if (s) hit++;
      score += s;
    }
    if (!score) continue;
    if (tokens.length > 1 && hit === tokens.length) score += 4;
    res.push({ ...e, score });
  }
  return tokens.length ? res.sort((a, b) => b.score - a.score || a.site.localeCompare(b.site)) : res;
}
