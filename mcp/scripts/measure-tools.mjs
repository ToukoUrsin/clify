// Measures what a server's tool list costs an agent before it does anything:
// tool count, JSON size, and Claude input tokens (Anthropic count_tokens with
// and without the tools; ANTHROPIC_BASE_URL may point at a compatible proxy).
//   node scripts/measure-tools.mjs label=url [label=url ...]
import { connect } from "./rpc.mjs";

const API = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
const KEY = process.env.ANTHROPIC_API_KEY;
const model = process.env.MEASURE_MODEL ?? "claude-opus-5-5";

async function countTokens(tools) {
  if (!KEY) return null;
  const body = { model, messages: [{ role: "user", content: "hi" }], ...(tools.length ? { tools } : {}) };
  const res = await fetch(`${API}/v1/messages/count_tokens`, {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (typeof j.input_tokens !== "number") throw new Error(`count_tokens: ${JSON.stringify(j).slice(0, 300)}`);
  return j.input_tokens;
}

const base = await countTokens([]);
const rows = [];
for (const arg of process.argv.slice(2)) {
  const [label, url] = arg.split(/=(?=https?:\/\/)/); // labels may contain "="
  const c = await connect(url);
  const { tools } = await c.call("tools/list");
  const defs = tools.map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema }));
  const tokens = base === null ? null : (await countTokens(defs)) - base;
  rows.push({ label, tools: tools.length, jsonChars: JSON.stringify(tools).length, claudeTokens: tokens });
}
console.log(JSON.stringify({ model, measuredAt: new Date().toISOString(), method: "count_tokens(messages+tools) - count_tokens(messages)", rows }, null, 2));
