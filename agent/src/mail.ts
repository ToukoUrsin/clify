// Email transports. The main agent lives on Primitive (clify@<domain>,
// long-polled inbound, DMARC results on every message); the peer agent lives on
// its Inkbox mailbox. Both expose the same small interface so the agent loop
// doesn't care which one it runs on.
//
// Outbound is fenced in code: a send to any address that is neither matched by
// CLIFY_AGENT_SEND_TO nor wrote to the agent first (DMARC-verified, see
// policy.ts) is refused; those first writers get at most CLIFY_AGENT_CAP_SENDER_OUT
// mails a day, and addresses in CLIFY_AGENT_CAPPED ("addr=N,...") get at most
// N mails ever (counted on disk). cc goes only to CLIFY_AGENT_SEND_TO and to
// people who were on a verified group thread with the agent (policy.groupOf);
// they count against the same daily cap.
import fs from "node:fs";
import path from "node:path";
import { INKBOX_API, PRIMITIVE_API } from "../../clify/src/identity.ts";
import type { Identity } from "../../clify/src/vault.ts";
import { countOutbound, DEFAULT_CAPS, knownSenders, threadPeople } from "./policy.ts";

export interface Inbound {
  provider: "primitive" | "inkbox";
  id: string;
  messageId: string; // RFC 5322 Message-ID
  threadId: string;
  references: string[];
  from: string;
  fromName?: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  receivedAt: string;
  verified: boolean; // DMARC pass (Primitive); Inkbox gives no auth result, so false there
  auth?: string;
  attachments: string[];
  automated?: boolean;
  automatedReasons?: string[];
  nullSender?: boolean; // empty envelope sender: a bounce
  headers?: Record<string, string>; // the raw message's top-level headers, lower-case names
  replyToSentId?: string; // Primitive: the sent email this answers
  files?: { filename: string; data: Buffer }[]; // attachment contents, when the provider gives them
}

export interface Outbound {
  to: string;
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  attach?: string[];
  inReplyTo?: string;
  references?: string[];
}

export interface SentMail {
  provider: Inbound["provider"];
  id: string;
  messageId?: string;
  threadId?: string;
  at: string;
  to: string;
  cc?: string[];
  subject: string;
}

export interface Transport {
  address: string;
  next(): Promise<Inbound[]>; // waits (long-poll or short poll) and returns new inbound mail, oldest first
  send(m: Outbound): Promise<SentMail>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(url: string, headers: Record<string, string>, init: RequestInit = {}, timeoutMs = 60_000): Promise<any> {
  const res = await fetch(url, { ...init, headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ── Outbound fence ───────────────────────────────────────────────────────
function globToRe(g: string): RegExp {
  return new RegExp("^" + g.trim().toLowerCase().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^@\\s]*") + "$");
}

export function checkFence(stateDir: string, to: string[], subject: string, cc: string[] = []): void {
  const allow = (process.env.CLIFY_AGENT_SEND_TO || "").split(",").filter(Boolean).map(globToRe);
  const caps = Object.fromEntries(
    (process.env.CLIFY_AGENT_CAPPED || "")
      .split(",")
      .filter(Boolean)
      .map((s) => s.split("=").map((x) => x.trim().toLowerCase())),
  );
  const countsFile = path.join(stateDir, "send-caps.json");
  const counts: Record<string, number> = fs.existsSync(countsFile) ? JSON.parse(fs.readFileSync(countsFile, "utf8")) : {};
  const known = knownSenders(stateDir);
  const onThread = threadPeople(stateDir);
  const firstWriters: string[] = [];
  for (const raw of [...to, ...cc]) {
    const a = raw.toLowerCase();
    if (caps[a] !== undefined) {
      if ((counts[a] ?? 0) >= Number(caps[a])) throw new Error(`send refused: the cap of ${caps[a]} mails to ${a} is used up`);
      if (process.env.CLIFY_AGENT_CAPPED_TAG && !subject.includes(process.env.CLIFY_AGENT_CAPPED_TAG)) throw new Error(`send refused: mail to ${a} must carry "${process.env.CLIFY_AGENT_CAPPED_TAG}" in the subject`);
      continue;
    }
    if (allow.some((re) => re.test(a))) continue;
    if (to.includes(raw) ? known.has(a) : onThread.has(a)) {
      firstWriters.push(a);
      continue;
    }
    throw new Error(`send refused: ${a} is not an address this agent may email (CLIFY_AGENT_SEND_TO), and it has not written to the agent first${to.includes(raw) ? "" : " or been on a group thread with it"}`);
  }
  const outCap = Number(process.env.CLIFY_AGENT_CAP_SENDER_OUT || DEFAULT_CAPS.senderOut);
  for (const a of firstWriters) countOutbound(stateDir, a, outCap);
  for (const raw of [...to, ...cc]) {
    const a = raw.toLowerCase();
    if (caps[a] !== undefined) counts[a] = (counts[a] ?? 0) + 1;
  }
  fs.writeFileSync(countsFile, JSON.stringify(counts, null, 2));
}

function attachments(files: string[]) {
  return files.map((f) => {
    const ext = path.extname(f).toLowerCase();
    const type = { ".csv": "text/csv", ".png": "image/png", ".jpg": "image/jpeg", ".pdf": "application/pdf", ".txt": "text/plain", ".json": "application/json", ".md": "text/markdown" }[ext] ?? "application/octet-stream";
    return { filename: path.basename(f), content_type: type, content_base64: fs.readFileSync(f).toString("base64") };
  });
}

// DMARC pass (aligned SPF or DKIM). Without it a From line proves nothing.
function authPassed(auth: any): boolean {
  if (!auth) return false;
  if (auth.dmarc === "pass") return true;
  return (auth.dkimSignatures ?? []).some((s: any) => s.result === "pass" && s.aligned) || (auth.spf === "pass" && auth.dmarcSpfAligned === true);
}

// ── Primitive ────────────────────────────────────────────────────────────
export function primitive(i: Identity, address: string, stateDir: string): Transport {
  const key = i.apiKeys?.primitive;
  if (!key) throw new Error("no Primitive API key in the vault");
  const H = { authorization: `Bearer ${key}` };
  const cursorFile = path.join(stateDir, "primitive-cursor.txt");
  let cursor = fs.existsSync(cursorFile) ? fs.readFileSync(cursorFile, "utf8").trim() : `${new Date(Date.now() - 60_000).toISOString()}|00000000-0000-0000-0000-000000000000`;
  return {
    address,
    async next() {
      const u = new URLSearchParams({ since: cursor, wait: "30", recipient: address });
      let page: any;
      try {
        page = await call(`${PRIMITIVE_API}/emails?${u}`, H, {}, 50_000);
      } catch (e) {
        process.stderr.write(`primitive poll: ${(e as Error).message}\n`);
        await sleep(5000);
        return [];
      }
      const out: Inbound[] = [];
      for (const row of page?.data ?? []) {
        let d = (await call(`${PRIMITIVE_API}/emails/${row.id}`, H))?.data ?? row;
        // A just-arrived email can be unthreaded for a moment; a reply must not start a new job.
        for (let n = 0; n < 6 && !d.thread_id; n++) {
          await sleep(2000);
          d = (await call(`${PRIMITIVE_API}/emails/${row.id}`, H).catch(() => null))?.data ?? d;
        }
        const parsed = typeof d.parsed === "string" ? JSON.parse(d.parsed) : d.parsed ?? {};
        out.push({
          provider: "primitive",
          id: d.id,
          messageId: d.message_id,
          threadId: d.thread_id ?? d.id,
          references: parsed.references ?? [],
          from: String(d.from_email ?? d.sender ?? "").toLowerCase(),
          fromName: d.from_header?.replace(/<.*>/, "").replace(/"/g, "").trim() || undefined,
          to: (d.to_addresses ?? parsed.to_addresses ?? []).map((t: any) => String(t.address ?? t).toLowerCase()),
          cc: (parsed.cc ?? d.cc ?? []).map((t: any) => String(t.address ?? t).toLowerCase()),
          subject: d.subject ?? "",
          text: d.body_text ?? parsed.body_text ?? "",
          receivedAt: d.received_at ?? d.created_at,
          verified: authPassed(d.auth),
          auth: d.auth ? `spf=${d.auth.spf} dmarc=${d.auth.dmarc}` : undefined,
          attachments: (parsed.attachments ?? []).map((a: any) => a.filename).filter(Boolean),
          automated: !!d.automated,
          automatedReasons: d.automated_reasons ?? [],
          nullSender: d.smtp_mail_from === "" || d.smtp_mail_from === "<>",
          replyToSentId: d.reply_to_sent_email_id ?? undefined,
          ...(await rawMessage(`${PRIMITIVE_API}/emails/${d.id}/raw`, H)),
        });
      }
      if (page?.meta?.cursor) {
        cursor = page.meta.cursor;
        fs.writeFileSync(cursorFile, cursor);
      }
      return out.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    },
    async send(m) {
      checkFence(stateDir, [m.to], m.subject, m.cc ?? []);
      const body = {
        from: `"${i.name ?? "clify agent"}" <${address}>`,
        to: m.to,
        ...(m.cc?.length ? { cc: m.cc } : {}),
        subject: m.subject,
        body_text: m.text,
        ...(m.html ? { body_html: m.html } : {}),
        ...(m.inReplyTo ? { in_reply_to: m.inReplyTo, references: m.references?.length ? m.references : [m.inReplyTo] } : {}),
        ...(m.attach?.length ? { attachments: attachments(m.attach) } : {}),
      };
      const r = await call(`${PRIMITIVE_API}/send-mail`, H, { method: "POST", body: JSON.stringify(body) });
      if (r.data?.rejected?.length) throw new Error(`Primitive rejected ${r.data.rejected.join(", ")}`);
      const id = r.data?.id;
      let d: any = null;
      for (let n = 0; n < 6 && id && !(d?.thread_id && d?.message_id); n++) {
        d = (await call(`${PRIMITIVE_API}/sent-emails/${id}`, H).catch(() => null))?.data ?? d;
        if (!(d?.thread_id && d?.message_id)) await sleep(1500);
      }
      return { provider: "primitive", id, messageId: d?.message_id, threadId: d?.thread_id, at: d?.created_at ?? new Date().toISOString(), to: m.to, cc: m.cc, subject: m.subject };
    },
  };
}

// ── Inkbox ───────────────────────────────────────────────────────────────
export function inkbox(i: Identity, stateDir: string): Transport {
  const key = i.apiKeys?.inkbox;
  if (!key || !i.email) throw new Error("no Inkbox mailbox/key in the vault");
  const H = { "X-API-Key": key };
  const MB = `${INKBOX_API}/mail/mailboxes/${encodeURIComponent(i.email)}`;
  const seenFile = path.join(stateDir, "inkbox-seen.json");
  const seen = new Set<string>(fs.existsSync(seenFile) ? JSON.parse(fs.readFileSync(seenFile, "utf8")) : []);
  const startFile = path.join(stateDir, "inkbox-start.txt");
  if (!fs.existsSync(startFile)) fs.writeFileSync(startFile, new Date(Date.now() - 60_000).toISOString().replace(/\.\d+Z$/, "Z"));
  const start = fs.readFileSync(startFile, "utf8").trim();
  return {
    address: i.email,
    async next() {
      await sleep(4000);
      let page: any;
      try {
        page = await call(`${MB}/messages?direction=inbound&limit=50&start_datetime=${start}`, H);
      } catch (e) {
        process.stderr.write(`inkbox poll: ${(e as Error).message}\n`);
        await sleep(5000);
        return [];
      }
      const out: Inbound[] = [];
      for (const m of page?.items ?? []) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        const d = await call(`${MB}/messages/${m.id}`, H);
        out.push({
          provider: "inkbox",
          id: d.id,
          messageId: d.message_id,
          threadId: d.thread_id ?? d.id,
          references: d.references ?? [],
          from: String(d.from_address ?? "").toLowerCase(),
          fromName: d.from_display_name ?? undefined,
          to: (d.to_addresses ?? []).map((x: string) => x.toLowerCase()),
          cc: (d.cc_addresses ?? []).map((x: string) => x.toLowerCase()),
          subject: d.subject ?? "",
          text: d.body_text ?? "",
          receivedAt: d.created_at,
          verified: false,
          attachments: (d.attachment_metadata ?? []).map((a: any) => a.filename),
        });
      }
      fs.writeFileSync(seenFile, JSON.stringify([...seen].slice(-2000)));
      return out.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    },
    async send(m) {
      checkFence(stateDir, [m.to], m.subject, m.cc ?? []);
      const r = await call(`${MB}/messages`, H, {
        method: "POST",
        body: JSON.stringify({
          recipients: { to: [m.to], ...(m.cc?.length ? { cc: m.cc } : {}) },
          subject: m.subject,
          body_text: m.text,
          ...(m.html ? { body_html: m.html } : {}),
          ...(m.inReplyTo ? { in_reply_to_message_id: m.inReplyTo } : {}),
          ...(m.attach?.length ? { attachments: attachments(m.attach) } : {}),
        }),
      });
      const d = await call(`${MB}/messages/${r.id}`, H).catch(() => r);
      return { provider: "inkbox", id: r.id, messageId: d.message_id, threadId: d.thread_id, at: d.created_at ?? new Date().toISOString(), to: m.to, cc: m.cc, subject: m.subject };
    },
  };
}

// The raw RFC 822 message (Primitive serves /emails/:id/raw): its top-level
// headers (List-*, Precedence, Auto-Submitted, ...) and its attachments.
export async function rawMessage(url: string, headers: Record<string, string>): Promise<{ headers: Record<string, string>; files: { filename: string; data: Buffer }[] }> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) }).catch(() => null);
  if (!res?.ok) return { headers: {}, files: [] };
  const raw = await res.text();
  return { headers: parseHeaders(raw), files: rawAttachments(raw) };
}

export function parseHeaders(raw: string): Record<string, string> {
  const cut = raw.search(/\r?\n\r?\n/);
  const head = (cut < 0 ? raw : raw.slice(0, cut)).replace(/\r?\n[ \t]+/g, " ");
  const out: Record<string, string> = {};
  for (const line of head.split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m && !(m[1].toLowerCase() in out)) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

// Every MIME leaf part with a filename, decoded.
export function rawAttachments(raw: string): { filename: string; data: Buffer }[] {
  const bounds = [...raw.matchAll(/boundary="?([^";\r\n]+)"?/gi)].map((m) => m[1]);
  if (!bounds.length) return [];
  const parts = raw.split(new RegExp(bounds.map((b) => "--" + b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")));
  const out: { filename: string; data: Buffer }[] = [];
  for (const p of parts) {
    const cut = p.search(/\r?\n\r?\n/);
    if (cut < 0) continue;
    const head = p.slice(0, cut).replace(/\r?\n[ \t]+/g, " ");
    const name = head.match(/filename\*?=(?:UTF-8'')?"?([^";\r\n]+)"?/i)?.[1];
    if (!name || /content-type:\s*multipart/i.test(head)) continue;
    const body = p.slice(cut).trim();
    const enc = head.match(/content-transfer-encoding:\s*([\w-]+)/i)?.[1]?.toLowerCase();
    const data = enc === "base64" ? Buffer.from(body.replace(/\s+/g, ""), "base64") : enc === "quoted-printable" ? Buffer.from(body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), "latin1") : Buffer.from(body);
    out.push({ filename: path.basename(decodeURIComponent(name)).replace(/[^\w.-]/g, "-"), data });
  }
  return out;
}

// The reply's own words: quoted history, signatures and provider footers removed.
export function freshText(t: string): string {
  const lines = (t ?? "").replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (let n = 0; n < lines.length; n++) {
    const l = lines[n];
    const joined = `${l} ${lines[n + 1] ?? ""}`;
    if (/^\s*>/.test(l)) continue;
    if (/^\s*On\b.*\bwrote:\s*$/i.test(l) || (/^\s*On\b/.test(l) && /\bwrote:\s*$/i.test(joined) && !/wrote:/i.test(l) && out.length)) break;
    if (/^\s*-{2,}\s*(Original|Forwarded) Message/i.test(l) || /^-{5,} Forwarded thread/.test(l) || /^-- ?$/.test(l) || /^\s*Sent (via|from) (Inkbox|my )/i.test(l) || /^_{5,}$/.test(l.trim())) break;
    if (/^\s*From:\s.+/.test(l) && out.some((x) => x.trim())) break;
    out.push(l);
  }
  return out.join("\n").trim();
}
