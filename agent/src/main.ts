// clify agent entry point.
//
//   main.ts serve        run the agent loop for CLIFY_AGENT_ROLE (main | peer)
//   main.ts jobs         list jobs (no secrets)
//   main.ts show <job>   one job: mail log, steps and models (no secrets)
//   main.ts decisions [n] the last n policy decisions (who wrote, tier, accepted / ignored / capped, why)
//
// Environment (see deploy/*.env.example):
//   CLIFY_AGENT_ROLE      main | peer
//   CLIFY_HOME            clify home with this agent's vault (identity, keys, sessions)
//   CLIFY_AGENT_STATE     where jobs live (default $CLIFY_HOME/agent)
//   CLIFY_AGENT_ADDRESS   main: its Primitive address (default clify@<identity domain>)
//   CLIFY_AGENT_PEER      main: the peer agent's address
//   CLIFY_AGENT_HUMAN     main: who to email when blocked;  CLIFY_AGENT_HUMAN_TAG: subject tag
//   CLIFY_AGENT_OWNERS    main: owner-tier senders (full power, DMARC pass); default CLIFY_AGENT_HUMAN
//   CLIFY_AGENT_PUBLIC    main: 1 = any other DMARC-verified sender gets read-only public-tier jobs
//   CLIFY_AGENT_ACCEPT    peer: the main agent's address; main with the public tier off: who else may give (public-tier) jobs
//   CLIFY_AGENT_CAP_SENDER_JOBS / _SENDER_MSGS / _GLOBAL_JOBS / _SENDER_OUT / _THREAD_MSGS  public caps per UTC day (5 / 20 / 150 / 20 / 10)
//   CLIFY_AGENT_PUBLIC_HOME  clify home for public jobs: built-in specs only, no vault (default <CLIFY_HOME>-public)
//   CLIFY_AGENT_SEND_TO   comma list of address globs the agent may email besides people who wrote first; CLIFY_AGENT_CAPPED addr=N,...
//   CLIFY_AGENT_WRITE_SITES  sites where owner jobs may send writes (--yes) on the agent's own accounts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getIdentity } from "../../clify/src/vault.ts";
import { Agent, type Job } from "./agent.ts";
import { inkbox, primitive, type Inbound } from "./mail.ts";
import { DEFAULT_CAPS, Policy } from "./policy.ts";

const env = (k: string, d = "") => process.env[k]?.trim() || d;
const list = (k: string) => env(k).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const glob = (g: string) => new RegExp("^" + g.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^@\\s]*") + "$");

const here = path.dirname(new URL(import.meta.url).pathname);
const CLIFY_HOME = env("CLIFY_HOME", path.join(os.homedir(), ".clify"));
const STATE = env("CLIFY_AGENT_STATE", path.join(CLIFY_HOME, "agent"));
fs.mkdirSync(STATE, { recursive: true, mode: 0o700 });

function boxName(): string {
  const m = fs.existsSync(path.join(os.homedir(), "MACHINE.md")) ? fs.readFileSync(path.join(os.homedir(), "MACHINE.md"), "utf8").match(/\| Name \| (.+?) \|/) : null;
  return env("CLIFY_AGENT_BOX", m ? `InstaBox ${m[1].trim()}` : os.hostname());
}

function makeAgent(): Agent {
  const role = env("CLIFY_AGENT_ROLE", "main") as "main" | "peer";
  const i = getIdentity();
  if (!i) throw new Error(`no identity in the vault at ${CLIFY_HOME}`);
  const accept = list("CLIFY_AGENT_ACCEPT").map(glob);
  const peer = env("CLIFY_AGENT_PEER").toLowerCase() || undefined;
  const human = env("CLIFY_AGENT_HUMAN").toLowerCase() || undefined;
  const address = role === "main" ? env("CLIFY_AGENT_ADDRESS", `clify@${i.aliasDomain}`) : i.email!;
  const transport = role === "main" ? primitive(i, address, STATE) : inkbox(i, STATE);
  // The peer takes tasks only from the main agent; the main agent's senders go through the policy.
  const gate = (m: Inbound): string | null => (role === "main" || accept.some((re) => re.test(m.from)) ? null : "only the main agent gives the peer tasks");
  const num = (k: string, d: number) => Number(env(k)) || d;
  const policy =
    role === "main"
      ? new Policy(
          {
            owners: list("CLIFY_AGENT_OWNERS").length ? list("CLIFY_AGENT_OWNERS") : human ? [human] : [],
            open: env("CLIFY_AGENT_PUBLIC") === "1",
            accept,
            peer,
            human,
            caps: {
              senderJobs: num("CLIFY_AGENT_CAP_SENDER_JOBS", DEFAULT_CAPS.senderJobs),
              senderMsgs: num("CLIFY_AGENT_CAP_SENDER_MSGS", DEFAULT_CAPS.senderMsgs),
              globalJobs: num("CLIFY_AGENT_CAP_GLOBAL_JOBS", DEFAULT_CAPS.globalJobs),
              senderOut: num("CLIFY_AGENT_CAP_SENDER_OUT", DEFAULT_CAPS.senderOut),
              threadMsgs: num("CLIFY_AGENT_CAP_THREAD_MSGS", DEFAULT_CAPS.threadMsgs),
            },
          },
          STATE,
        )
      : undefined;
  const publicHome = path.resolve(env("CLIFY_AGENT_PUBLIC_HOME", `${CLIFY_HOME.replace(/\/$/, "")}-public`));
  if (publicHome === path.resolve(CLIFY_HOME) || fs.existsSync(path.join(publicHome, "vault.enc"))) throw new Error(`CLIFY_AGENT_PUBLIC_HOME ${publicHome} must be its own clify home with no vault`);
  return new Agent({
    role,
    name: role === "main" ? "clify agent" : "clify research agent (peer)",
    transport,
    stateDir: STATE,
    accept: gate,
    peer,
    human,
    humanTag: env("CLIFY_AGENT_HUMAN_TAG"),
    boxName: boxName(),
    clifyBin: env("CLIFY_AGENT_CLIFY", path.resolve(here, "..", "bin", "clify")),
    clifyHome: CLIFY_HOME,
    writeSites: list("CLIFY_AGENT_WRITE_SITES"),
    policy,
    specsDir: path.resolve(here, "..", "..", "clify", "specs"),
    publicHome,
  });
}

function summary(j: Job) {
  return { id: j.id, role: j.role, ...(j.tier ? { tier: j.tier } : {}), status: j.status, requester: j.requester, subject: j.subject, created: j.createdAt, updated: j.updatedAt, mails: j.mail.length, threads: Object.values(j.threads).map((t) => `${t.kind}:${t.with}`), models: [...new Set(j.steps.filter((s) => s.kind === "llm").map((s) => s.model))] };
}

// A job as Markdown: every email (ids, timestamps, sender check, attachments) and every step.
function transcript(j: Job): string {
  const models = j.steps.filter((s) => s.kind === "llm").reduce<Record<string, number>>((a, s) => ((a[s.model!] = (a[s.model!] ?? 0) + 1), a), {});
  const kinds = Object.fromEntries(Object.entries(j.threads).map(([id, t]) => [id, t.kind]));
  const out = [
    `# ${j.subject}`,
    "",
    `- Job \`${j.id}\` (${j.role} agent on ${boxName()}${j.tier ? `, ${j.tier} tier` : ""}), status **${j.status}**`,
    `- Requester: ${j.requester}`,
    `- Started ${j.createdAt}, last update ${j.updatedAt}`,
    `- Model calls: ${Object.entries(models).map(([m, n]) => `${m} × ${n}`).join(", ")}`,
    "",
    "## Emails",
    "",
  ];
  j.mail.forEach((m, n) => {
    out.push(`### ${n + 1}. ${m.dir === "in" ? "⬅ in" : "➡ out"} · ${m.from} → ${m.to.join(", ")}${m.cc?.length ? ` (cc ${m.cc.join(", ")})` : ""}`);
    out.push("");
    out.push(`- Time: ${m.at}`);
    out.push(`- Subject: ${m.subject}`);
    out.push(`- Thread: ${kinds[m.threadId ?? ""] ?? "?"} \`${m.threadId}\` · ${m.provider} id \`${m.id}\``);
    if (m.messageId) out.push(`- Message-ID: \`${m.messageId}\``);
    if (m.dir === "in" && m.provider === "primitive") out.push(`- Sender check: ${m.verified ? "DMARC pass" : "not verified"}${m.auth ? ` (${m.auth})` : ""}`);
    if (m.attachments.length) out.push(`- Attachments: ${m.attachments.join(", ")}`);
    out.push("", "```text", m.text.trim().replace(/```/g, "'''"), "```", "");
  });
  out.push("## Steps", "");
  for (const s of j.steps) {
    const inp = s.kind === "tool" ? (s.tool === "clify" ? `\`clify ${((s.input as any)?.args ?? []).join(" ").replace(/(--(authenticity_token|csrfmiddlewaretoken) )[\w-]{20,}/g, "$1<csrf token>")}\`` : s.tool === "write_file" ? `\`${(s.input as any)?.name}\`` : "") : "";
    out.push(`- ${s.at.slice(11, 19)} ${s.kind === "llm" ? `model ${s.model} (${s.tokens?.in} in / ${s.tokens?.out} out tokens, ${s.ms} ms)` : s.kind === "tool" ? `${s.ok ? "✓" : "✗"} **${s.tool}** ${inp} ${s.summary && s.tool !== "clify" ? `— ${s.summary}` : ""}` : `_${s.summary}_`}`);
  }
  return out.join("\n") + "\n";
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "serve") {
  await makeAgent().run();
} else if (cmd === "jobs" || cmd === "show" || cmd === "transcript") {
  const dir = path.join(STATE, "jobs");
  const jobs: Job[] = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) : [];
  if (cmd === "jobs") console.log(JSON.stringify(jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(summary), null, 2));
  else {
    const j = jobs.find((x) => x.id === arg);
    if (!j) throw new Error(`no job ${arg}`);
    if (cmd === "show") console.log(JSON.stringify({ ...summary(j), mail: j.mail, steps: j.steps }, null, 2));
    else console.log(transcript(j));
  }
} else if (cmd === "decisions") {
  const f = path.join(STATE, "decisions.jsonl");
  const rows = fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean) : [];
  console.log(rows.slice(-(Number(arg) || 50)).join("\n"));
} else {
  console.error("usage: main.ts serve | jobs | show <job> | transcript <job> | decisions [n]");
  process.exit(1);
}
