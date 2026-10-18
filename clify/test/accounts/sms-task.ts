// Real SMS proof: in an account the agent already has, have the site text the
// agent's own number (add the number + verify / send a test), then read the SMS
// back through clify's Inkbox SMS reader.
// Usage: node --import tsx test/accounts/sms-task.ts <site> "<instruction>"
import { waitForSmsCode } from "../../src/codes.ts";
import { listSms } from "../../src/identity.ts";
import { runAuthFlow } from "../../src/signup.ts";
import { getIdentity, getSite } from "../../src/vault.ts";

const [site, instruction] = process.argv.slice(2);
const s = getSite(site);
const id = getIdentity();
if (!s?.origin || !id?.phone) throw new Error("need an existing account and a phone number");
const startedAt = new Date(Date.now() - 5000);
const r = await runAuthFlow({
  name: site,
  url: s.probe?.url ?? s.origin,
  mode: "login",
  email: s.email!,
  username: s.username,
  password: s.password ?? "",
  phone: id.phone,
  storageState: s.storage,
  maxSteps: 30,
  goal: `You are already signed in (resumed session). Task: ${instruction} Use {{phone}} / {{phone_national}} for the number. If a verification code is texted, call check_sms and type {{code}}. Then open the account page and call done(result="logged_in").`,
});
const texts = await listSms(startedAt);
const code = texts.length ? await waitForSmsCode({ after: startedAt, timeoutMs: 5000 }) : null;
console.log(JSON.stringify({ site, flowOk: r.ok, channel: r.verificationChannel, blockers: r.blockers, smsReceived: texts.map((t) => ({ from: t.from, at: t.receivedAt, text: t.text.slice(0, 160) })), extractedCode: code?.code ?? null }, null, 2));
