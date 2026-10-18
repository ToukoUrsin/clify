// Encrypted credential vault. Everything secret clify keeps lives here, never
// in plain files: site logins (the user's own or accounts the agent created),
// 2FA (TOTP) secrets, saved sessions (cookies, bearer and refresh tokens) and
// the agent's identity (its email inbox and phone number).
//
//   $CLIFY_HOME/vault.enc   AES-256-GCM, one JSON document, mode 0600
//
// The 32-byte key comes from, in order:
//   1. CLIFY_VAULT_KEY (base64 key, or any passphrase -> scrypt)
//   2. the macOS Keychain (service "clify-vault"), created on first use
//   3. the Linux Secret Service via `secret-tool`, created on first use
//   4. $CLIFY_HOME/vault.key (0600), only when no OS keystore exists
// Agents never see vault contents: commands only report which fields are set.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOME } from "./store.ts";
import type { Session } from "./types.ts";

export interface SiteSecret {
  username?: string;
  password?: string;
  totp?: string; // base32 secret or otpauth:// URI
  recoveryCodes?: string[]; // 2FA recovery codes (never shown to the model)
  email?: string; // address the account is registered with
  phone?: string;
  origin?: string;
  createdBy?: "user" | "agent"; // "agent" = clify created this account
  accountState?: "created" | "attempted"; // agent signups: "attempted" = stopped before the account was confirmed
  createdAt?: string;
  session?: Session;
  storage?: unknown; // browser storage state (cookies + localStorage) to resume in a browser
  tokens?: StoredToken[]; // auth tokens the web app keeps in localStorage/sessionStorage
  refresh?: RefreshRecipe; // how the web app renews its access token
  probe?: Probe; // a GET that only works when signed in (the account's own profile)
  loginUrl?: string;
  signupUrl?: string;
  terms?: { allowed: boolean; url?: string; quote?: string; checkedAt: string };
  history?: { at: string; event: string }[];
}

export interface StoredToken {
  where: "localStorage" | "sessionStorage";
  origin: string;
  key: string;
  path?: string; // dot path inside a JSON value, e.g. "auth.accessToken"
  value: string;
  kind: "access" | "refresh" | "id" | "token";
  exp?: number; // JWT expiry (unix seconds)
  header?: string; // request header the app sent it in (e.g. "authorization")
  scheme?: string; // e.g. "Bearer "
}

export interface RefreshRecipe {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string; // with {{refresh_token}} where the refresh token goes
  contentType?: string;
  accessPath?: string; // where the new access token is in the JSON reply
  refreshPath?: string;
}

export interface Probe {
  url: string;
  marker?: string; // text the reply must contain (the account's email/username)
}

export interface Identity {
  name?: string; // display name used on signups
  email?: string;
  emailProvider?: "primitive" | "inkbox";
  phone?: string;
  phoneProvider?: "inkbox";
  apiKeys?: Record<string, string>; // provider -> API key
  inboxId?: string;
  phoneId?: string;
  handle?: string; // Inkbox agent handle
  aliasDomain?: string; // catch-all domain for per-site addresses (Primitive), e.g. fine-vale.primitive.email
}

interface VaultData {
  v: 1;
  identity?: Identity;
  sites: Record<string, SiteSecret>;
}

export const VAULT_FILE = path.join(HOME, "vault.enc");
const SERVICE = "clify-vault";

let cachedKey: { key: Buffer; store: string } | null = null;

function tryExec(cmd: string, args: string[], input?: string): string | null {
  try {
    return execFileSync(cmd, args, { input, stdio: ["pipe", "pipe", "ignore"], encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function hasCmd(cmd: string): boolean {
  return tryExec("/bin/sh", ["-c", `command -v ${cmd}`]) !== null;
}

export function vaultKey(): { key: Buffer; store: string } {
  if (cachedKey) return cachedKey;
  const env = process.env.CLIFY_VAULT_KEY;
  if (env) {
    const raw = Buffer.from(env, "base64");
    const key = raw.length === 32 && raw.toString("base64") === env ? raw : crypto.scryptSync(env, "clify-vault-v1", 32);
    return (cachedKey = { key, store: "env" });
  }
  const account = os.userInfo().username;
  const fresh = crypto.randomBytes(32).toString("base64");
  if (process.platform === "darwin" && hasCmd("security")) {
    let k = tryExec("security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"]);
    if (!k) {
      tryExec("security", ["add-generic-password", "-s", SERVICE, "-a", account, "-w", fresh, "-U"]);
      k = tryExec("security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"]);
    }
    if (k) return (cachedKey = { key: Buffer.from(k, "base64"), store: "macos-keychain" });
  }
  if (process.platform === "linux" && hasCmd("secret-tool")) {
    let k = tryExec("secret-tool", ["lookup", "service", SERVICE, "account", account]);
    if (!k) {
      tryExec("secret-tool", ["store", "--label", "clify vault key", "service", SERVICE, "account", account], fresh);
      k = tryExec("secret-tool", ["lookup", "service", SERVICE, "account", account]);
    }
    if (k) return (cachedKey = { key: Buffer.from(k, "base64"), store: "secret-service" });
  }
  const kf = path.join(HOME, "vault.key");
  fs.mkdirSync(HOME, { recursive: true });
  if (!fs.existsSync(kf)) fs.writeFileSync(kf, fresh + "\n", { mode: 0o600 });
  return (cachedKey = { key: Buffer.from(fs.readFileSync(kf, "utf8").trim(), "base64"), store: "key-file" });
}

export function readVault(): VaultData {
  if (!fs.existsSync(VAULT_FILE)) return { v: 1, sites: {} };
  const box = JSON.parse(fs.readFileSync(VAULT_FILE, "utf8"));
  const d = crypto.createDecipheriv("aes-256-gcm", vaultKey().key, Buffer.from(box.iv, "base64"));
  d.setAuthTag(Buffer.from(box.tag, "base64"));
  try {
    const plain = Buffer.concat([d.update(Buffer.from(box.data, "base64")), d.final()]);
    return JSON.parse(plain.toString("utf8"));
  } catch {
    throw new Error(`cannot decrypt ${VAULT_FILE}: wrong vault key`);
  }
}

export function writeVault(v: VaultData): void {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", vaultKey().key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(v), "utf8"), c.final()]);
  const box = { v: 1, alg: "aes-256-gcm", iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
  fs.mkdirSync(HOME, { recursive: true });
  const tmp = VAULT_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(box) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, VAULT_FILE);
}

// Cross-process lock around read-modify-write (parallel signups share one vault).
function withLock<T>(fn: () => T): T {
  fs.mkdirSync(HOME, { recursive: true });
  const lock = VAULT_FILE + ".lock";
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 30000) fs.rmSync(lock, { recursive: true, force: true }); // stale
      } catch {
        /* gone */
      }
      if (Date.now() > deadline) throw new Error("vault is locked by another clify process");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

export function getSite(name: string): SiteSecret | null {
  return readVault().sites[name] ?? null;
}

export function setSite(name: string, patch: Partial<SiteSecret>): SiteSecret {
  return withLock(() => {
  const v = readVault();
  const next = { ...(v.sites[name] ?? {}), ...patch };
  for (const k of Object.keys(next) as (keyof SiteSecret)[]) if (next[k] === undefined || next[k] === "") delete next[k];
  v.sites[name] = next;
  writeVault(v);
  return next;
  });
}

export function removeSite(name: string): boolean {
  return withLock(() => {
    const v = readVault();
    if (!v.sites[name]) return false;
    delete v.sites[name];
    writeVault(v);
    return true;
  });
}

export function listSiteSecrets(): Record<string, SiteSecret> {
  return readVault().sites;
}

export function addHistory(name: string, event: string): void {
  const h = getSite(name)?.history ?? [];
  setSite(name, { history: [...h, { at: new Date().toISOString(), event }].slice(-30) });
}

export function getIdentity(): Identity | null {
  return readVault().identity ?? null;
}

export function setIdentity(patch: Partial<Identity>): Identity {
  return withLock(() => {
    const v = readVault();
    v.identity = { ...(v.identity ?? {}), ...patch, apiKeys: { ...(v.identity?.apiKeys ?? {}), ...(patch.apiKeys ?? {}) } };
    writeVault(v);
    return v.identity;
  });
}

// What an agent may see: which secrets exist, never their values.
export function describeSite(name: string, s: SiteSecret) {
  return {
    site: name,
    ...(s.username ? { username: s.username } : {}),
    ...(s.email ? { email: s.email } : {}),
    hasPassword: !!s.password,
    has2fa: !!s.totp,
    ...(s.recoveryCodes?.length ? { recoveryCodes: s.recoveryCodes.length } : {}),
    loggedIn: !!(s.session && (s.session.cookies?.length || Object.keys(s.session.headers ?? {}).length)),
    ...(s.session?.updatedAt ? { sessionUpdatedAt: s.session.updatedAt } : {}),
    ...(s.origin ? { origin: s.origin } : {}),
    ...(s.tokens?.length ? { storedTokens: s.tokens.map((t) => `${t.kind}:${t.key}${t.path ? "." + t.path : ""}`) } : {}),
    canRefresh: !!s.refresh,
    ...(s.probe ? { probe: s.probe.url } : {}),
    hasAccount: !!(s.password || s.session),
    ...(s.createdBy ? { createdBy: s.createdBy } : {}),
    ...(s.accountState ? { accountState: s.accountState } : {}),
    ...(s.terms && !s.terms.allowed ? { termsBlocked: true } : {}),
    ...(s.createdAt ? { createdAt: s.createdAt } : {}),
  };
}

export function describeIdentity(i: Identity | null) {
  if (!i) return null;
  return {
    ...(i.name ? { name: i.name } : {}),
    ...(i.handle ? { handle: i.handle } : {}),
    ...(i.email ? { email: i.email, emailProvider: i.emailProvider } : {}),
    ...(i.aliasDomain ? { perSiteEmail: `<site>@${i.aliasDomain}` } : {}),
    phone: i.phone ?? null,
    ...(i.phone ? { phoneProvider: i.phoneProvider } : {}),
    providers: Object.keys(i.apiKeys ?? {}),
  };
}

// A strong password for accounts the agent creates. Mixed classes so most
// password rules accept it.
export function generatePassword(): string {
  const raw = crypto.randomBytes(18).toString("base64url");
  return `${raw.slice(0, 20)}-Aa9!`;
}
