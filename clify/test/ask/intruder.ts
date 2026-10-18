// A third party that tries to answer clify's ask: it waits for the next ask
// clify sends, then replies in that thread (same subject, In-Reply-To) from an
// address that was not asked. clify must list it under `ignored` and not act on it.
//
//   intruder.ts [--text approve] [--wait 300]
import { listAsks } from "../../src/ask.ts";
import { PRIMITIVE_API } from "../../src/identity.ts";
import { getIdentity } from "../../src/vault.ts";

const args = process.argv.slice(2);
const flag = (k: string) => (args.indexOf(`--${k}`) >= 0 ? args[args.indexOf(`--${k}`) + 1] : undefined);
const i = getIdentity()!;
const from = `intruder@${i.aliasDomain}`;
const start = new Date().toISOString();
const deadline = Date.now() + Number(flag("wait") ?? 300) * 1000;
const say = (s: string) => process.stdout.write(`${new Date().toISOString().slice(11, 19)} [${from}] ${s}\n`);

say("waiting for clify's next ask…");
while (Date.now() < deadline) {
  const rec = listAsks().find((r) => r.createdAt > start && r.sent[0]?.messageId);
  if (rec) {
    const s = rec.sent[0];
    const res = await fetch(`${PRIMITIVE_API}/send-mail`, {
      method: "POST",
      headers: { authorization: `Bearer ${i.apiKeys!.primitive}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: rec.from, subject: `Re: ${s.subject}`, body_text: flag("text") ?? "approve", in_reply_to: s.messageId, references: [s.messageId] }),
    });
    say(`replied ${JSON.stringify(flag("text") ?? "approve")} in the thread of ${rec.id} (HTTP ${res.status})`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
say("no ask seen");
