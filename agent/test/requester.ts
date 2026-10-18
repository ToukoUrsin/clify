// A test requester: a person-like sender on the agent's own Primitive domain
// (e.g. maya@fine-vale.primitive.email) that emails the agent a job, waits for
// its replies and answers in the same thread. Scripted answers, no model: it
// plays the human side of a conversation so tests never email real people.
//
//   requester.ts send  --as maya@d --to clify@d [--cc a,b] --subject S --text T  → {threadId, messageId}
//   requester.ts wait  --as maya@d --thread T [--from F] [--timeout 900]        → next mail in thread T (from F)
//   requester.ts wait  --as bob@d --subject S [--from F]                        → next mail with subject S in bob's own mailbox (a thread someone else started)
//   requester.ts reply --as maya@d --thread T --text T [--to X] [--cc a,b]       → reply to the latest mail in T (--cc: reply-all)
//
// State (last mail per thread) in $REQ_STATE (default /tmp/clify-requester). Uses
// the Primitive key from the clify vault in $CLIFY_HOME.
import fs from "node:fs";
import path from "node:path";
import { PRIMITIVE_API } from "../../clify/src/identity.ts";
import { getIdentity } from "../../clify/src/vault.ts";

const i = getIdentity();
if (!i?.apiKeys?.primitive) throw new Error("no Primitive key in the vault");
const H = { authorization: `Bearer ${i.apiKeys.primitive}`, accept: "application/json" };
const STATE = process.env.REQ_STATE || "/tmp/clify-requester";
fs.mkdirSync(STATE, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(p: string, init: RequestInit = {}) {
  const res = await fetch(PRIMITIVE_API + p, { ...init, headers: { ...H, ...(init.body ? { "content-type": "application/json" } : {}) }, signal: AbortSignal.timeout(60_000) });
  const t = await res.text();
  if (!res.ok) throw new Error(`primitive ${res.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (k: string) => {
  const n = args.indexOf(`--${k}`);
  return n > 0 ? args[n + 1] : undefined;
};
const as = flag("as")!;
const name = flag("name") ?? as.split("@")[0].replace(/^./, (c) => c.toUpperCase());
const stateFile = (t: string) => path.join(STATE, `${as}-${t}.json`);

async function sent(id: string) {
  for (let n = 0; n < 8; n++) {
    const d = (await api(`/sent-emails/${id}`).catch(() => null))?.data;
    if (d?.thread_id && d?.message_id) return d;
    await sleep(1500);
  }
  throw new Error("sent email has no thread id yet");
}

const ccFlag = () => (flag("cc") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

async function send(o: { to: string; cc?: string[]; subject: string; text: string; inReplyTo?: string; references?: string[] }) {
  const r = await api("/send-mail", {
    method: "POST",
    body: JSON.stringify({ from: `"${name}" <${as}>`, to: o.to, ...(o.cc?.length ? { cc: o.cc } : {}), subject: o.subject, body_text: o.text, ...(o.inReplyTo ? { in_reply_to: o.inReplyTo, references: o.references ?? [o.inReplyTo] } : {}) }),
  });
  const d = await sent(r.data.id);
  return { id: r.data.id, threadId: d.thread_id, messageId: d.message_id, at: d.created_at, subject: o.subject };
}

if (cmd === "send") {
  const s = await send({ to: flag("to")!, cc: ccFlag(), subject: flag("subject")!, text: flag("text")! });
  fs.writeFileSync(stateFile(s.threadId), JSON.stringify({ subject: s.subject, refs: [s.messageId], since: s.at }));
  console.log(JSON.stringify(s));
} else if (cmd === "wait") {
  const subj = flag("subject");
  const from = flag("from")?.toLowerCase();
  let thread = flag("thread")!;
  const st = subj ? { subject: subj, refs: [], since: new Date(Date.now() - 15 * 60_000).toISOString() } : JSON.parse(fs.readFileSync(stateFile(thread), "utf8"));
  const deadline = Date.now() + Number(flag("timeout") ?? 900) * 1000;
  let cursor = `${new Date(new Date(st.since).getTime() - 2000).toISOString()}|00000000-0000-0000-0000-000000000000`;
  const seen = new Set<string>(st.seen ?? []);
  while (Date.now() < deadline) {
    const page = await api(`/emails?${new URLSearchParams({ since: cursor, wait: "30", recipient: as })}`).catch((e) => (console.error(String(e)), null));
    if (!page) {
      await sleep(3000);
      continue;
    }
    if (page.meta?.cursor) cursor = page.meta.cursor;
    for (const row of page.data ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      // A just-arrived row can have no thread id yet: ask again until it's threaded.
      let d = (await api(`/emails/${row.id}`)).data;
      for (let n = 0; n < 6 && !d.thread_id; n++) {
        await sleep(2000);
        d = (await api(`/emails/${row.id}`)).data;
      }
      if (subj ? String(d.subject ?? "").replace(/^(re|fwd?):\s*/gi, "") !== subj : d.thread_id !== thread) continue;
      if (from && String(d.from_email ?? "").toLowerCase() !== from) continue;
      if (subj) thread = d.thread_id;
      const parsed = typeof d.parsed === "string" ? JSON.parse(d.parsed) : d.parsed ?? {};
      fs.writeFileSync(stateFile(thread), JSON.stringify({ ...st, seen: [...seen], since: d.received_at, last: { messageId: d.message_id, subject: d.subject }, refs: [...st.refs, d.message_id] }));
      console.log(JSON.stringify({ id: d.id, messageId: d.message_id, threadId: d.thread_id, from: d.from_email, to: d.to_addresses ?? parsed.to_addresses, cc: parsed.cc ?? d.cc, subject: d.subject, receivedAt: d.received_at, dmarc: d.auth?.dmarc, attachments: (parsed.attachments ?? []).map((a: any) => a.filename), text: d.body_text }, null, 2));
      process.exit(0);
    }
  }
  throw new Error("no reply from the agent in time");
} else if (cmd === "reply") {
  const thread = flag("thread")!;
  const st = JSON.parse(fs.readFileSync(stateFile(thread), "utf8"));
  if (!st.last) throw new Error("nothing to reply to yet; run wait first");
  const subject = /^re:/i.test(st.last.subject) ? st.last.subject : `Re: ${st.last.subject}`;
  const s = await send({ to: flag("to") ?? "clify@fine-vale.primitive.email", cc: ccFlag(), subject, text: flag("text")!, inReplyTo: st.last.messageId, references: st.refs });
  fs.writeFileSync(stateFile(thread), JSON.stringify({ ...st, since: s.at, refs: [...st.refs, s.messageId] }));
  console.log(JSON.stringify(s));
} else {
  console.error("usage: requester.ts send|wait|reply --as ADDR ...");
  process.exit(1);
}
