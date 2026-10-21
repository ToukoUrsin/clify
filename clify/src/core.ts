// The session-free core of the command runner: builds the HTTP request from a
// spec command, sends it, parses JSON/XML/HTML and shapes the result for
// agents. It reads no files, so the hosted MCP server (mcp/) bundles this same
// code. runtime.ts adds the saved session and the vault re-login on top.
import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import { looksLikeXml, xmlToJson } from "./xml.ts";
import type { CommandSpec, Session, SiteSpec } from "./types.ts";

export interface RunResult {
  ok: boolean;
  status: number;
  url: string;
  data: unknown;
  error?: string;
  next?: string; // the exact command to run next (fix, login, confirm)
  total?: number; // total result count when the site reports one
  nextArgs?: Record<string, string>; // args for the next page, when the command paginates
  raw?: string; // response body head (opts.keepRaw), for verification evidence
  contentType?: string;
  finalUrl?: string;
  // Set on write commands run without confirmation: the exact request that
  // would be sent. Re-run with --yes (CLI) or confirm:true (MCP) to send it.
  needsConfirmation?: boolean;
  preview?: { method: string; url: string; body?: unknown };
}

export interface RunOptions {
  confirm?: boolean;
  confirmHint?: string; // how the caller confirms: "--yes" (CLI) or "confirm:true" (MCP)
  session?: Session | null; // override (tests); default = the site's saved session
  keepRaw?: boolean;
  relogin?: boolean; // default true: re-login from the vault once on an auth failure
  // Where sessions come from (runtime.ts: the vault). Without it no session is
  // ever attached, which is how the hosted MCP server runs.
  sessions?: SessionSource;
  // Refuse requests whose host is not on the spec's own site (hosted server).
  sameSiteOnly?: boolean;
}

export interface SessionSource {
  load(name: string): Session | null;
  relogin(spec: SiteSpec): Promise<Session | null>;
}

// Keep the version in step with package.json (core.ts is also bundled alone for the hosted MCP).
export const USER_AGENT = "clify/0.3.0 (agent CLI generated from the site's own web app)";

export function siteRoot(host: string): string {
  if (/^[\d.]+$/.test(host) || host.includes(":")) return host; // IP addresses match exactly
  const parts = host.split(".");
  // example.co.uk / example.com.au keep three labels
  const n = parts.length > 2 && /^(co|com|org|net|gov|ac|edu)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2 ? 3 : 2;
  return parts.slice(-n).join(".");
}

function cookieHeader(url: URL, s: Session): string {
  const now = Date.now() / 1000;
  return s.cookies
    .filter((c) => {
      const d = c.domain.replace(/^\./, "");
      return (url.hostname === d || url.hostname.endsWith("." + d)) && url.pathname.startsWith(c.path || "/") && (c.expires <= 0 || c.expires > now);
    })
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

function coerce(v: string, type: string): unknown {
  if (type === "number" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  if (type === "boolean") return v === "true" || v === "1";
  return v;
}

// Replace {param} references inside a body template. A string that is exactly
// "{param}" takes the typed value; unset params drop the key.
function fill(t: unknown, args: Record<string, unknown>): unknown {
  if (typeof t === "string") {
    const whole = t.match(/^\{(\w+)\}$/);
    if (whole) return args[whole[1]];
    return t.replace(/\{(\w+)\}/g, (_, k) => (args[k] === undefined ? "" : String(args[k])));
  }
  if (Array.isArray(t)) return t.map((x) => fill(x, args));
  if (t && typeof t === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(t)) {
      const f = fill(v, args);
      if (f !== undefined) out[k] = f;
    }
    return out;
  }
  return t;
}

// Agents often hold a result's url rather than its slug: a full URL passed to a
// path param is matched against the URL template and its path params filled in.
function pathArgsFromUrl(spec: SiteSpec, cmd: CommandSpec, raw: Record<string, string>): Record<string, string> {
  const pathParams = cmd.params.filter((p) => p.in === "path");
  const urlArg = pathParams.map((p) => raw[p.name]).find((v) => typeof v === "string" && /^https?:\/\//.test(v));
  if (!urlArg) return raw;
  let u: URL;
  try {
    u = new URL(urlArg);
  } catch {
    return raw;
  }
  const tpath = new URL(cmd.urlTemplate.split("?")[0].replace(/\{(\w+)\}/g, "__P_$1__"), spec.origin).pathname;
  const names: string[] = [];
  const re = new RegExp(
    "^" +
      tpath
        .split(/__P_(\w+)__/)
        .map((part, i) => (i % 2 ? (names.push(part), "([^/]+?)") : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
        .join("") +
      "/?$",
  );
  const m = u.pathname.match(re);
  if (!m) return raw;
  const out = { ...raw };
  names.forEach((n, i) => (out[n] = decodeURIComponent(m[i + 1])));
  return out;
}

export function buildRequest(spec: SiteSpec, cmd: CommandSpec, raw: Record<string, string>) {
  raw = pathArgsFromUrl(spec, cmd, raw);
  const args: Record<string, unknown> = {};
  const known = new Set(cmd.params.map((p) => p.name));
  const unknown = Object.keys(raw).filter((k) => !known.has(k));
  if (unknown.length) throw new Error(`unknown option ${unknown.map((k) => `--${k}`).join(", ")}; valid: ${[...known].map((k) => `--${k}`).join(" ") || "(none)"}`);
  for (const p of cmd.params) {
    let v: unknown = raw[p.name];
    if (v === undefined && p.context && spec.context?.[p.context]) v = spec.context[p.context].value;
    if (v === undefined && p.default !== undefined) v = String(p.default);
    if (v === undefined) {
      if (p.required) throw new Error(`missing --${p.name}${p.description ? ` (${p.description})` : ""}${p.example !== undefined ? `, e.g. --${p.name} ${JSON.stringify(String(p.example))}` : cmd.example?.[p.name] !== undefined ? `, e.g. --${p.name} ${JSON.stringify(cmd.example[p.name])}` : ""}`);
      continue;
    }
    if (p.enum?.length && !p.enum.includes(String(v))) throw new Error(`--${p.name} must be one of: ${p.enum.join(", ")}`);
    args[p.name] = coerce(String(v), p.type);
  }
  const fillPath = (t: string) => t.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(args[k] ?? "")));
  const path = fillPath(cmd.urlTemplate);
  const url = new URL(path, spec.origin);
  const headers: Record<string, string> = { ...(cmd.headers ?? {}) };
  const templ = JSON.stringify(cmd.bodyTemplate ?? {});
  let body = cmd.bodyTemplate ? (fill(cmd.bodyTemplate, args) as Record<string, unknown>) : undefined;
  for (const p of cmd.params) {
    if (!(p.name in args)) continue;
    const key = p.key || p.name;
    if (p.in === "query") {
      if (!cmd.urlTemplate.includes(`{${p.name}}`)) url.searchParams.set(key, String(args[p.name]));
    } else if (p.in === "header") headers[key] = String(args[p.name]);
    else if (p.in === "body" && !templ.includes(`{${p.name}}`)) (body ??= {})[key] = args[p.name];
  }
  let payload: string | undefined;
  if (body && cmd.method !== "GET" && cmd.method !== "HEAD") {
    if (cmd.bodyEncoding === "form") {
      const f = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) {
        if (Array.isArray(v)) v.forEach((x) => f.append(k, String(x)));
        else if (v !== undefined && v !== null) f.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
      }
      payload = f.toString();
      headers["content-type"] ??= "application/x-www-form-urlencoded";
    } else {
      payload = JSON.stringify(body);
      headers["content-type"] ??= "application/json";
    }
  }
  // The CSRF page can be per-item too (/projects/{project}/checks/): same params.
  return { url, method: cmd.method, headers, body: payload, csrfFrom: cmd.csrf ? fillPath(cmd.csrf.from) : undefined };
}

// A command by name or by one of its aliases (collapsed near-duplicates).
export function findCommand(spec: SiteSpec, name: string): CommandSpec | undefined {
  return spec.commands.find((c) => c.name === name) ?? spec.commands.find((c) => c.aliases?.includes(name));
}

export function dig(data: unknown, path?: string): unknown {
  if (!path) return data;
  let cur: any = data;
  for (const part of path.split(".")) {
    if (cur == null) return undefined;
    // "items.*.name" / "items.name" over an array maps each element.
    if (Array.isArray(cur) && !/^\d+$/.test(part)) {
      cur = cur.map((x) => (part === "*" ? x : x?.[part]));
      continue;
    }
    cur = cur[part];
  }
  return cur;
}

function pick(el: HTMLElement, rule: string): string | undefined {
  // "sel@attr", "sel" (text), "@attr" (the item itself), "a || b" (first that matches)
  for (const alt of rule.split("||").map((r) => r.trim())) {
    const at = alt.lastIndexOf("@");
    const sel = at >= 0 && !/[\]"']/.test(alt.slice(at)) ? alt.slice(0, at).trim() : alt;
    const attr = at >= 0 && !/[\]"']/.test(alt.slice(at)) ? alt.slice(at + 1).trim() : "";
    let target: HTMLElement | null = null;
    try {
      target = sel ? el.querySelector(sel) : el;
    } catch {
      target = null;
    }
    if (!target) continue;
    const v = attr ? target.getAttribute(attr) : target.textContent;
    const t = v?.replace(/\s+/g, " ").trim();
    if (t) return t;
  }
  return undefined;
}

export function extractHtml(html: string, cmd: CommandSpec, base: URL): unknown {
  const root = parseHtml(html);
  const ex = cmd.extract;
  if (ex?.jsonScript) {
    const el = root.querySelector(ex.jsonScript);
    if (!el) return undefined;
    try {
      return dig(JSON.parse(el.textContent), cmd.resultPath);
    } catch {
      return undefined;
    }
  }
  const abs = (k: string, v: string | undefined) =>
    v && /(href|src|url|link)/i.test(k) && !/^(https?:|mailto:|#)/.test(v) ? new URL(v, base).toString() : v;
  const row = (el: HTMLElement) => {
    const out: Record<string, string> = {};
    for (const [k, rule] of Object.entries(ex?.fields ?? {})) {
      const v = abs(k + rule, pick(el, rule));
      if (v !== undefined) out[k] = v;
    }
    return out;
  };
  if (ex?.list) {
    let items: HTMLElement[] = [];
    try {
      items = root.querySelectorAll(ex.list);
    } catch {
      return [];
    }
    return items.map(row).filter((r) => Object.keys(r).length);
  }
  if (ex?.fields && Object.keys(ex.fields).length) return row(root);
  const text = root.querySelector("main, article, #content, body")?.textContent ?? root.textContent;
  return text.replace(/\s+/g, " ").trim().slice(0, 4000);
}

function setCookies(res: Response): string[] {
  const h = res.headers as any;
  const list: string[] = typeof h.getSetCookie === "function" ? h.getSetCookie() : [];
  return list.map((c) => c.split(";")[0]).filter(Boolean);
}

function mergeCookies(base: string | undefined, extra: string[]): string | undefined {
  if (!extra.length) return base;
  const jar = new Map<string, string>();
  for (const part of (base ?? "").split(/;\s*/).filter(Boolean)) jar.set(part.split("=")[0], part);
  for (const c of extra) jar.set(c.split("=")[0], c);
  return [...jar.values()].join("; ");
}

// Fetch-then-submit: read a fresh CSRF token from the page that hosts the form.
async function fetchCsrf(spec: SiteSpec, cmd: CommandSpec, headers: Record<string, string>, from = cmd.csrf!.from): Promise<{ token?: string; cookies: string[] }> {
  const c = cmd.csrf!;
  const url = new URL(from, spec.origin);
  const res = await fetch(url, { headers: { ...headers, accept: c.jsonPath ? "application/json" : "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(30000) });
  const cookies = setCookies(res);
  const text = await res.text();
  let token: string | undefined;
  if (c.cookie) token = cookies.find((x) => x.startsWith(c.cookie + "="))?.slice(c.cookie.length + 1);
  else if (c.jsonPath) {
    try {
      token = String(dig(JSON.parse(text), c.jsonPath) ?? "") || undefined;
    } catch {
      /* not JSON */
    }
  } else if (c.selector) token = pick(parseHtml(text) as unknown as HTMLElement, c.selector);
  if (token && c.cookie) token = decodeURIComponent(token);
  return { token, cookies };
}

function looksLikeLoginPage(res: Response, text: string, requested: URL): boolean {
  const final = new URL(res.url || requested.toString());
  const loginPath = /\/(login|log-in|signin|sign-in|sign_in|auth|account\/login|session\/new)(\/|$|\?)/i;
  if (loginPath.test(final.pathname) && !loginPath.test(requested.pathname)) return true;
  return false;
}

// The total hit count many search APIs report next to the results.
function totalOf(raw: unknown): number | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const scan = (o: any, depth: number): number | undefined => {
    for (const [k, v] of Object.entries(o)) {
      if (/^(total|totalCount|total_count|totalResults|total_results|totalHits|numFound|nbHits|num_found|found|totalElements|resultCount|result_count|count)$/i.test(k)) {
        if (typeof v === "number") return v;
        if (v && typeof v === "object" && typeof (v as any).value === "number") return (v as any).value; // elasticsearch hits.total
      }
      if (depth < 2 && v && typeof v === "object" && !Array.isArray(v) && /^(meta|hits|response|data|search|pagination|page_info|pageInfo|result|results)$/i.test(k)) {
        const t = scan(v, depth + 1);
        if (t !== undefined) return t;
      }
    }
    return undefined;
  };
  return scan(raw, 0);
}

// Next-page args for paginated commands.
function nextArgs(cmd: CommandSpec, args: Record<string, string>, rawJson: unknown, data: unknown): Record<string, string> | undefined {
  const pg = cmd.pagination ?? (cmd.params.some((p) => p.name === "page") ? { type: "page" as const, param: "page" } : undefined);
  if (!pg) return undefined;
  const param = cmd.params.find((p) => p.name === pg.param);
  if (!param) return undefined;
  if (pg.type === "cursor") {
    const next = pg.nextPath ? dig(rawJson, pg.nextPath) : undefined;
    return next !== undefined && next !== null && next !== "" && next !== false ? { [pg.param]: String(next) } : undefined;
  }
  if (Array.isArray(data) && data.length === 0) return undefined;
  const cur = Number(args[pg.param] ?? param.default ?? (pg.type === "page" ? 1 : 0));
  if (!Number.isFinite(cur)) return undefined;
  const step = pg.step ?? (pg.type === "offset" ? (Array.isArray(data) ? data.length : 10) : 1);
  return { [pg.param]: String(cur + step) };
}

export async function run(spec: SiteSpec, cmd: CommandSpec, raw: Record<string, string>, opts: RunOptions = {}): Promise<RunResult> {
  let req: ReturnType<typeof buildRequest>;
  try {
    req = buildRequest(spec, cmd, raw);
  } catch (e) {
    return { ok: false, status: 0, url: cmd.urlTemplate, data: null, error: (e as Error).message, next: `clify ${spec.name} ${cmd.name} --help` };
  }
  const commandHost = new URL(cmd.urlTemplate.split("?")[0].replace(/\{(\w+)\}/g, "__P_$1__"), spec.origin).hostname;
  const allowedRoots = new Set([siteRoot(new URL(spec.origin).hostname), siteRoot(commandHost)]);
  if (opts.sameSiteOnly && !allowedRoots.has(siteRoot(req.url.hostname))) {
    return { ok: false, status: 0, url: req.url.toString(), data: null, error: `refusing request to ${req.url.hostname}: not ${spec.name}'s site` };
  }
  const confirmHint = opts.confirmHint ?? "--yes";
  if (cmd.mutates && !opts.confirm) {
    let body: unknown = req.body;
    try {
      body = !req.body ? undefined : cmd.bodyEncoding === "form" ? Object.fromEntries(new URLSearchParams(req.body)) : JSON.parse(req.body);
    } catch {
      /* keep raw */
    }
    const argv = Object.entries(raw).map(([k, v]) => `--${k} ${JSON.stringify(v)}`).join(" ");
    return {
      ok: false,
      status: 0,
      url: req.url.toString(),
      data: null,
      needsConfirmation: true,
      preview: { method: req.method, url: req.url.toString(), ...(body !== undefined ? { body } : {}), ...(cmd.csrf ? { csrf: "fresh token fetched at send time" } : {}) },
      error: `"${cmd.name}" changes data on ${new URL(spec.origin).hostname}. Nothing was sent. Check the preview, then re-run with ${confirmHint} to send it.`,
      next: confirmHint === "--yes" ? `clify ${spec.name} ${cmd.name} ${argv} --yes`.replace(/\s+/g, " ") : undefined,
    };
  }
  const relogin = async (s: SiteSpec) => (opts.sessions ? opts.sessions.relogin(s) : null);
  let session = opts.session === undefined ? (opts.sessions?.load(spec.name) ?? null) : opts.session;
  if (cmd.auth && !session && opts.relogin !== false && opts.session === undefined) session = await relogin(spec);
  if (cmd.auth && !session) {
    return { ok: false, status: 0, url: req.url.toString(), data: null, error: `"${cmd.name}" needs a login and no session is saved.`, next: `clify login ${spec.name}` };
  }
  const attempt = async (sess: Session | null) => {
    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      accept: cmd.responseType === "json" ? "application/json, text/plain, */*" : "text/html,application/xhtml+xml,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      ...req.headers,
    };
    // Session goes only to the site's own domain, never to third-party hosts.
    if (sess && siteRoot(req.url.hostname) === siteRoot(new URL(spec.origin).hostname)) {
      for (const n of spec.auth?.headerNames ?? []) if (sess.headers[n]) headers[n] = sess.headers[n];
      const ck = cookieHeader(req.url, sess);
      if (ck) headers.cookie = ck;
    }
    let body = req.body;
    if (cmd.csrf) {
      const { token, cookies } = await fetchCsrf(spec, cmd, headers, req.csrfFrom);
      if (!token) throw new Error(`could not read the CSRF token from ${req.csrfFrom ?? cmd.csrf.from}`);
      const merged = mergeCookies(headers.cookie, cookies);
      if (merged) headers.cookie = merged;
      // As a browser submitting that form would (Django rejects HTTPS posts without a Referer).
      headers.referer ??= new URL(req.csrfFrom ?? cmd.csrf.from, spec.origin).toString();
      headers.origin ??= new URL(spec.origin).origin;
      if (cmd.csrf.header) headers[cmd.csrf.header] = token;
      if (cmd.csrf.field) {
        if (cmd.bodyEncoding === "form") {
          const f = new URLSearchParams(body ?? "");
          f.set(cmd.csrf.field, token);
          body = f.toString();
          headers["content-type"] ??= "application/x-www-form-urlencoded";
        } else {
          const j = body ? JSON.parse(body) : {};
          j[cmd.csrf.field] = token;
          body = JSON.stringify(j);
          headers["content-type"] ??= "application/json";
        }
      }
    }
    const res = await fetch(req.url, { method: req.method, headers, body, redirect: "follow", signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    return { res, text };
  };
  let res: Response, text: string;
  try {
    ({ res, text } = await attempt(session));
    const authFailed = res.status === 401 || res.status === 403 || ((cmd.auth || !!session) && looksLikeLoginPage(res, text, req.url));
    if (authFailed && (cmd.auth || session) && opts.relogin !== false && opts.session === undefined) {
      const fresh = await relogin(spec);
      if (fresh) {
        session = fresh;
        ({ res, text } = await attempt(fresh));
      }
    }
  } catch (e) {
    return { ok: false, status: 0, url: req.url.toString(), data: null, error: `request failed: ${(e as Error).message}` };
  }
  const ct = res.headers.get("content-type") ?? "";
  let data: unknown = text;
  let rawJson: unknown;
  if (/json/i.test(ct) || /^\s*[[{]/.test(text)) {
    try {
      rawJson = JSON.parse(text);
      data = dig(rawJson, cmd.resultPath);
    } catch {
      /* leave as text */
    }
  } else if (looksLikeXml(ct, text)) {
    rawJson = xmlToJson(text);
    data = dig(rawJson, cmd.resultPath);
  } else if (/html/i.test(ct)) {
    data = extractHtml(text, cmd, new URL(res.url || req.url));
  } else if (typeof data === "string") {
    data = data.slice(0, 20000);
  }
  const loginWall = (cmd.auth || !!session) && looksLikeLoginPage(res, text, req.url);
  const ok = res.ok && !loginWall;
  let error: string | undefined;
  let next: string | undefined;
  if (!ok) {
    if (res.status === 401 || res.status === 403 || loginWall) {
      error = session ? `HTTP ${res.status}${loginWall ? " (redirected to the login page)" : ""}: the site rejected the saved session and re-login did not fix it.` : `HTTP ${res.status}: this endpoint needs a login or the site refused the request.`;
      next = `clify login ${spec.name}`;
    } else if (res.status === 429 && /(^|\.)(api\.data\.gov|api\.open\.fec\.gov)$/.test(req.url.hostname) && req.url.searchParams.get("api_key") === "DEMO_KEY") {
      error = "HTTP 429: api.data.gov DEMO_KEY is limited to ~30 requests/hour per IP";
      next = "pass --api_key <free key from https://api.data.gov/signup>";
    } else if (res.status === 429) error = "HTTP 429: rate limited by the site; wait a minute before retrying";
    else if (res.status === 404) {
      error = "HTTP 404: not found; check the id/slug argument (take it from a list or search command's output)";
    } else error = `HTTP ${res.status}`;
  }
  const result: RunResult = { ok, status: res.status, url: req.url.toString(), data: ok ? data : typeof data === "string" ? data.slice(0, 600) : data, error, next };
  if (ok) {
    const na = nextArgs(cmd, raw, rawJson, data);
    if (na) result.nextArgs = na;
    const total = totalOf(rawJson);
    if (total !== undefined) result.total = total;
  }
  if (opts.keepRaw) {
    result.raw = text.slice(0, 400_000);
    result.contentType = ct;
    result.finalUrl = res.url || req.url.toString();
  }
  return result;
}

// What the CLI and MCP print for a successful call: shaped data plus count and
// the next-page args. Fields: explicit list, '*' for all, else the spec's defaults.
export function present(cmd: CommandSpec, res: RunResult, opts: { fields?: string[]; limit?: number; full?: boolean; cli?: boolean }) {
  const fields = opts.fields?.length === 1 && opts.fields[0] === "*" ? undefined : opts.fields?.length ? opts.fields : cmd.defaultFields;
  const data = shape(res.data, { fields, limit: opts.limit, full: opts.full });
  // --limit dropped rows from this page: following nextPage would skip them, so say so instead.
  const dropped = Array.isArray(res.data) && Array.isArray(data) ? res.data.length - data.length : 0;
  return {
    ok: true,
    status: res.status,
    ...(Array.isArray(data) ? { count: data.length } : {}),
    ...(res.total !== undefined ? { total: res.total } : {}),
    ...(dropped > 0 ? { more: `${dropped} more rows on this page: raise ${opts.cli ? "--limit" : "limit"}` } : res.nextArgs ? { nextPage: opts.cli ? Object.entries(res.nextArgs).map(([k, v]) => `--${k} ${JSON.stringify(v)}`).join(" ") : res.nextArgs } : {}),
    data,
  };
}

// Agent-friendly shaping: field selection, limits, long-string trimming.
export function shape(data: unknown, opts: { fields?: string[]; limit?: number; full?: boolean }): unknown {
  const trim = (v: unknown, depth = 0): unknown => {
    if (opts.full) return v;
    if (typeof v === "string") return v.length > 400 ? v.slice(0, 400) + "…" : v;
    if (Array.isArray(v)) return v.map((x) => trim(x, depth + 1));
    if (v && typeof v === "object") {
      if (depth > 4) return "{…}";
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x, depth + 1)]));
    }
    return v;
  };
  let d = data;
  if (Array.isArray(d)) {
    if (opts.limit) d = d.slice(0, opts.limit);
    if (opts.fields?.length) d = (d as any[]).map((x) => (x && typeof x === "object" ? Object.fromEntries(opts.fields!.map((f) => [f, dig(x, f)])) : x));
  } else if (d && typeof d === "object" && opts.fields?.length) {
    d = Object.fromEntries(opts.fields.map((f) => [f, dig(d, f)]));
  }
  return trim(d);
}
