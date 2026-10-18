// Public, read-only status page of the clify agent, so anyone can check it is
// alive without emailing it. Listens on 127.0.0.1 only; tunnel.ts brings it to
// the agent identity's Inkbox address (https://<handle>.inkboxwire.com).
//
//   GET /status        HTML for browsers, JSON otherwise (by Accept)
//   GET /status.json   JSON          GET /healthz   "ok"
//
// It reads counts and timestamps from the agent's state and systemd, nothing
// else: no requester addresses, subjects, message contents or secrets ever
// leave this file. GET/HEAD only, per-IP and global rate limits, 10 s cache.
//
// Environment: the main agent's env file (caps, CLIFY_HOME) plus
//   STATUS_PORT        default 18320
//   CLIFY_PEER_HOME    the peer's clify home (default /data/home/.clify-peer)
//   STATUS_PUBLIC_URL  the public address shown on the page
//   STATUS_TUNNEL_FILE where tunnel.ts writes its connection state
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DEFAULT_CAPS, LIMITS } from "../src/policy.ts";
import { MODEL } from "../src/llm.ts";

const run = promisify(execFile);
const env = (k: string, d = "") => process.env[k]?.trim() || d;
const here = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(env("STATUS_PORT", "18320"));
const CLIFY_HOME = env("CLIFY_HOME", path.join(os.homedir(), ".clify-agent"));
const STATE = env("CLIFY_AGENT_STATE", path.join(CLIFY_HOME, "agent"));
const PEER_STATE = path.join(env("CLIFY_PEER_HOME", "/data/home/.clify-peer"), "agent");
const TUNNEL_FILE = env("STATUS_TUNNEL_FILE", "/data/home/.clify-tunnel/status.json");
const PUBLIC_URL = env("STATUS_PUBLIC_URL");
const UNITS = ["clify-agent@main", "clify-agent@peer", "clify-agent-status", "clify-agent-tunnel"];

const readJson = (f: string) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
const bootMs = () => Date.now() - Number(fs.readFileSync("/proc/uptime", "utf8").split(" ")[0]) * 1000;

function machine() {
  const md = fs.existsSync(path.join(os.homedir(), "MACHINE.md")) ? fs.readFileSync(path.join(os.homedir(), "MACHINE.md"), "utf8") : "";
  const row = (k: string) => md.match(new RegExp(`\\| ${k} \\| (.+?) \\|`))?.[1].replace(/`/g, "").trim();
  return { name: row("Name") ?? os.hostname(), template: row("Template"), size: row("Size") };
}

async function units() {
  const out: Record<string, unknown> = {};
  const boot = bootMs();
  for (const u of UNITS) {
    try {
      const { stdout } = await run("systemctl", ["show", u, "-p", "ActiveState,SubState,ActiveEnterTimestampMonotonic,NRestarts"], { timeout: 3000 });
      const p = Object.fromEntries(stdout.trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
      const since = p.ActiveState === "active" && Number(p.ActiveEnterTimestampMonotonic) ? boot + Number(p.ActiveEnterTimestampMonotonic) / 1000 : null;
      out[u] = { state: `${p.ActiveState}/${p.SubState}`, since: since ? iso(since) : null, uptime_s: since ? Math.round((Date.now() - since) / 1000) : 0, restarts: Number(p.NRestarts) || 0 };
    } catch {
      out[u] = { state: "unknown" };
    }
  }
  return out;
}

// The LLM bridge's sandbox end: alive while its instabox ssh session to the relay is.
async function bridge() {
  const listening = await new Promise<boolean>((ok) => {
    const s = net.connect(18318, "127.0.0.1", () => (s.destroy(), ok(true)));
    s.on("error", () => ok(false));
    s.setTimeout(1000, () => (s.destroy(), ok(false)));
  });
  let since: string | null = null;
  try {
    const { stdout } = await run("ps", ["-eo", "etimes=,args="], { timeout: 3000 });
    const l = stdout.split("\n").find((l) => /bridge\/sandbox-end\.mjs/.test(l));
    if (l) since = iso(Date.now() - Number(l.trim().split(/\s+/)[0]) * 1000);
  } catch {}
  return { listening, connected_since: since, model: MODEL, route: "127.0.0.1:18318 → instabox ssh stdio → relay → Claude Opus 5.5" };
}

// Counts and timestamps only. Jobs hold mail and model transcripts; none of it is copied out.
function jobs(dir: string, today: string) {
  const s = { today: { total: 0, owner: 0, public: 0 }, all_time: 0, last_received: "", last_replied: "", model_calls_today: 0, models: new Set<string>(), last_model: "", last_model_at: "", open: 0 };
  let files: string[] = [];
  try {
    files = fs.readdirSync(path.join(dir, "jobs")).filter((f) => f.endsWith(".json"));
  } catch {}
  for (const f of files) {
    const j = readJson(path.join(dir, "jobs", f));
    if (!j) continue;
    s.all_time++;
    if (String(j.createdAt).startsWith(today)) {
      s.today.total++;
      s.today[j.tier === "public" ? "public" : "owner"]++;
    }
    if (/^(working|waiting)/.test(j.status)) s.open++;
    for (const m of j.mail ?? []) {
      if (m.dir === "in" && m.at > s.last_received) s.last_received = m.at;
      if (m.dir === "out" && m.at > s.last_replied) s.last_replied = m.at;
    }
    for (const st of j.steps ?? []) {
      if (st.kind !== "llm" || !st.model) continue;
      if (String(st.at).startsWith(today)) (s.model_calls_today++, s.models.add(st.model));
      if (st.at > s.last_model_at) (s.last_model_at = st.at), (s.last_model = st.model);
    }
  }
  return { ...s, models: [...s.models] };
}

function decisionsToday(today: string) {
  const out: Record<string, number> = {};
  try {
    for (const l of fs.readFileSync(path.join(STATE, "decisions.jsonl"), "utf8").split("\n")) {
      if (!l.startsWith(`{"at":"${today}`)) continue;
      const a = JSON.parse(l).action ?? "other";
      out[a] = (out[a] ?? 0) + 1;
    }
  } catch {}
  return out;
}

function clify() {
  const root = path.resolve(here, "..", "..", "clify");
  let sites = 0;
  try {
    sites = fs.readdirSync(path.join(root, "specs")).filter((f) => f.endsWith(".json")).length;
  } catch {}
  return { version: readJson(path.join(root, "package.json"))?.version ?? "?", built_in_sites: sites };
}

async function collect() {
  const today = new Date().toISOString().slice(0, 10);
  const num = (k: string, d: number) => Number(env(k)) || d;
  const main = jobs(STATE, today);
  const peer = jobs(PEER_STATE, today);
  const tunnel = readJson(TUNNEL_FILE);
  const m = machine();
  return {
    ok: true,
    generated_at: iso(Date.now()),
    agent: {
      name: "clify agent",
      email: env("CLIFY_AGENT_ADDRESS", "clify@fine-vale.primitive.email"),
      peer_email: env("CLIFY_AGENT_PEER", "clify-agent-b3d326@inkboxmail.com"),
      inkbox_identity: tunnel?.handle ?? "clify-agent-b3d326",
      public_url: PUBLIC_URL || tunnel?.public_url || null,
      runs_on: `InstaBox ${m.name}`,
      how_to_use: "email it a job in plain language; it replies in your thread",
    },
    computer: { instabox: m.name, template: m.template, size: m.size, booted_at: iso(bootMs()), uptime_s: Math.round(os.uptime()), load_1m: Number(os.loadavg()[0].toFixed(2)) },
    services: await units(),
    tunnel: tunnel ? { status: tunnel.status, since: tunnel.since } : { status: "unknown" },
    llm_bridge: await bridge(),
    jobs: {
      day_utc: today,
      today: main.today,
      peer_subtasks_today: peer.today.total,
      open_now: main.open,
      all_time: main.all_time,
      last_job_received_at: main.last_received || null,
      last_reply_sent_at: main.last_replied || null,
      model_calls_today: main.model_calls_today + peer.model_calls_today,
      models_today: [...new Set([...main.models, ...peer.models])],
      last_model: main.last_model_at > peer.last_model_at ? main.last_model : peer.last_model || main.last_model,
      inbound_decisions_today: decisionsToday(today),
    },
    clify: clify(),
    caps: {
      public_tier: env("CLIFY_AGENT_PUBLIC") === "1",
      per_sender_jobs_per_day: num("CLIFY_AGENT_CAP_SENDER_JOBS", DEFAULT_CAPS.senderJobs),
      per_sender_emails_per_day: num("CLIFY_AGENT_CAP_SENDER_MSGS", DEFAULT_CAPS.senderMsgs),
      public_jobs_per_day: num("CLIFY_AGENT_CAP_GLOBAL_JOBS", DEFAULT_CAPS.globalJobs),
      mails_to_one_sender_per_day: num("CLIFY_AGENT_CAP_SENDER_OUT", DEFAULT_CAPS.senderOut),
      public_limits: { model_calls_per_turn: LIMITS.public.rounds, model_calls_per_job: LIMITS.public.jobRounds, turn_s: LIMITS.public.turnMs / 1000, clify_command_s: LIMITS.public.clifyMs / 1000 },
      day_resets: "00:00 UTC",
    },
  };
}

let cache: { at: number; body: Awaited<ReturnType<typeof collect>> } | null = null;
let inflight: Promise<Awaited<ReturnType<typeof collect>>> | null = null;
async function status() {
  if (cache && Date.now() - cache.at < 10_000) return cache.body;
  inflight ??= collect().finally(() => (inflight = null));
  const body = await inflight;
  cache = { at: Date.now(), body };
  return body;
}

// ── HTML ────────────────────────────────────────────────────────────────
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const dur = (s: number) => (s >= 86400 ? `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h` : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min` : `${s} s`);
const ago = (t: string | null) => (t ? `${esc(t.replace("T", " ").replace(/\.\d+Z$|Z$/, " UTC"))} (${dur(Math.max(0, Math.round((Date.now() - Date.parse(t)) / 1000)))} ago)` : "none yet");

function html(s: Awaited<ReturnType<typeof collect>>) {
  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  const svc = Object.entries(s.services)
    .map(([u, v]: [string, any]) => row(u, `<b class="${v.state === "active/running" ? "up" : "down"}">${esc(v.state)}</b>${v.since ? ` · up ${dur(v.uptime_s)} · ${v.restarts} restarts` : ""}`))
    .join("");
  const allUp = Object.values(s.services).every((v: any) => v.state === "active/running") && s.llm_bridge.listening;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30">
<title>clify agent status</title><style>
body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:2em auto;padding:0 1em;color:#1a1a1a}
h1{font-size:1.5em;margin:0}h2{font-size:1.05em;margin:1.6em 0 .3em;color:#555;text-transform:uppercase;letter-spacing:.04em}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:.25em .6em .25em 0;vertical-align:top;border-bottom:1px solid #eee}th{font-weight:500;color:#555;width:38%}
.up{color:#0a7d32}.down{color:#b00020}code{white-space:nowrap;background:#f4f4f4;padding:0 .3em;border-radius:3px}small{color:#777}
</style></head><body>
<h1>clify agent: <span class="${allUp ? "up" : "down"}">${allUp ? "alive" : "degraded"}</span></h1>
<p>An always-on email agent on its own computer. Email <code>${esc(s.agent.email)}</code> a job in plain language; it replies in your thread. This page is read-only; JSON at <a href="/status.json">/status.json</a>.</p>
<h2>Identity</h2><table>
${row("Email (jobs)", `<code>${esc(s.agent.email)}</code>`)}${row("Peer agent (Inkbox mailbox)", `<code>${esc(s.agent.peer_email)}</code>`)}
${row("Inkbox identity", `<code>${esc(s.agent.inkbox_identity)}</code>: email, phone number and this internet address`)}${row("Public address", esc(s.agent.public_url ?? ""))}</table>
<h2>Computer</h2><table>
${row("Runs on", `${esc(s.agent.runs_on)} <small>${esc(s.computer.template ?? "")} · ${esc(s.computer.size ?? "")}</small>`)}
${row("Sandbox up", `${dur(s.computer.uptime_s)} <small>(booted ${esc(s.computer.booted_at)})</small>`)}${svc}
${row("Inkbox tunnel", `<b class="${s.tunnel.status === "connected" ? "up" : "down"}">${esc(s.tunnel.status)}</b>${s.tunnel.since ? ` since ${esc(s.tunnel.since)}` : ""}`)}
${row("LLM bridge", `<b class="${s.llm_bridge.listening ? "up" : "down"}">${s.llm_bridge.listening ? "connected" : "down"}</b>${s.llm_bridge.connected_since ? ` since ${esc(s.llm_bridge.connected_since)}` : ""} · <code>${esc(s.llm_bridge.model)}</code>`)}</table>
<h2>Jobs today (${esc(s.jobs.day_utc)}, UTC)</h2><table>
${row("Jobs", `${s.jobs.today.total} <small>(${s.jobs.today.public} public, ${s.jobs.today.owner} owner)</small> · ${s.jobs.peer_subtasks_today} peer sub-tasks · ${s.jobs.open_now} open now · ${s.jobs.all_time} all time`)}
${row("Last job email received", ago(s.jobs.last_job_received_at))}${row("Last reply sent", ago(s.jobs.last_reply_sent_at))}
${row("Model calls today", `${s.jobs.model_calls_today} <small>${esc(s.jobs.models_today.join(", "))}</small>`)}
${row("Inbound decisions today", esc(Object.entries(s.jobs.inbound_decisions_today).map(([k, v]) => `${k} ${v}`).join(", ") || "none"))}</table>
<h2>clify and caps</h2><table>
${row("clify", `v${esc(s.clify.version)} · ${s.clify.built_in_sites} built-in sites`)}
${row("Public tier", s.caps.public_tier ? "on: anyone with DMARC-verified mail gets read-only jobs" : "off")}
${row("Per sender / day", `${s.caps.per_sender_jobs_per_day} jobs, ${s.caps.per_sender_emails_per_day} emails`)}${row("Public jobs / day", String(s.caps.public_jobs_per_day))}
${row("Public job limits", `${s.caps.public_limits.model_calls_per_turn} model calls a turn, ${s.caps.public_limits.model_calls_per_job} a job, ${s.caps.public_limits.turn_s / 60} min a turn, ${s.caps.public_limits.clify_command_s} s per clify command`)}</table>
<p><small>Generated ${esc(s.generated_at)} · refreshes every 30 s · no requester addresses, message contents or secrets are shown · <a href="https://github.com/ToukoUrsin/clify">source</a></small></p>
</body></html>`;
}

// ── HTTP: read-only, rate-limited ───────────────────────────────────────
const PER_IP = 60; // requests per minute per client IP
const GLOBAL = 600; // requests per minute overall
const hits = new Map<string, number[]>();
let global: number[] = [];
function limited(ip: string): boolean {
  const t = Date.now();
  global = global.filter((x) => t - x < 60_000);
  const h = (hits.get(ip) ?? []).filter((x) => t - x < 60_000);
  if (h.length >= PER_IP || global.length >= GLOBAL) return hits.set(ip, h), true;
  h.push(t), global.push(t), hits.set(ip, h);
  if (hits.size > 10_000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > 60_000) hits.delete(k);
  return false;
}

const HEADERS = {
  "cache-control": "public, max-age=10",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  "access-control-allow-origin": "*",
};

const server = http.createServer(async (req, res) => {
  req.resume();
  const send = (code: number, type: string, body: string, extra: Record<string, string> = {}) => {
    res.writeHead(code, { ...HEADERS, "content-type": type, ...extra });
    res.end(req.method === "HEAD" ? undefined : body);
  };
  if (req.method !== "GET" && req.method !== "HEAD") return send(405, "text/plain", "read-only: GET or HEAD\n", { allow: "GET, HEAD" });
  // The tunnel sets X-Forwarded-For to the real client; the server itself only listens on loopback.
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();
  if (limited(ip)) return send(429, "text/plain", "too many requests, try again in a minute\n", { "retry-after": "60" });
  const p = new URL(req.url ?? "/", "http://x").pathname.replace(/\/+$/, "") || "/";
  try {
    if (p === "/healthz") return send(200, "text/plain", "ok\n");
    if (p === "/") return send(302, "text/plain", "see /status\n", { location: "/status" });
    if (p === "/status.json" || (p === "/status" && !/text\/html/.test(String(req.headers.accept ?? ""))))
      return send(200, "application/json; charset=utf-8", JSON.stringify(await status(), null, 2) + "\n");
    if (p === "/status" || p === "/status.html") return send(200, "text/html; charset=utf-8", html(await status()));
    return send(404, "text/plain", "not found: try /status\n");
  } catch (e) {
    process.stderr.write(`status: ${(e as Error).message}\n`);
    return send(500, "text/plain", "status unavailable\n");
  }
});
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.listen(PORT, "127.0.0.1", () => process.stdout.write(`status page on http://127.0.0.1:${PORT}/status\n`));
