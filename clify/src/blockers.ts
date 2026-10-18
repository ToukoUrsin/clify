// Detects pages clify must not go past. clify never solves CAPTCHAs or bot
// checks: when one appears the explorer stops that path and reports it, and
// the site is marked as needing a human for that step.
import type { Page } from "playwright";

export type Blocker = "captcha" | "bot-check" | null;

// visibleOnly: only count CAPTCHA widgets a user would actually see (the
// explorer uses it so invisible reCAPTCHA v3 badges on newsletter forms are not
// reported as blockers). Default: any trace counts.
export async function detectBlocker(page: Page, opts: { visibleOnly?: boolean } = {}): Promise<Blocker> {
  const title = await page.title().catch(() => "");
  if (/just a moment|attention required|verify you are human|are you a robot|security check/i.test(title)) return "bot-check";
  const frameRe = /recaptcha\/(api2|enterprise)|hcaptcha\.com|challenges\.cloudflare\.com|arkoselabs|funcaptcha/;
  const widgets = '[data-sitekey], img[src*="captcha" i], img[id*="captcha" i], input[name*="captcha" i], .g-recaptcha, .h-captcha, .cf-turnstile';
  if (!opts.visibleOnly) {
    if (page.frames().some((f) => frameRe.test(f.url()))) return "captcha";
    const n = await page.locator(widgets).count().catch(() => 0);
    return n ? "captcha" : null;
  }
  const frames = page.frames().filter((f) => frameRe.test(f.url()) && !/size=invisible/.test(f.url()));
  for (const f of frames) {
    const el = await f.frameElement().catch(() => null);
    const box = el ? await el.boundingBox().catch(() => null) : null;
    if (box && box.width > 30 && box.height > 30 && (await el!.isVisible().catch(() => false))) return "captcha";
  }
  const n = await page.locator(widgets).filter({ visible: true }).count().catch(() => 0);
  return n ? "captcha" : null;
}
