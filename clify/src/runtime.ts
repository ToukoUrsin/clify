// Executes a generated command as an HTTP request and shapes the response for
// agents. Read commands run directly. Write commands (mutates) only send with
// an explicit confirmation; without it they return a dry-run preview. The saved
// login session (the user's own account, from `clify login`) is attached only
// to requests on the site's own domain. When the site rejects the session
// (401/403 or a redirect to its login page) clify logs in again from the vault
// once and retries. The request/parse/shape code is in core.ts (shared with the
// hosted MCP server); this file adds the sessions.
import { run as runCore, type RunOptions, type RunResult, type SessionSource } from "./core.ts";
import { readJson, siteFile } from "./store.ts";
import { getSite } from "./vault.ts";
import type { CommandSpec, Session, SiteSpec } from "./types.ts";

export { buildRequest, dig, findCommand, extractHtml, present, shape, siteRoot, USER_AGENT } from "./core.ts";
export type { RunOptions, RunResult } from "./core.ts";

export function loadSession(name: string): Session | null {
  // The encrypted vault is the store; a plain session.json is only read for
  // fixtures and older installs.
  const s = getSite(name)?.session ?? readJson<Session | null>(siteFile(name, "session.json"), null);
  return s && (s.cookies?.length || Object.keys(s.headers ?? {}).length) ? s : null;
}

// Re-login uses only what the vault already holds (saved session, stored
// credentials); a failing call never creates a new account.
async function relogin(spec: SiteSpec): Promise<Session | null> {
  try {
    const sec = getSite(spec.name);
    if (!sec?.session && !sec?.password) return null;
    const { ensureAccount } = await import("./accounts.ts");
    const mode = sec.password && sec.createdBy === "agent" ? "agent" : "user";
    const r = await ensureAccount({ name: spec.name, url: spec.auth?.loginUrl || spec.startUrl, mode });
    if (!r.ok || !r.loggedIn) return null;
  } catch {
    return null;
  }
  return loadSession(spec.name);
}

const vaultSessions: SessionSource = { load: loadSession, relogin };

export function run(spec: SiteSpec, cmd: CommandSpec, raw: Record<string, string>, opts: RunOptions = {}): Promise<RunResult> {
  return runCore(spec, cmd, raw, { sessions: vaultSessions, ...opts });
}
