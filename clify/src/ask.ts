// Ask a human. When clify reaches something only a person can do (a CAPTCHA,
// a payment wall, a phone check it can't pass, an ambiguous choice, a write
// that needs approval) it does not try to get around it. It emails its human
// from its own address (Primitive), or texts them from its own number
// (Inkbox), waits, and continues from the reply in the same thread.
//
//  - The thread is the context: site, page, what clify was doing, the exact
//    options and a screenshot all go in the first message.
//  - Only replies from the address that was asked (plus any delegate) are acted
//    on, and only when the mail passed DMARC. Anything else is listed under
//    `ignored` and never parsed.
//  - cc loops another agent in on the same thread; forward hands the thread to
//    another agent (delegation) and its reply answers the ask.
//  - Replies are parsed into a fixed decision (skip, approve, deny,
//    use-my-account, retry, an option, a code) or returned as free text. A reply
//    never turns into code or commands.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { extractCode } from "./codes.ts";
import { identity, INKBOX_API, listSms, PRIMITIVE_API } from "./identity.ts";
import { HOME, log, readJson, writeJson } from "./store.ts";
import type { Identity } from "./vault.ts";

export const ASK_DIR = path.join(HOME, "asks");
export const TEST_TAG = "[clify test, no reply needed]";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface AskOption {
  key: string; // decision returned when the human picks it
  label: string;
}

export interface AskRequest {
  question: string;
  subject?: string; // short subject; default: the question
  to?: string; // email address, or E.164 number with via=sms. Default: the saved human.
  via?: "email" | "sms";
  cc?: string[]; // other agents looped in on the thread (email only)
  site?: string;
  url?: string;
  doing?: string; // what clify was doing when it stopped
  blocker?: string; // what stopped it
  details?: string; // extra block, e.g. the exact request a write would send
  options?: AskOption[];
  attach?: string[]; // file paths (screenshots)
  waitMs?: number; // 0 = send and return
  test?: boolean; // subject carries TEST_TAG
  note?: string; // line shown above the question
  acceptFrom?: string[]; // extra addresses whose verified replies count (default: only `to`)
  delegate?: { to: string; afterMs: number; note?: string }; // no answer by then: forward to this agent
}

export interface Answer {
  decision: string; // an option key, "code", or "text"
  answer: string; // the reply's own words (quoted history removed)
  code?: string;
  from: string;
  verified: boolean;
  receivedAt: string;
  emailId?: string;
  threadId?: string;
}

interface Sent {
  sentEmailId?: string;
  messageId?: string; // RFC 5322 Message-ID
  threadId?: string;
  to: string;
  cc?: string[];
  subject: string;
  at: string;
  kind: "ask" | "forward" | "notice";
}

export interface AskRecord {
  id: string;
  createdAt: string;
  via: "email" | "sms";
  from: string;
  to: string;
  cc: string[];
  acceptFrom: string[];
  subject: string;
  question: string;
  site?: string;
  url?: string;
  doing?: string;
  blocker?: string;
  details?: string;
  options: AskOption[];
  attach: string[];
  test?: boolean;
  sent: Sent[];
  cursor?: string; // Primitive forward-tail cursor
  status: "sent" | "answered" | "timeout";
  answer?: Answer;
  ignored: { from: string; subject?: string; reason: string; at: string }[];
  delegated?: { to: string; at: string };
}

export interface AskResult {
  ok: boolean;
  id: string;
  status: AskRecord["status"];
  via: AskRecord["via"];
  to: string;
  cc: string[];
  thread_id?: string;
  decision?: string;
  answer?: string;
  code?: string;
  answeredBy?: string;
  verified?: boolean;
  delegated?: AskRecord["delegated"];
  ignored: AskRecord["ignored"];
  next?: string;
}

// ── Storage ──────────────────────────────────────────────────────────────
const recFile = (id: string) => path.join(ASK_DIR, `${id}.json`);
const HUMAN_FILE = path.join(ASK_DIR, "human.json");

export function loadAsk(idOrThread: string): AskRecord {
  const direct = readJson<AskRecord | null>(recFile(idOrThread), null);
  if (direct) return direct;
  const hit = listAsks().find((r) => r.sent.some((s) => s.threadId === idOrThread || s.sentEmailId === idOrThread));
  if (!hit) throw new Error(`no ask "${idOrThread}" (clify ask list)`);
  return hit;
}

function saveAsk(r: AskRecord): void {
  writeJson(recFile(r.id), r, true);
}

export function listAsks(): AskRecord[] {
  if (!fs.existsSync(ASK_DIR)) return [];
  return fs
    .readdirSync(ASK_DIR)
    .filter((f) => /^ask-[a-f0-9]+\.json$/.test(f))
    .map((f) => readJson<AskRecord | null>(path.join(ASK_DIR, f), null))
    .filter((r): r is AskRecord => !!r)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// The human clify asks by default: CLIFY_HUMAN_EMAIL / CLIFY_HUMAN_PHONE, else asks/human.json.
export function getHuman(): { email?: string; phone?: string } {
  const f = readJson<{ email?: string; phone?: string }>(HUMAN_FILE, {});
  return { email: process.env.CLIFY_HUMAN_EMAIL || f.email, phone: process.env.CLIFY_HUMAN_PHONE || f.phone };
}

export function setHuman(h: { email?: string; phone?: string }): { email?: string; phone?: string } {
  const next = { ...readJson<object>(HUMAN_FILE, {}), ...Object.fromEntries(Object.entries(h).filter(([, v]) => v)) };
  writeJson(HUMAN_FILE, next, true);
  return next;
}

// Saves a page screenshot (base64 JPEG) for an ask; returns the file path.
export function saveShot(name: string, b64: string): string | undefined {
  if (!b64) return undefined;
  const dir = path.join(ASK_DIR, "files");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = path.join(dir, `${name.replace(/[^a-z0-9-]/gi, "-")}-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`);
  fs.writeFileSync(f, Buffer.from(b64, "base64"), { mode: 0o600 });
  return f;
}

// ── Providers ────────────────────────────────────────────────────────────
async function call(url: string, headers: Record<string, string>, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, { ...init, headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...headers }, signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const prim = (i: Identity, p: string, init: RequestInit = {}) => {
  if (!i.apiKeys?.primitive) throw new Error("no Primitive API key in the vault; run: clify identity init");
  return call(PRIMITIVE_API + p, { authorization: `Bearer ${i.apiKeys.primitive}` }, init);
};

const inkbox = (i: Identity, p: string, init: RequestInit = {}) => {
  if (!i.apiKeys?.inkbox) throw new Error("no Inkbox API key in the vault; run: clify identity init");
  return call(INKBOX_API + p, { "X-API-Key": i.apiKeys.inkbox }, init);
};

// The agent's own sending address: clify@<its Primitive domain>.
export function agentAddress(i = identity()): string {
  if (!i.aliasDomain) throw new Error("no Primitive domain in the identity; run: clify identity init");
  return process.env.CLIFY_ASK_FROM || `clify@${i.aliasDomain}`;
}

function attachments(files: string[]) {
  return files.map((f) => {
    const ext = path.extname(f).toLowerCase();
    const type = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".pdf": "application/pdf", ".txt": "text/plain", ".json": "application/json" }[ext] ?? "application/octet-stream";
    return { filename: path.basename(f), content_type: type, content_base64: fs.readFileSync(f).toString("base64") };
  });
}

async function sendMail(
  i: Identity,
  m: { to: string; cc?: string[]; subject: string; text: string; html: string; attach?: string[]; inReplyTo?: string; references?: string[] },
  kind: Sent["kind"],
): Promise<Sent> {
  const from = agentAddress(i);
  const body = {
    from: `"${i.name ?? "clify agent"}" <${from}>`,
    to: m.to,
    ...(m.cc?.length ? { cc: m.cc } : {}),
    subject: m.subject,
    body_text: m.text,
    body_html: m.html,
    ...(m.inReplyTo ? { in_reply_to: m.inReplyTo, references: m.references ?? [m.inReplyTo] } : {}),
    ...(m.attach?.length ? { attachments: attachments(m.attach) } : {}),
  };
  const r = await prim(i, "/send-mail", { method: "POST", body: JSON.stringify(body) });
  const id = r.data?.id;
  if (r.data?.rejected?.length) throw new Error(`Primitive rejected ${r.data.rejected.join(", ")}`);
  // Thread id and Message-ID are on the stored send.
  let detail: any = null;
  for (let n = 0; n < 5 && id && !(detail?.thread_id && detail?.message_id); n++) {
    detail = (await prim(i, `/sent-emails/${id}`).catch(() => null))?.data ?? detail;
    if (!(detail?.thread_id && detail?.message_id)) await sleep(1500);
  }
  log(`  ✉️  ${kind} sent from ${from} to ${m.to}${m.cc?.length ? ` cc ${m.cc.join(", ")}` : ""}: "${m.subject}"`);
  return { sentEmailId: id, messageId: detail?.message_id ?? undefined, threadId: detail?.thread_id ?? undefined, to: m.to, cc: m.cc, subject: m.subject, at: new Date().toISOString(), kind };
}

// DMARC pass (aligned SPF or DKIM) on the reply. Without it a From line proves nothing.
function authPassed(auth: any): boolean {
  if (!auth) return false;
  if (auth.dmarc === "pass") return true;
  const dkim = (auth.dkimSignatures ?? []).some((s: any) => s.result === "pass" && s.aligned);
  return dkim || (auth.spf === "pass" && auth.dmarcSpfAligned === true);
}

// ── Message text ─────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function composeAsk(r: AskRecord, i: Identity, note?: string): { text: string; html: string } {
  const ctx = [
    r.site && `Site:     ${r.site}`,
    r.url && `Page:     ${r.url}`,
    r.doing && `Doing:    ${r.doing}`,
    r.blocker && `Stopped:  ${r.blocker}`,
  ].filter(Boolean) as string[];
  const opts = r.options.length
    ? ["Reply with one of:", ...r.options.map((o, n) => `  ${n + 1}. ${o.key.padEnd(15)} ${o.label}`), "Or reply in your own words."]
    : ["Reply in your own words."];
  const lines = [
    ...(note ? [note, ""] : []),
    r.question,
    "",
    ...(ctx.length ? [...ctx, ""] : []),
    ...(r.details ? [r.details, ""] : []),
    ...opts,
    "",
    ...(r.attach.length ? [`Attached: ${r.attach.map((f) => path.basename(f)).join(", ")}`, ""] : []),
    "clify never solves CAPTCHAs or works around bot checks. Never send passwords by email.",
    `— ${i.name ?? "clify agent"} <${r.from}> · ask ${r.id} · reply in this thread; replies are acted on only from ${r.acceptFrom.join(", ")}`,
  ];
  const text = lines.join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.45;color:#111">
${note ? `<p style="color:#666">${esc(note)}</p>` : ""}<p style="font-size:16px"><b>${esc(r.question)}</b></p>
${ctx.length ? `<table style="border-collapse:collapse;margin:8px 0">${ctx.map((c) => { const [k, ...v] = c.split(/:\s+/); return `<tr><td style="color:#666;padding:2px 12px 2px 0">${esc(k)}</td><td>${esc(v.join(": "))}</td></tr>`; }).join("")}</table>` : ""}
${r.details ? `<pre style="background:#f5f5f5;padding:10px;border-radius:6px;white-space:pre-wrap">${esc(r.details)}</pre>` : ""}
${r.options.length ? `<p>Reply with one of:</p><ol>${r.options.map((o) => `<li><code>${esc(o.key)}</code> — ${esc(o.label)}</li>`).join("")}</ol><p>Or reply in your own words.</p>` : "<p>Reply in your own words.</p>"}
${r.attach.length ? `<p style="color:#666">Attached: ${r.attach.map((f) => esc(path.basename(f))).join(", ")}</p>` : ""}
<p style="color:#888;font-size:12px">clify never solves CAPTCHAs or works around bot checks. Never send passwords by email.<br>${esc(i.name ?? "clify agent")} &lt;${esc(r.from)}&gt; · ask ${r.id} · replies are acted on only from ${esc(r.acceptFrom.join(", "))}</p></div>`;
  return { text, html };
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
    if (/^\s*-{2,}\s*(Original|Forwarded) Message/i.test(l) || /^-- ?$/.test(l) || /^\s*Sent (via|from) (Inkbox|my )/i.test(l) || /^_{5,}$/.test(l.trim())) break;
    if (/^\s*From:\s.+/.test(l) && out.some((x) => x.trim())) break;
    out.push(l);
  }
  return out.join("\n").trim();
}

const SYNONYMS: Record<string, RegExp> = {
  skip: /^(skip|pass|move on|next|no\b|nope|ignore|leave it)/,
  approve: /^(approve[ds]?|yes\b|y\b|yep|ok\b|okay|go\b|go ahead|send( it)?\b|confirm(ed)?|lgtm|do it|ship it)/,
  deny: /^(deny|denied|reject(ed)?|no\b|nope|don'?t|do not|stop|cancel|hold)/,
  "use-my-account": /(use my (own )?(account|login)|i'?ll log ?in|log in as me|my account)/,
  retry: /^(retry|try again|done\b|solved|fixed|cleared|unblocked|go again)/,
};

export function parseAnswer(raw: string, options: AskOption[]): { decision: string; answer: string; code?: string } {
  const answer = freshText(raw);
  const first = (answer.split(/\n\s*\n/)[0] ?? "").trim();
  const low = first.toLowerCase().replace(/^["'*\s]+|["'*.!\s]+$/g, "");
  const num = low.match(/^(\d)\s*[.)]?$/);
  if (num && options[Number(num[1]) - 1]) return { decision: options[Number(num[1]) - 1].key, answer };
  for (const o of options) {
    const k = o.key.toLowerCase();
    if (low === k || low.startsWith(k + " ") || low.startsWith(k + ",") || SYNONYMS[k]?.test(low)) return { decision: o.key, answer };
  }
  const code = /^[A-Z0-9-]{4,10}$/i.test(first.replace(/\s/g, "")) && /\d/.test(first) ? first.replace(/[\s-]/g, "") : extractCode(first);
  if (code) return { decision: "code", answer, code };
  return { decision: "text", answer };
}

// ── Asking ───────────────────────────────────────────────────────────────
export async function ask(req: AskRequest): Promise<AskResult> {
  const i = identity();
  const via = req.via ?? (req.to && /^\+\d{8,15}$/.test(req.to) ? "sms" : "email");
  const human = getHuman();
  const to = (req.to ?? (via === "sms" ? human.phone : human.email))?.trim();
  if (!to) throw new Error(`no human to ask: pass --to, or set one with: clify ask --set-human you@example.com`);
  if (via === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error(`--to must be an email address (got "${to}")`);
  if (via === "sms" && !/^\+\d{8,15}$/.test(to)) throw new Error(`--to must be an E.164 phone number for --via sms (got "${to}")`);
  for (const f of req.attach ?? []) if (!fs.existsSync(f)) throw new Error(`attachment not found: ${f}`);
  const id = `ask-${crypto.randomBytes(4).toString("hex")}`;
  const short = (req.subject ?? req.question).replace(/\s+/g, " ").trim();
  const subject = [req.test ? TEST_TAG : "", "[clify]", req.site && !req.subject ? `${req.site}:` : "", short.length > 90 ? short.slice(0, 88).replace(/\s+\S*$/, "") + "…" : short].filter(Boolean).join(" ");
  const rec: AskRecord = {
    id,
    createdAt: new Date().toISOString(),
    via,
    from: via === "sms" ? i.phone ?? "" : agentAddress(i),
    to,
    cc: via === "email" ? (req.cc ?? []).map((c) => c.trim()).filter(Boolean) : [],
    acceptFrom: [to, ...(req.acceptFrom ?? [])].map((a) => a.toLowerCase()),
    subject,
    question: req.question,
    site: req.site,
    url: req.url,
    doing: req.doing,
    blocker: req.blocker,
    details: req.details,
    options: req.options ?? [],
    attach: (req.attach ?? []).map((f) => path.resolve(f)),
    test: req.test,
    sent: [],
    status: "sent",
    ignored: [],
  };
  if (via === "sms") {
    if (!i.phoneId) throw new Error("no phone number on the agent identity");
    const keys = rec.options.map((o) => o.key.toUpperCase()).join(" / ");
    const text = `${req.test ? "[clify test] " : ""}clify${req.site ? ` (${req.site})` : ""}: ${req.question}${keys ? ` Reply ${keys}, or a short answer.` : ""} [${id}]`.slice(0, 1600);
    await inkbox(i, `/phone/numbers/${i.phoneId}/texts`, { method: "POST", body: JSON.stringify({ to, text }), headers: { "Idempotency-Key": id, Prefer: "idempotency-replay" } as any });
    rec.sent.push({ to, subject: text, at: new Date().toISOString(), kind: "ask" });
    log(`  📱 ask texted from ${i.phone} to ${to}`);
  } else {
    const { text, html } = composeAsk(rec, i, req.note);
    rec.sent.push(await sendMail(i, { to, cc: rec.cc, subject, text, html, attach: rec.attach }, "ask"));
  }
  saveAsk(rec);
  if (!req.waitMs) return result(rec);
  return waitForAnswer(rec.id, { waitMs: req.waitMs, delegate: req.delegate });
}

// Waits for a verified reply in any of the ask's threads (the original, and any
// forward). With `delegate`, an unanswered ask is forwarded once `afterMs` passes.
export async function waitForAnswer(id: string, o: { waitMs: number; delegate?: AskRequest["delegate"] }): Promise<AskResult> {
  let rec = loadAsk(id);
  if (rec.status === "answered") return result(rec);
  const deadline = Date.now() + o.waitMs;
  let delegateAt = o.delegate && !rec.delegated ? Date.now() + o.delegate.afterMs : Infinity;
  const i = identity();
  log(`  ⏳ waiting up to ${Math.round(o.waitMs / 60000) || "<1"} min for ${rec.acceptFrom.join(" / ")} (ask ${rec.id})`);
  while (Date.now() < deadline) {
    if (Date.now() >= delegateAt && o.delegate) {
      log(`  ↪ no answer from ${rec.to} yet: delegating to ${o.delegate.to}`);
      await forwardAsk(rec.id, o.delegate.to, { note: o.delegate.note });
      rec = loadAsk(rec.id);
      delegateAt = Infinity;
    }
    const until = Math.min(deadline, delegateAt);
    const got = rec.via === "sms" ? await pollSms(i, rec, until) : await pollEmail(i, rec, until);
    rec = got.rec;
    saveAsk(rec);
    if (got.answer) {
      rec.answer = got.answer;
      rec.status = "answered";
      saveAsk(rec);
      log(`  💬 ${got.answer.from} answered: ${got.answer.decision}${got.answer.decision === "text" ? ` "${got.answer.answer.slice(0, 80)}"` : ""}`);
      return result(rec);
    }
  }
  rec.status = "timeout";
  saveAsk(rec);
  return result(rec);
}

function inThread(rec: AskRecord, row: any): boolean {
  const ids = new Set(rec.sent.map((s) => s.sentEmailId).filter(Boolean));
  const threads = new Set(rec.sent.map((s) => s.threadId).filter(Boolean));
  return (row.reply_to_sent_email_id && ids.has(row.reply_to_sent_email_id)) || (row.thread_id && threads.has(row.thread_id)) || rec.sent.some((s) => s.subject && row.subject && row.subject.replace(/^(re|fwd?):\s*/gi, "") === s.subject.replace(/^(re|fwd?):\s*/gi, "") && row.subject !== s.subject);
}

async function pollEmail(i: Identity, rec: AskRecord, until: number): Promise<{ rec: AskRecord; answer?: Answer }> {
  const first = rec.sent[0];
  let cursor = rec.cursor ?? `${new Date(new Date(first.at).getTime() - 5000).toISOString()}|00000000-0000-0000-0000-000000000000`;
  while (Date.now() < until) {
    const wait = Math.max(1, Math.min(30, Math.floor((until - Date.now()) / 1000)));
    const u = new URLSearchParams({ since: cursor, wait: String(wait), recipient: rec.from });
    const page = await prim(i, `/emails?${u}`).catch((e) => (log(`  inbox error: ${(e as Error).message}`), null));
    if (!page) {
      await sleep(5000);
      continue;
    }
    if (page.meta?.cursor) cursor = page.meta.cursor;
    rec.cursor = cursor;
    for (const row of page.data ?? []) {
      if (!inThread(rec, row)) continue;
      const d = (await prim(i, `/emails/${row.id}`))?.data ?? row;
      const from = String(d.from_email ?? d.sender ?? "").toLowerCase();
      const verified = authPassed(d.auth);
      const at = d.received_at ?? d.created_at ?? new Date().toISOString();
      if (!rec.acceptFrom.includes(from)) {
        rec.ignored.push({ from, subject: d.subject, reason: "not an address this ask accepts answers from", at });
        continue;
      }
      if (!verified) {
        rec.ignored.push({ from, subject: d.subject, reason: "failed DMARC/SPF/DKIM: sender not verified", at });
        continue;
      }
      if (d.fyi) continue; // an acknowledgement, not an answer
      const p = parseAnswer(d.body_text ?? d.parsed?.text ?? "", rec.options);
      if (!p.answer) continue;
      return { rec, answer: { ...p, from, verified, receivedAt: at, emailId: d.id, threadId: d.thread_id ?? undefined } };
    }
  }
  return { rec };
}

// SMS has no sender authentication: only texts from the exact number asked count.
async function pollSms(i: Identity, rec: AskRecord, until: number): Promise<{ rec: AskRecord; answer?: Answer }> {
  const after = new Date(new Date(rec.sent[0].at).getTime() - 2000);
  while (Date.now() < until) {
    const rows = await listSms(after).catch(() => []);
    const hit = rows.filter((t) => t.from === rec.to).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0];
    if (hit) {
      const p = parseAnswer(hit.text, rec.options);
      return { rec, answer: { ...p, from: hit.from, verified: false, receivedAt: hit.receivedAt } };
    }
    await sleep(Math.min(5000, Math.max(0, until - Date.now())));
  }
  return { rec };
}

// ── Delegation ───────────────────────────────────────────────────────────
// Forwards the ask's thread to another agent. The forward carries the whole
// thread (each message's sender, time and own words) plus the original
// attachments, and that agent's verified reply now answers the ask.
export async function forwardAsk(id: string, to: string, o: { note?: string; cc?: string[] } = {}): Promise<AskResult> {
  const i = identity();
  const rec = loadAsk(id);
  if (rec.via !== "email") throw new Error("only email asks can be forwarded");
  const target = to.trim().toLowerCase();
  const transcript: string[] = [];
  const threadId = rec.sent.find((s) => s.threadId)?.threadId;
  if (threadId) {
    const t = (await prim(i, `/threads/${threadId}`).catch(() => null))?.data;
    for (const m of t?.messages ?? []) {
      const d = (await prim(i, m.direction === "inbound" ? `/emails/${m.id}` : `/sent-emails/${m.id}`).catch(() => null))?.data;
      if (!d) continue;
      const from = m.direction === "inbound" ? d.from_email ?? d.sender : rec.from;
      if (m.direction === "inbound" && String(from).toLowerCase() === rec.from.toLowerCase()) continue; // our own copy
      const body = m.direction === "inbound" ? freshText(d.body_text ?? "") : (d.body_text ?? "").trim();
      transcript.push(`From: ${from}\nDate: ${d.received_at ?? d.created_at ?? ""}\nSubject: ${d.subject ?? ""}\n\n${body}`);
    }
  }
  if (!transcript.length) transcript.push(composeAsk(rec, i).text);
  rec.acceptFrom = [...new Set([...rec.acceptFrom, target])];
  const note =
    o.note ??
    `${rec.to} hasn't answered, so clify is delegating this to you. You have the whole thread below. Decide and reply in this thread${rec.options.length ? ` with one of: ${rec.options.map((x) => x.key).join(", ")}` : ""}. Your reply is what clify acts on.`;
  const text = `${note}\n\n---------- Forwarded thread (ask ${rec.id}) ----------\n\n${transcript.join("\n\n----------\n\n")}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px"><p>${esc(note)}</p><hr><pre style="white-space:pre-wrap;font-family:inherit">${esc(transcript.join("\n\n──────────\n\n"))}</pre></div>`;
  const subject = `Fwd: ${rec.subject.replace(/^(fwd?:\s*)+/i, "")}`;
  rec.sent.push(await sendMail(i, { to, cc: o.cc, subject, text, html, attach: rec.attach.filter((f) => fs.existsSync(f)) }, "forward"));
  rec.delegated = { to: target, at: new Date().toISOString() };
  rec.status = rec.status === "answered" ? "answered" : "sent";
  saveAsk(rec);
  return result(rec);
}

// Tells the original human how the ask was resolved (in their thread), e.g.
// after a delegate answered. No reply needed.
export async function noticeHuman(id: string, text: string): Promise<void> {
  const i = identity();
  const rec = loadAsk(id);
  const orig = rec.sent.find((s) => s.kind === "ask");
  if (!orig || rec.via !== "email") return;
  const body = `${text}\n\nNo reply needed. — ${i.name ?? "clify agent"} · ask ${rec.id}`;
  rec.sent.push(
    await sendMail(i, { to: rec.to, subject: `Re: ${rec.subject}`, text: body, html: `<p>${esc(text).replace(/\n/g, "<br>")}</p><p style="color:#888;font-size:12px">No reply needed. · ask ${rec.id}</p>`, inReplyTo: orig.messageId }, "notice"),
  );
  saveAsk(rec);
}

function result(rec: AskRecord): AskResult {
  const a = rec.answer;
  return {
    ok: rec.status !== "timeout",
    id: rec.id,
    status: rec.status,
    via: rec.via,
    to: rec.to,
    cc: rec.cc,
    thread_id: (a?.threadId ?? rec.sent.find((s) => s.threadId)?.threadId) || undefined,
    ...(a ? { decision: a.decision, answer: a.answer, ...(a.code ? { code: a.code } : {}), answeredBy: a.from, verified: a.verified } : {}),
    ...(rec.delegated ? { delegated: rec.delegated } : {}),
    ignored: rec.ignored,
    ...(rec.status === "timeout" ? { next: `clify ask resume ${rec.id} --wait 30m` } : rec.status === "sent" && !a ? { next: `clify ask resume ${rec.id} --wait 30m` } : {}),
  };
}

// ── Blockers and writes ──────────────────────────────────────────────────
export const BLOCKER_OPTIONS: AskOption[] = [
  { key: "skip", label: "Skip this site; clify moves on" },
  { key: "use-my-account", label: "Use your own login instead (you run: clify login <site> --user)" },
  { key: "retry", label: "You've cleared it yourself (e.g. in your own browser); clify tries once more" },
];

// A blocked signup/login/explore: ask what to do. clify never touches the
// CAPTCHA itself; the human decides whether to skip, sign in themselves, or
// have clify retry after they've dealt with it.
export async function askOnBlocker(o: { site: string; url: string; doing: string; blockers: string[]; shot?: string } & Omit<AskRequest, "question">): Promise<AskResult & { action: string; next?: string }> {
  const blocker = o.blockers.join("; ");
  const kind = /captcha|bot-check/i.test(blocker) ? "a CAPTCHA / bot check" : /payment/i.test(blocker) ? "a payment wall" : /phone/i.test(blocker) ? "a phone check" : "something it can't get past";
  const r = await ask({
    ...o,
    question: `clify was ${o.doing} on ${o.site} and hit ${kind}. What should it do?`,
    subject: o.subject ?? `${o.site}: ${kind.replace(/^an? /, "")} while ${o.doing.split(" ").slice(0, 2).join(" ")}. Skip, use your login, or retry?`,
    blocker,
    options: o.options ?? BLOCKER_OPTIONS,
    attach: [...(o.attach ?? []), ...(o.shot ? [o.shot] : [])],
  });
  const action =
    r.status !== "answered" ? "waiting" : r.decision === "skip" ? "skipped" : r.decision === "use-my-account" ? "use-my-account" : r.decision === "retry" ? "retry" : "see-answer";
  const next =
    action === "skipped"
      ? `skipped ${o.site} on ${r.answeredBy}'s answer; moving on`
      : action === "use-my-account"
        ? `clify login ${o.site} --user --url ${o.url}`
        : action === "waiting"
          ? r.next
          : undefined;
  return { ...r, action, next };
}

// A write needing approval: send the exact request it would make, and only
// send it if the verified answer is "approve".
export async function approveWrite(o: {
  site: string;
  command: string;
  preview: unknown;
  send: () => Promise<unknown>;
} & Omit<AskRequest, "question"> & { question?: string }): Promise<{ approved: boolean; sent: boolean; result?: unknown; ask: AskResult }> {
  const { preview, send, command, ...rest } = o;
  const r = await ask({
    ...rest,
    question: o.question ?? `clify wants to run "${command}" on ${o.site}, which changes data. Approve?`,
    subject: o.subject ?? `${o.site}: approve "${command}"? (it changes data)`,
    doing: o.doing ?? `running ${o.site} ${command}`,
    details: `Exact request (nothing has been sent):\n${JSON.stringify(preview, null, 2)}`,
    options: [
      { key: "approve", label: "Send this exact request" },
      { key: "deny", label: "Don't send it" },
    ],
  });
  if (r.status !== "answered" || r.decision !== "approve") return { approved: false, sent: false, ask: r };
  return { approved: true, sent: true, result: await send(), ask: r };
}
