// One call that gets the agent signed in to a site:
//   1. reuse the saved session (refresh its access token first if it is about to expire)
//   2. else log in with the vault's credentials (the user's own, or the agent's),
//      handling TOTP and emailed/SMS codes
//   3. else (mode auto/agent) sign up with the agent identity after the terms
//      check, verify by email, and save credentials + session to the vault.
// The core agent calls this from `clify add` and when a command gets a 401.
import fs from "node:fs";
import path from "node:path";
import { emailFor, identity } from "./identity.ts";
import { checkSession, ensureFresh, refreshSession, type SessionCheck } from "./session.ts";
import { makeUsername, runAuthFlow, signup, type AuthFlowResult } from "./signup.ts";
import { HOME, readJson, siteFile, writeJson, readSpec } from "./store.ts";
import { addHistory, generatePassword, getSite, setSite } from "./vault.ts";
import type { SiteSpec } from "./types.ts";

export interface EnsureResult {
  ok: boolean;
  loggedIn: boolean;
  storageState?: string; // path to a 0600 Playwright storage-state file for a browser to resume the session
  blockers: string[];
  via?: "saved-session" | "refreshed" | "login" | "signup";
  account?: { email?: string; username?: string; createdBy?: string };
  session?: SessionCheck;
  flow?: AuthFlowResult;
}

// Playwright needs a file; write it 0600 in a private dir and overwrite each time.
function writeStorageState(name: string): string | undefined {
  const st = getSite(name)?.storage;
  if (!st) return undefined;
  const dir = path.join(HOME, "run");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = path.join(dir, `${name}.storage.json`);
  fs.writeFileSync(f, JSON.stringify(st), { mode: 0o600 });
  return f;
}

function done(name: string, via: EnsureResult["via"], session: SessionCheck, flow?: AuthFlowResult): EnsureResult {
  const s = getSite(name);
  ensureMeCommand(name);
  return {
    ok: true,
    loggedIn: true,
    storageState: writeStorageState(name),
    blockers: [],
    via,
    account: { email: s?.email, username: s?.username, createdBy: s?.createdBy },
    session,
    ...(flow ? { flow } : {}),
  };
}

// Gives every signed-in site at least one CLI command: `clify <site> me`, the
// account's own profile/settings (the session probe). The core agent's specs
// are left alone; this only adds the command when it is missing.
export function ensureMeCommand(name: string): void {
  const s = getSite(name);
  if (!s?.probe || !s.origin) return;
  const file = siteFile(name, "spec.json");
  const spec = readSpec<SiteSpec>(name) ?? {
    name,
    startUrl: s.origin,
    origin: s.origin,
    createdAt: new Date().toISOString(),
    description: `${new URL(s.origin).hostname} (account created by clify's agent identity)`,
    commands: [],
  };
  if (spec.commands.some((c) => c.name === "me" || c.aliases?.includes("me"))) return;
  const u = new URL(s.probe.url);
  const json = !/\.(html?)$/.test(u.pathname) && /\/api\/|\.json|graphql|\/v\d+\//i.test(u.pathname);
  const urlTemplate = u.origin === new URL(spec.origin).origin ? u.pathname + u.search : u.toString();
  // The generated CLI may already have this request (get-account, whoami...): name it `me` too.
  const twin = spec.commands.find((c) => c.method === "GET" && !c.params.some((p) => p.required) && (c.urlTemplate === urlTemplate || c.urlTemplate === u.toString()));
  if (twin) twin.aliases = [...(twin.aliases ?? []), "me"];
  else spec.commands.push({
    name: "me",
    summary: "The signed-in account's own profile/settings (needs the saved session)",
    method: "GET",
    urlTemplate,
    params: [],
    responseType: json ? "json" : "html",
    mutates: false,
    auth: true,
    source: `GET ${s.probe.url}`,
  });
  const headerNames = new Set([...(spec.auth?.headerNames ?? []), ...Object.keys(s.session?.headers ?? {})]);
  spec.auth = { ...(spec.auth ?? {}), headerNames: [...headerNames], ...(s.loginUrl ? { loginUrl: s.loginUrl } : {}) };
  writeJson(file, spec);
}

export async function ensureAccount(opts: { name: string; url: string; mode?: "auto" | "agent" | "user"; maxSteps?: number; goal?: string }): Promise<EnsureResult> {
  const { name, url } = opts;
  const mode = opts.mode ?? "auto";
  const blockers: string[] = [];
  let sec = getSite(name);

  // 1. saved session
  if (sec?.session) {
    const fresh = await ensureFresh(name);
    let check = await checkSession(name);
    if (check.valid) return done(name, fresh.refreshed ? "refreshed" : "saved-session", check);
    if (sec.refresh && !fresh.refreshed) {
      const r = await refreshSession(name);
      if (r.ok) {
        check = await checkSession(name);
        if (check.valid) return done(name, "refreshed", check);
      }
    }
    blockers.push(`saved session not valid: ${check.reason ?? "unknown"}`);
  }

  // 2. log in with stored credentials
  sec = getSite(name);
  const owner = sec?.createdBy ?? "user";
  if (sec?.password && (sec.email || sec.username) && (mode !== "user" || owner === "user") && (mode !== "agent" || owner === "agent")) {
    const flow = await runAuthFlow({
      name,
      url: sec.loginUrl ?? url,
      mode: "login",
      email: sec.email ?? sec.username!,
      username: sec.username,
      password: sec.password,
      totpSecret: sec.totp,
      displayName: owner === "agent" ? identity().name : undefined,
      maxSteps: opts.maxSteps ?? 30,
      goal: opts.goal,
    });
    addHistory(name, `login ${flow.ok ? "ok" : "failed: " + flow.blockers.join("; ")}`);
    if (flow.ok && flow.session) return done(name, "login", flow.session, flow);
    return { ok: false, loggedIn: flow.loggedIn, blockers: [...blockers, ...flow.blockers, ...(flow.loggedIn ? [`signed in but the session does not work over HTTP: ${flow.session?.reason}`] : [])], flow, via: "login" };
  }
  if (mode === "user") return { ok: false, loggedIn: false, blockers: [...blockers, `no saved login of yours for ${name}; run: clify login ${name} --user --url <login url>`] };
  if (sec?.createdBy === "agent" && sec.accountState !== "attempted" && sec.password) return { ok: false, loggedIn: false, blockers }; // never sign up twice

  // 3. sign up with the agent identity
  const r = await signupWithIdentity({ name, url, maxSteps: opts.maxSteps });
  if (r.ok && r.session) return done(name, "signup", r.session, r);
  return { ok: false, loggedIn: r.loggedIn, blockers: [...blockers, ...r.blockers], flow: r, via: "signup" };
}

// Signs up with the identity's main inbox; if the site rejects that address,
// retries once with a per-site address on the catch-all domain.
export async function signupWithIdentity(o: { name: string; url: string; email?: "main" | "site"; termsUrl?: string; maxSteps?: number; goal?: string }) {
  const id = identity();
  const password = generatePassword();
  const username = makeUsername(o.name);
  let email = emailFor(o.name, o.email ?? "main");
  let r = await signup({ name: o.name, url: o.url, email, password, username, displayName: id.name ?? "clify agent", phone: id.phone, termsUrl: o.termsUrl, maxSteps: o.maxSteps, goal: o.goal });
  if (!r.ok && !r.loggedIn && r.blockers.some((b) => /email-rejected/.test(b)) && id.aliasDomain && email !== emailFor(o.name, "site")) {
    email = emailFor(o.name, "site");
    r = await signup({ name: o.name, url: o.url, email, password, username, displayName: id.name ?? "clify agent", phone: id.phone, skipTerms: true, maxSteps: o.maxSteps });
  }
  addHistory(o.name, `signup ${r.ok ? "ok" : "failed: " + r.blockers.join("; ")}`);
  if (!r.signedUp && r.steps === 0 && r.terms.allowed) {
    // Stopped before any action (e.g. CAPTCHA on the first page): no account exists, drop the unused credentials.
    const s = getSite(o.name);
    if (s && s.createdBy === "agent" && !s.session) setSite(o.name, { password: undefined, username: undefined, email: undefined, createdBy: undefined, createdAt: undefined });
  }
  if (r.ok) ensureMeCommand(o.name);
  return r;
}

// Completes a late email confirmation for an existing account: opens the
// newest verification link for this site in a browser resumed from the saved
// session, then re-saves the session.
export async function verifyByEmail(name: string, sinceMs = 24 * 3600_000): Promise<{ ok: boolean; subject?: string; blockers: string[] }> {
  const { AuthBrowser } = await import("./auth-browser.ts");
  const { waitForVerification } = await import("./codes.ts");
  const { saveSession } = await import("./session.ts");
  const { detectBlocker } = await import("./blockers.ts");
  const s = getSite(name);
  if (!s?.email || !s.origin) return { ok: false, blockers: [`no account for ${name}`] };
  const f = await waitForVerification({ after: new Date(Date.now() - sinceMs), to: s.email, site: s.origin, timeoutMs: 30_000 });
  if (!f?.link) return { ok: false, blockers: ["no verification link found in the inbox"] };
  const b = new AuthBrowser();
  await b.open(s.storage);
  try {
    await b.page.goto(f.link, { waitUntil: "domcontentloaded", timeout: 45000 });
    await b.settle(2500);
    const blocker = await detectBlocker(b.page);
    if (blocker) return { ok: false, subject: f.mail.subject, blockers: [`${blocker} at ${b.page.url()}`] };
    if (s.probe) {
      await b.page.goto(s.probe.url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await b.settle(1500);
    }
    await saveSession(name, s.origin, b.ctx, b.exchanges, { page: b.page, markers: [s.email, s.username ?? ""] });
    addHistory(name, `email verified via link (${f.mail.subject})`);
    return { ok: true, subject: f.mail.subject, blockers: [] };
  } finally {
    await b.close();
  }
}
