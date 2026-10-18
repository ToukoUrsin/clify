// Box end of the LLM bridge. Runs on the machine that can reach the model pool
// (any Anthropic-compatible endpoint: POOL_URL, key from POOL_KEY_CMD or
// ANTHROPIC_API_KEY). It opens
// `instabox ssh <box> -- -T node <sandbox-end.mjs>`, reads one JSON request per
// line, forwards it to the pool with the key added here, and writes the answer
// back. Only POST /v1/messages (and count_tokens) pass, and only for the
// allowed models. Every answer's model is logged, so a silent fallback to
// another model shows up in the log.
//
// It also keeps the InstaBox awake: if the sandbox paused itself, it wakes it
// and reconnects.
//
//   node box-end.mjs            env: INSTABOX_BOX (clify-agent), POOL_URL,
//                               POOL_KEY_CMD, SANDBOX_BRIDGE (path on the sandbox)
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const BOX = process.env.INSTABOX_BOX || "clify-agent";
const IB = process.env.INSTABOX_BIN || path.join(os.homedir(), ".local/bin/instabox");
const POOL = process.env.POOL_URL || "https://api.anthropic.com";
const KEY_CMD = process.env.POOL_KEY_CMD || "";
const REMOTE = process.env.SANDBOX_BRIDGE || "/data/workspace/clify-agent/agent/bridge/sandbox-end.mjs";
const ALLOWED = new Set((process.env.BRIDGE_MODELS || "claude-opus-5-5,gpt-6.1-sol").split(","));
const LOG = process.env.BRIDGE_LOG || path.join(os.homedir(), ".cache/clify-agent-bridge/models.jsonl");
fs.mkdirSync(path.dirname(LOG), { recursive: true });

const say = (s) => process.stdout.write(`${new Date().toISOString()} ${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let key = "";
const poolKey = () => (key ||= KEY_CMD ? execFileSync(KEY_CMD, { encoding: "utf8" }).trim() : process.env.ANTHROPIC_API_KEY || "");

async function answer(m) {
  const fail = (status, message) => ({ id: m.id, status, body: JSON.stringify({ type: "error", error: { type: "bridge", message } }) });
  if (m.method !== "POST" || !/^\/v1\/messages(\/count_tokens)?(\?.*)?$/.test(m.path)) return fail(403, `bridge only forwards POST /v1/messages (got ${m.method} ${m.path})`);
  let req;
  try {
    req = JSON.parse(m.body);
  } catch {
    return fail(400, "body is not JSON");
  }
  if (!ALLOWED.has(req.model)) return fail(403, `model ${req.model} is not allowed through the bridge`);
  const t0 = Date.now();
  try {
    const res = await fetch(POOL + m.path, {
      method: "POST",
      headers: { ...m.headers, "x-api-key": poolKey(), "anthropic-version": m.headers["anthropic-version"] || "2023-06-01" },
      body: m.body,
      signal: AbortSignal.timeout(14 * 60_000),
    });
    const body = await res.text();
    const ct = res.headers.get("content-type") || "application/json";
    let model = req.model;
    if (ct.includes("json")) model = JSON.parse(body)?.model ?? model;
    else model = body.match(/"model"\s*:\s*"([^"]+)"/)?.[1] ?? model;
    fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), requested: req.model, model, status: res.status, ms: Date.now() - t0, stream: !!req.stream }) + "\n");
    say(`${res.status} ${req.model} -> ${model} ${Date.now() - t0}ms`);
    return { id: m.id, status: res.status, contentType: ct, model, body };
  } catch (e) {
    return fail(502, `pool: ${e.message}`);
  }
}

function state() {
  try {
    return JSON.parse(execFileSync(IB, ["get", BOX, "--json"], { encoding: "utf8", timeout: 30_000 })).state;
  } catch {
    return "unknown";
  }
}

async function ensureAwake() {
  let s = state();
  // Mid-transition (it is pausing itself, or starting): let that finish first.
  for (let n = 0; n < 6 && /ing$/.test(s) && s !== "running"; n++) {
    await sleep(10_000);
    s = state();
  }
  if (s === "running") return;
  say(`sandbox ${BOX} is ${s}; waking it`);
  try {
    execFileSync(IB, [s === "stopped" ? "start" : /pause|suspend/.test(s) ? "resume" : "wake", BOX], { stdio: "inherit", timeout: 120_000 });
  } catch (e) {
    say(`wake failed: ${e.message}`);
  }
}

async function connect() {
  await ensureAwake();
  const child = spawn(IB, ["ssh", BOX, "--", "-T", "-o", "ServerAliveInterval=20", "-o", "ServerAliveCountMax=3", `node ${REMOTE}`], { stdio: ["pipe", "pipe", "inherit"] });
  say(`connected to ${BOX} (pid ${child.pid})`);
  readline.createInterface({ input: child.stdout }).on("line", async (line) => {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return say(`not a request: ${line.slice(0, 120)}`);
    }
    const r = await answer(m);
    if (child.stdin.writable) child.stdin.write(JSON.stringify(r) + "\n");
  });
  return new Promise((resolve) => child.on("exit", (code) => resolve(code)));
}

// Watchdog: check every 2 minutes that the sandbox still runs.
setInterval(() => ensureAwake().catch(() => {}), 120_000).unref();

for (let backoff = 2000; ; ) {
  const t0 = Date.now();
  const code = await connect();
  say(`bridge session ended (exit ${code})`);
  backoff = Date.now() - t0 > 60_000 ? 2000 : Math.min(60_000, backoff * 2);
  await sleep(backoff);
}
