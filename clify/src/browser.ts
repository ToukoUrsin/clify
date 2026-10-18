// Browser for exploration: a fresh headless Chrome per run (local by default, or
// a remote one over CDP with CLIFY_CDP_URL / --cdp), a network recorder,
// a write guard, and a compact "what can I click" view that the exploring model
// works from. The guard holds every write (records its shape, never sends it);
// the exceptions are the login form of an account the user supplied and runs
// with writes explicitly allowed (`clify add --allow-writes`). Page navigations
// the site's robots.txt disallows are blocked.
import fs from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page, type Request, type Route } from "playwright";
import type { Exchange } from "./types.ts";
import type { Robots } from "./policy.ts";
import { log } from "./store.ts";

const STATIC_RE = /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|eot|css|map|mp4|webm|mp3)(\?|$)/i;
const NOISE_HOSTS =
  /(google-analytics|googletagmanager|doubleclick|facebook\.net|hotjar|segment\.io|sentry\.io|clarity\.ms|intercom|hs-analytics|hubspot|matomo|newrelic|nr-data|datadoghq|cookiebot|onetrust|cookielaw|usercentrics|recaptcha|hcaptcha|challenges\.cloudflare|gstatic|fonts\.googleapis|youtube|vimeo|plausible|mixpanel|amplitude|qualtrics|bugsnag|logrocket|heapanalytics|branch\.io|adobedtm|omtrdc|demdex|quantserve|scorecardresearch|criteo|taboola|outbrain|fullstory|optimizely|tiktok|linkedin\.com\/px|bing\.com|yandex|\/cdn-cgi\/|google\.com\/(rmkt|pagead|ads)|\/collect\?|\/g\/collect|\/beacon|\/rum\b|\/telemetry|\/track(ing)?\b|\/pixel|\/log_event|\/analytics)/i;
// POSTs that read rather than write. Everything else non-GET is held back
// unless the current action was explicitly allowed to write.
const READISH_RE =
  /(search|query|list|filter|find|lookup|autocomplete|suggest|count|fetch|get[A-Z_-]|browse|graphql|preview|export|report|facet|aggregat|elastic|_msearch|_search)/i;

export function cleanHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "<svg/>")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s(style|srcset|data-[\w-]+|aria-[\w-]+|on\w+)="[^"]*"/gi, "")
    .replace(/\s+/g, " ");
}

// JSON data embedded in a page (<script type="application/json">, ld+json,
// Next.js __NEXT_DATA__, Nuxt). Server-rendered SPAs often carry their whole
// page state here, which beats CSS extraction.
export function jsonScripts(html: string, max = 20_000): { selector: string; size: number; sample: string }[] {
  const out: { selector: string; size: number; sample: string }[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 6) {
    const attrs = m[1];
    const body = m[2].trim();
    const type = attrs.match(/type=["']([^"']+)/i)?.[1] ?? "";
    const id = attrs.match(/id=["']([^"']+)/i)?.[1];
    if (!/json/i.test(type) || body.length < 40) continue;
    const selector = id ? `script#${id}` : `script[type="${type}"]`;
    if (out.some((x) => x.selector === selector)) continue;
    out.push({ selector, size: body.length, sample: body.slice(0, max) });
  }
  return out;
}

export function chromeExecutable(): string | undefined {
  for (const p of [
    process.env.CLIFY_CHROME,
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ]) {
    if (p && fs.existsSync(p)) return p;
  }
  return undefined;
}

// The exploration browser: a local headless Chrome, or a remote Chrome over the
// DevTools protocol when CLIFY_CDP_URL is set (e.g. one per site in a Blaxel
// sandbox). CLIFY_CDP_HEADERS (JSON) adds headers to the CDP handshake, for
// endpoints behind a token. The URL may carry a token, so only its host is logged.
export async function launchBrowser(): Promise<Browser> {
  const cdp = process.env.CLIFY_CDP_URL;
  if (!cdp) return chromium.launch({ headless: true, executablePath: chromeExecutable() });
  const headers = process.env.CLIFY_CDP_HEADERS ? (JSON.parse(process.env.CLIFY_CDP_HEADERS) as Record<string, string>) : undefined;
  log(`  remote browser over CDP at ${new URL(cdp).host}`);
  return chromium.connectOverCDP(cdp, { headers, timeout: 90_000 });
}

export interface ElementInfo {
  i: number;
  tag: string;
  role: string;
  label: string;
  type?: string;
  value?: string;
  href?: string;
  options?: string[];
  disabled?: boolean;
}

export class SiteBrowser {
  browser!: Browser;
  ctx!: BrowserContext;
  page!: Page;
  exchanges: Exchange[] = [];
  held: Exchange[] = [];
  private cursor = 0;
  private currentAction = "page load";
  private allowWrites = false;
  private heldReqs = new WeakSet<Request>(); // answered locally by the guard, never sent
  private sentReqs = new WeakSet<Request>(); // writes let through by --allow-writes
  private origin: string;
  private robots?: Robots;
  private sendWrites: boolean;
  robotsBlocked: string[] = [];
  withSession = false; // set once logged in; marks recorded exchanges

  constructor(startUrl: string, opts: { robots?: Robots; sendWrites?: boolean } = {}) {
    this.origin = new URL(startUrl).origin;
    this.robots = opts.robots;
    this.sendWrites = !!opts.sendWrites;
  }

  async open(storageState?: string): Promise<void> {
    this.browser = await launchBrowser();
    this.ctx = await this.browser.newContext({
      viewport: { width: 1280, height: 860 },
      locale: "en-US",
      ...(storageState && fs.existsSync(storageState) ? { storageState } : {}),
    });
    await this.ctx.route("**/*", (route) => this.guard(route));
    this.ctx.on("requestfinished", (req) => void this.record(req));
    this.page = this.ctx.pages()[0] ?? (await this.ctx.newPage());
    this.ctx.on("page", (p) => {
      // Follow popups / target=_blank so the model keeps working on the newest tab.
      this.page = p;
    });
  }

  // allowWrites lets this one action's requests through (login submit only).
  setAction(label: string, allowWrites = false): void {
    this.currentAction = label;
    this.allowWrites = allowWrites;
  }

  private interesting(req: Request): boolean {
    const url = req.url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return false;
    if (STATIC_RE.test(url) || NOISE_HOSTS.test(url)) return false;
    const rt = req.resourceType();
    if (rt === "xhr" || rt === "fetch") return true;
    // Classic server-rendered sites: form posts and navigations are the API.
    if (rt === "document") return true;
    return false;
  }

  private async guard(route: Route): Promise<void> {
    const req = route.request();
    const method = req.method();
    const loginWrite = this.allowWrites && this.isLoginRequest(req);
    if (req.resourceType() === "document" && req.url().startsWith(this.origin) && this.robots && !this.robots.allowed(req.url())) {
      this.robotsBlocked.push(req.url());
      log(`  🚫 robots.txt disallows ${req.url().slice(0, 100)}`);
      return route.abort("blockedbyclient").catch(() => {});
    }
    if (method === "GET" || method === "HEAD" || method === "OPTIONS" || loginWrite) {
      return route.continue().catch(() => {});
    }
    // Non-GET to analytics/beacon URLs: dropped (never sent, not recorded), so the
    // noise filter can never become a way for a real write to slip past the guard.
    if (!this.interesting(req)) return route.abort().catch(() => {});
    const body = req.postData() ?? "";
    const isGraphqlMutation = /"query"\s*:\s*"\s*mutation/i.test(body) || /^\s*mutation\b/.test(body);
    if (!isGraphqlMutation && (READISH_RE.test(req.url()) || READISH_RE.test(body.slice(0, 400)))) {
      return route.continue().catch(() => {});
    }
    if (this.sendWrites) {
      log(`  ✉ write sent (--allow-writes) ${method} ${req.url().slice(0, 100)}`);
      this.sentReqs.add(req);
      return route.continue().catch(() => {});
    }
    // Hold the write: record its exact shape for the CLI, but never send it.
    this.heldReqs.add(req);
    this.held.push({
      method,
      url: req.url(),
      status: 0,
      requestHeaders: await req.allHeaders().catch(() => ({})),
      requestBody: body.slice(0, 8000),
      resourceType: req.resourceType(),
      triggeredBy: this.currentAction,
      held: true,
    });
    log(`  ⛔ held write ${method} ${req.url().slice(0, 100)}`);
    // A held page submit gets a stub page so the navigation completes; XHRs get an empty 204.
    if (req.resourceType() === "document") {
      await route.fulfill({ status: 200, contentType: "text/html", body: "<title>clify: write held</title><p>clify held this write; it was not sent.</p>" }).catch(() => {});
    } else {
      await route.fulfill({ status: 204, body: "" }).catch(() => {});
    }
  }

  private isLoginRequest(req: Request): boolean {
    if (!/submit login/i.test(this.currentAction)) return false;
    let url: URL;
    try {
      url = new URL(req.url());
    } catch {
      return false;
    }
    if (url.origin !== this.origin) return false;
    const target = `${url.pathname}${url.search}`;
    return req.resourceType() === "document" || /login|log-in|signin|sign-in|authenticate|session|oauth|token/i.test(target);
  }

  private async record(req: Request): Promise<void> {
    if (!this.interesting(req) || this.heldReqs.has(req)) return;
    const res = await req.response().catch(() => null);
    if (!res) return;
    const ct = res.headers()["content-type"] ?? "";
    // Document GETs are only interesting if they are same-site pages; keep them
    // light (no body) unless they are form posts.
    let sample: string | undefined;
    let scripts: Exchange["jsonScripts"] = [];
    const isDoc = req.resourceType() === "document";
    if (isDoc && req.method() === "GET" && !req.url().startsWith(this.origin)) return;
    try {
      const buf = await res.body();
      const raw = buf.toString("utf8", 0, Math.min(buf.length, 600_000));
      // Server-rendered pages: keep the markup (minus scripts/styles) so the
      // synthesizer can write CSS extractors; JSON/text keep a head sample.
      sample = /html/i.test(ct) ? cleanHtml(raw).slice(0, 40_000) : raw.slice(0, 30_000);
      if (/html/i.test(ct)) scripts = jsonScripts(buf.toString("utf8"));
    } catch {
      /* redirects, streamed or aborted bodies */
    }
    this.exchanges.push({
      method: req.method(),
      url: req.url(),
      status: res.status(),
      requestHeaders: await req.allHeaders().catch(() => ({})),
      requestBody: req.postData()?.slice(0, 8000),
      contentType: ct,
      responseSample: sample,
      resourceType: req.resourceType(),
      triggeredBy: this.currentAction,
      ...(scripts?.length ? { jsonScripts: scripts } : {}),
      ...(this.sentReqs.has(req) || (this.allowWrites && !/^(GET|HEAD|OPTIONS)$/.test(req.method())) ? { sent: true } : {}),
      ...(this.withSession ? { withSession: true } : {}),
    });
  }

  // API calls captured since the last call (for feedback to the model).
  newExchanges(): Exchange[] {
    const out = this.exchanges.slice(this.cursor);
    this.cursor = this.exchanges.length;
    return out;
  }

  async settle(ms = 1500): Promise<void> {
    // A popup that closed itself leaves us on a dead page: go back to a live one.
    if (this.page.isClosed()) {
      const live = this.ctx.pages().filter((p) => !p.isClosed());
      this.page = live[live.length - 1] ?? (await this.ctx.newPage());
    }
    await this.page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState("networkidle", { timeout: ms + 4000 }).catch(() => {});
    await this.page.waitForTimeout(ms).catch(() => {});
  }

  // Number every visible interactive element so the model can say "click 12".
  async elements(): Promise<ElementInfo[]> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.page.evaluate(() => {
          const sel =
            'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=option], [role=combobox], [onclick], summary, label[for]';
          const els = Array.from(document.querySelectorAll<HTMLElement>(sel));
          const out: any[] = [];
          let i = 0;
          for (const el of els) {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            if (r.width < 2 || r.height < 2 || st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0) continue;
            if (r.bottom < -400 || r.top > window.innerHeight * 3) continue;
            const tag = el.tagName.toLowerCase();
            const input = el as HTMLInputElement;
            const aria = el.getAttribute("aria-label") || el.getAttribute("title") || "";
            let label = (aria || el.innerText || input.placeholder || input.name || input.value || "").replace(/\s+/g, " ").trim();
            if (!label && tag === "input") {
              const id = el.id;
              const lab = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
              label = (lab?.textContent || "").trim();
            }
            if (!label && tag === "a") label = (el.querySelector("img") as HTMLImageElement | null)?.alt || "";
            el.setAttribute("data-clify", String(i));
            const info: any = { i, tag, role: el.getAttribute("role") || "", label: label.slice(0, 80) };
            if (tag === "input") {
              info.type = input.type;
              if (input.type === "checkbox" || input.type === "radio") info.value = input.checked ? "checked" : "unchecked";
              else if (input.value && input.type !== "password") info.value = input.value.slice(0, 40);
            }
            if (tag === "select") {
              const s = el as HTMLSelectElement;
              info.options = Array.from(s.options).slice(0, 25).map((o) => o.text.trim());
              info.value = s.options[s.selectedIndex]?.text;
            }
            if (tag === "a") info.href = (el as HTMLAnchorElement).getAttribute("href")?.slice(0, 120);
            if ((el as HTMLButtonElement).disabled) info.disabled = true;
            out.push(info);
            i++;
            if (i >= 220) break;
          }
          return out;
        });
      } catch {
        await this.page.waitForTimeout(800);
      }
    }
    return [];
  }

  locator(i: number) {
    return this.page.locator(`[data-clify="${i}"]`).first();
  }

  async screenshot(): Promise<string> {
    const buf = await this.page.screenshot({ type: "jpeg", quality: 55 }).catch(() => Buffer.alloc(0));
    return buf.toString("base64");
  }

  async visibleText(max = 2500): Promise<string> {
    const t = await this.page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    return t.replace(/\n\s*\n+/g, "\n").slice(0, max);
  }

  async close(): Promise<void> {
    await this.ctx.close().catch(() => {});
    await this.browser.close().catch(() => {});
  }
}
