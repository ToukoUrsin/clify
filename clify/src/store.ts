// On-disk layout. Everything lives under $CLIFY_HOME (default ~/.clify):
//   sites/<name>/spec.json        generated CLI spec
//   sites/<name>/recording.jsonl  captured public network traffic
//   bin/<name>                    shim so the agent can just run `<name> ...`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOME = process.env.CLIFY_HOME || path.join(os.homedir(), ".clify");

export function siteDir(name: string): string {
  const d = path.join(HOME, "sites", name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function siteFile(name: string, file: string): string {
  return path.join(siteDir(name), file);
}

// Verified specs that ship with clify (specs/<site>.json). They work right
// after install; a site's own spec in $CLIFY_HOME (from `clify add`/`repair`)
// takes precedence.
export const BUILTIN_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "specs");

export function builtinSites(): string[] {
  if (process.env.CLIFY_NO_BUILTINS || !fs.existsSync(BUILTIN_DIR)) return [];
  return fs.readdirSync(BUILTIN_DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
}

export function listSites(): string[] {
  const d = path.join(HOME, "sites");
  const own = fs.existsSync(d) ? fs.readdirSync(d).filter((n) => fs.existsSync(path.join(d, n, "spec.json"))) : [];
  return [...new Set([...own, ...builtinSites()])].sort();
}

// The spec for a site: $CLIFY_HOME first, then the bundled built-in.
export function readSpec<T = any>(name: string): T | null {
  if (!/^[\w.-]+$/.test(name)) return null;
  const own = path.join(HOME, "sites", name, "spec.json");
  if (fs.existsSync(own)) return readJson<T | null>(own, null);
  const builtin = path.join(BUILTIN_DIR, `${name}.json`);
  if (!process.env.CLIFY_NO_BUILTINS && fs.existsSync(builtin)) return readJson<T | null>(builtin, null);
  return null;
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, data: unknown, secret = false): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: secret ? 0o600 : 0o644 });
  if (secret) fs.chmodSync(file, 0o600);
}

// "https://www.hankintailmoitukset.fi/fi/" -> "hankintailmoitukset"
// "https://books.toscrape.com/" -> "books-toscrape"; "en.wikipedia.org" -> "wikipedia"
export function nameFromUrl(url: string): string {
  const host = new URL(url).hostname.replace(/^www\d?\./, "");
  const parts = host.split(".");
  if (/^[\d.]+$/.test(host) || parts.length < 2) return host.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  // Drop the TLD and generic second levels (co.uk, gov.uk, com.au, nlm.nih.gov...).
  const generic = new Set(["com", "org", "net", "co", "gov", "ac", "edu", "nih", "nlm"]);
  const core = parts.slice(0, -1).filter((p, i, a) => !(generic.has(p) && i > 0) || i === a.length - 1 && a.length === 1);
  if (!core.length) return parts[0].toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const main = core[core.length - 1];
  // Keep one meaningful subdomain (books.toscrape.com, hn.algolia.com); skip
  // language and boilerplate ones (en., m., app., api.).
  const sub = core.length > 1 ? core[core.length - 2] : "";
  const boring = /^(en|de|fr|es|it|nl|sv|fi|ja|zh|ru|pt|pl|m|app|api|web|www\d*|beta|new|portal|site|home)$/;
  let name = sub && !boring.test(sub) ? `${sub}-${main}` : main;
  // "data.gov.uk" -> "data-gov", not just "data"
  if (core.length === 1 && /^(data|docs|api|search|catalog|portal|open|dev|app|web)$/.test(main)) name = `${main}-${parts[parts.length - (parts.length > 2 ? 2 : 1)]}`;
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export function log(...args: unknown[]): void {
  if (process.env.CLIFY_QUIET) return;
  const ts = new Date().toISOString().slice(11, 19);
  process.stderr.write(`\x1b[2m${ts}\x1b[0m ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`);
}
