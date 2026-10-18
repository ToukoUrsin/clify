// Who may give the main agent work, and what each sender may do. Enforced here
// in code, never by the prompt: the tier is set from the verified sender when a
// job starts, and the tools, clify commands and recipients follow from it.
//
//   owner   the addresses in CLIFY_AGENT_OWNERS, DMARC-verified. Full power:
//           the agent's own accounts, writes on CLIFY_AGENT_WRITE_SITES, signups
//           (terms checked, never CAPTCHAs), the peer agent, escalation.
//   public  any other DMARC-verified sender (CLIFY_AGENT_PUBLIC=1). Read-only
//           clify on the built-in public sites, run with a clify home that has
//           no vault; answers go to the sender, in the same thread (and to
//           the people they cc'd, see "Group threads" below).
//
// Mail that is automated, bulk, from a mailing list or not DMARC-verified is
// ignored. Public senders have daily caps; every decision is logged to
// <state>/decisions.jsonl.
import fs from "node:fs";
import path from "node:path";
import type { Inbound } from "./mail.ts";

export type Tier = "owner" | "public";

export interface Caps {
  senderJobs: number; // new jobs per public sender per UTC day
  senderMsgs: number; // emails per public sender per UTC day
  globalJobs: number; // public jobs per UTC day, all senders
  senderOut: number; // emails the agent sends one public sender per UTC day
  threadMsgs: number; // public emails accepted in one thread per UTC day, all senders
}

export interface Limits {
  rounds: number; // model calls per turn (one email in → the agent's answer)
  jobRounds: number; // model calls over the whole job
  turnMs: number; // wall time per turn
  clifyMs: number; // one clify command
}

export const DEFAULT_CAPS: Caps = { senderJobs: 5, senderMsgs: 20, globalJobs: 150, senderOut: 20, threadMsgs: 10 };
export const LIMITS: Record<Tier, Limits> = {
  owner: { rounds: 30, jobRounds: 200, turnMs: 30 * 60_000, clifyMs: 8 * 60_000 },
  public: { rounds: 12, jobRounds: 30, turnMs: 4 * 60_000, clifyMs: 60_000 },
};

// Tools per tier. Public jobs never forward, never escalate, never fetch arbitrary pages.
export const TOOLS: Record<Tier, Set<string>> = {
  owner: new Set(["clify", "fetch_page", "write_file", "read_file", "ask_requester", "message_peer", "escalate_to_human", "reply"]),
  public: new Set(["clify", "write_file", "read_file", "ask_requester", "reply"]),
};

// The rules a turn runs under: never more than the job's tier, and public when
// the email came from a public person on an owner's group thread.
export const tierNow = (j: { tier?: Tier; turn?: Tier }): Tier => (j.tier === "public" || j.turn === "public" ? "public" : j.tier ?? "owner");

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();

// ── Inbound screening ────────────────────────────────────────────────────
// Returns why a mail must be ignored before anyone looks at its content, or null.
export function screen(m: Inbound): string | null {
  const h = m.headers ?? {};
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?)([+@.-]|$)/i.test(m.from)) return `automated sender address ${m.from}`;
  if (m.automated) return `automated mail${m.automatedReasons?.length ? ` (${m.automatedReasons.join(", ")})` : ""}`;
  if (h["list-id"] || h["list-unsubscribe"] || h["list-post"]) return "mailing list mail (List-* headers)";
  if (/^(bulk|list|junk|auto_reply)$/i.test(h["precedence"] ?? "")) return `bulk mail (Precedence: ${h["precedence"]})`;
  if (h["auto-submitted"] && !/^no\b/i.test(h["auto-submitted"])) return `auto-reply (Auto-Submitted: ${h["auto-submitted"]})`;
  if (h["x-autoreply"] || h["x-autorespond"] || h["x-auto-reply"]) return "auto-reply (X-Autoreply)";
  if (m.nullSender) return "bounce (empty envelope sender)";
  if (!m.verified) return "sender failed DMARC (no aligned SPF/DKIM pass)";
  return null;
}

// ── Per-day ledger ───────────────────────────────────────────────────────
interface SenderDay {
  jobs: number;
  msgs: number;
  out: number;
  noticed?: boolean;
}
interface LedgerData {
  day: string;
  jobs: number;
  senders: Record<string, SenderDay>;
  threads: Record<string, number>; // public emails accepted per thread today
  known: Record<string, string>; // addresses that wrote first with DMARC pass → first seen
  onThread: Record<string, string>; // addresses on a verified group thread with the agent → first seen (may be cc'd)
}

export class Ledger {
  file: string;
  d: LedgerData;
  constructor(stateDir: string) {
    this.file = path.join(stateDir, "policy-ledger.json");
    this.d = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, "utf8")) : { day: today(), jobs: 0, senders: {}, threads: {}, known: {}, onThread: {} };
    this.d.known ??= {};
    this.d.threads ??= {};
    this.d.onThread ??= {};
  }
  roll() {
    if (this.d.day !== today()) Object.assign(this.d, { day: today(), jobs: 0, senders: {}, threads: {} });
  }
  sender(a: string): SenderDay {
    this.roll();
    return (this.d.senders[a] ??= { jobs: 0, msgs: 0, out: 0 });
  }
  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.d, null, 2), { mode: 0o600 });
  }
  isKnown(a: string) {
    return !!this.d.known[a.toLowerCase()];
  }
}

// Addresses that may get mail without being on CLIFY_AGENT_SEND_TO: they wrote first.
export function knownSenders(stateDir: string): Set<string> {
  const f = path.join(stateDir, "policy-ledger.json");
  return new Set(fs.existsSync(f) ? Object.keys(JSON.parse(fs.readFileSync(f, "utf8")).known ?? {}) : []);
}

// Addresses that may be cc'd: they were on a verified group thread with the agent (see groupOf).
export function threadPeople(stateDir: string): Set<string> {
  const f = path.join(stateDir, "policy-ledger.json");
  return new Set(fs.existsSync(f) ? Object.keys(JSON.parse(fs.readFileSync(f, "utf8")).onThread ?? {}) : []);
}

// Outbound to a public sender counts against its daily cap (the fence calls this).
export function countOutbound(stateDir: string, to: string, cap: number): void {
  const l = new Ledger(stateDir);
  const s = l.sender(to.toLowerCase());
  if (s.out >= cap) throw new Error(`send refused: ${to} already got ${cap} mails today`);
  s.out++;
  l.save();
}

// ── Decisions ────────────────────────────────────────────────────────────
export type Decision =
  | { action: "accept"; tier: Tier; newJob: boolean; reason: string }
  | { action: "ignore"; reason: string }
  | { action: "notice"; reason: string; text: string };

export interface PolicyConfig {
  owners: string[];
  open: boolean; // public tier on: any verified sender may give read-only jobs
  accept: RegExp[]; // when not open: non-owners must match this
  peer?: string;
  human?: string;
  caps: Caps;
}

export interface JobRef {
  tier?: Tier;
  requester: string;
  origin?: string; // the requester's thread: the key of the per-thread cap
  group?: string[]; // a group thread's people (reply-all), see groupOf
}

// ── Group threads (cc / reply-all) ───────────────────────────────────────
// A person cc's the agent into a conversation with someone else: the agent
// joins it and answers everyone on it. Who is on it is decided here, from the
// first verified email, never by the model, and never grows later:
//   - the sender plus the other To/Cc addresses of that email, minus the agent;
//   - only for an owner, or a public sender who started the thread (a public
//     email that already answers an earlier thread gets an answer to its
//     sender only: the others never asked for the agent);
//   - no role or list addresses (no-reply, lists, groups), and no more than
//     MAX_GROUP people (more is bulk: sender only). Mailing-list mail is
//     ignored outright by screen().
export const MAX_GROUP = 8;
const NOT_A_PERSON = /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?|notifications?|lists?|all|everyone|announce)([+@.-]|$)|@(googlegroups\.com|groups\.|lists?\.)/i;

// A public sender can write any address into To/Cc without the mail ever
// reaching it, so for the public tier the agent only copies people on the
// sender's own (non-freemail) domain, plus its own peer agent: it can never be
// used to mail strangers. Owners may group anyone.
const FREEMAIL = /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|yandex|zoho|fastmail|hey|tutanota|tuta)\./i;
const domainOf = (a: string) => a.slice(a.lastIndexOf("@") + 1).toLowerCase();

export function groupOf(m: Inbound, self: string, tier: Tier, peer?: string): { group: string[]; why: string } {
  const others = [...new Set([...m.to, ...m.cc].map((a) => a.toLowerCase()))].filter((a) => a !== self.toLowerCase() && a !== m.from);
  if (!others.length) return { group: [], why: "only the agent was addressed" };
  let people = others.filter((a) => !NOT_A_PERSON.test(a));
  if (tier === "public") {
    const home = domainOf(m.from);
    const same = (a: string) => !FREEMAIL.test(home) && domainOf(a) === home;
    const kept = people.filter((a) => same(a) || (peer && a === peer.toLowerCase()));
    if (!kept.length && people.length) return { group: [], why: "a public sender's cc'd people are outside their own domain: answering the sender only" };
    people = kept;
  }
  if (!people.length) return { group: [], why: "no people besides the agent (role or list addresses only): answering the sender only" };
  if (people.length > MAX_GROUP) return { group: [], why: `${people.length} recipients is bulk: answering the sender only` };
  if (tier === "public" && (m.references?.length || m.headers?.["in-reply-to"])) return { group: [], why: "a public sender cc'd the agent into a thread they may not have started: answering the sender only" };
  return { group: [m.from, ...people], why: `group thread: reply-all to ${[m.from, ...people].join(", ")}` };
}

export class Policy {
  log: string;
  constructor(public cfg: PolicyConfig, public stateDir: string) {
    this.log = path.join(stateDir, "decisions.jsonl");
  }

  // Read fresh every time: the outbound fence updates the same file.
  get ledger() {
    return new Ledger(this.stateDir);
  }

  tierOf(from: string): Tier {
    return this.cfg.owners.includes(from) ? "owner" : "public";
  }

  decide(m: Inbound, job?: JobRef): Decision {
    const why = screen(m);
    if (why) return { action: "ignore", reason: why };
    const from = m.from;
    if (job) {
      const tier = job.tier ?? "owner";
      const inGroup = from !== job.requester && !!job.group?.includes(from);
      if (tier === "public") {
        if (from !== job.requester && !inGroup) return { action: "ignore", reason: `${from} is not the requester of this public job${job.group ? " or on its thread" : ""}` };
        return this.capMsgs(from) ?? this.capThread(job.origin) ?? { action: "accept", tier, newJob: false, reason: !inGroup ? "follow-up in the requester's thread" : from === this.cfg.peer ? "the peer agent on the group thread (kept as context, never answered)" : "follow-up from a person on the group thread" };
      }
      if (from === job.requester || from === this.cfg.peer || from === this.cfg.human) return { action: "accept", tier, newJob: false, reason: "follow-up in an owner job" };
      // Someone else the owner put on the thread: heard, but this turn is public (read-only), and capped like any public sender.
      if (inGroup) return this.capMsgs(from) ?? this.capThread(job.origin) ?? { action: "accept", tier: this.tierOf(from), newJob: false, reason: "follow-up from a person on the owner's group thread (this turn: their own tier)" };
      return { action: "ignore", reason: `${from} is not part of this owner job` };
    }
    const tier = this.tierOf(from);
    if (tier === "owner") return { action: "accept", tier, newJob: true, reason: "owner, DMARC pass" };
    if ((from === this.cfg.peer || from === this.cfg.human) && /^re:/i.test(m.subject)) return { action: "ignore", reason: "a reply that is not in any job's thread" };
    if (!this.cfg.open && !this.cfg.accept.some((re) => re.test(from))) return { action: "ignore", reason: "public tier is closed and the sender is not on the allow list" };
    const L = this.ledger;
    const s = L.sender(from);
    const c = this.cfg.caps;
    const capped = this.capMsgs(from);
    if (capped) return capped;
    if (s.jobs >= c.senderJobs) return this.notice(from, `sender cap: ${s.jobs}/${c.senderJobs} jobs today`, `Thanks for writing. Public requests are limited to ${c.senderJobs} jobs per sender per day, and today's are used up. Please try again tomorrow (the day resets at 00:00 UTC).`);
    if (L.d.jobs >= c.globalJobs) return this.notice(from, `global cap: ${L.d.jobs}/${c.globalJobs} public jobs today`, `Thanks for writing. I've reached today's limit of ${c.globalJobs} public jobs. Please try again tomorrow (the day resets at 00:00 UTC).`);
    return { action: "accept", tier, newJob: true, reason: "public sender, DMARC pass" };
  }

  capMsgs(from: string): Decision | null {
    const s = this.ledger.sender(from);
    const c = this.cfg.caps;
    if (s.msgs < c.senderMsgs) return null;
    return this.notice(from, `sender cap: ${s.msgs}/${c.senderMsgs} emails today`, `Thanks for writing. Public requests are limited to ${c.senderMsgs} emails per sender per day, and today's are used up. Please try again tomorrow (the day resets at 00:00 UTC).`);
  }

  // A group thread can't run forever: at most threadMsgs public emails a day, then silence (no notice to everyone on it).
  capThread(thread?: string): Decision | null {
    const n = (thread && this.ledger.d.threads[thread]) || 0;
    if (!thread || n < this.cfg.caps.threadMsgs) return null;
    return { action: "ignore", reason: `thread cap: ${n}/${this.cfg.caps.threadMsgs} public emails in this thread today` };
  }

  // At most one cap notice per sender per day; after that, silence.
  notice(from: string, reason: string, text: string): Decision {
    const s = this.ledger.sender(from);
    if (s.noticed) return { action: "ignore", reason: `${reason}; already told today` };
    return { action: "notice", reason, text };
  }

  // Count what was accepted (or noticed) and remember who wrote first.
  // o.thread: the job's requester thread (per-thread cap); o.group: the people of a new group thread, who may then be cc'd.
  commit(m: Inbound, d: Decision, o: { thread?: string; group?: string[] } = {}) {
    const L = this.ledger;
    const s = L.sender(m.from);
    if (d.action !== "ignore") L.d.known[m.from] ??= now(); // wrote first, DMARC pass: may get an answer
    if (d.action === "notice") s.noticed = true;
    if (d.action === "accept") {
      for (const a of o.group ?? []) L.d.onThread[a] ??= now();
      if (d.tier === "public") {
        s.msgs++;
        const t = o.thread ?? m.threadId;
        L.d.threads[t] = (L.d.threads[t] ?? 0) + 1;
        if (d.newJob) {
          s.jobs++;
          L.d.jobs++;
        }
      }
    }
    L.save();
  }

  record(m: Inbound, d: Decision, jobId?: string) {
    const row = { at: now(), id: m.id, from: m.from, subject: m.subject.slice(0, 120), verified: m.verified, action: d.action, ...(d.action === "accept" ? { tier: d.tier, newJob: d.newJob } : {}), reason: d.reason, ...(jobId ? { job: jobId } : {}) };
    fs.appendFileSync(this.log, JSON.stringify(row) + "\n");
  }
}

// ── clify for public jobs ────────────────────────────────────────────────
// Public jobs may run `clify list | guide | help` and read commands of the
// built-in public specs (clify/specs). No account words, no generation, no
// writes (not even a preview), no flags that reach accounts or a browser.
const PUBLIC_WORDS = new Set(["list", "guide", "help"]);
const BANNED_FLAGS = /^--(yes|allow-writes|cdp|account|user|session|password-cmd|ask-human|via)(=|$)/;

export function publicSites(specsDir: string): Set<string> {
  return new Set(fs.existsSync(specsDir) ? fs.readdirSync(specsDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) : []);
}

export function publicClifyDenied(args: string[], specsDir: string): string | null {
  const [first, second] = args;
  if (!first) return 'pass args, e.g. ["list"]';
  if (!PUBLIC_WORDS.has(first) && (!/^[\w.-]+$/.test(first) || !publicSites(specsDir).has(first)))
    return `"${first}" is not available for public requests. Public requests are read-only and can use only the built-in public sites (\`clify list\`); no accounts, signups, logins or new sites.`;
  const bad = args.find((a) => BANNED_FLAGS.test(a));
  if (bad) return `${bad.split("=")[0]} is not available for public requests: they are read-only and use no accounts`;
  if (PUBLIC_WORDS.has(first)) return null;
  if (!second || second.startsWith("--")) return null;
  const spec = JSON.parse(fs.readFileSync(path.join(specsDir, `${first}.json`), "utf8"));
  const cmd = (spec.commands ?? []).find((c: any) => c.name === second);
  if (cmd?.mutates) return `"${first} ${second}" changes data on the site; public requests are read-only`;
  return null;
}
