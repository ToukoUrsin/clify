// Turns raw evidence (a recording, a live response) into compact text a model
// can write a spec from: recorded requests grouped into endpoints, JSON shown as
// a schema plus a short sample, HTML as a selector outline with repeated-item
// hints, so CSS extractors can be written from it.
import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import { cleanHtml, jsonScripts } from "./browser.ts";
import type { Exchange } from "./types.ts";
import { looksLikeXml, xmlToJson } from "./xml.ts";

// ---------- JSON ----------

export function jsonSchema(v: unknown, depth = 0, maxKeys = 30): string {
  if (v === null) return "null";
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    if (depth > 4) return `[…${v.length}]`;
    return `[${jsonSchema(v[0], depth + 1, maxKeys)}] (${v.length} items)`;
  }
  if (typeof v === "object") {
    if (depth > 4) return "{…}";
    const entries = Object.entries(v as object);
    const pad = "  ".repeat(depth + 1);
    const body = entries
      .slice(0, maxKeys)
      .map(([k, x]) => `${pad}${k}: ${jsonSchema(x, depth + 1, maxKeys)}`)
      .join("\n");
    return `{\n${body}${entries.length > maxKeys ? `\n${pad}… ${entries.length - maxKeys} more keys` : ""}\n${"  ".repeat(depth)}}`;
  }
  if (typeof v === "string") return `string ${JSON.stringify(v.length > 40 ? v.slice(0, 40) + "…" : v)}`;
  return `${typeof v} ${JSON.stringify(v)}`;
}

// A small, valid sample: arrays cut to 2 items, strings to 80 chars.
export function jsonSample(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return v.length > 2 ? [...v.slice(0, 2).map((x) => jsonSample(x, depth + 1)), `…${v.length - 2} more`] : v.map((x) => jsonSample(x, depth + 1));
  if (v && typeof v === "object") {
    if (depth > 5) return "{…}";
    return Object.fromEntries(Object.entries(v).slice(0, 40).map(([k, x]) => [k, jsonSample(x, depth + 1)]));
  }
  if (typeof v === "string" && v.length > 80) return v.slice(0, 80) + "…";
  return v;
}

export function describeJson(text: string, max = 3500): string {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    // Truncated or JSONP: show the head.
    return `(unparsed JSON head) ${text.slice(0, Math.min(max, 1500))}`;
  }
  const schema = jsonSchema(v);
  const sample = JSON.stringify(jsonSample(v));
  return `schema:\n${schema.slice(0, max)}\nsample: ${sample.slice(0, Math.min(1800, max))}`;
}

// ---------- HTML ----------

const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "path", "iframe", "template", "link", "meta", "head", "br", "hr", "img", "picture", "source"]);
const CHROME_TAGS = new Set(["nav", "header", "footer", "aside"]);

function tagOf(el: HTMLElement): string {
  return (el.tagName ?? "").toLowerCase();
}

function classes(el: HTMLElement): string[] {
  return (el.getAttribute?.("class") ?? "")
    .split(/\s+/)
    .filter((c) => c && c.length < 40 && !/^(active|selected|open|hidden|show|js-|is-)/.test(c));
}

export function selectorOf(el: HTMLElement): string {
  const tag = tagOf(el);
  if (!tag) return "";
  const id = el.getAttribute("id");
  if (id && /^[A-Za-z][\w-]{0,40}$/.test(id) && !/\d{3,}/.test(id)) return `${tag}#${id}`;
  const cls = classes(el).slice(0, 2);
  return tag + cls.map((c) => "." + c.replace(/([^\w-])/g, "\\$1")).join("");
}

function signature(el: HTMLElement): string {
  return `${tagOf(el)}.${classes(el).slice(0, 2).join(".")}`;
}

function ownText(el: HTMLElement): string {
  return el.childNodes
    .filter((n) => n.nodeType === 3)
    .map((n) => n.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function attrsOf(el: HTMLElement): string {
  const tag = tagOf(el);
  const pick: string[] = [];
  const add = (k: string, max = 70) => {
    const v = el.getAttribute?.(k);
    if (v) pick.push(`${k}=${JSON.stringify(v.length > max ? v.slice(0, max) + "…" : v)}`);
  };
  if (tag === "a") add("href");
  if (tag === "form") (add("action"), add("method"));
  if (tag === "input" || tag === "select" || tag === "textarea" || tag === "button") (add("name"), add("type"), add("value", 40));
  if (tag === "time") add("datetime");
  if (tag === "meta") (add("name"), add("content"));
  add("itemprop");
  add("title", 50);
  return pick.length ? ` [${pick.join(" ")}]` : "";
}

function elementChildren(el: HTMLElement): HTMLElement[] {
  return el.childNodes.filter((n): n is HTMLElement => n.nodeType === 1 && !SKIP_TAGS.has(tagOf(n as HTMLElement)));
}

// Indented outline of the page's content with CSS-ish selectors, collapsing
// wrapper chains and long runs of identical siblings.
export function outline(root: HTMLElement, maxChars = 5000): string {
  const lines: string[] = [];
  let size = 0;
  const walk = (el: HTMLElement, depth: number) => {
    if (size > maxChars || depth > 14) return;
    let chain = selectorOf(el);
    let cur = el;
    // Collapse single-child wrappers without text into "a > b > c".
    for (;;) {
      const kids = elementChildren(cur);
      if (kids.length !== 1 || ownText(cur) || tagOf(cur) === "a") break;
      cur = kids[0];
      chain += " > " + selectorOf(cur);
    }
    const tag = tagOf(cur);
    if (CHROME_TAGS.has(tag) && depth > 0) {
      const l = `${"  ".repeat(depth)}${chain} (site chrome, skipped)`;
      lines.push(l);
      size += l.length;
      return;
    }
    const t = ownText(cur);
    const l = `${"  ".repeat(depth)}${chain}${attrsOf(cur)}${t ? ` "${t.length > 70 ? t.slice(0, 70) + "…" : t}"` : ""}`;
    lines.push(l);
    size += l.length + 1;
    const kids = elementChildren(cur);
    for (let i = 0; i < kids.length; i++) {
      const sig = signature(kids[i]);
      let run = 1;
      while (i + run < kids.length && signature(kids[i + run]) === sig) run++;
      if (run >= 3) {
        walk(kids[i], depth + 1);
        walk(kids[i + 1], depth + 1);
        const m = `${"  ".repeat(depth + 1)}… ${run - 2} more ${sig.replace(/\.$/, "")}`;
        lines.push(m);
        size += m.length;
        i += run - 1;
      } else walk(kids[i], depth + 1);
    }
  };
  walk(root, 0);
  return lines.join("\n").slice(0, maxChars);
}

export interface RepeatHint {
  selector: string;
  count: number;
  sample: string;
}

// Lists of same-shaped elements with real text: the usual shape of search
// results, product grids and tables.
export function repeatedItems(root: HTMLElement, max = 4): RepeatHint[] {
  const out: (RepeatHint & { score: number })[] = [];
  const visit = (el: HTMLElement, path: string, depth: number) => {
    if (depth > 30) return;
    const kids = elementChildren(el);
    const groups = new Map<string, HTMLElement[]>();
    for (const k of kids) {
      const sig = signature(k);
      groups.set(sig, [...(groups.get(sig) ?? []), k]);
    }
    for (const [, items] of groups) {
      if (items.length < 3) continue;
      const texts = items.map((x) => x.textContent.replace(/\s+/g, " ").trim());
      const avg = texts.reduce((a, t) => a + Math.min(t.length, 300), 0) / items.length;
      if (avg < 15) continue;
      const tag = tagOf(el);
      if (tag && CHROME_TAGS.has(tag)) continue;
      const parentSel = selectorOf(el);
      const itemSel = selectorOf(items[0]).replace(/#[\w-]+$/, "");
      const linkish = items.filter((x) => x.querySelector("a[href]") || x.tagName === "A").length / items.length;
      out.push({
        selector: `${parentSel} > ${itemSel}`,
        count: items.length,
        sample: texts[0].slice(0, 160),
        score: items.length * Math.min(avg, 200) * (0.5 + linkish),
      });
    }
    for (const k of kids) visit(k, path, depth + 1);
  };
  visit(root, "", 0);
  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ score: _s, ...r }) => r);
}

function contentRoot(root: HTMLElement): HTMLElement {
  for (const sel of ["main", "[role=main]", "#content", "#main", "article", ".content", "#app", "body"]) {
    const el = root.querySelector(sel);
    if (el && el.textContent.replace(/\s+/g, " ").trim().length > 200) return el;
  }
  return root.querySelector("body") ?? root;
}

export function describeHtml(html: string, maxChars = 6000, raw = false): string {
  const cleaned = raw ? cleanHtml(html) : html;
  const root = parseHtml(cleaned);
  const title = root.querySelector("title")?.textContent.trim() ?? "";
  const reps = repeatedItems(root);
  const forms = root
    .querySelectorAll("form")
    .slice(0, 4)
    .map((f) => {
      const inputs = f
        .querySelectorAll("input, select, textarea")
        .filter((i) => i.getAttribute("type") !== "submit")
        .slice(0, 12)
        .map((i) => `${i.getAttribute("name") ?? "?"}${i.getAttribute("type") === "hidden" ? `(hidden=${(i.getAttribute("value") ?? "").slice(0, 30)})` : i.tagName === "SELECT" ? `(select: ${i.querySelectorAll("option").slice(0, 8).map((o) => o.getAttribute("value") ?? o.textContent.trim()).join("|")})` : ""}`);
      return `form${attrsOf(f)} inputs: ${inputs.join(", ")}`;
    });
  const parts = [
    `title: ${JSON.stringify(title)}`,
    reps.length ? `repeated items (CSS selector ×count: first item text):\n${reps.map((r) => `  ${r.selector} ×${r.count}: ${JSON.stringify(r.sample)}`).join("\n")}` : "",
    forms.length ? `forms:\n  ${forms.join("\n  ")}` : "",
    `outline:\n${outline(contentRoot(root), maxChars)}`,
  ];
  if (raw) {
    const scripts = jsonScripts(html);
    if (scripts.length) parts.push(describeScripts(scripts, 2500));
  }
  return parts.filter(Boolean).join("\n");
}

export function describeScripts(scripts: NonNullable<Exchange["jsonScripts"]>, max = 2500): string {
  return `embedded JSON (usable via extract.jsonScript):\n${scripts
    .slice(0, 3)
    .map((s) => `  ${s.selector} (${s.size} chars)\n${describeJson(s.sample, max).replace(/^/gm, "    ")}`)
    .join("\n")}`;
}

// ---------- recording ----------

export interface Endpoint {
  id: string;
  method: string;
  url: string; // template-ish: https://host/path/{id}
  kind: string; // xhr/fetch/document
  contentType: string;
  status: number;
  count: number;
  triggers: string[];
  examples: Exchange[];
  held: boolean;
  sent: boolean;
  withSession: boolean;
}

const JUNK_RE =
  /(\/(_next\/static|static|assets|build|dist)\/|\.(js|mjs|css|json\.map|txt|xml|woff2?)(\?|$)|\/(manifest|sw|service-worker)\.|\/(i18n|locales?|translations?)\/|feature[-_]?flags?|\/config(\.json)?(\?|$)|launchdarkly|statsig|growthbook|split\.io|\/heartbeat|\/health|\/ping\b|\/csp-report|\/consent|\/log(s|ging)?\b|\/metrics|recaptcha|turnstile|captcha)/i;

function templatePath(u: URL): string {
  const segs = u.pathname.split("/").map((s) => {
    if (/^\d+$/.test(s)) return "{n}";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) || (/^[0-9a-z_-]{16,}$/i.test(s) && /\d/.test(s) && /[a-z]/i.test(s) && !/-.*-.*-/.test(s))) return "{id}";
    return s;
  });
  return `${u.origin}${segs.join("/")}`;
}

export function groupEndpoints(exchanges: Exchange[]): Endpoint[] {
  const groups = new Map<string, Endpoint>();
  for (const e of exchanges) {
    if (e.method === "OPTIONS" || e.method === "HEAD") continue;
    if (!e.held && !e.sent && (e.status < 200 || e.status >= 400)) continue;
    let u: URL;
    try {
      u = new URL(e.url);
    } catch {
      continue;
    }
    if (JUNK_RE.test(u.pathname) && !/json/i.test(e.contentType ?? "")) continue;
    if (/^(image|font|video|audio)\//i.test(e.contentType ?? "")) continue;
    if (/javascript|css/i.test(e.contentType ?? "")) continue;
    const gql = /graphql/i.test(u.pathname) ? (e.requestBody?.match(/"operationName"\s*:\s*"(\w+)"/)?.[1] ?? u.searchParams.get("operationName") ?? "") : "";
    const key = `${e.method} ${templatePath(u)}${gql ? `#${gql}` : ""}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        id: "",
        method: e.method,
        url: templatePath(u) + (gql ? ` (GraphQL operation ${gql})` : ""),
        kind: e.resourceType ?? "",
        contentType: (e.contentType ?? "").split(";")[0],
        status: e.status,
        count: 0,
        triggers: [],
        examples: [],
        held: false,
        sent: false,
        withSession: false,
      };
      groups.set(key, g);
    }
    g.count++;
    if (e.triggeredBy && !g.triggers.includes(e.triggeredBy)) g.triggers.push(e.triggeredBy);
    if (g.examples.length < 6 && !g.examples.some((x) => x.url === e.url && x.requestBody === e.requestBody)) g.examples.push(e);
    g.held ||= !!e.held;
    g.sent ||= !!e.sent;
    g.withSession ||= !!e.withSession;
  }
  const rank = (g: Endpoint) => {
    const json = /json/i.test(g.contentType);
    const api = g.kind === "xhr" || g.kind === "fetch";
    const user = g.triggers.some((t) => t !== "page load");
    return (g.held || g.sent ? 30 : 0) + (json ? 40 : 0) + (api ? 20 : 0) + (user ? 15 : 0) + Math.min(g.count, 5) - (g.kind === "document" && !user ? 5 : 0);
  };
  const list = [...groups.values()].sort((a, b) => rank(b) - rank(a));
  list.forEach((g, i) => (g.id = `E${i + 1}`));
  return list;
}

const BORING_HEADERS = /^(:|cookie|host|content-length|connection|accept-encoding|sec-|user-agent|referer|origin|accept-language|cache-control|pragma|priority|te$|dnt|upgrade-insecure|if-none-match|if-modified-since|purpose|x-client-data)/i;

function queryValues(examples: Exchange[]): string {
  const vals = new Map<string, Set<string>>();
  for (const e of examples) {
    try {
      for (const [k, v] of new URL(e.url).searchParams) {
        if (!vals.has(k)) vals.set(k, new Set());
        vals.get(k)!.add(v.length > 60 ? v.slice(0, 60) + "…" : v);
      }
    } catch {
      /* skip */
    }
  }
  return [...vals].map(([k, s]) => `${k}=[${[...s].slice(0, 6).map((x) => JSON.stringify(x)).join(", ")}]`).join(" ");
}

export function describeEndpoint(g: Endpoint, budget = 4000): string {
  const e = g.examples[0];
  const lines: string[] = [];
  lines.push(
    `## ${g.id}  ${g.method} ${g.url}  [${g.kind || "?"}${g.contentType ? `, ${g.contentType}` : ""}, status ${g.status}, seen ×${g.count}${g.held ? ", WRITE held (not sent)" : ""}${g.sent ? ", WRITE sent" : ""}${g.withSession ? ", logged-in" : ""}]`,
  );
  if (g.triggers.length) lines.push(`triggered by: ${g.triggers.slice(0, 6).map((t) => JSON.stringify(t)).join(", ")}`);
  lines.push(`example URLs:\n${g.examples.slice(0, 4).map((x) => `  ${x.url.slice(0, 300)}`).join("\n")}`);
  const q = queryValues(g.examples);
  if (q) lines.push(`query values seen: ${q}`);
  const hdrs = Object.entries(e.requestHeaders ?? {}).filter(([k]) => !BORING_HEADERS.test(k));
  if (hdrs.length) lines.push(`request headers: ${hdrs.map(([k, v]) => `${k}: ${/authorization|token|cookie|csrf|xsrf|session/i.test(k) ? "<secret>" : v.slice(0, 80)}`).join("; ")}`);
  const bodies = [...new Set(g.examples.map((x) => x.requestBody).filter(Boolean))].slice(0, 3);
  if (bodies.length) lines.push(`request bodies:\n${bodies.map((b) => `  ${b!.slice(0, 1500)}`).join("\n")}`);
  if (e.responseSample) {
    if (/json/i.test(g.contentType) || /^\s*[[{]/.test(e.responseSample)) lines.push(`response:\n${describeJson(e.responseSample, Math.max(1200, budget - 1500))}`);
    else if (looksLikeXml(g.contentType, e.responseSample)) lines.push(`response (XML, clify converts it to JSON for resultPath):\n${describeJson(JSON.stringify(xmlToJson(e.responseSample)), Math.max(1200, budget - 1500))}`);
    else if (/html/i.test(g.contentType)) {
      lines.push(`page:\n${describeHtml(e.responseSample, Math.max(1500, budget - 1500))}`);
      if (e.jsonScripts?.length) lines.push(describeScripts(e.jsonScripts, 1800));
    } else lines.push(`response head: ${e.responseSample.slice(0, 600)}`);
  }
  return lines.join("\n").slice(0, budget + 2500);
}

// The whole recording as one text, most API-like endpoints first.
export function digestRecording(exchanges: Exchange[], maxChars = 90_000): { text: string; endpoints: Endpoint[] } {
  const endpoints = groupEndpoints(exchanges);
  const parts: string[] = [];
  let size = 0;
  for (const g of endpoints) {
    const budget = g.kind === "document" ? 5000 : 3500;
    const t = describeEndpoint(g, budget);
    if (size + t.length > maxChars) {
      parts.push(`## ${g.id}  ${g.method} ${g.url} (details omitted: size budget)`);
      continue;
    }
    parts.push(t);
    size += t.length;
  }
  return { text: parts.join("\n\n"), endpoints };
}
