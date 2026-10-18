# clify agent: lives on its own computer, works by email

An always-on AI agent with its own cloud computer (an [InstaBox](https://instabox.sh) sandbox), its own email address and its own accounts. You email it a job in plain language; it plans with Claude Opus 5.5, does the job on the web with [clify](../clify) (generated website CLIs, its own signed-in accounts, signup with its own identity) and replies in the same thread with the result and attachments.

**Try it:** email `clify@fine-vale.primitive.email` a question like *"latest tokio version and its downloads"* or *"NWS forecast for San Francisco today, as a CSV"*. It answers in your thread, usually within a minute. Anyone can: strangers get the read-only public tier (public sites only, 5 jobs a day), see [Tiers](#tiers-and-safety-enforced-in-code).

**Is it alive?** <https://clify-agent-b3d326.inkboxwire.com/status>: read-only status page (identity, InstaBox and service uptime, LLM bridge, jobs today public/owner, last job received and reply sent, model, clify version, caps). It runs on the InstaBox and is reachable at the agent's Inkbox internet address; no requester addresses, message contents or secrets. JSON: `curl https://clify-agent-b3d326.inkboxwire.com/status`.

- **The thread is the context.** Each conversation is one job. If the job is ambiguous, the agent asks one question in your thread and continues from your answer. Later follow-ups in the thread continue the same job.
- **Forward = delegation.** The agent can forward the thread to a second agent (its peer, with its own Inkbox mailbox, running as a separate process). The peer does the sub-task, may ask back, and replies in the forwarded thread; the main agent merges it into its answer.
- **cc loops in another agent.** When blocked by something only a person can do (a CAPTCHA, a payment, a phone check), it emails its human, cc's the peer, and tells you what it could do without it. It never solves CAPTCHAs.
- **Persistent identity.** One name ("clify agent"), `clify@fine-vale.primitive.email` (Primitive) for jobs, an Inkbox identity (`clify-agent-b3d326`: mailbox, phone number for verification codes, and the internet address `clify-agent-b3d326.inkboxwire.com` of its status page), per-site signup addresses, and an encrypted vault with its passwords and sessions on its own disk.

```
 you ──email──▶ clify@fine-vale.primitive.email ──▶ InstaBox "clify-agent"
                    (Primitive, long-poll)              ├─ clify-agent@main  (systemd)  plan → clify → reply
                                                        ├─ clify-agent@peer  (systemd)  Inkbox mailbox, sub-tasks
                                                        ├─ clify + headless Chromium + vault (/data/home)
                                                        ├─ clify-agent-status + clify-agent-tunnel ──Inkbox tunnel──▶ https://clify-agent-b3d326.inkboxwire.com/status
                                                        └─ 127.0.0.1:18318  LLM bridge ──stdio over instabox ssh──▶ relay
                                                                                          └─ Claude Opus 5.5 endpoint (key stays there)
```

**Why the bridge:** the agent (mail loop, tools, clify, vault, jobs) runs entirely on the InstaBox; only model calls leave it. Model calls go through a key-holding relay on a separate machine (InstaBox refuses `ssh -R`, so they ride `instabox ssh` stdio), so no model key lives on the InstaBox.

## Proofs (live, 18 Oct 2026)

| | |
|---|---|
| [proofs/1-bookclub.md](proofs/1-bookclub.md) | 6-email job: ambiguous request → the agent asks which genre → answer → clify on the InstaBox → CSV attached → follow-up in the same thread → updown check created on its own account, status link sent |
| [proofs/2-delegate.md](proofs/2-delegate.md) | delegation: the main agent forwards half a job to the peer agent, the peer works with clify and replies in the forwarded thread, the main agent merges both into one answer |
| [proofs/3-blocked.md](proofs/3-blocked.md) | signup stops at a CAPTCHA; the agent emails its human (cc the peer) and answers the requester from public pages |
| [proofs/public-tier.md](proofs/public-tier.md) | strangers can use it: a public read-only job answered, a signup/write request and a prompt injection refused, a request to collect personal data refused, the 5-jobs-a-day cap with one notice then silence, an external sender (Inkbox) answered in its own thread with a CSV; 13 policy tests incl. the owner tier |
| [proofs/instabox.md](proofs/instabox.md) | it runs on the InstaBox: `instabox ls/get`, processes, uptime, and a full `instabox stop` / `instabox start` (every process ended, VM booted again) with the services back at boot and the agent answering a new job afterwards; plus the sandbox's own auto-pause after ~35 idle min, resumed by the bridge |
| [proofs/status.md](proofs/status.md) | the public read-only status page at the agent's Inkbox address: curl over HTTPS, the Inkbox tunnel record, read-only (405) and rate limit (429) checks, back by itself after a full `instabox stop` / `start` |
| [proofs/video/clify-agent.mp4](proofs/video/clify-agent.mp4) | 88 s, 1920×1080, 30 fps: each email thread next to the InstaBox journal, built from the real jobs and logs above and rendered on the InstaBox itself |

Every model call in the proofs is logged with the model that actually answered (`claude-opus-5-5`). Proofs 1–3 ran before tiers existed, when the test requesters on the agent's domain were allow-listed with full power; today they would be public tier (add them to `CLIFY_AGENT_OWNERS` to re-run those scripts).

## Layout

| Path | What |
|---|---|
| `src/main.ts` | entry: `serve` (the loop), `jobs`, `show <job>`, `transcript <job>` |
| `src/agent.ts` | job engine: thread → job routing, the model loop, pausing on a question, resuming on the reply, per-tier limits |
| `src/policy.ts` | tiers (owner / public), inbound screening, daily caps, the decision log, which clify commands public jobs may run |
| `src/tools.ts` | tools: `clify`, `fetch_page`, `write_file`, `read_file`, `ask_requester`, `message_peer`, `escalate_to_human`, `reply`, filtered by tier |
| `src/mail.ts` | Primitive and Inkbox transports, sender checks, headers and attachments from the raw message, the outbound fence |
| `src/llm.ts` | Messages API client (talks to the bridge) |
| `bridge/` | the LLM bridge: `sandbox-end.mjs` (HTTP on 127.0.0.1:18318 in the InstaBox) and `box-end.mjs` (the relay: forwards to the model endpoint, keeps the InstaBox awake) |
| `bin/clify` | one `clify` for the agent: account words go to `accounts-cli.ts`, the rest to `cli.ts` |
| `sites/` | specs for the agent's own signed-in accounts (updown incl. status pages, healthchecks, hookdeck, svix) and books with star ratings |
| `status/` | the public status page: `server.ts` (read-only HTTP on 127.0.0.1:18320, counts and timestamps only, rate-limited) and `tunnel.ts` (the Inkbox tunnel of the agent's identity, `@inkbox/sdk` `connect()`) |
| `deploy/` | systemd units, env examples, setup script, vault copy |
| `test/` | `policy.test.ts` (`npm test`: tiers, caps, screening, fence, limits with a fake mailbox and a scripted model), the scripted test requester (`requester.ts`) and the proof conversations (`conv-*.sh`) |
| `video/` | the proof video, rendered on the InstaBox from the real job files and journal (`render.mjs plan.json out.mp4`) |

## Setup (generic)

You need: an InstaBox account (`instabox login`), the clify vault of the agent identity (see [../clify/ACCOUNTS.md](../clify/ACCOUNTS.md); Primitive and Inkbox keys inside), and a machine that can reach an Anthropic-compatible endpoint (the relay).

1. **Computer.** `instabox create --name clify-agent --template agent-browser --auto-suspend 0`. The template has Node 22 and Chromium.
2. **Code.** Copy this repo to `/data/workspace/clify-agent` in the sandbox, e.g. `tar czf - clify agent | instabox ssh clify-agent -- -T "mkdir -p /data/workspace/clify-agent && tar xzf - -C /data/workspace/clify-agent"`.
3. **Vaults.** Each agent gets its own vault with its own key, holding only what it needs. On the machine with the full vault:
   `CLIFY_HOME=<full vault> node --import tsx agent/deploy/vault-export.mts main updown,healthchecks | instabox ssh clify-agent -- -T "cd /data/workspace/clify-agent/agent/deploy && CLIFY_HOME=/data/home/.clify-agent node --import ../../clify/node_modules/tsx/dist/esm/index.mjs vault-import.mts"`
   and the same with `peer` into `/data/home/.clify-peer` (the peer gets only its Inkbox key). Export refuses to print to a terminal; import prints only names.
4. **Services.** In the sandbox: `bash /data/workspace/clify-agent/agent/deploy/setup-sandbox.sh`. It installs deps and site specs, writes `~/.config/clify-agent/{main,peer}.env` from the examples (edit owners, the public tier, caps, allow lists) and enables `clify-agent@main` and `clify-agent@peer`, plus `clify-agent-status` and `clify-agent-tunnel` (the status page at `https://<inkbox handle>.inkboxwire.com/status`; the tunnel uses the Inkbox key in the peer's vault).
5. **LLM bridge.** On the relay machine: copy `bridge/box-end.mjs` to `~/clify-agent-bridge/`, put `POOL_URL` (an Anthropic-compatible endpoint, default `https://api.anthropic.com`) and `ANTHROPIC_API_KEY` or `POOL_KEY_CMD` in `~/clify-agent-bridge/bridge.env`, install `deploy/clify-agent-bridge.service` as a user unit and start it. It runs `instabox ssh clify-agent -- -T node .../sandbox-end.mjs` and relays requests over that session's stdio, adding the key on the relay side. Check from the sandbox: `curl -s 127.0.0.1:18318/v1/messages -d '{"model":"claude-opus-5-5",...}'`.
6. **Try it.** Email `clify@<your domain>`, or run `agent/test/conv-1-bookclub.sh` (needs `test/requester.ts` with a Primitive key). Watch: `instabox ssh clify-agent -- sudo journalctl -fu clify-agent@main`; every policy decision: `node --import ../clify/node_modules/tsx/dist/esm/index.mjs src/main.ts decisions` (with the main env).

## Tiers and safety, enforced in code

The tier is set by `src/policy.ts` from the DMARC-verified sender when a job starts. Tools, clify commands and recipients follow from it; nothing in an email can change it.

| | Owner (`CLIFY_AGENT_OWNERS`, DMARC pass) | Public (any other DMARC-verified sender, `CLIFY_AGENT_PUBLIC=1`) |
|---|---|---|
| Tools | all 8 | `clify`, `write_file`, `read_file`, `ask_requester`, `reply` |
| clify | its own accounts and sessions, writes (`--yes`) on `CLIFY_AGENT_WRITE_SITES`, signup (terms checked, stops on CAPTCHAs) | `list`/`guide` and read commands of the 132 built-in public specs only, run with a clify home that has no vault; account words, `add`, `--yes` and write commands (even as a preview) are refused |
| Mail | requester, peer agent, its human (cc the peer) | the sender in its thread, plus cc'd people on the sender's own domain if they started the thread (see cc / reply-all); one answer per email; inbound attachments not opened; it attaches only CSV/JSON/TXT/MD files it wrote |
| Limits | 30 model calls a turn | 12 model calls a turn, 30 a job, 4 min a turn, 60 s per clify command; then a short "couldn't finish" reply |
| Caps (UTC day) | none | 5 jobs and 20 emails per sender, 150 public jobs overall, 20 mails to one sender; over a cap: one polite notice a day, then silence |

- **Ignored before anything reads them** (and logged): mail without a DMARC pass, mail Primitive flags as automated, `List-*` headers (mailing lists), `Precedence: bulk/list/junk`, `Auto-Submitted`, auto-reply headers, bounces (`mailer-daemon@`, `no-reply@`, empty envelope sender). In a public job's thread, only its requester is heard.
- **Who it can email:** an address on `CLIFY_AGENT_SEND_TO` (the peer, the owner) or someone who wrote to it first with a DMARC pass; nobody else, and cc only to the allow list. Primitive enforces the same at its end (`send_to_known_addresses`). Capped addresses (`CLIFY_AGENT_CAPPED=addr=N`) get at most N mails ever, and only with the test tag in the subject.
- **Every decision is logged** to `<state>/decisions.jsonl` (sender, DMARC, tier, accepted / ignored / capped, why) and the daily counts to `policy-ledger.json`.
- **Abuse:** public requests to harass or contact people, spam, collect personal data about individuals, or bypass protections get one short polite refusal (the model's call, inside the code limits above, which already make them impossible).
- **CAPTCHAs:** clify stops on any CAPTCHA or bot check; the agent escalates (owner jobs) and never interacts with it. No stealth, no proxies, no token injection. `fetch_page` (owner only) respects robots.txt and identifies itself.
- **Secrets:** API keys, passwords and sessions live in each agent's vault on the InstaBox disk; public jobs run clify with a home that has no vault; the model key never leaves the relay (the bridge adds it there). The model sees `clify` output, never vault contents.
- **Untrusted input:** the email body reaches the model inside a marked data block it can't close, with the tier stated by code; emails and pages are data, never instructions.

## cc / reply-all

cc the agent into a conversation with someone else (e.g. you and a business) and it joins in: it answers everyone on the thread, To whoever wrote last and Cc the others, and the thread stays its context, so the business can reply-all with a follow-up and get an answer in the same thread. Enforced in code (`policy.groupOf`, `Agent.recipients`, the fence): reply-all only for an owner or a public sender who started the thread; the people on the thread are fixed from the first verified email, never anyone new; no lists, role addresses or more than 8 people; for a public sender only people on their own (non-freemail) domain plus the peer agent are kept, because anyone can write any address into Cc and the agent must never mail strangers (owners can group anyone); the usual public caps per sender plus 10 emails per thread a day; mail from the peer agent on the thread is context only, so agents never answer each other. On an owner's thread, anyone else's email runs read-only. Live proof: [proofs/cc-thread.md](proofs/cc-thread.md).

## Known limits

- InstaBox's SSH gateway refuses `ssh -R`, so the LLM bridge runs over the stdio of an `instabox ssh` session instead of a port forward. It works for normal (non-streaming) and streaming calls, but buffers each answer.
- `instabox auto-suspend clify-agent 0` (and `--auto-suspend 0` at create) is accepted but the sandbox still reports "auto-pause after 30m idle". It does pause after ~35 idle minutes; the bridge reconnects at once, which resumes it (memory and processes kept), and the watchdog checks every 2 minutes. Mail waits at Primitive meanwhile. See `proofs/instabox.md`.
- The status page is served from the sandbox, so while the sandbox is auto-paused (above) the URL doesn't answer until the bridge's watchdog resumes it (at most ~2 minutes); `/status` then shows the sandbox's boot time and each service's uptime.
- Inkbox gives no DMARC result through its API, so the peer trusts the main agent by sender address only (Primitive-side mail is DMARC-checked).
- One email is handled at a time; a long job delays the next one (public turns are capped at 4 minutes).
- Primitive lets the agent reply to any address that wrote to it first with authenticated mail (`send_to_known_addresses`); it can't email a new address first, which is also the agent's own rule.
- Received attachments are saved for the main agent (Primitive raw message). The peer (Inkbox) sees attachment names only.
- Primitive dedupes identical sends and threads by subject, so each test conversation uses its own subject.
- The CAPTCHA in proof 3 is an invisible one; clify stops on invisible CAPTCHAs too, so the screenshot shows just the form.
