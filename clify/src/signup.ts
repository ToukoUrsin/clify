// Account flows driven by Claude in headless Chrome: sign up with the agent's
// own identity, or log in to an existing account, including email/SMS codes,
// verification links and TOTP.
//
// Rules enforced in code, not left to the model:
//  - Before any signup the site's terms (and robots.txt) are read; an explicit
//    ban on automated/bot accounts or automated access stops the flow.
//  - A CAPTCHA or bot check on the page stops the flow at once. clify never
//    interacts with it, never solves it, never tries to get around it.
//  - No real-identity social networks.
//  - The model never sees the password or TOTP codes: it types {{password}} /
//    {{totp}} and they are substituted here, locally.
import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { parse as parseHtml } from "node-html-parser";
import { saveShot } from "./ask.ts";
import { AuthBrowser } from "./auth-browser.ts";
import { detectBlocker } from "./blockers.ts";
import { inspect, waitForSmsCode, waitForVerification, type Found } from "./codes.ts";
import { hasPhone } from "./identity.ts";
import { client, MODEL, parseJson, withRetry } from "./llm.ts";
import { siteRoot, USER_AGENT } from "./runtime.ts";
import { checkSession, saveSession, type SessionCheck } from "./session.ts";
import { log } from "./store.ts";
import { totp } from "./totp.ts";
import { getSite, setSite } from "./vault.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Real-identity social networks: no agent accounts, no posts.
const SOCIAL_RE =
  /(^|\.)(linkedin|facebook|instagram|twitter|x|threads|tiktok|snapchat|pinterest|tumblr|reddit|vk|weibo|bsky|bluesky|mastodon|truthsocial|nextdoor|quora|meetup|tinder|bumble|hinge|whatsapp|telegram|signal|discord)\.(com|net|org|app|social|me)$/i;

export function isSocialNetwork(url: string): boolean {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return SOCIAL_RE.test(host) || host === "x.com" || host === "t.co";
}

// ── Claude via the box pool ──────────────────────────────────────────────
// The pool may answer with a non-Claude model on 429; those replies are
// discarded and retried later.
async function claude(params: Record<string, unknown>): Promise<Anthropic.Message> {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = (await withRetry(() => client.messages.create({ model: MODEL, ...params } as any))) as Anthropic.Message;
    if (/claude/i.test(res.model ?? "")) return res;
    log(`  ↻ model pool answered with "${res.model}", not Claude; retrying in ${20 * attempt}s`);
    await sleep(20_000 * attempt);
  }
  throw new Error("model pool kept answering with a non-Claude model");
}

async function claudeText(prompt: string, maxTokens = 4000): Promise<string> {
  const res = await claude({ max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// ── Terms check ──────────────────────────────────────────────────────────
export interface TermsResult {
  allowed: boolean;
  checked: string[]; // URLs read
  url?: string; // document with the deciding clause
  quote?: string;
  reason: string;
}

const TERMS_LINK_RE = /(terms|tos\b|conditions|legal|acceptable[- ]use|aup|user agreement|usage policy|community guidelines)/i;
const TERMS_PATHS = ["/terms", "/tos", "/terms-of-service", "/legal/terms", "/legal/terms-of-service", "/terms-of-use", "/legal/tos", "/policies/terms", "/policies/terms-of-service", "/about/terms", "/legal/terms-of-use", "/legal", "/terms-and-conditions", "/aup", "/acceptable-use-policy"];
const KEY_RE = /(automat|\bbots?\b|robot|script|scrap|crawl|spider|human|natural person|machine|\bagents?\b|artificial|\bAI\b|register|registration|create an account|account creation|multiple accounts|fake|impersonat|accurate information|sign[- ]?up)/i;

async function fetchText(url: string): Promise<{ url: string; status: number; html: string } | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    const buf = Buffer.from(await res.arrayBuffer());
    // Terms published as PDF: extract the text (poppler's pdftotext), wrap it as a page.
    if (buf.subarray(0, 5).toString() === "%PDF-") {
      try {
        const text = execFileSync("pdftotext", ["-", "-"], { input: buf, encoding: "utf8", maxBuffer: 20_000_000 });
        return { url: res.url || url, status: res.status, html: `<title>Terms (PDF)</title><pre>${text.replace(/</g, "&lt;")}</pre>` };
      } catch {
        return null;
      }
    }
    return { url: res.url || url, status: res.status, html: buf.toString("utf8") };
  } catch {
    return null;
  }
}

function htmlText(html: string): string {
  const root = parseHtml(html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ""));
  return root.textContent.replace(/[ \t\r]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

// Paragraphs that talk about automation, bots, humans or account creation.
function relevantExcerpts(text: string, max = 9000): string {
  const paras = text.split(/\n|(?<=\.)\s{2,}/).map((p) => p.trim()).filter((p) => p.length > 30);
  const hits: string[] = [];
  let n = 0;
  for (const p of paras) {
    if (!KEY_RE.test(p)) continue;
    const s = p.slice(0, 1200);
    hits.push(s);
    n += s.length;
    if (n > max) break;
  }
  return hits.join("\n");
}

export async function checkTerms(siteUrl: string, opts: { termsUrl?: string; browser?: AuthBrowser } = {}): Promise<TermsResult> {
  const origin = new URL(siteUrl).origin;
  const candidates = new Set<string>();
  if (opts.termsUrl) candidates.add(opts.termsUrl);
  const home = await fetchText(siteUrl);
  let homeHtml = home?.html ?? "";
  if (opts.browser) {
    // Footer links are often rendered client-side: read the live DOM too.
    await opts.browser.page.goto(siteUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await opts.browser.settle(1500);
    homeHtml += await opts.browser.page.content().catch(() => "");
  }
  for (const a of parseHtml(homeHtml).querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") ?? "";
    const label = `${a.textContent} ${href}`;
    if (!TERMS_LINK_RE.test(label) || /privacy|cookie/i.test(a.textContent)) continue;
    try {
      const u = new URL(href, home?.url ?? siteUrl);
      if (/^https?:$/.test(u.protocol)) candidates.add(u.toString().split("#")[0]);
    } catch {
      /* bad href */
    }
  }
  for (const p of TERMS_PATHS) candidates.add(origin + p);
  const docs: { url: string; text: string }[] = [];
  const checked: string[] = [];
  const queue = [...candidates].slice(0, 16);
  for (let qi = 0; qi < queue.length; qi++) {
    const url = queue[qi];
    if (docs.length >= 4) break;
    const r = await fetchText(url);
    if (!r || r.status >= 400) continue;
    let text = htmlText(r.html);
    if (text.length < 1500 && opts.browser) {
      // client-rendered legal page
      await opts.browser.page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await opts.browser.settle(1500);
      text = await opts.browser.visibleText(200_000);
    }
    if (text.length < 800 || !/(terms|agreement|conditions|policy)/i.test(text.slice(0, 5000))) continue;
    if (docs.some((d) => d.url === r.url)) continue;
    checked.push(r.url);
    docs.push({ url: r.url, text });
    // Policies the terms incorporate (acceptable use, community guidelines) are read next.
    for (const a of parseHtml(r.html).querySelectorAll("a[href]")) {
      if (!/(acceptable[- ]use|usage polic|community guidelines|aup\b)/i.test(`${a.textContent} ${a.getAttribute("href")}`)) continue;
      try {
        const u = new URL(a.getAttribute("href")!, r.url).toString().split("#")[0];
        if (!queue.includes(u)) queue.splice(qi + 1, 0, u);
      } catch {
        /* bad href */
      }
    }
  }
  const robots = await fetchText(origin + "/robots.txt");
  const robotsTxt = robots && robots.status < 400 && !/<html/i.test(robots.html) ? robots.html.slice(0, 3000) : "";
  if (robotsTxt) checked.push(origin + "/robots.txt");
  if (!docs.length) return { allowed: false, checked, reason: "terms-not-found: could not find the site's terms; pass --terms-url to check them" };

  const prompt = `You check whether a website's terms allow an AI agent to create and use its own account. The agent is a software agent (a headless browser driven by an AI), registering openly as "clify agent" with its own email address, one account, no CAPTCHA solving, no bot-detection evasion.

Decide "banned" if the terms EXPLICITLY:
- prohibit creating/registering accounts by automated means, bots or scripts, or
- require that accounts be held/registered by a human / natural person (not a bot), or
- prohibit accessing or using the service through automated means, bots, robots, scripts or AI agents in general (a carve-out only for the official API still counts as banned for browser automation).
Do NOT count as a ban: rules against scraping/crawling content, spam, abuse, reverse engineering, excessive load, reselling, minimum age, giving false information (the agent is honest about what it is), or robots.txt Disallow lines (they are for search crawlers, not accounts).
If nothing explicit forbids it, answer allowed.

Answer only JSON: {"allowed": true|false, "url": "<doc with the deciding clause or null>", "quote": "<exact deciding sentence, or null>", "reason": "<one sentence>"}

${docs.map((d) => `=== ${d.url}\n${relevantExcerpts(d.text)}`).join("\n\n")}
${robotsTxt ? `\n=== robots.txt\n${robotsTxt}` : ""}`;
  const verdict = parseJson<{ allowed: boolean; url?: string | null; quote?: string | null; reason: string }>(await claudeText(prompt, 2000));
  return { allowed: !!verdict.allowed, checked, url: verdict.url ?? undefined, quote: verdict.quote ?? undefined, reason: verdict.reason };
}

// ── The flow driver ──────────────────────────────────────────────────────
export interface AuthFlowOptions {
  name: string;
  url: string;
  mode: "signup" | "login";
  email: string;
  password: string;
  username?: string;
  displayName?: string;
  totpSecret?: string;
  phone?: string;
  maxSteps?: number;
  goal?: string; // extra instruction
  storageState?: unknown;
}

export interface AuthFlowResult {
  ok: boolean;
  loggedIn: boolean;
  signedUp: boolean;
  verified: boolean; // email/SMS verification completed
  verificationChannel?: "email-link" | "email-code" | "sms-code" | "totp" | "none";
  blockers: string[];
  steps: number;
  finalUrl?: string;
  session?: SessionCheck;
  note?: string;
  blockedShot?: string; // screenshot of the page that stopped the flow (for clify ask)
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "click",
    description: "Click element number i. intent = what it does.",
    input_schema: { type: "object", properties: { i: { type: "integer" }, intent: { type: "string" } }, required: ["i"] },
  },
  {
    name: "type",
    description:
      "Replace the value of input i with text. Placeholders are expanded locally: {{email}} {{password}} {{name}} {{first_name}} {{last_name}} {{username}} {{company}} {{phone}} (E.164, e.g. +1...) {{phone_national}} (US 10 digits, when the country is picked separately) {{code}} (last code read from email/SMS) {{totp}} (current 2FA code). submit=true presses Enter after typing.",
    input_schema: { type: "object", properties: { i: { type: "integer" }, text: { type: "string" }, submit: { type: "boolean" } }, required: ["i", "text"] },
  },
  {
    name: "type_code_boxes",
    description: "For split one-time-code inputs (one box per digit): types {{code}} or {{totp}} starting at box i.",
    input_schema: { type: "object", properties: { i: { type: "integer" }, text: { type: "string", enum: ["{{code}}", "{{totp}}"] } }, required: ["i", "text"] },
  },
  {
    name: "select",
    description: "Choose an option (visible text) in select element i.",
    input_schema: { type: "object", properties: { i: { type: "integer" }, option: { type: "string" } }, required: ["i", "option"] },
  },
  {
    name: "goto",
    description: "Open a URL.",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  { name: "press", description: "Press a key (Enter, Tab, Escape...).", input_schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
  { name: "scroll", description: "Scroll the page.", input_schema: { type: "object", properties: { direction: { type: "string", enum: ["down", "up"] } }, required: ["direction"] } },
  { name: "wait", description: "Wait a few seconds for the page.", input_schema: { type: "object", properties: { seconds: { type: "integer" } } } },
  {
    name: "check_email",
    description:
      "Wait (up to ~2 min) for a new email to the account's address and read it: you get the subject, sender, a short text excerpt, whether a one-time code was found (then type {{code}}) and the numbered links. Use after the site says it sent a code or a confirmation link.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "open_email_link",
    description: "Open link number n from the last email read (e.g. the verify/confirm link) in this browser.",
    input_schema: { type: "object", properties: { n: { type: "integer" } }, required: ["n"] },
  },
  {
    name: "check_sms",
    description: "Wait for an SMS code to the agent's phone number. Tells you if there is no phone number.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "done",
    description:
      "Finish. result: 'logged_in' = you are signed in to the account now (dashboard/app visible); 'blocked' = cannot continue. blocker (when blocked): captcha | phone-required | payment-required | invite-only | email-rejected | terms | oauth-only | already-exists | other. account_url = a page that shows this account's own profile/settings/email, if you saw one.",
    input_schema: {
      type: "object",
      properties: {
        result: { type: "string", enum: ["logged_in", "blocked"] },
        blocker: { type: "string" },
        note: { type: "string" },
        account_url: { type: "string" },
      },
      required: ["result"],
    },
  },
];

function systemPrompt(o: AuthFlowOptions, extra: string): string {
  const who = `Identity (non-secret values you may reason about): name "${o.displayName ?? "clify agent"}", email ${o.email}, username ${o.username ?? "(none)"}, phone ${o.phone ?? "none available"}. The password is secret: always type {{password}}.`;
  const task =
    o.mode === "signup"
      ? `Create a new account on this site for the agent, verify it, and end signed in.
1. Find the sign-up / register / get-started page (look in the header, or try /signup, /register, /join). Choose email + password signup. Never use "Continue with Google/GitHub/Apple" or other OAuth.
2. Fill: email {{email}}, password {{password}} (and confirm-password with {{password}}), name {{name}} or first/last {{first_name}} {{last_name}}, username {{username}}, company/workspace {{company}}. Optional fields: leave empty. Phone: if the site asks for a phone number (required, or to verify the account), use {{phone}} / {{phone_national}} (US, +1), then call check_sms for the code.
3. The site's terms were already checked and allow this agent. You may tick a required "I agree to the Terms/Privacy" box. Leave marketing/newsletter opt-ins unticked.
4. Multi-step flows and onboarding: answer minimally and honestly (role "developer", use case "testing/automation", team size 1, skip where possible). Choose a free plan; never enter payment details.
5. Email verification: when the site says it sent a code or link, call check_email, then type {{code}} or open_email_link. If no mail arrives, use the site's "resend" once, then check_email again.
6. If the site then asks you to log in, log in with {{email}} / {{password}}.
7. When you see the signed-in app, open the account/profile/settings page once (so its URL and API get recorded) and call done(result="logged_in", account_url=...).`
      : `Log in to the agent's existing account on this site and end signed in.
1. Find the login / sign-in page. Never use OAuth buttons; use email/username + password.
2. Type {{email}} (or {{username}} if the field wants a username) and {{password}}. Some sites ask for the email first, then the password on the next step.
   Passwordless sites (emailed sign-in link or code): enter {{email}}, then check_email and open the link / type {{code}}.
3. Two-factor: if asked to pick a method, prefer the authenticator app when a TOTP secret is stored (${o.totpSecret ? "it is" : "it is not"}), else SMS/phone${o.phone ? "" : " (no phone available)"}, else email. For an authenticator/TOTP code type {{totp}}; if a code was emailed call check_email then type {{code}}; for SMS call check_sms.
4. When you see the signed-in app, open the account/profile/settings page once and call done(result="logged_in", account_url=...).`;
  return `You are clify's account agent, driving a headless Chrome. ${who}

${task}

Hard rules:
- CAPTCHAs, "verify you are human" checks, puzzles: never interact with them. Call done(result="blocked", blocker="captcha") immediately.
- A required phone number when none is available, a payment wall, an invite-only or waitlist signup: done blocked with that blocker.
- If the email is rejected (e.g. "disposable email not allowed") call done blocked with blocker "email-rejected". If the account already exists, try logging in instead.
- Dismiss cookie banners (reject optional cookies). Do not post, message, invite or publish anything.
- One action per turn, no narration.${extra ? "\n" + extra : ""}`;
}

export async function runAuthFlow(o: AuthFlowOptions): Promise<AuthFlowResult> {
  const maxSteps = o.maxSteps ?? 45;
  const b = new AuthBrowser();
  await b.open(o.storageState);
  const blockers: string[] = [];
  let lastMail: Found | null = null;
  let code: string | undefined;
  let verified = false;
  let channel: AuthFlowResult["verificationChannel"] = "none";
  const usedMail: string[] = [];
  const startedAt = new Date(Date.now() - 5000);
  const [first, ...rest] = (o.displayName ?? "clify agent").split(" ");
  const values = (): Record<string, string> => ({
    email: o.email,
    password: o.password,
    name: o.displayName ?? "clify agent",
    first_name: first,
    last_name: rest.join(" ") || "agent",
    username: o.username ?? o.email.split("@")[0],
    company: "clify",
    phone: o.phone ?? "",
    phone_national: (o.phone ?? "").replace(/^\+1/, ""),
    code: code ?? "",
    totp: o.totpSecret ? totp(o.totpSecret) : "",
  });
  const expand = (t: string) => t.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in values() ? values()[k] : m));
  const secretsIn = (t: string) => /\{\{(password|totp)\}\}/.test(t);

  let blockedNow: string | null = null;
  const observe = async (note: string): Promise<Anthropic.ToolResultBlockParam["content"]> => {
    await b.settle(1200);
    const blocker = await detectBlocker(b.page);
    if (blocker) {
      blockedNow = `${blocker} at ${b.page.url()}`;
      return [{ type: "text", text: `${note}\n⛔ ${blocker} on this page. clify stops here (never interacts with CAPTCHAs).` }];
    }
    const els = await b.elements();
    const text = await b.visibleText(2500);
    const lines = [
      note,
      `URL: ${b.page.url()}`,
      `Title: ${await b.page.title().catch(() => "")}`,
      `Visible text (start): ${text.replace(/\s+/g, " ").slice(0, 1500)}`,
      "Elements:",
      els
        .map(
          (e) =>
            `[${e.i}] ${e.tag}${e.type ? `:${e.type}` : ""}${e.role ? `(${e.role})` : ""} "${e.label}"${e.value ? ` =${e.value}` : ""}${e.href ? ` → ${e.href}` : ""}${
              e.options ? ` options:${e.options.join("|").slice(0, 300)}` : ""
            }${e.disabled ? " (disabled)" : ""}`,
        )
        .join("\n"),
    ];
    let body = lines.join("\n").slice(0, 16000);
    // Never echo a secret back, even if a site reflects it into the page.
    for (const s of [o.password, values().totp].filter((x) => x && x.length >= 6)) body = body.split(s).join("[secret]");
    const shot = await b.screenshot();
    return [{ type: "text", text: body }, ...(shot ? [{ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: shot } }] : [])];
  };

  const act = async (name: string, input: any): Promise<Anthropic.ToolResultBlockParam["content"] | string> => {
    switch (name) {
      case "click": {
        const loc = b.locator(input.i);
        await loc.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
        await loc.click({ timeout: 8000 }).catch(async (e) => {
          // Styled checkbox inputs: click their label instead.
          const ok = await loc.evaluate((el: any) => (el.click(), true)).catch(() => false);
          if (!ok) throw e;
        });
        return observe(`Clicked [${input.i}]${input.intent ? ` (${input.intent})` : ""}.`);
      }
      case "type": {
        const text = String(input.text);
        const loc = b.locator(input.i);
        await loc.fill(expand(text), { timeout: 6000 }).catch(async () => {
          await loc.click({ timeout: 4000 });
          await b.page.keyboard.press("ControlOrMeta+A");
          await b.page.keyboard.type(expand(text), { delay: 20 });
        });
        if (/\{\{totp\}\}/.test(text)) channel = "totp";
        if (input.submit) await loc.press("Enter");
        return observe(`Typed ${secretsIn(text) ? "a secret placeholder" : JSON.stringify(text)} into [${input.i}]${input.submit ? " and pressed Enter" : ""}.`);
      }
      case "type_code_boxes": {
        const val = expand(String(input.text));
        if (!val) return "No code available yet (call check_email / check_sms first).";
        if (input.text === "{{totp}}") channel = "totp";
        await b.locator(input.i).click({ timeout: 6000 });
        await b.page.keyboard.type(val, { delay: 60 });
        return observe("Typed the code into the code boxes.");
      }
      case "select":
        await b.locator(input.i).selectOption({ label: input.option }, { timeout: 6000 });
        return observe(`Selected "${input.option}".`);
      case "goto": {
        const url = new URL(input.url, b.page.url() || o.url).toString();
        await b.page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        return observe(`Opened ${url}.`);
      }
      case "press":
        await b.page.keyboard.press(input.key);
        return observe(`Pressed ${input.key}.`);
      case "scroll":
        await b.page.mouse.wheel(0, input.direction === "up" ? -1500 : 1500);
        return observe(`Scrolled ${input.direction}.`);
      case "wait":
        await b.page.waitForTimeout(Math.min(20, Number(input.seconds ?? 5)) * 1000);
        return observe("Waited.");
      case "check_email": {
        log("  📭 waiting for verification mail…");
        const f = await waitForVerification({ after: startedAt, to: o.email, site: o.url, timeoutMs: 150_000, exclude: usedMail });
        if (!f) return "No new email arrived in ~2.5 minutes. Use the site's resend option once, or done(blocked, blocker='other', note='no verification email').";
        usedMail.push(f.mail.id);
        lastMail = f;
        if (f.code) code = f.code;
        const excerpt = (f.mail.text || htmlText(f.mail.html ?? "")).replace(/\s+/g, " ").slice(0, 1200);
        return [
          `Email from ${f.mail.from}: "${f.mail.subject}"`,
          f.code ? `One-time code found (${f.code.length} chars): type {{code}}.` : "No one-time code found in it.",
          `Links:\n${f.links.map((l, n) => `  ${n}. ${l.text || "(no text)"} → ${l.url.slice(0, 90)}${l.url.length > 90 ? "…" : ""}`).join("\n") || "  (none)"}`,
          `Text: ${excerpt}`,
        ].join("\n");
      }
      case "open_email_link": {
        const l = (lastMail as Found | null)?.links[Number(input.n)];
        if (!l) return "No such link; call check_email first.";
        await b.page.goto(l.url, { waitUntil: "domcontentloaded", timeout: 45000 });
        verified = true;
        channel = "email-link";
        return observe(`Opened email link ${input.n}.`);
      }
      case "check_sms": {
        if (!hasPhone()) return "No phone number: the agent identity has no SMS number. If the site requires one, call done(result='blocked', blocker='phone-required').";
        const r = await waitForSmsCode({ after: startedAt, timeoutMs: 150_000 });
        if (!r?.code) return "No SMS code arrived.";
        code = r.code;
        channel = "sms-code";
        return `SMS code received (${r.code.length} chars): type {{code}}.`;
      }
      default:
        return `Unknown tool ${name}`;
    }
  };

  // Login without the model for ordinary forms: username/email (+ next step),
  // password, then a TOTP or emailed code if a code field appears.
  const quickLogin = async (): Promise<boolean> => {
    const visible = (sel: string) => b.page.locator(sel).filter({ visible: true }).first();
    const userSel = 'input[autocomplete="username"], input[autocomplete="email"], input[type="email"], input[name*="email" i], input[name*="user" i], input[name="login"], input[id*="email" i], input[id*="user" i]';
    const codeSel = 'input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="totp" i], input[name*="code" i], input[id*="otp" i], input[id*="code" i], input[name*="token" i]';
    const user = visible(userSel);
    if (!(await user.count())) return false;
    const wantsEmail = /email/i.test(`${await user.getAttribute("type")} ${await user.getAttribute("name")} ${await user.getAttribute("autocomplete")}`);
    await user.fill(wantsEmail || !o.username ? o.email : o.username, { timeout: 6000 });
    let pass = visible('input[type="password"]');
    if (!(await pass.count())) {
      await user.press("Enter");
      await b.settle(1500);
      pass = visible('input[type="password"]');
      if (!(await pass.count())) return false;
    }
    await pass.fill(o.password, { timeout: 6000 });
    await pass.press("Enter");
    await b.settle(1800);
    if (await detectBlocker(b.page)) return false;
    const codeBox = visible(codeSel);
    if (await codeBox.count()) {
      const pageText = (await b.visibleText(2000)).toLowerCase();
      if (o.totpSecret) {
        await codeBox.fill(totp(o.totpSecret), { timeout: 6000 });
        channel = "totp";
      } else if (hasPhone() && /\b(sms|text message|phone)\b/.test(pageText) && !/\bemail\b/.test(pageText)) {
        const r = await waitForSmsCode({ after: startedAt, timeoutMs: 120_000 });
        if (!r?.code) return false;
        code = r.code;
        await codeBox.fill(r.code, { timeout: 6000 });
        channel = "sms-code";
        verified = true;
      } else {
        const f = await waitForVerification({ after: startedAt, to: o.email, site: o.url, timeoutMs: 120_000 });
        if (!f?.code) return false;
        code = f.code;
        await codeBox.fill(f.code, { timeout: 6000 });
        channel = "email-code";
        verified = true;
      }
      await codeBox.press("Enter");
      await b.settle(2500);
    }
    const stillForm = (await visible('input[type="password"]').count()) + (await visible(codeSel).count());
    return stillForm === 0 && !/(log-?in|sign-?in|2fa|mfa|otp|verify)/i.test(new URL(b.page.url()).pathname);
  };

  log(`🌐 ${o.mode} ${o.url} as ${o.email}`);
  let result: { result: string; blocker?: string; note?: string; account_url?: string } | null = null;
  let steps = 0;
  try {
    await b.page.goto(o.url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => log(`goto: ${e.message}`));
    if (o.mode === "login" && !(await detectBlocker(b.page))) {
      const ok = await quickLogin().catch((e) => (log(`  quick login: ${(e as Error).message.split("\n")[0]}`), false));
      if (ok) {
        log("  ✓ logged in with the plain form (no model needed)");
        result = { result: "logged_in" };
      } else await b.page.goto(o.url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    }
    const messages: Anthropic.MessageParam[] = [];
    if (!result) messages.push({ role: "user", content: [{ type: "text", text: `Start URL: ${o.url}. You have ${maxSteps} actions.` }, ...((await observe("Initial page.")) as any[])] });
    for (; !result && steps < maxSteps && !blockedNow; steps++) {
      pruneImages(messages, 3);
      const res = await claude({ max_tokens: 3000, system: systemPrompt(o, o.goal ?? ""), tools: TOOLS, messages });
      messages.push({ role: "assistant", content: res.content as any });
      if (res.stop_reason === "refusal") {
        result = { result: "blocked", blocker: "other", note: "model declined" };
        break;
      }
      const uses = res.content.filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
      if (!uses.length) {
        messages.push({ role: "user", content: "Use a tool (one action per turn), or call done." });
        continue;
      }
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const u of uses) {
        const input = u.input as any;
        log(`→ ${u.name} ${JSON.stringify(input).slice(0, 140)}`);
        if (u.name === "done") {
          result = input;
          results.push({ type: "tool_result", tool_use_id: u.id, content: "ok" });
          continue;
        }
        if (result || blockedNow) {
          results.push({ type: "tool_result", tool_use_id: u.id, content: "skipped" });
          continue;
        }
        try {
          results.push({ type: "tool_result", tool_use_id: u.id, content: (await act(u.name, input)) as any });
        } catch (e) {
          const err = (e as Error).message.split("\n")[0].slice(0, 300);
          log(`  ✗ ${err}`);
          // is_error results may only hold text, so report the error in a normal result with the fresh page state.
          results.push({ type: "tool_result", tool_use_id: u.id, content: [{ type: "text", text: `ERROR: ${err}` }, ...((await observe("State after error:")) as any[])] });
        }
      }
      if (result) break;
      const left = maxSteps - steps - 1;
      messages.push({ role: "user", content: left === 5 ? [...results, { type: "text", text: "5 actions left: finish the flow or call done." }] : results });
    }
    if (blockedNow) blockers.push(blockedNow);
    else if (!result) blockers.push("out of steps");
    else if (result.result === "blocked") blockers.push(`${result.blocker ?? "other"}${result.note ? `: ${result.note}` : ""} at ${b.page.url()}`);

    if (code && channel === "none") channel = "email-code";
    if (code && channel === "email-code") verified = true;

    let loggedIn = false;
    if (result?.result === "logged_in" && !blockedNow) {
      const passwordFields = await b.page.locator('input[type="password"]').filter({ visible: true }).count();
      const url = b.page.url();
      loggedIn = passwordFields === 0 || !/(login|sign-?in|signup|register)/i.test(url);
      if (loggedIn && o.mode === "signup" && !verified) {
        // Many sites let you in first and send the confirmation mail anyway: open its link now.
        const f = await waitForVerification({ after: startedAt, to: o.email, site: o.url, timeoutMs: 60_000, exclude: usedMail });
        if (f?.link) {
          log("  ✉️ opening the confirmation link that arrived after signup");
          await b.page.goto(f.link, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
          await b.settle(2500);
          verified = true;
          channel = "email-link";
        }
      }
      if (result.account_url) {
        await b.page.goto(new URL(result.account_url, url).toString(), { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
        await b.settle(2500);
      }
      if (loggedIn) {
        await saveSession(o.name, o.url, b.ctx, b.exchanges, {
          page: b.page,
          markers: [o.email, o.username ?? "", o.displayName ?? "clify agent"],
          probeUrl: result.account_url ? new URL(result.account_url, url).toString() : b.page.url(),
        });
        log("🔑 signed in, session saved to the vault");
      } else blockers.push(`model reported logged_in but the page still shows a login form (${url})`);
    }
    const finalUrl = b.page.url();
    const blockedShot = blockers.length ? saveShot(o.name, await b.screenshot()) : undefined;
    await b.close();
    // The proof that matters: the saved session works over plain HTTP, browser closed.
    const session = loggedIn ? await checkSession(o.name) : undefined;
    return {
      ok: loggedIn && !!session?.valid,
      loggedIn,
      signedUp: o.mode === "signup" && loggedIn,
      verified,
      verificationChannel: channel,
      blockers,
      steps,
      finalUrl,
      session,
      note: result?.note,
      ...(blockedShot ? { blockedShot } : {}),
    };
  } finally {
    await b.close();
  }
}

// Keep only the newest n screenshots in the transcript (cost and context).
function pruneImages(messages: Anthropic.MessageParam[], keep: number) {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user" || typeof m.content === "string") continue;
    for (const block of m.content as any[]) {
      const lists = block.type === "tool_result" && Array.isArray(block.content) ? [block.content] : block.type === "image" ? [[block]] : [];
      for (const list of lists) {
        for (let j = list.length - 1; j >= 0; j--) {
          if (list[j].type !== "image") continue;
          if (++seen > keep) list[j] = { type: "text", text: "[older screenshot removed]" };
        }
      }
      if (block.type === "image" && seen > keep) {
        block.type = "text";
        block.text = "[older screenshot removed]";
        delete block.source;
      }
    }
  }
}

// ── Signup with the agent identity ───────────────────────────────────────
export function makeUsername(site: string): string {
  return `clifyagent${crypto.randomBytes(3).toString("hex")}`;
}

export interface SignupOutcome extends AuthFlowResult {
  site: string;
  email: string;
  terms: TermsResult;
}

export async function signup(o: {
  name: string;
  url: string;
  email: string;
  password: string;
  username: string;
  displayName: string;
  phone?: string;
  termsUrl?: string;
  skipTerms?: boolean;
  maxSteps?: number;
  goal?: string;
}): Promise<SignupOutcome> {
  if (isSocialNetwork(o.url)) {
    const terms = { allowed: false, checked: [], reason: "real-identity social network: no agent accounts (owner's rule)" };
    return { site: o.name, email: o.email, terms, ok: false, loggedIn: false, signedUp: false, verified: false, blockers: ["social-network"], steps: 0 };
  }
  const prev = getSite(o.name);
  let terms: TermsResult;
  if (o.skipTerms && prev?.terms?.allowed) terms = { allowed: true, checked: [prev.terms.url ?? ""], reason: "checked earlier", url: prev.terms.url };
  else {
    log(`📜 reading ${new URL(o.url).hostname} terms…`);
    const tb = new AuthBrowser();
    await tb.open();
    try {
      terms = await checkTerms(o.url, { termsUrl: o.termsUrl, browser: tb });
    } finally {
      await tb.close();
    }
    log(`📜 terms: ${terms.allowed ? "allowed" : "NOT allowed"} — ${terms.reason}`);
    setSite(o.name, { terms: { allowed: terms.allowed, url: terms.url, quote: terms.quote, checkedAt: new Date().toISOString() } });
  }
  if (!terms.allowed) {
    return { site: o.name, email: o.email, terms, ok: false, loggedIn: false, signedUp: false, verified: false, blockers: [`terms: ${terms.reason}`], steps: 0 };
  }
  // Store the credentials before anything is submitted, so a crash never loses an account.
  setSite(o.name, {
    email: o.email,
    username: o.username,
    password: o.password,
    origin: new URL(o.url).origin,
    signupUrl: o.url,
    createdBy: "agent",
    accountState: "attempted",
    createdAt: new Date().toISOString(),
  });
  const r = await runAuthFlow({ name: o.name, url: o.url, mode: "signup", email: o.email, password: o.password, username: o.username, displayName: o.displayName, phone: o.phone, maxSteps: o.maxSteps, goal: o.goal });
  if (r.loggedIn) setSite(o.name, { accountState: "created" });
  return { site: o.name, email: o.email, terms, ...r };
}

export { inspect, siteRoot };
