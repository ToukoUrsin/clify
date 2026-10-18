// The second agent identity (the Inkbox mailbox) for the ask tests. It plays
// either the human, or a peer agent that clify delegates to.
//
//   inkbox-agent.ts reply --ask <id|next> --text "skip" [--delay s] [--wait 180]
//        wait for clify's ask <id> to arrive, then reply in its thread with --text
//   inkbox-agent.ts peer --ask <id> [--wait 300]
//        peer agent: note any thread it is cc'd on, and when clify forwards the
//        thread to it, decide with a fixed policy and reply in the forwarded thread
//
// Run from the clify dir:  node --import ./node_modules/tsx/dist/esm/index.mjs test/ask/inkbox-agent.ts ...
import { INKBOX_API } from "../../src/identity.ts";
import { getIdentity } from "../../src/vault.ts";

const i = getIdentity();
if (!i?.apiKeys?.inkbox || !i.email) throw new Error("no Inkbox identity in the vault");
const MAILBOX = i.email;
const H = { "X-API-Key": i.apiKeys.inkbox, accept: "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (s: string) => process.stdout.write(`${new Date().toISOString().slice(11, 19)} [inkbox ${MAILBOX}] ${s}\n`);

async function api(p: string, init: RequestInit = {}) {
  const res = await fetch(`${INKBOX_API}${p}`, { ...init, headers: { ...H, ...(init.body ? { "content-type": "application/json" } : {}) } });
  const t = await res.text();
  if (!res.ok) throw new Error(`inkbox ${res.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

const args = process.argv.slice(2);
const mode = args[0];
const flag = (k: string) => {
  const n = args.indexOf(`--${k}`);
  return n > 0 ? args[n + 1] : undefined;
};
const askId = flag("ask");
const waitS = Number(flag("wait") ?? 240);
if (!askId || !["reply", "peer"].includes(mode)) throw new Error("usage: inkbox-agent.ts reply|peer --ask <id> [--text ...] [--wait s]");

const seen = new Set<string>();
async function nextMail(pred: (m: any) => boolean): Promise<any | null> {
  const deadline = Date.now() + waitS * 1000;
  const after = new Date(Date.now() - 30 * 60_000).toISOString().replace(/\.\d+Z$/, "Z");
  while (Date.now() < deadline) {
    const page = await api(`/mail/mailboxes/${encodeURIComponent(MAILBOX)}/messages?direction=inbound&limit=30&start_datetime=${after}`);
    for (const m of (page.items ?? []).reverse()) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const d = await api(`/mail/mailboxes/${encodeURIComponent(MAILBOX)}/messages/${m.id}`);
      if (pred(d)) return d;
    }
    await sleep(4000);
  }
  return null;
}

async function replyTo(d: any, text: string) {
  const r = await api(`/mail/mailboxes/${encodeURIComponent(MAILBOX)}/messages`, {
    method: "POST",
    body: JSON.stringify({
      recipients: { to: [d.from_address] },
      subject: /^re:/i.test(d.subject) ? d.subject : `Re: ${d.subject}`,
      body_text: text,
      in_reply_to_message_id: d.message_id,
    }),
  });
  say(`replied in thread to ${d.from_address}: ${JSON.stringify(text)} (message ${r.id})`);
}

// "next": the first clify mail that arrives after this starts (older mail is marked seen).
const fromClify = (d: any) => /^clify@/i.test(d.from_address ?? "") && (askId === "next" || (d.body_text ?? "").includes(askId!));
if (askId === "next") {
  const page = await api(`/mail/mailboxes/${encodeURIComponent(MAILBOX)}/messages?direction=inbound&limit=50`);
  for (const m of page.items ?? []) seen.add(m.id);
}

if (mode === "reply") {
  say(`waiting for clify's ask ${askId}…`);
  const d = await nextMail(fromClify);
  if (!d) throw new Error("ask never arrived");
  say(`got "${d.subject}" from ${d.from_address}${d.attachment_metadata?.length ? ` with ${d.attachment_metadata.length} attachment(s): ${d.attachment_metadata.map((a: any) => a.filename).join(", ")}` : ""}`);
  const delay = Number(flag("delay") ?? 0);
  if (delay) {
    say(`reading it (replying in ${delay}s)…`);
    await sleep(delay * 1000);
  }
  await replyTo(d, flag("text") ?? "skip");
} else {
  // Peer agent policy (fixed, no model): it may approve writes to httpbin.org
  // (an echo service for tests) and tell clify to skip CAPTCHA-blocked sites.
  // Everything else goes back to the human.
  say(`peer agent online, watching for ask ${askId}…`);
  for (;;) {
    const d = await nextMail(fromClify);
    if (!d) throw new Error("no forwarded thread arrived");
    const cc = (d.cc_addresses ?? []).map((x: string) => x.toLowerCase());
    if (!/^fwd?:/i.test(d.subject)) {
      say(`cc'd on "${d.subject}" (to ${d.to_addresses.join(", ")}${cc.length ? `, cc ${cc.join(", ")}` : ""}): context noted; it's the human's call until clify forwards it to me`);
      continue;
    }
    const body: string = d.body_text ?? "";
    say(`delegated: "${d.subject}" (${body.length} chars of thread)`);
    const host = body.match(/"url":\s*"https?:\/\/([^/"]+)/)?.[1];
    let text: string;
    if (/Exact request/.test(body) && host === "httpbin.org") text = "approve\n\nPolicy: httpbin.org is an echo service used for tests, so this write is harmless. Approved on the human's behalf.";
    else if (/captcha|bot check/i.test(body)) text = "skip\n\nPolicy: CAPTCHAs are for the human, never for agents. Skip this site and move on.";
    else text = "deny\n\nNot covered by my policy; leaving it for the human.";
    await replyTo(d, text);
    break;
  }
}
