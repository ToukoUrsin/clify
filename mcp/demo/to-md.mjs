// Turns the raw client logs (raw/<client>.jsonl) into readable transcripts
// (transcript-<client>.md; never <client>.md: claude.md would read as CLAUDE.md
// on case-insensitive disks) and terminal scripts for the video renderer (raw/<client>.screen.json).
//   node to-md.mjs [claude codex mcp-use]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.CLIFY_MCP_URL ?? "https://bold-cloud-h4u6s.run.mcp-use.com/mcp";
const task = fs.readFileSync(path.join(here, "task.txt"), "utf8").trim();
const lines = (f) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const clip = (s, n = 700) => (s.length > n ? s.slice(0, n) + " …" : s);

// MCP results arrive as a CallToolResult envelope; show the text the model read.
function resultText(r) {
  if (r == null) return "";
  if (typeof r === "string") {
    try {
      return resultText(JSON.parse(r));
    } catch {
      return r;
    }
  }
  if (Array.isArray(r)) return r.map((c) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n");
  if (r.content) return (r.isError ? "[isError] " : "") + resultText(r.content);
  return JSON.stringify(r);
}

const parsers = {
  claude(events) {
    const init = events.find((e) => e.type === "system" && e.subtype === "init");
    const res = events.find((e) => e.type === "result");
    const calls = [];
    const byId = new Map();
    for (const e of events) {
      for (const c of e.message?.content ?? []) {
        if (c.type === "tool_use") {
          const call = { tool: c.name.replace(/^mcp__clify__/, ""), args: c.input };
          byId.set(c.id, call);
          calls.push(call);
        } else if (c.type === "tool_result" && byId.has(c.tool_use_id)) byId.get(c.tool_use_id).result = resultText(c.content);
      }
    }
    const models = [...new Set(events.map((e) => e.message?.model).filter(Boolean))];
    return {
      title: "Claude Code",
      client: `Claude Code ${init?.claude_code_version ?? ""} (\`claude -p\`, headless)`.trim(),
      model: models.join(", ") || init?.model,
      command: "claude -p \"$TASK\" --model claude-opus-5-5 --mcp-config mcp.json --strict-mcp-config --tools \"\" --allowedTools mcp__clify --output-format stream-json --verbose",
      calls,
      answer: res?.result ?? "",
      stats: res ? `${(res.duration_ms / 1000).toFixed(1)} s, ${res.num_turns} turns, $${res.total_cost_usd?.toFixed(4)}` : "",
    };
  },
  codex(events) {
    const calls = events
      .filter((e) => e.type === "item.completed" && e.item.type === "mcp_tool_call")
      .map((e) => ({ tool: e.item.tool, args: e.item.arguments, result: e.item.error ? `[error] ${JSON.stringify(e.item.error)}` : resultText(e.item.result) }));
    const msgs = events.filter((e) => e.type === "item.completed" && e.item.type === "agent_message").map((e) => e.item.text);
    const usage = events.find((e) => e.type === "turn.completed")?.usage;
    return {
      title: "Codex CLI",
      client: "Codex CLI 0.163.0 (`codex exec --json`, headless)",
      model: "gpt-6.1-sol (the Codex CLI's configured default model)",
      command: "codex exec --json -s read-only -c mcp_servers.clify.url=\"$URL\" -c mcp_servers.clify.default_tools_approval_mode=\"approve\" \"$TASK\"",
      calls,
      answer: msgs.at(-1) ?? "",
      stats: usage ? `${usage.input_tokens} input tokens (${usage.cached_input_tokens} cached), ${usage.output_tokens} output` : "",
    };
  },
  "mcp-use"(events) {
    const calls = [];
    for (const e of events) {
      if (e.type === "tool_call") calls.push({ tool: e.tool, args: e.input });
      else if (e.type === "tool_result") {
        const open = calls.find((c) => c.tool === e.tool && c.result === undefined);
        if (open) open.result = resultText(e.output);
        else calls.push({ tool: e.tool, args: {}, result: resultText(e.output) });
      }
    }
    const meta = Object.assign({}, ...events.filter((e) => e.type === "meta"));
    return {
      title: "mcp-use agent",
      client: "mcp-use TypeScript agent (`@mcp-use/agent` 2.0.24 MCPAgent + `@mcp-use/client` 2.4.4)",
      model: (meta.responseModels ?? []).join(", ") || meta.llm,
      command: "node mcp-use-agent.mjs \"$TASK\"   # MCPAgent({ llm: \"anthropic/claude-opus-5-5\", mcpServers: { clify: { url } } })",
      calls,
      answer: events.find((e) => e.type === "final")?.text ?? "",
      stats: meta.seconds ? `${meta.seconds.toFixed(1)} s` : "",
    };
  },
  inspector(events) {
    // The chat stream (AI SDK data-stream lines): 9: tool call, a: tool result, 0: answer text.
    const stream = fs.readFileSync(path.join(here, "raw", "inspector-stream.txt"), "utf8").split("\n");
    const calls = [];
    const byId = new Map();
    let answer = "";
    for (const l of stream) {
      const m = l.match(/^([0-9a-z]):(.*)$/);
      if (!m) continue;
      const v = JSON.parse(m[2]);
      if (m[1] === "9") byId.set(v.toolCallId, calls[calls.push({ tool: v.toolName, args: v.args }) - 1]);
      else if (m[1] === "a" && byId.has(v.toolCallId)) byId.get(v.toolCallId).result = resultText(v.result);
      else if (m[1] === "0") answer += v;
    }
    const meta = Object.assign({}, ...events.filter((e) => e.type === "meta"));
    return {
      title: "mcp-use Inspector",
      client: "mcp-use Inspector (Manufact's browser MCP client with chat), driven in headless Chromium",
      model: `${meta.llm} (the Inspector's built-in hosted chat model; no key or account)`,
      command: "npx @mcp-use/inspector --url \"$URL\" --no-open & node inspector-gui.mjs \"$TASK\"   # types the task into the Chat tab",
      calls,
      answer,
      stats: meta.seconds ? `${meta.seconds.toFixed(1)} s incl. browser start` : "",
    };
  },
};

// Claude's init event lists the box's private skills, plugins and sockets; keep
// only what the transcript needs before the raw log is committed.
const INIT_KEEP = ["type", "subtype", "session_id", "tools", "mcp_servers", "model", "claude_code_version"];
function pruneClaudeInit(f) {
  const out = lines(f).map((e) => (e.type === "system" && e.subtype === "init" ? Object.fromEntries(INIT_KEEP.filter((k) => k in e).map((k) => [k, e[k]])) : e));
  fs.writeFileSync(f, out.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

const argsText = (a) => JSON.stringify(a ?? {});
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(parsers)) {
  const f = path.join(here, "raw", `${name}.jsonl`);
  if (!fs.existsSync(f)) continue;
  if (name === "claude") pruneClaudeInit(f);
  const t = parsers[name](lines(f));
  const when = fs.statSync(f).mtime.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const md = [
    `# ${t.title} → clify MCP (deployed on Manufact)`,
    "",
    `- **Client:** ${t.client}`,
    `- **Model:** ${t.model}`,
    `- **Server:** ${url}`,
    `- **Run:** ${when} on a Linux box${t.stats ? `, ${t.stats}` : ""}`,
    `- **Raw log:** \`raw/${name}.jsonl\`${name === "inspector" ? ", chat stream \`raw/inspector-stream.txt\`, screenshots \`raw/inspector/\`" : ""}`,
    "",
    "```bash",
    t.command,
    "```",
    "",
    "## Task",
    "",
    task.split("\n").map((l) => `> ${l}`).join("\n"),
    "",
    `## Tool calls (${t.calls.length})`,
    "",
    ...t.calls.flatMap((c, i) => [`### ${i + 1}. \`${c.tool}\``, "", "```json", argsText(c.args), "```", "", "Result:", "", "```json", clip(c.result ?? ""), "```", ""]),
    "## Answer",
    "",
    t.answer,
    "",
  ].join("\n");
  const out = `transcript-${name === "claude" ? "claude-code" : name}.md`;
  fs.writeFileSync(path.join(here, out), md);
  fs.writeFileSync(path.join(here, "raw", `${name}.screen.json`), JSON.stringify({ title: t.title, model: t.model, command: t.command, calls: t.calls.map((c) => ({ tool: c.tool, args: argsText(c.args), result: clip(c.result ?? "", 260) })), answer: t.answer, stats: t.stats }, null, 2));
  console.log(`${name}: ${t.calls.length} tool calls → ${out}`);
}
