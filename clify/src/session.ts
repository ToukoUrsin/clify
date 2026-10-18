// Login state for a site clify has an account on (the user's own, or one the
// agent created). After a browser login, the browser's cookies, any non-cookie
// auth headers the web app sent (bearer tokens, CSRF headers), tokens the app
// keeps in localStorage/sessionStorage, the app's token-refresh request and a
// "who am I" probe are saved to the encrypted vault. Later calls go straight
// over HTTP with these; the runtime attaches them only to the site's own domain.
import type { BrowserContext, Page } from "playwright";
import { siteRoot, USER_AGENT } from "./runtime.ts";
import { log } from "./store.ts";
import { getSite, setSite, type Probe, type RefreshRecipe, type SiteSecret, type StoredToken } from "./vault.ts";
import type { Exchange, Session } from "./types.ts";

const AUTH_HEADER_RE = /^(authorization|x-csrf-token|x-xsrf-token|x-api-key|x-auth-token|x-access-token|x-session-token|x-auth|api-key|apikey)$/i;
// Headers the browser sets per request; never replay these.
const SKIP_RE = /^(:|cookie|host|content-length|connection|accept-encoding|sec-|user-agent|referer|origin|content-type|accept|accept-language|cache-control|pragma|priority|te|dnt|upgrade-insecure)/i;
const JWT_RE = /^eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}$/;

function sameSite(url: string, origin: string): boolean {
  try {
    return siteRoot(new URL(url).hostname) === siteRoot(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function collectAuthHeaders(exchanges: Exchange[], origin: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of exchanges) {
    if (!sameSite(e.url, origin)) continue;
    for (const [k, v] of Object.entries(e.requestHeaders)) {
      const key = k.toLowerCase();
      if (SKIP_RE.test(key)) continue;
      if (AUTH_HEADER_RE.test(key) || (/token|csrf|xsrf/i.test(key) && v.length > 8)) out[key] = v;
    }
  }
  return out;
}

export function jwtExp(token: string): number | undefined {
  if (!JWT_RE.test(token)) return undefined;
  try {
    const p = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof p.exp === "number" ? p.exp : undefined;
  } catch {
    return undefined;
  }
}

const ANALYTICS_KEY_RE = /(^ph_|posthog|amplitude|mixpanel|segment|intercom|^_ga|statsig|launchdarkly|sentry|hotjar|datadog|crisp|hubspot|optimizely|growthbook|rudder|heap|clarity)/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function kindOf(key: string, value: string): StoredToken["kind"] | null {
  const k = key.toLowerCase();
  if (/\s/.test(value) || value.length > 8000) return null;
  if (/refresh/.test(k)) return value.length >= 8 ? "refresh" : null; // Supabase refresh tokens are ~12 chars
  if (value.length < 20 || UUID_RE.test(value) || /^(https?:|\/)/.test(value)) return JWT_RE.test(value) ? "access" : null;
  const tokenish = JWT_RE.test(value) || (/[a-z]/i.test(value) && /\d/.test(value));
  if (!tokenish) return null;
  if (/id[_-]?token/.test(k)) return "id";
  if (JWT_RE.test(value)) return "access";
  if (/(access|auth|bearer|jwt)/.test(k) || /(^|[_-])token$|^token$|session[_-]?token/.test(k)) return "access";
  if (/token/.test(k) && !/csrf|xsrf|device|push|fcm/.test(k)) return "token";
  return null;
}

// Walks localStorage/sessionStorage values (plain strings or JSON blobs such as
// Supabase/Auth0/Firebase caches) for access, id and refresh tokens.
export function findStorageTokens(where: StoredToken["where"], origin: string, items: { name: string; value: string }[]): StoredToken[] {
  const out: StoredToken[] = [];
  const visit = (key: string, path: string | undefined, v: unknown, depth: number) => {
    if (depth > 5 || out.length > 20) return;
    if (typeof v === "string") {
      const leaf = path ? path.split(".").pop()! : key;
      const kind = kindOf(leaf, v) ?? (path ? null : JWT_RE.test(v) ? "access" : null);
      if (kind) out.push({ where, origin, key, ...(path ? { path } : {}), value: v, kind, exp: jwtExp(v) });
      return;
    }
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) visit(key, path ? `${path}.${k}` : k, x, depth + 1);
  };
  for (const { name, value } of items) {
    if (ANALYTICS_KEY_RE.test(name)) continue;
    let parsed: unknown = value;
    if (/^\s*[{[]/.test(value)) {
      try {
        parsed = JSON.parse(value);
      } catch {
        /* keep string */
      }
    }
    if (typeof parsed === "string" && /^".*"$/.test(value)) parsed = value.slice(1, -1);
    visit(name, undefined, parsed, 0);
  }
  return out;
}

// Finds the request the app used to renew its token, so clify can replay it
// without a browser: a token/refresh endpoint whose request carries the refresh
// token (or grant_type=refresh_token) and whose reply carries a new access token.
export function findRefreshRecipe(exchanges: Exchange[], tokens: StoredToken[]): RefreshRecipe | undefined {
  const refreshVals = tokens.filter((t) => t.kind === "refresh").map((t) => t.value);
  for (const e of [...exchanges].reverse()) {
    if (e.method === "GET" || !e.requestBody) continue;
    const body = e.requestBody;
    const carries = refreshVals.find((v) => body.includes(v)) ?? (/refresh_token/.test(body) ? "__any__" : undefined);
    if (!carries || !/token|refresh|auth|session|oauth/i.test(e.url)) continue;
    let reply: any;
    try {
      reply = JSON.parse(e.responseSample ?? "");
    } catch {
      continue;
    }
    const accessPath = findPath(reply, /^(access_?token|accessToken|token|id_?token|idToken|jwt)$/i);
    if (!accessPath) continue;
    let tmpl = body;
    let refreshInBody = carries;
    if (carries === "__any__") {
      const m = body.match(/refresh_token"?\s*[:=]\s*"?([^"&,}\s]+)/);
      refreshInBody = m?.[1] ?? "";
    }
    if (refreshInBody) tmpl = tmpl.split(refreshInBody).join("{{refresh_token}}");
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(e.requestHeaders)) if (!SKIP_RE.test(k) || /^content-type$/i.test(k)) headers[k.toLowerCase()] = v;
    return {
      method: e.method,
      url: e.url,
      headers,
      body: tmpl,
      contentType: e.requestHeaders["content-type"],
      accessPath,
      refreshPath: findPath(reply, /^(refresh_?token|refreshToken)$/i),
    };
  }
  return undefined;
}

function findPath(o: any, re: RegExp, prefix = "", depth = 0): string | undefined {
  if (!o || typeof o !== "object" || depth > 4) return undefined;
  for (const [k, v] of Object.entries(o)) if (re.test(k) && typeof v === "string" && v.length > 10) return prefix + k;
  for (const [k, v] of Object.entries(o)) {
    const p = findPath(v, re, `${prefix}${k}.`, depth + 1);
    if (p) return p;
  }
  return undefined;
}

function dig(o: any, path?: string): any {
  return path?.split(".").reduce((c, k) => (c == null ? c : c[k]), o);
}

// A same-site GET that returned the account's own data (contains its email or
// username): the cheapest way to tell later whether the session still works.
export function findProbe(exchanges: Exchange[], origin: string, markers: string[]): Probe | undefined {
  const ms = markers.filter((m) => m && m.length >= 3).map((m) => m.toLowerCase());
  const scored: { p: Probe; score: number }[] = [];
  for (const e of exchanges) {
    if (e.method !== "GET" || e.status !== 200 || !sameSite(e.url, origin) || !e.responseSample) continue;
    const sample = e.responseSample.toLowerCase();
    const marker = ms.find((m) => sample.includes(m));
    if (!marker) continue;
    let score = /json/i.test(e.contentType ?? "") ? 10 : 2;
    if (/\/(me|user|users\/me|account|profile|viewer|whoami|session|settings|self|current)/i.test(e.url)) score += 5;
    if (/[?&](token|code|state|ticket)=/.test(e.url)) score -= 20; // one-shot URLs
    scored.push({ p: { url: e.url, marker }, score: score - e.url.length / 200 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.p;
}

export interface SaveOptions {
  page?: Page; // to read sessionStorage too
  markers?: string[]; // account email/username, to pick the probe
  probeUrl?: string; // explicit probe (the page the browser ended on)
}

export async function saveSession(name: string, origin: string, ctx: BrowserContext, exchanges: Exchange[], opts: SaveOptions = {}): Promise<Session> {
  const root = siteRoot(new URL(origin).hostname);
  const state = await ctx.storageState();
  const prev = getSite(name);
  const tokens: StoredToken[] = [];
  for (const o of state.origins ?? []) {
    if (!sameSite(o.origin, origin)) continue;
    tokens.push(...findStorageTokens("localStorage", o.origin, o.localStorage));
  }
  if (opts.page) {
    const ss = await opts.page
      .evaluate(() => Object.keys(sessionStorage).map((k) => ({ name: k, value: sessionStorage.getItem(k) ?? "" })))
      .catch(() => [] as { name: string; value: string }[]);
    let pageOrigin = origin;
    try {
      pageOrigin = new URL(opts.page.url()).origin;
    } catch {
      /* keep */
    }
    if (sameSite(pageOrigin, origin)) tokens.push(...findStorageTokens("sessionStorage", pageOrigin, ss));
  }
  const headers = collectAuthHeaders(exchanges, origin);
  // Which header carries which stored token (so a refreshed token can replace it).
  for (const t of tokens) {
    for (const [h, v] of Object.entries(headers)) {
      const i = v.indexOf(t.value);
      if (i >= 0) {
        t.header = h;
        t.scheme = v.slice(0, i);
      }
    }
  }
  // An SPA that keeps a JWT in storage but made no API call we saw yet: send it
  // as a bearer token (the common convention), only to this site.
  if (!headers.authorization) {
    const jwt = tokens.find((t) => t.kind === "access" && JWT_RE.test(t.value) && (!t.exp || t.exp * 1000 > Date.now()));
    if (jwt) {
      headers.authorization = `Bearer ${jwt.value}`;
      jwt.header = "authorization";
      jwt.scheme = "Bearer ";
    }
  }
  const s: Session = {
    cookies: state.cookies
      .filter((c) => siteRoot(c.domain.replace(/^\./, "")) === root)
      .map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires })),
    headers,
    updatedAt: new Date().toISOString(),
  };
  const markers = opts.markers ?? [prev?.email ?? "", prev?.username ?? ""];
  const probe =
    findProbe(exchanges, origin, markers) ?? (opts.probeUrl ? { url: opts.probeUrl, marker: markers.find(Boolean)?.toLowerCase() } : undefined) ?? prev?.probe;
  const refresh = findRefreshRecipe(exchanges, tokens) ?? prev?.refresh;
  setSite(name, { session: s, storage: state, origin, tokens: tokens.length ? tokens : prev?.tokens, refresh, probe });
  return s;
}

// ── Using a saved session over plain HTTP ────────────────────────────────
function cookieHeader(url: URL, s: Session): string {
  const now = Date.now() / 1000;
  return (s.cookies ?? [])
    .filter((c) => {
      const d = c.domain.replace(/^\./, "");
      return (url.hostname === d || url.hostname.endsWith("." + d)) && url.pathname.startsWith(c.path || "/") && (c.expires <= 0 || c.expires > now);
    })
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

// Merges Set-Cookie replies back into the session (sliding sessions, rotated ids).
function mergeSetCookie(s: Session, url: URL, res: Response): boolean {
  const set = (res.headers as any).getSetCookie?.() as string[] | undefined;
  if (!set?.length) return false;
  for (const line of set) {
    const [pair, ...attrs] = line.split(";").map((x) => x.trim());
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const a = Object.fromEntries(attrs.map((x) => [x.split("=")[0].toLowerCase(), x.split("=").slice(1).join("=")]));
    const domain = a.domain ? a.domain.replace(/^\./, "") : url.hostname;
    const path = a.path || "/";
    let expires = -1;
    if (a["max-age"]) expires = Date.now() / 1000 + Number(a["max-age"]);
    else if (a.expires) expires = Date.parse(a.expires) / 1000;
    s.cookies = s.cookies.filter((c) => !(c.name === name && c.domain.replace(/^\./, "") === domain && c.path === path));
    if (expires === -1 || expires > Date.now() / 1000) s.cookies.push({ name, value, domain, path, expires });
  }
  return true;
}

export async function sessionFetch(
  name: string,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; text: string; contentType: string; url: string }> {
  const sec = getSite(name);
  const s = sec?.session;
  const u = new URL(url);
  const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "application/json, text/html;q=0.9, */*;q=0.5", ...(init.headers ?? {}) };
  if (s && sec?.origin && sameSite(url, sec.origin)) {
    Object.assign(headers, s.headers);
    const ck = cookieHeader(u, s);
    if (ck) headers.cookie = ck;
  }
  const res = await fetch(u, { method: init.method ?? "GET", headers, body: init.body, redirect: "follow", signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  if (s && mergeSetCookie(s, u, res)) setSite(name, { session: { ...s, updatedAt: new Date().toISOString() } });
  return { status: res.status, text, contentType: res.headers.get("content-type") ?? "", url: res.url };
}

export interface SessionCheck {
  valid: boolean;
  status?: number;
  url?: string;
  reason?: string;
  data?: unknown;
}

// Is the saved session still signed in? Fetches the probe (the account's own
// data) over plain HTTP and checks the reply still shows the account.
export async function checkSession(name: string): Promise<SessionCheck> {
  const sec = getSite(name);
  if (!sec?.session) return { valid: false, reason: "no saved session" };
  if (!sec.probe) return { valid: false, reason: "no probe URL recorded for this site" };
  try {
    const r = await sessionFetch(name, sec.probe.url);
    const marker = sec.probe.marker?.toLowerCase();
    const has = marker ? r.text.toLowerCase().includes(marker) : true;
    let data: unknown = r.text;
    if (/json/i.test(r.contentType) || /^\s*[{[]/.test(r.text)) {
      try {
        data = JSON.parse(r.text);
      } catch {
        /* text */
      }
    }
    if (typeof data === "string") {
      const { parse } = await import("node-html-parser");
      const root = parse(data);
      data = { title: root.querySelector("title")?.textContent.trim(), text: (root.querySelector("main, body")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 1500) };
    }
    if (r.status >= 200 && r.status < 300 && has) return { valid: true, status: r.status, url: r.url, data };
    return { valid: false, status: r.status, url: r.url, reason: r.status < 300 ? "reply does not show the account (signed out?)" : `HTTP ${r.status}` };
  } catch (e) {
    return { valid: false, reason: (e as Error).message };
  }
}

export function accessTokenExpiry(sec: SiteSecret | null): number | undefined {
  const exps = (sec?.tokens ?? []).filter((t) => t.kind === "access" && t.exp).map((t) => t.exp!);
  if (exps.length) return Math.min(...exps);
  const auth = sec?.session?.headers?.authorization?.replace(/^Bearer\s+/i, "");
  return auth ? jwtExp(auth) : undefined;
}

// Renews the access token by replaying the app's own refresh request.
export async function refreshSession(name: string): Promise<{ ok: boolean; reason?: string; exp?: number }> {
  const sec = getSite(name);
  if (!sec?.session) return { ok: false, reason: "no saved session" };
  const r = sec.refresh;
  const rt = sec.tokens?.find((t) => t.kind === "refresh");
  if (!r) return { ok: false, reason: "no refresh request recorded for this site" };
  const body = r.body?.includes("{{refresh_token}}") ? (rt ? r.body.replaceAll("{{refresh_token}}", rt.value) : undefined) : r.body;
  if (r.body && body === undefined) return { ok: false, reason: "no refresh token stored" };
  const s = sec.session;
  const u = new URL(r.url);
  const headers: Record<string, string> = { "user-agent": USER_AGENT, ...r.headers };
  // A bearer access token in the recorded request may be expired; static client auth (Basic, API keys) stays.
  if (/^bearer\s+eyJ/i.test(headers.authorization ?? "")) delete headers.authorization;
  const ck = cookieHeader(u, s);
  if (ck) headers.cookie = ck;
  let res: Response;
  try {
    res = await fetch(u, { method: r.method, headers, body, signal: AbortSignal.timeout(30000) });
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  const text = await res.text();
  mergeSetCookie(s, u, res);
  if (!res.ok) return { ok: false, reason: `refresh HTTP ${res.status}: ${text.slice(0, 120)}` };
  let reply: any;
  try {
    reply = JSON.parse(text);
  } catch {
    return { ok: false, reason: "refresh reply is not JSON" };
  }
  const access = dig(reply, r.accessPath);
  if (typeof access !== "string") return { ok: false, reason: `no ${r.accessPath} in refresh reply` };
  const newRefresh = r.refreshPath ? dig(reply, r.refreshPath) : undefined;
  let tokens = (sec.tokens ?? []).map((t) => {
    if (t.kind === "access") return { ...t, value: access, exp: jwtExp(access) };
    if (t.kind === "refresh" && typeof newRefresh === "string") return { ...t, value: newRefresh };
    return t;
  });
  if (!tokens.some((t) => t.kind === "access")) {
    tokens = [...tokens, { where: "localStorage", origin: sec.origin ?? u.origin, key: "access_token", value: access, kind: "access", exp: jwtExp(access), header: "authorization", scheme: "Bearer " }];
  }
  const accessTok = tokens.find((t) => t.kind === "access" && t.header);
  const hdr = accessTok?.header ?? "authorization";
  const scheme = accessTok?.scheme ?? "Bearer ";
  s.headers[hdr] = scheme + access;
  s.updatedAt = new Date().toISOString();
  setSite(name, { session: s, tokens });
  log(`🔄 ${name}: access token refreshed`);
  return { ok: true, exp: jwtExp(access) };
}

// Refresh first if the access token expires within `skewSec`.
export async function ensureFresh(name: string, skewSec = 120): Promise<{ refreshed: boolean; reason?: string }> {
  const exp = accessTokenExpiry(getSite(name));
  if (!exp || exp * 1000 > Date.now() + skewSec * 1000) return { refreshed: false };
  const r = await refreshSession(name);
  return { refreshed: r.ok, reason: r.reason };
}

// Re-derives stored tokens from the saved browser storage (after detector changes).
export function rescanTokens(name: string): StoredToken[] {
  const sec = getSite(name);
  const st = sec?.storage as { origins?: { origin: string; localStorage: { name: string; value: string }[] }[] } | undefined;
  if (!sec?.origin || !st) return [];
  const tokens = (st.origins ?? []).filter((o) => sameSite(o.origin, sec.origin!)).flatMap((o) => findStorageTokens("localStorage", o.origin, o.localStorage));
  for (const t of tokens) {
    for (const [h, v] of Object.entries(sec.session?.headers ?? {})) {
      const i = v.indexOf(t.value);
      if (i >= 0) {
        t.header = h;
        t.scheme = v.slice(0, i);
      }
    }
  }
  setSite(name, { tokens });
  return tokens;
}
