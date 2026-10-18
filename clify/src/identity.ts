// The agent's own identity: one persistent name, an email inbox (Inkbox), a
// catch-all domain for per-site addresses (Primitive) and, when one is
// provisioned, an SMS phone number (Inkbox). Provider API keys live in the
// encrypted vault; nothing here ever prints them.
//
//   clify identity init   imports INKBOX_API_KEY / PRIMITIVE_API_KEY (env, or
//                         files in ~/.config/clify-secrets) into the vault and
//                         discovers the inbox, alias domain and phone number.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getIdentity, setIdentity, type Identity } from "./vault.ts";

export const INKBOX_API = "https://inkbox.ai/api/v1";
export const PRIMITIVE_API = "https://api.primitive.dev/v1";
const SECRETS_DIR = path.join(os.homedir(), ".config", "clify-secrets");

export interface Mail {
  provider: "inkbox" | "primitive";
  id: string;
  from: string; // sender address
  fromName?: string;
  to: string[];
  subject: string;
  snippet?: string;
  text?: string;
  html?: string;
  receivedAt: string; // ISO
}

export interface Sms {
  id: string;
  from: string;
  text: string;
  receivedAt: string;
}

async function api(url: string, headers: Record<string, string>, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, { ...init, headers: { accept: "application/json", ...headers, ...(init.headers as any) }, signal: AbortSignal.timeout(45000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

function keyFromEnvOrFile(name: string): string | undefined {
  if (process.env[name]) return process.env[name]!.trim();
  const f = path.join(SECRETS_DIR, name);
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : undefined;
}

export function identity(): Identity {
  const i = getIdentity();
  if (!i?.email && !i?.aliasDomain) throw new Error("no agent identity yet; run: clify identity init");
  return i;
}

// ── Inkbox ────────────────────────────────────────────────────────────────
function inkboxHeaders(i: Identity) {
  const key = i.apiKeys?.inkbox;
  if (!key) throw new Error("no Inkbox API key in the vault; run: clify identity init");
  return { "X-API-Key": key };
}

async function inkboxList(i: Identity, after: Date): Promise<Mail[]> {
  if (!i.email || i.emailProvider !== "inkbox") return [];
  const u = new URL(`${INKBOX_API}/mail/mailboxes/${encodeURIComponent(i.email)}/messages`);
  u.searchParams.set("direction", "inbound");
  u.searchParams.set("limit", "50");
  u.searchParams.set("start_datetime", after.toISOString().replace(/\.\d+Z$/, "Z"));
  const page = await api(u.toString(), inkboxHeaders(i));
  return (page.items ?? []).map((m: any) => ({
    provider: "inkbox" as const,
    id: m.id,
    from: m.from_address,
    fromName: m.from_display_name ?? undefined,
    to: [...(m.to_addresses ?? []), ...(m.cc_addresses ?? [])],
    subject: m.subject ?? "",
    snippet: m.snippet ?? "",
    receivedAt: m.created_at,
  }));
}

async function inkboxBody(i: Identity, m: Mail): Promise<Mail> {
  const d = await api(`${INKBOX_API}/mail/mailboxes/${encodeURIComponent(i.email!)}/messages/${m.id}`, inkboxHeaders(i));
  return { ...m, text: d.body_text ?? "", html: d.body_html ?? "" };
}

// ── Primitive ─────────────────────────────────────────────────────────────
function primitiveHeaders(i: Identity) {
  const key = i.apiKeys?.primitive;
  if (!key) throw new Error("no Primitive API key in the vault; run: clify identity init");
  return { authorization: `Bearer ${key}` };
}

function primitiveRow(m: any): Mail {
  return {
    provider: "primitive",
    id: m.id,
    from: m.from_email ?? m.sender,
    fromName: m.from_header?.replace(/<.*>/, "").trim() || undefined,
    to: [...new Set<string>((m.to_addresses ?? []).map((t: any) => t.address).concat(m.recipient ? [m.recipient] : []))],
    subject: m.subject ?? "",
    snippet: m.snippet ?? "",
    receivedAt: m.received_at ?? m.created_at,
  };
}

// wait > 0 long-polls: Primitive holds the request until mail arrives past `after`.
async function primitiveList(i: Identity, after: Date, wait = 0, recipient?: string): Promise<Mail[]> {
  if (!i.aliasDomain || !i.apiKeys?.primitive) return [];
  const u = new URL(`${PRIMITIVE_API}/emails`);
  if (wait > 0) {
    u.searchParams.set("since", `${after.toISOString()}|00000000-0000-0000-0000-000000000000`);
    u.searchParams.set("wait", String(Math.min(30, wait)));
  } else {
    u.searchParams.set("date_from", after.toISOString());
    u.searchParams.set("limit", "50");
  }
  if (recipient) u.searchParams.set("recipient", recipient);
  const page = await api(u.toString(), primitiveHeaders(i));
  return (page.data ?? []).map(primitiveRow);
}

async function primitiveBody(i: Identity, m: Mail): Promise<Mail> {
  const d = await api(`${PRIMITIVE_API}/emails/${m.id}`, primitiveHeaders(i));
  const e = d.data ?? d;
  return { ...m, text: e.body_text ?? e.parsed?.text ?? "", html: e.body_html ?? e.parsed?.html ?? "" };
}

// ── Inbox facade ──────────────────────────────────────────────────────────
// Every message to any of the agent's addresses received at/after `after`, newest first.
export async function listMail(after: Date, opts: { wait?: number; to?: string } = {}): Promise<Mail[]> {
  const i = identity();
  const to = opts.to?.toLowerCase();
  const wantInkbox = !to || to === i.email?.toLowerCase();
  const wantPrimitive = !to || (!!i.aliasDomain && to.endsWith("@" + i.aliasDomain));
  const [a, b] = await Promise.all([
    wantInkbox ? inkboxList(i, after).catch(() => [] as Mail[]) : [],
    wantPrimitive ? primitiveList(i, after, opts.wait, to).catch(() => [] as Mail[]) : [],
  ]);
  return [...a, ...b]
    .filter((m) => new Date(m.receivedAt).getTime() >= after.getTime() - 1000)
    .filter((m) => !to || m.to.some((x) => x.toLowerCase() === to))
    .sort((x, y) => y.receivedAt.localeCompare(x.receivedAt));
}

export async function mailBody(m: Mail): Promise<Mail> {
  if (m.text || m.html) return m;
  const i = identity();
  return m.provider === "inkbox" ? inkboxBody(i, m) : primitiveBody(i, m);
}

// The address to register on a site with. "main" = the identity's own inbox;
// "site" = a per-site address on the catch-all domain (keeps accounts apart and
// lets verification mail be matched by recipient).
export function emailFor(site: string, which: "main" | "site" = "main"): string {
  const i = identity();
  if (which === "site" && i.aliasDomain) return `${site.toLowerCase().replace(/[^a-z0-9-]/g, "-")}@${i.aliasDomain}`;
  if (i.email) return i.email;
  return `${site}@${i.aliasDomain}`;
}

// ── SMS ───────────────────────────────────────────────────────────────────
export function hasPhone(): boolean {
  const i = getIdentity();
  return !!(i?.phone && i.phoneId);
}

export async function listSms(after: Date): Promise<Sms[]> {
  const i = identity();
  if (!i.phone || !i.phoneId) throw new Error("no phone number: the agent identity has no SMS number (Inkbox needs a paid plan for one)");
  const u = new URL(`${INKBOX_API}/phone/numbers/${i.phoneId}/texts`);
  u.searchParams.set("limit", "50");
  u.searchParams.set("start_datetime", after.toISOString().replace(/\.\d+Z$/, "Z"));
  const rows = await api(u.toString(), inkboxHeaders(i));
  return (Array.isArray(rows) ? rows : rows.items ?? [])
    .filter((t: any) => t.direction === "inbound")
    .map((t: any) => ({ id: t.id, from: t.sender_phone_number ?? t.remote_phone_number, text: t.text ?? "", receivedAt: t.created_at }));
}

// ── Setup ─────────────────────────────────────────────────────────────────
// Imports provider keys into the vault and discovers addresses. Safe to re-run
// (e.g. after a phone number is bought, it picks the number up).
export async function initIdentity(opts: { removeKeyFiles?: boolean } = {}): Promise<{ identity: Identity; imported: string[]; notes: string[] }> {
  const notes: string[] = [];
  const imported: string[] = [];
  const cur = getIdentity() ?? {};
  const keys: Record<string, string> = { ...(cur.apiKeys ?? {}) };
  for (const [prov, env] of [
    ["inkbox", "INKBOX_API_KEY"],
    ["primitive", "PRIMITIVE_API_KEY"],
  ] as const) {
    const k = keyFromEnvOrFile(env);
    if (k && k !== keys[prov]) {
      keys[prov] = k;
      imported.push(prov);
    }
  }
  const patch: Partial<Identity> = { apiKeys: keys, name: cur.name ?? "clify agent" };
  if (keys.inkbox) {
    const ids = await api(`${INKBOX_API}/identities`, { "X-API-Key": keys.inkbox });
    const list = Array.isArray(ids) ? ids : ids.items ?? [];
    const me = list.find((x: any) => x.agent_handle === cur.handle) ?? list.find((x: any) => x.status === "active") ?? list[0];
    if (me) {
      patch.handle = me.agent_handle;
      patch.email = me.email_address ?? me.mailbox?.email_address;
      patch.emailProvider = "inkbox";
      patch.inboxId = me.mailbox?.id;
      if (me.display_name) patch.name = me.display_name;
      if (me.phone_number) {
        patch.phone = me.phone_number.number ?? me.phone_number.phone_number;
        patch.phoneId = me.phone_number.id;
        patch.phoneProvider = "inkbox";
      } else notes.push("Inkbox identity has no phone number yet; SMS codes are unavailable until one is provisioned");
    } else notes.push("Inkbox key works but no identity was found");
  }
  if (keys.primitive) {
    const d = await api(`${PRIMITIVE_API}/domains`, { authorization: `Bearer ${keys.primitive}` });
    const dom = (d.data ?? []).find((x: any) => x.is_active && x.managed_zone) ?? (d.data ?? [])[0];
    if (dom) patch.aliasDomain = dom.domain;
    if (!patch.email && dom) {
      patch.email = `agent@${dom.domain}`;
      patch.emailProvider = "primitive";
    }
  }
  const saved = setIdentity(patch);
  if (opts.removeKeyFiles) {
    for (const env of ["INKBOX_API_KEY", "PRIMITIVE_API_KEY"]) {
      const f = path.join(SECRETS_DIR, env);
      if (fs.existsSync(f) && saved.apiKeys?.[env.split("_")[0].toLowerCase()]) fs.rmSync(f);
    }
  }
  return { identity: saved, imported, notes };
}
