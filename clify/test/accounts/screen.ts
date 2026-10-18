// Pre-screens candidate sites for agent signup: reads their terms (model) and
// looks at the signup page for a CAPTCHA, email field and OAuth-only signup.
// Nothing is submitted. Usage: node --import tsx test/accounts/screen.ts sites.txt > screen.jsonl
import fs from "node:fs";
import { AuthBrowser } from "../../src/auth-browser.ts";
import { detectBlocker } from "../../src/blockers.ts";
import { checkTerms, isSocialNetwork } from "../../src/signup.ts";

const SIGNUP_RE = /(sign ?up|register|get started|create (an )?account|join|start (for )?free|try (it )?free|start building)/i;

async function screen(url: string) {
  const row: any = { url };
  if (isSocialNetwork(url)) return { ...row, verdict: "skip: social network" };
  const b = new AuthBrowser();
  await b.open();
  try {
    await b.page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await b.settle(2500);
    row.homeBlocker = await detectBlocker(b.page);
    let signupUrl: string | undefined;
    const links = await b.page
      .evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((a) => ({ t: (a as HTMLElement).innerText.trim(), h: (a as HTMLAnchorElement).href })))
      .catch(() => [] as { t: string; h: string }[]);
    signupUrl = links.find((l) => SIGNUP_RE.test(l.t) && /^https?:/.test(l.h))?.h;
    row.signupUrl = signupUrl;
    if (signupUrl) {
      await b.page.goto(signupUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await b.settle(4000);
      row.signupFinal = b.page.url();
      row.signupBlocker = await detectBlocker(b.page);
      row.emailField = (await b.page.locator('input[type="email"], input[name*="email" i], input[autocomplete="email"], input[autocomplete="username"]').filter({ visible: true }).count()) > 0;
      row.passwordField = (await b.page.locator('input[type="password"]').filter({ visible: true }).count()) > 0;
      row.oauth = (await b.visibleText(4000)).match(/continue with (google|github|apple|microsoft)/gi)?.slice(0, 3) ?? [];
    }
    const t = await checkTerms(url, { browser: b });
    row.terms = { allowed: t.allowed, reason: t.reason, quote: t.quote, url: t.url, checked: t.checked };
  } catch (e) {
    row.error = (e as Error).message.slice(0, 200);
  } finally {
    await b.close();
  }
  row.candidate = !!(row.terms?.allowed && !row.homeBlocker && !row.signupBlocker && row.emailField);
  return row;
}

const urls = fs.readFileSync(process.argv[2], "utf8").split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
const conc = Number(process.env.CONC ?? 5);
let next = 0;
await Promise.all(
  Array.from({ length: conc }, async () => {
    while (next < urls.length) {
      const u = urls[next++];
      const r = await screen(u);
      process.stdout.write(JSON.stringify(r) + "\n");
      process.stderr.write(`${r.candidate ? "✅" : "❌"} ${u} ${r.terms ? (r.terms.allowed ? "terms-ok" : "terms-ban") : ""} ${r.signupBlocker ?? ""} ${r.emailField ? "email" : "no-email"}\n`);
    }
  }),
);
