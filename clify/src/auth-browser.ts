// Headless Chrome for account flows (signup, login, email verification). Unlike
// the explorer's browser there is no write guard: submitting the signup or
// login form is the point. It records same-site traffic so the session module
// can find auth headers, the token-refresh request and a "who am I" probe.
// Nothing hides the automation: stock headless Chrome, no stealth, no proxies.
import { type Browser, type BrowserContext, type Page, type Request } from "playwright";
import { cleanHtml, launchBrowser, type ElementInfo } from "./browser.ts";
import type { Exchange } from "./types.ts";

const STATIC_RE = /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|eot|css|map|mp4|webm|mp3|js|mjs)(\?|$)/i;

export class AuthBrowser {
  browser!: Browser;
  ctx!: BrowserContext;
  page!: Page;
  exchanges: Exchange[] = [];

  async open(storageState?: unknown): Promise<void> {
    this.browser = await launchBrowser();
    this.ctx = await this.browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
      ...(storageState ? { storageState: storageState as any } : {}),
    });
    this.ctx.on("requestfinished", (req) => void this.record(req));
    this.page = await this.ctx.newPage();
    this.ctx.on("page", (p) => {
      this.page = p;
    });
  }

  private async record(req: Request): Promise<void> {
    const url = req.url();
    if (!/^https?:/.test(url) || STATIC_RE.test(url)) return;
    const rt = req.resourceType();
    if (rt !== "xhr" && rt !== "fetch" && rt !== "document") return;
    const res = await req.response().catch(() => null);
    if (!res) return;
    const ct = res.headers()["content-type"] ?? "";
    let sample: string | undefined;
    try {
      const buf = await res.body();
      const raw = buf.toString("utf8", 0, Math.min(buf.length, 400_000));
      sample = /html/i.test(ct) ? cleanHtml(raw).slice(0, 60_000) : raw.slice(0, 20_000);
    } catch {
      /* redirects / aborted */
    }
    this.exchanges.push({
      method: req.method(),
      url,
      status: res.status(),
      requestHeaders: await req.allHeaders().catch(() => ({})),
      requestBody: req.postData()?.slice(0, 8000),
      contentType: ct,
      responseSample: sample,
      resourceType: rt,
    });
  }

  async settle(ms = 1200): Promise<void> {
    await this.page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState("networkidle", { timeout: ms + 5000 }).catch(() => {});
    await this.page.waitForTimeout(ms);
  }

  // Numbered visible interactive elements. Password values are never included.
  async elements(): Promise<ElementInfo[]> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.page.evaluate(() => {
          const sel =
            'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=checkbox], [role=radio], [role=option], [role=combobox], [role=switch], [contenteditable=true], summary, label';
          const out: any[] = [];
          let i = 0;
          // Walk open shadow roots too (web-component login widgets).
          // (A plain loop, no inner functions: tsx would wrap them in a __name helper the page lacks.)
          const all: HTMLElement[] = [];
          const roots: (Document | ShadowRoot)[] = [document];
          while (roots.length) {
            const root = roots.shift()!;
            all.push(...Array.from(root.querySelectorAll<HTMLElement>(sel)));
            for (const host of Array.from(root.querySelectorAll<HTMLElement>("*"))) if (host.shadowRoot) roots.push(host.shadowRoot);
          }
          for (const el of all) {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            const input = el as HTMLInputElement;
            const tag = el.tagName.toLowerCase();
            // Styled checkboxes are often 0x0 inputs inside a visible label: keep them.
            const tinyCheck = tag === "input" && (input.type === "checkbox" || input.type === "radio");
            if (!tinyCheck && (r.width < 2 || r.height < 2 || st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0)) continue;
            if (tag === "label" && !el.querySelector("input[type=checkbox], input[type=radio]") && !(el as HTMLLabelElement).htmlFor) continue;
            if (r.bottom < -600 || r.top > window.innerHeight * 4) continue;
            const aria = el.getAttribute("aria-label") || el.getAttribute("title") || "";
            let label = (aria || el.innerText || input.placeholder || input.name || "").replace(/\s+/g, " ").trim();
            if (tag === "input" || tag === "textarea" || tag === "select") {
              const root = el.getRootNode() as Document | ShadowRoot;
              const lab = el.id ? root.querySelector(`label[for="${CSS.escape(el.id)}"]`) : el.closest("label");
              const lt = (lab?.textContent || "").replace(/\s+/g, " ").trim();
              if (lt && !label.includes(lt)) label = `${lt}${label ? " | " + label : ""}`;
              if (input.placeholder && !label.includes(input.placeholder)) label += ` (placeholder: ${input.placeholder})`;
            }
            if (!label && tag === "a") label = (el.querySelector("img") as HTMLImageElement | null)?.alt || "";
            el.setAttribute("data-clify", String(i));
            const info: any = { i, tag, role: el.getAttribute("role") || "", label: label.slice(0, 120) };
            if (tag === "input") {
              info.type = input.type;
              if (input.name) info.label += ` [name=${input.name}]`;
              if (input.type === "checkbox" || input.type === "radio") info.value = input.checked ? "checked" : "unchecked";
              else if (input.value && input.type !== "password") info.value = input.value.slice(0, 60);
              else if (input.type === "password" && input.value) info.value = "(filled)";
              if (input.required) info.label += " *required";
            }
            if (el.getAttribute("aria-checked")) info.value = el.getAttribute("aria-checked") === "true" ? "checked" : "unchecked";
            if (tag === "select") {
              const s = el as HTMLSelectElement;
              info.options = Array.from(s.options).slice(0, 40).map((o) => o.text.trim());
              info.value = s.options[s.selectedIndex]?.text;
            }
            if (tag === "a") info.href = (el as HTMLAnchorElement).getAttribute("href")?.slice(0, 140);
            if ((el as HTMLButtonElement).disabled) info.disabled = true;
            out.push(info);
            if (++i >= 250) break;
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

  async visibleText(max = 3000): Promise<string> {
    const t = await this.page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    return t.replace(/\n\s*\n+/g, "\n").slice(0, max);
  }

  async close(): Promise<void> {
    await this.ctx?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
  }
}
