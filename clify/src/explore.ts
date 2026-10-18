// Phase 1: a Claude agent drives headless Chrome through a site like a power
// user while the recorder captures the HTTP calls behind each action. Without
// an account it uses public features only. With the user's own credentials it
// logs in first (that form submit is the one write let through) and saves the
// session; with a logged-in storage state (from the accounts module) it starts
// signed in. It never touches CAPTCHAs, obeys robots.txt for navigation, and
// every other write is held back (recorded for the CLI, never sent) unless the
// run explicitly allows writes. On real-identity social networks writes are
// always held.
//
// A scripted run (o.script) executes a fixed action list instead of the model:
// deterministic, used for fixtures, tests and repeatable demos.
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import { detectBlocker } from "./blockers.ts";
import { SiteBrowser } from "./browser.ts";
import { checkModel, client, MODEL, withRetry } from "./llm.ts";
import { isSocialNetwork, robotsFor, type Robots } from "./policy.ts";
import { log, siteFile } from "./store.ts";
import { saveSession } from "./session.ts";
import type { Credentials, Exchange } from "./types.ts";

export interface ScriptStep {
  tool: string; // fill_login | click | type | select | goto | scroll | back | press | logged_in
  input: Record<string, any>; // same inputs as the model's tools; may use `selector` instead of `i`
}

export interface ExploreOptions {
  name: string;
  url: string;
  goal?: string;
  maxSteps?: number;
  credentials?: Credentials; // the user's own existing account
  storageState?: string; // start logged in (Playwright storage-state file)
  allowWrites?: boolean; // send writes instead of holding them (never on social networks)
  robots?: Robots; // default: fetched from the site
  maxSeconds?: number; // wall-clock budget for model-driven runs
  script?: ScriptStep[];
  append?: boolean; // add to an existing recording.jsonl instead of replacing it
}

export interface ExploreResult {
  exchanges: Exchange[];
  held: Exchange[];
  summary: string;
  stoppedFor?: string; // "captcha", "needs-account", ...
  loggedIn: boolean;
  blockers: string[];
  steps: number;
}

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "fill_login",
    description:
      "Fill the visible username/email and password fields with the user's existing account. Credentials stay local and are never shown to you. Set submit=true only to submit that login form; never use this for account creation or settings.",
    input_schema: {
      type: "object",
      properties: {
        submit: { type: "boolean" },
        submit_selector: { type: "string", description: "Optional CSS selector for the login submit button." },
      },
    },
  },
  {
    name: "click",
    description:
      "Click element number i. intent = what this does for a user ('search by keyword', 'open item detail', 'next page'); it labels the API calls it triggers. Requests that create/change/delete data are held back: recorded, never sent. login_submit=true only on the button that submits the login form with the user's credentials (lets that one request through).",
    input_schema: {
      type: "object",
      properties: { i: { type: "integer" }, intent: { type: "string" }, login_submit: { type: "boolean" } },
      required: ["i", "intent"],
    },
  },
  {
    name: "type",
    description:
      "Type text into input i (replaces its value). {{username}} and {{password}} expand to the user's credentials (you never see them). submit=true presses Enter afterwards; set login_submit=true too when that submits the login form.",
    input_schema: {
      type: "object",
      properties: {
        i: { type: "integer" },
        text: { type: "string" },
        submit: { type: "boolean" },
        intent: { type: "string" },
        login_submit: { type: "boolean" },
      },
      required: ["i", "text"],
    },
  },
  {
    name: "select",
    description: "Choose an option (by visible text) in select element i.",
    input_schema: {
      type: "object",
      properties: { i: { type: "integer" }, option: { type: "string" }, intent: { type: "string" } },
      required: ["i", "option"],
    },
  },
  {
    name: "goto",
    description: "Navigate to a URL on the site.",
    input_schema: { type: "object", properties: { url: { type: "string" }, intent: { type: "string" } }, required: ["url"] },
  },
  {
    name: "scroll",
    description: "Scroll down or up (loads lazy content).",
    input_schema: { type: "object", properties: { direction: { type: "string", enum: ["down", "up"] } }, required: ["direction"] },
  },
  { name: "back", description: "Browser back.", input_schema: { type: "object", properties: {} } },
  {
    name: "press",
    description: "Press a key (Enter, Escape, Tab, ArrowDown...).",
    input_schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  },
  {
    name: "logged_in",
    description: "Call once the login with the user's credentials worked (you see their account/dashboard). Saves the session for the CLI. verify='auto' requires common signed-in evidence before saving.",
    input_schema: { type: "object", properties: { verify: { type: "string", enum: ["auto"] } } },
  },
  {
    name: "done",
    description:
      "Finish. summary = the capabilities you exercised. stopped_for = 'captcha' if a CAPTCHA/bot check blocked an important path, 'needs-account' if the useful features need a login.",
    input_schema: {
      type: "object",
      properties: { summary: { type: "string" }, stopped_for: { type: "string", enum: ["captcha", "needs-account", "other"] } },
      required: ["summary"],
    },
  },
];

function systemPrompt(o: ExploreOptions, hasCreds: boolean, sendWrites: boolean, social: boolean): string {
  const account = o.storageState
    ? "You are already signed in with the account clify holds for this site. Exercise the signed-in features too (the user's own items, lists, history, settings pages as reads). Never change account settings, never delete the account."
    : hasCreds
      ? "The user gave you their own existing account. Use fill_login first; credentials stay local and are never shown to you. Set submit=true only for the site's login form, then call logged_in once you see the account/dashboard. Never create an account and never change account settings."
      : "Public features only: never log in and never create an account. If the useful features all need a login, call done with stopped_for='needs-account'.";
  const writes = social
    ? "This is a real-identity social network: never post, comment, like, follow, message or change anything. Only read."
    : sendWrites
      ? "Writes ARE sent in this run (the user allowed it). Exercise the core write actions once each on your own content only (create, edit, then delete a test item named 'clify test'). Never pay, never message or invite other people, never post publicly, never delete anything you did not create."
      : "Writes are held: any request a click would send to create/change/delete data is recorded and never sent, so you may click the core write actions (add to cart, save, create, submit a form) once each so the CLI learns their shape. Never pay and never message other people.";
  return `You are clify's explorer. You drive a headless Chrome through a website so a command-line tool can be generated from the HTTP requests behind its buttons. Another agent will use that CLI instead of a browser, so every capability you exercise becomes a command.

Rules
1. ${account}
2. CAPTCHAs and bot checks: never interact with them or try to get past them. If one blocks a path, use other features; if it blocks everything, call done with stopped_for='captcha'.
3. ${writes}
4. Stay on this site. Pages the site's robots.txt disallows are blocked; pick another path when that happens.

What to cover (each at least once, every action with a clear intent label, because intents name the commands):
- the core read feature: keyword search (use a realistic query that returns results), then each filter/facet, sort order, and page 2 of results
- open 2 different detail pages (item, article, product, profile, package...) so the URL pattern is clear
- secondary listings: categories, tags, latest/top lists, related items, autocomplete/suggest as you type
- downloads/exports or "view as JSON/API" links if the site offers them; a link to public API docs is a great find: open it
- the signed-in user's own data when signed in
Skip marketing, blog, careers, pricing, legal and help-center pages. Dismiss cookie banners (reject optional cookies). Prefer typing into search boxes and pressing Enter (type with submit=true) over guessing URLs; goto is fine for URL patterns you already saw.

Call done when the main capabilities are covered or you are nearly out of actions.${o.goal ? `\n\nThe user's goal for this CLI: ${o.goal}. Make sure every action for it is exercised first.` : ""}

After each action you get the URL, numbered elements, the API calls it triggered and a screenshot. One action per turn, no narration.`;
}

export async function explore(o: ExploreOptions): Promise<ExploreResult> {
  const maxSteps = o.maxSteps ?? 40;
  const creds = o.credentials;
  const hasCreds = !!(creds?.username && creds?.password);
  const social = isSocialNetwork(o.url);
  const sendWrites = !!o.allowWrites && !social;
  const robots = o.robots ?? (o.script ? undefined : await robotsFor(o.url));
  const b = new SiteBrowser(o.url, { robots, sendWrites });
  await b.open(o.storageState);
  if (o.storageState) b.withSession = true;
  let steps = 0;
  let summary = "";
  let stoppedFor: string | undefined;
  let loggedIn = false;
  const blockers: string[] = [];

  // Credentials are substituted here, locally; the model only ever sees the placeholders.
  const expand = (t: string) => (creds ? t.replaceAll("{{username}}", creds.username).replaceAll("{{password}}", creds.password) : t);
  const target = (input: any) => (input.selector ? b.page.locator(input.selector).filter({ visible: true }).first() : b.locator(input.i));

  const observe = async (note: string): Promise<Anthropic.Beta.BetaToolResultBlockParam["content"]> => {
    await b.settle(o.script ? 300 : 1000);
    const els = await b.elements();
    const calls = b.newExchanges().filter((e) => e.resourceType !== "document" || e.method !== "GET");
    const blocker = await detectBlocker(b.page, { visibleOnly: true });
    if (blocker) blockers.push(`${blocker} at ${b.page.url()}`);
    const lines = [
      note,
      `URL: ${b.page.url()}`,
      `Title: ${await b.page.title().catch(() => "")}`,
      blocker ? `⚠ ${blocker} on this page: do not interact with it (rule 2).` : "",
      calls.length
        ? `API calls triggered (${calls.length}):\n` +
          calls
            .slice(0, 15)
            .map((e) => `  ${e.method} ${e.url.slice(0, 140)} → ${e.status} ${e.contentType?.split(";")[0] ?? ""} ${e.responseSample?.length ?? 0}B`)
            .join("\n")
        : "No XHR calls (server-rendered page: the page request itself is the API).",
      b.held.length ? `Held writes so far: ${b.held.length}` : "",
      "Elements:",
      els
        .map(
          (e) =>
            `[${e.i}] ${e.tag}${e.type ? `:${e.type}` : ""}${e.role ? `(${e.role})` : ""} "${e.label}"${e.value ? ` =${e.value}` : ""}${
              e.href ? ` → ${e.href}` : ""
            }${e.options ? ` options:${e.options.join("|").slice(0, 200)}` : ""}${e.disabled ? " (disabled)" : ""}`,
        )
        .join("\n"),
    ].filter(Boolean);
    if (o.script) return [{ type: "text", text: lines.join("\n").slice(0, 14000) }];
    const shot = await b.screenshot();
    return [
      { type: "text", text: lines.join("\n").slice(0, 14000) },
      ...(shot ? [{ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: shot } }] : []),
    ];
  };

  const act = async (name: string, input: any): Promise<Anthropic.Beta.BetaToolResultBlockParam["content"] | string> => {
    const login = !!input.login_submit && hasCreds && !loggedIn;
    switch (name) {
      case "fill_login": {
        if (!hasCreds) return "No credentials were given; stay on public features.";
        const userSelector =
          input.username_selector ||
          'input[autocomplete="username"], input[type="email"], input[name*="user" i], input[name*="email" i], input[id*="user" i], input[id*="email" i]';
        const passSelector = input.password_selector || 'input[type="password"]';
        const userLoc = b.page.locator(userSelector).filter({ visible: true }).first();
        const passLoc = b.page.locator(passSelector).filter({ visible: true }).first();
        if ((await userLoc.count()) === 0 || (await passLoc.count()) === 0) return "Could not find visible username/email and password fields.";
        b.setAction("fill login", false);
        await userLoc.fill(expand("{{username}}"), { timeout: 6000 });
        await passLoc.fill(expand("{{password}}"), { timeout: 6000 });
        if (input.submit) {
          b.setAction("submit login", true);
          if (input.submit_selector) await b.page.locator(input.submit_selector).filter({ visible: true }).first().click({ timeout: 8000 });
          else await passLoc.press("Enter");
        }
        return observe(input.submit ? "Filled and submitted the existing-account login form." : "Filled the existing-account login form.");
      }
      case "click": {
        b.setAction(input.intent ?? "click", login);
        const loc = target(input);
        await loc.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
        await loc.click({ timeout: 8000 });
        return observe(`Clicked [${input.i ?? input.selector}].`);
      }
      case "type": {
        b.setAction(input.intent ?? "type", login && !!input.submit);
        const loc = target(input);
        await loc.fill(expand(String(input.text)), { timeout: 6000 });
        if (input.submit) await loc.press("Enter");
        return observe(`Typed into [${input.i ?? input.selector}]${input.submit ? " and pressed Enter" : ""}.`);
      }
      case "select":
        b.setAction(input.intent ?? "select");
        await target(input).selectOption({ label: input.option }, { timeout: 6000 });
        return observe(`Selected "${input.option}".`);
      case "goto": {
        b.setAction(input.intent ?? "navigate");
        const url = new URL(input.url, b.page.url() || o.url).toString();
        if (!o.script && !sameSite(url, o.url)) return `${url} is on another site; stay on ${new URL(o.url).hostname}.`;
        if (robots && !robots.allowed(url)) return `robots.txt disallows ${new URL(url).pathname}; choose another page.`;
        await b.page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        return observe(`Opened ${url}.`);
      }
      case "scroll":
        await b.page.mouse.wheel(0, input.direction === "up" ? -1600 : 1600);
        return observe(`Scrolled ${input.direction}.`);
      case "back":
        await b.page.goBack({ timeout: 15000 }).catch(() => {});
        return observe("Went back.");
      case "press":
        await b.page.keyboard.press(input.key);
        return observe(`Pressed ${input.key}.`);
      case "logged_in":
        if (!hasCreds) return "No credentials were given; stay on public features.";
        if (input.verify === "auto") {
          const url = b.page.url();
          const passwordFields = await b.page.locator('input[type="password"]').filter({ visible: true }).count();
          const text = (await b.visibleText(3500)).toLowerCase();
          const signedInMarker = /dashboard|account|profile|sign out|log out|logout|welcome/.test(text) || (!/login|sign-in|signin/.test(url) && passwordFields === 0);
          const failureMarker = /invalid|incorrect|failed|try again|unable to sign/.test(text);
          if (!signedInMarker || failureMarker) return "Could not verify a signed-in account; session was not saved.";
        }
        await saveSession(o.name, o.url, b.ctx, b.exchanges);
        loggedIn = true;
        b.withSession = true;
        log("🔑 logged in, session saved");
        return "Session saved. Continue exploring as the logged-in user.";
      default:
        return `Unknown tool ${name}`;
    }
  };

  log(`🌐 ${o.url}`);
  await b.page.goto(o.url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => log(`goto: ${e.message}`));

  try {
    if (o.script) {
      await observe("Initial page."); // runs the blocker check on the start page too
      for (const step of o.script) {
        if (blockers.some((x) => /^(captcha|bot-check)/.test(x))) {
          log("  ⛔ CAPTCHA/bot check on the page: stopping this flow, not interacting with it");
          break;
        }
        log(`→ ${step.tool} ${JSON.stringify(step.input).slice(0, 140)}`);
        try {
          await act(step.tool, step.input);
        } catch (e) {
          const err = (e as Error).message.split("\n")[0].slice(0, 200);
          log(`  ✗ ${err}`);
          blockers.push(`step failed: ${step.tool} ${JSON.stringify(step.input).slice(0, 80)}: ${err}`);
        }
      }
      summary = "scripted run";
    } else {
      if (robots && !robots.allowed(o.url)) {
        blockers.push(`robots.txt disallows ${o.url}`);
        summary = "robots.txt disallows the start page";
      } else
        await driveModel(o, systemPrompt(o, hasCreds, sendWrites, social), maxSteps, observe, act, (s, f, n) => {
          summary = s;
          stoppedFor = f;
          steps = n;
        });
    }
  } finally {
    // Refresh the session at the end too: SPAs often mint tokens after login.
    if (loggedIn || o.storageState) await saveSession(o.name, o.url, b.ctx, b.exchanges).catch(() => {});
    const all = [...b.exchanges, ...b.held];
    const file = siteFile(o.name, "recording.jsonl");
    // Secrets never reach the recording: cookie/auth/CSRF header values are redacted
    // (the live session is saved separately, encrypted, in the vault).
    const SECRET_KEY = /pass|secret|token|otp|csrf|xsrf|session|auth(?!or)|credential|pin\b/i;
    // Bodies that look form-encoded but aren't (e.g. a bare "%") must not abort the save.
    const safeDecode = (k: string): string => {
      try {
        return decodeURIComponent(k);
      } catch {
        return k;
      }
    };
    const redactBody = (body?: string): string | undefined => {
      if (!body) return body;
      let out = body;
      if (creds?.password) out = out.split(creds.password).join("<redacted>").split(encodeURIComponent(creds.password)).join("<redacted>");
      if (/^\s*[{[]/.test(out)) out = out.replace(/("([\w-]*)"\s*:\s*)"[^"]*"/g, (m, pre, k) => (SECRET_KEY.test(k) ? `${pre}"<redacted>"` : m));
      else if (/^[^=&\s]+=[^&]*(&|$)/.test(out)) out = out.replace(/(^|&)([^=&]+)=([^&]*)/g, (m, sep, k) => (SECRET_KEY.test(safeDecode(k)) ? `${sep}${k}=%3Credacted%3E` : m));
      return out;
    };
    const redact = (x: Exchange): Exchange => ({
      ...x,
      requestBody: redactBody(x.requestBody),
      requestHeaders: Object.fromEntries(Object.entries(x.requestHeaders ?? {}).map(([k, v]) => [k, /^(cookie|authorization|proxy-authorization)$|token|csrf|xsrf|session|api-?key|secret/i.test(k) ? "<redacted>" : v])),
    });
    (o.append ? fs.appendFileSync : fs.writeFileSync)(file, all.map((x) => JSON.stringify(redact(x))).join("\n") + "\n", { mode: 0o600 });
    await b.close();
  }
  if (hasCreds && !loggedIn) blockers.push("login with the supplied account did not complete");
  if (o.script) steps = o.script.length;
  if (stoppedFor && stoppedFor !== "other" && !blockers.some((x) => x.startsWith(stoppedFor!))) blockers.push(stoppedFor);
  log(`📼 recorded ${b.exchanges.length} calls, ${b.held.length} held writes${blockers.length ? `, blockers: ${blockers.join("; ")}` : ""}`);
  return { exchanges: b.exchanges, held: b.held, summary, stoppedFor, loggedIn: loggedIn || !!o.storageState, blockers: [...new Set(blockers)], steps };
}

function sameSite(a: string, b: string): boolean {
  const root = (u: string) => new URL(u).hostname.split(".").slice(-2).join(".");
  try {
    return root(a) === root(b);
  } catch {
    return false;
  }
}

type Observe = (note: string) => Promise<Anthropic.Beta.BetaToolResultBlockParam["content"]>;
type Act = (name: string, input: any) => Promise<Anthropic.Beta.BetaToolResultBlockParam["content"] | string>;

async function driveModel(o: ExploreOptions, system: string, maxSteps: number, observe: Observe, act: Act, finish: (summary: string, stoppedFor: string | undefined, steps: number) => void) {
  const deadline = Date.now() + (o.maxSeconds ?? 900) * 1000;
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: [{ type: "text", text: `Start URL: ${o.url}. You have ${maxSteps} actions.` }, ...((await observe("Initial page.")) as any[])] },
  ];
  for (let step = 0; step < maxSteps; step++) {
    if (Date.now() > deadline) return finish("out of time", undefined, step);
    const res = await withRetry(async () =>
      checkModel(await client.beta.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system,
        tools: TOOLS,
        messages,
        output_config: { effort: "medium" },
        betas: ["context-management-2025-06-27"],
        context_management: {
          edits: [
            {
              type: "clear_tool_uses_20250919",
              trigger: { type: "input_tokens", value: 50000 },
              keep: { type: "tool_uses", value: 4 },
              clear_at_least: { type: "input_tokens", value: 15000 },
            },
          ],
        },
      } as any)),
    );
    messages.push({ role: "assistant", content: res.content as any });
    if (res.stop_reason === "refusal") return finish("model stopped", "other", step);
    const uses = res.content.filter((c): c is Anthropic.Beta.BetaToolUseBlock => c.type === "tool_use");
    if (!uses.length) return finish("model ended without done", undefined, step);
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    let finished = false;
    for (const u of uses) {
      const input = u.input as any;
      log(`→ ${u.name} ${JSON.stringify(input).slice(0, 140)}`);
      if (u.name === "done") {
        finish(input.summary ?? "", input.stopped_for, step + 1);
        finished = true;
        results.push({ type: "tool_result", tool_use_id: u.id, content: "ok" });
        continue;
      }
      try {
        results.push({ type: "tool_result", tool_use_id: u.id, content: (await act(u.name, input)) as any });
      } catch (e) {
        const err = (e as Error).message.split("\n")[0].slice(0, 300);
        log(`  ✗ ${err}`);
        // Error results may only carry text: send the state as text, no screenshot.
        const state = ((await observe("State after error:")) as any[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
        results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: [{ type: "text", text: `${err}\n${state}` }] });
      }
    }
    if (finished) return;
    const left = maxSteps - step - 1;
    messages.push({
      role: "user",
      content: left === 4 ? [...results, { type: "text", text: "4 actions left: cover anything important that's missing, then call done." }] : results,
    });
  }
  finish("out of actions", undefined, maxSteps);
}
