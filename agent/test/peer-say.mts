// Test only: make the Inkbox peer mailbox reply-all into a group thread, as a misbehaving peer agent would.
//   CLIFY_HOME=/data/home/.clify-peer node --import ../clify/node_modules/tsx/dist/esm/index.mjs test/peer-say.mts <subject> <inReplyTo> <to> <cc,cc> <text>
import { getIdentity } from "../../clify/src/vault.ts";
import { inkbox } from "../src/mail.ts";
import fs from "node:fs";
const [subject, inReplyTo, to, cc, text] = process.argv.slice(2);
const dir = "/tmp/peer-say";
fs.mkdirSync(dir, { recursive: true });
process.env.CLIFY_AGENT_SEND_TO = [to, ...cc.split(",")].join(",");
const t = inkbox(getIdentity()!, dir);
console.log(JSON.stringify(await t.send({ to, cc: cc.split(","), subject, text, inReplyTo })));
