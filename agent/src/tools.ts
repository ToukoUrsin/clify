// The agent's tools. clify does the web work; the rest is email.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parse } from "node-html-parser";
import type { Tool } from "./llm.ts";
import type { AgentConfig, Job } from "./agent.ts";
import type { SentMail } from "./mail.ts";
import { freshText } from "./mail.ts";
import { LIMITS, TOOLS, publicClifyDenied, tierNow, type Tier } from "./policy.ts";

export interface Ctx {
  job: Job;
  cfg: AgentConfig;
  files: string;
  send(threadId: string, o: { text: string; attach?: string[]; cc?: string[] }): Promise<SentMail>;
  newThread(kind: "peer" | "human", to: string, o: { subject: string; text: string; attach?: string[]; cc?: string[] }): Promise<{ sent: SentMail; threadId: string }>;
}

export interface ToolResult {
  ok: boolean;
  content: string;
  summary?: string;
  sent?: boolean;
  threadId?: string;
}

// Tools that send a message and then wait for its answer by email.
export const PAUSING = new Set(["ask_requester", "message_peer"]);

const attachProp = { type: "array", items: { type: "string" }, description: "file names from write_file (or paths clify printed)" };

const CLIFY: Tool = {
  name: "clify",
  description: "Run clify on your computer. Pass the words after `clify` as an array, e.g. [\"list\"], [\"books\"], [\"books\",\"list-category\",\"--category\",\"mystery_3\"]. Prints JSON.",
  input_schema: { type: "object", properties: { args: { type: "array", items: { type: "string" } } }, required: ["args"] },
};
const FETCH: Tool = {
  name: "fetch_page",
  description: "GET a public web page and return its title, text and links. robots.txt is respected. No cookies, no forms.",
  input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
};
const WRITE: Tool = {
  name: "write_file",
  description: "Write a file (CSV, TXT, JSON, MD) in this job's folder so you can attach it.",
  input_schema: { type: "object", properties: { name: { type: "string", description: "e.g. cheapest-books.csv" }, content: { type: "string" } }, required: ["name", "content"] },
};
const READ: Tool = {
  name: "read_file",
  description: "Read a text file in this job's folder (e.g. an attachment you received, saved as in-<name>).",
  input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
};
const REPLY: Tool = {
  name: "reply",
  description: "Email your answer in the thread this job came from, with optional attachments.",
  input_schema: { type: "object", properties: { text: { type: "string" }, attach: attachProp }, required: ["text"] },
};
const ASK: Tool = {
  name: "ask_requester",
  description: "Ask the requester one short clarifying question in their thread, then wait for their answer (it comes back as this tool's result).",
  input_schema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
};
const PEER: Tool = {
  name: "message_peer",
  description: "Delegate to your peer agent by email and wait for its reply. The first call forwards the requester's thread with your note (say exactly what you need back); later calls reply in the same peer thread.",
  input_schema: { type: "object", properties: { message: { type: "string" }, attach: attachProp }, required: ["message"] },
};
const ESCALATE: Tool = {
  name: "escalate_to_human",
  description: "Email your human (cc the peer agent) about a blocker only a person can clear: CAPTCHA, payment, phone check, approval. Does not wait.",
  input_schema: {
    type: "object",
    properties: {
      question: { type: "string", description: "what you need from the human" },
      site: { type: "string" },
      url: { type: "string" },
      doing: { type: "string", description: "what you were doing" },
      blocker: { type: "string", description: "what stopped you, e.g. 'hCaptcha on the signup page'" },
      options: { type: "array", items: { type: "string" }, description: "the replies you can act on, e.g. skip, use-my-account, retry" },
      attach: attachProp,
    },
    required: ["question", "blocker"],
  },
};

// The tool list follows the job's tier (policy.ts), never the email.
export function toolsFor(role: "main" | "peer", tier?: Tier): Tool[] {
  if (role === "peer") return [CLIFY, FETCH, WRITE, READ, REPLY];
  const all = [CLIFY, FETCH, WRITE, READ, ASK, PEER, ESCALATE, REPLY];
  return all.filter((t) => TOOLS[tier ?? "owner"].has(t.name));
}

export async function runTool(ctx: Ctx, name: string, input: any): Promise<ToolResult> {
  fs.mkdirSync(ctx.files, { recursive: true });
  const pub = tierNow(ctx.job) === "public";
  if (pub && !TOOLS.public.has(name)) return { ok: false, content: `${name} is not available for public requests (read-only: clify on public sites, write_file, read_file, ask_requester, reply)` };
  switch (name) {
    case "clify":
      return runClify(ctx, (input?.args ?? []).map(String));
    case "fetch_page":
      return fetchPage(String(input?.url ?? ""));
    case "write_file": {
      const n = path.basename(String(input?.name ?? "")).replace(/[^\w.-]/g, "-");
      if (!n || !/\.(csv|txt|json|md|tsv)$/i.test(n)) return { ok: false, content: "name must end in .csv, .tsv, .txt, .json or .md" };
      if (pub && Buffer.byteLength(String(input?.content ?? "")) > 1_000_000) return { ok: false, content: "files for public requests are limited to 1 MB" };
      fs.writeFileSync(path.join(ctx.files, n), String(input?.content ?? ""));
      return { ok: true, content: `wrote ${n} (${Buffer.byteLength(String(input.content))} bytes); attach it as "${n}"`, summary: n };
    }
    case "read_file": {
      const f = path.join(ctx.files, path.basename(String(input?.name ?? "")));
      if (!fs.existsSync(f)) return { ok: false, content: `no file ${input?.name}; files: ${fs.readdirSync(ctx.files).join(", ") || "none"}` };
      const t = fs.readFileSync(f, "utf8");
      return { ok: true, content: t.length > 20_000 ? t.slice(0, 20_000) + "\n…" : t, summary: path.basename(f) };
    }
    case "reply": {
      const attach = resolveAttach(ctx, input?.attach);
      if (typeof attach === "string") return { ok: false, content: attach };
      const s = await ctx.send(ctx.job.origin, { text: String(input?.text ?? ""), attach });
      return { ok: true, sent: true, content: `sent to ${s.to}${s.cc?.length ? ` cc ${s.cc.join(", ")}` : ""} (message ${s.messageId ?? s.id}). If they write again, you'll get it.`, summary: `to ${s.to}${s.cc?.length ? ` cc ${s.cc.join(",")}` : ""}${attach.length ? ` + ${attach.map((f) => path.basename(f)).join(", ")}` : ""}` };
    }
    case "ask_requester": {
      const s = await ctx.send(ctx.job.origin, { text: String(input?.question ?? "") });
      return { ok: true, sent: true, threadId: ctx.job.origin, content: "asked", summary: `asked ${s.to}` };
    }
    case "message_peer": {
      const peer = ctx.cfg.peer;
      if (!peer) return { ok: false, content: "no peer agent configured" };
      const attach = resolveAttach(ctx, input?.attach);
      if (typeof attach === "string") return { ok: false, content: attach };
      const msg = String(input?.message ?? "");
      const open = Object.entries(ctx.job.threads).find(([, t]) => t.kind === "peer");
      if (open) {
        await ctx.send(open[0], { text: msg, attach });
        return { ok: true, sent: true, threadId: open[0], content: "sent", summary: `replied to ${peer}` };
      }
      const r = await ctx.newThread("peer", peer, { subject: `Fwd: ${ctx.job.subject}`, text: `${msg}\n\n${forwardedThread(ctx.job)}`, attach });
      return { ok: true, sent: true, threadId: r.threadId, content: "forwarded", summary: `forwarded the thread to ${peer}` };
    }
    case "escalate_to_human": {
      const human = ctx.cfg.human;
      if (!human) return { ok: false, content: "no human configured" };
      const attach = resolveAttach(ctx, input?.attach);
      if (typeof attach === "string") return { ok: false, content: attach };
      const opts: string[] = input?.options?.length ? input.options : ["skip", "use-my-account", "retry"];
      const text = [
        String(input.question),
        "",
        ...(input.site ? [`Site:     ${input.site}`] : []),
        ...(input.url ? [`Page:     ${input.url}`] : []),
        ...(input.doing ? [`Doing:    ${input.doing}`] : []),
        `Stopped:  ${input.blocker}`,
        `For:      ${ctx.job.requester} ("${ctx.job.subject}")`,
        "",
        "Reply with one of:",
        ...opts.map((o, n) => `  ${n + 1}. ${o}`),
        "",
        `I never solve CAPTCHAs or work around bot checks. ${ctx.cfg.peer ? `My peer agent ${ctx.cfg.peer} is cc'd for context.` : ""}`,
      ].join("\n");
      const subject = [ctx.cfg.humanTag, "[clify] blocked:", String(input.site ? `${input.site}: ` : "") + String(input.blocker).slice(0, 70)].filter(Boolean).join(" ");
      const r = await ctx.newThread("human", human, { subject, text, attach, cc: ctx.cfg.peer ? [ctx.cfg.peer] : [] });
      return { ok: true, sent: true, threadId: r.threadId, content: `emailed ${human} (cc ${ctx.cfg.peer}). It does not wait: tell the requester and give what you can without it. A reply from the human will come to you as a new email in this job.`, summary: `emailed ${human}` };
    }
  }
  return { ok: false, content: `unknown tool ${name}` };
}

function resolveAttach(ctx: Ctx, list: unknown): string[] | string {
  const out: string[] = [];
  const pub = tierNow(ctx.job) === "public";
  // Public jobs attach only the CSV/JSON/text files they wrote themselves.
  const allowed = pub ? [ctx.files] : [ctx.files, path.join(ctx.cfg.clifyHome, "asks", "files")];
  for (const raw of (Array.isArray(list) ? list : []).map(String)) {
    const f = path.isAbsolute(raw) ? raw : path.join(ctx.files, path.basename(raw));
    if (!allowed.some((d) => path.resolve(f).startsWith(path.resolve(d) + path.sep))) return `attachment ${raw} is outside the job folder`;
    if (pub && (!/\.(csv|tsv|json|txt|md)$/i.test(f) || path.basename(f).startsWith("in-"))) return `attachment ${raw}: public replies can attach only files you wrote (csv, tsv, json, txt, md)`;
    if (!fs.existsSync(f)) return `attachment ${raw} not found; write it with write_file first`;
    out.push(f);
  }
  return out;
}

// The requester's thread as the forward's body: who said what, when.
function forwardedThread(j: Job): string {
  const rows = j.mail.filter((m) => m.threadId === j.origin || (m.dir === "out" && j.threads[m.threadId ?? ""]?.kind === "requester"));
  const parts = rows.map((m, n) => `From: ${m.from}\nDate: ${m.at}\nSubject: ${m.subject}\n\n${m.dir === "in" && n > 0 ? freshText(m.text) : m.text.trim()}`);
  return `---------- Forwarded thread (${j.id}) ----------\n\n${parts.join("\n\n----------\n\n")}`;
}

// ── clify ────────────────────────────────────────────────────────────────
const BLOCKED = new Set(["mcp", "record", "install", "ask", "forward", "approve", "logout"]);

function runClify(ctx: Ctx, args: string[]): Promise<ToolResult> {
  const [first, second] = args;
  const label = `clify ${args.join(" ")}`.slice(0, 160);
  if (!first) return Promise.resolve({ ok: false, content: "pass args, e.g. [\"list\"]" });
  // Public jobs: built-in public sites, read commands only, and a clify home with no vault in it.
  const pub = tierNow(ctx.job) === "public";
  if (pub) {
    const why = publicClifyDenied(args, ctx.cfg.specsDir);
    if (why) return Promise.resolve({ ok: false, content: why, summary: `refused: ${label}` });
  }
  if (BLOCKED.has(first)) return Promise.resolve({ ok: false, content: `\`clify ${first}\` is not available to you here${first === "ask" ? "; use escalate_to_human or ask_requester" : ""}` });
  if (first === "vault" && second && second !== "list") return Promise.resolve({ ok: false, content: "only `clify vault list` is available" });
  if (first === "login" && args.includes("--user")) return Promise.resolve({ ok: false, content: "--user logins need the human's own credentials; escalate_to_human instead" });
  if (first === "signup" && ctx.cfg.role !== "main") return Promise.resolve({ ok: false, content: "signup is not available to the peer" });
  if (args.includes("--yes")) {
    if (ctx.cfg.role !== "main") return Promise.resolve({ ok: false, content: "you are read-only: no --yes" });
    if (!ctx.cfg.writeSites.includes(first)) return Promise.resolve({ ok: false, content: `writes are only allowed on your own accounts on: ${ctx.cfg.writeSites.join(", ")}` });
  }
  const timeout = pub ? LIMITS.public.clifyMs : first === "signup" || first === "login" ? 8 * 60_000 : 3 * 60_000;
  const env = pub ? { ...process.env, CLIFY_HOME: ctx.cfg.publicHome, CLIFY_VAULT_KEY: "public-tier-has-no-vault", CLIFY_QUIET: "" } : { ...process.env, CLIFY_HOME: ctx.cfg.clifyHome, CLIFY_QUIET: "" };
  if (pub) fs.mkdirSync(ctx.cfg.publicHome, { recursive: true });
  return new Promise((resolve) => {
    const p = spawn(ctx.cfg.clifyBin, args, { cwd: ctx.files, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => p.kill("SIGTERM"), timeout);
    p.on("close", (code) => {
      clearTimeout(timer);
      const body = out.length > 16_000 ? out.slice(0, 16_000) + `\n… (${out.length - 16_000} more chars; use --fields/--limit)` : out;
      const tail = err.replace(/\x1b\[[0-9;]*m/g, "").trim().split("\n").slice(-12).join("\n");
      resolve({ ok: code === 0, content: `$ ${label}\nexit ${code}\n${body}${code !== 0 && tail ? `\nstderr:\n${tail}` : ""}`, summary: `${label} → exit ${code}` });
    });
  });
}

// ── fetch_page ───────────────────────────────────────────────────────────
const UA = `clify-agent/0.1 (AI agent reading public pages; ${process.env.CLIFY_AGENT_ADDRESS ?? "clify agent"})`;
const robotsCache = new Map<string, string>();

async function robotsAllows(u: URL): Promise<boolean> {
  let txt = robotsCache.get(u.origin);
  if (txt === undefined) {
    txt = await fetch(`${u.origin}/robots.txt`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) })
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => "");
    robotsCache.set(u.origin, txt);
  }
  let applies = false;
  const rules: string[] = [];
  for (const line of txt.split("\n").map((l) => l.replace(/#.*/, "").trim())) {
    const [k, ...v] = line.split(":");
    const val = v.join(":").trim();
    if (/^user-agent$/i.test(k)) applies = val === "*" || /clify/i.test(val);
    else if (applies && /^disallow$/i.test(k) && val) rules.push(val);
  }
  return !rules.some((r) => (u.pathname + u.search).startsWith(r.replace(/\*.*$/, "")));
}

async function fetchPage(url: string): Promise<ToolResult> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, content: `not a URL: ${url}` };
  }
  if (!/^https?:$/.test(u.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)) return { ok: false, content: "only public http(s) pages" };
  if (!(await robotsAllows(u))) return { ok: false, content: `robots.txt of ${u.host} disallows ${u.pathname}` };
  const res = await fetch(u, { headers: { "user-agent": UA, accept: "text/html,application/json;q=0.9,*/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(30_000) }).catch((e) => e as Error);
  if (res instanceof Error) return { ok: false, content: `fetch failed: ${res.message}` };
  const ct = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  if (!ct.includes("html")) return { ok: res.ok, content: `HTTP ${res.status} ${ct}\n${raw.slice(0, 15_000)}`, summary: `${u.host}${u.pathname} ${res.status}` };
  const root = parse(raw);
  root.querySelectorAll("script,style,noscript,svg").forEach((n) => n.remove());
  const title = root.querySelector("title")?.text.trim() ?? "";
  const text = root.querySelector("body")?.text.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim() ?? "";
  const links = root
    .querySelectorAll("a[href]")
    .map((a) => ({ t: a.text.replace(/\s+/g, " ").trim(), h: a.getAttribute("href") ?? "" }))
    .filter((l) => l.t && !l.h.startsWith("#") && !l.h.startsWith("javascript:"))
    .slice(0, 60)
    .map((l) => `${l.t.slice(0, 60)} -> ${new URL(l.h, res.url).href}`);
  const body = `HTTP ${res.status} ${res.url}\nTitle: ${title}\n\n${text.slice(0, 12_000)}${text.length > 12_000 ? "\n…" : ""}\n\nLinks:\n${links.join("\n")}`;
  return { ok: res.ok, content: body, summary: `${u.host}${u.pathname} ${res.status}` };
}
