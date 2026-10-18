// mcp-use client demo: an MCPAgent (@mcp-use/agent + @mcp-use/client) with
// anthropic/claude-opus-5-5 runs the task against the deployed clify server.
// Prints JSONL events (tool_call, tool_result, final, meta) to stdout.
//   CLIFY_MCP_URL=... ANTHROPIC_API_KEY=... node mcp-use-agent.mjs "<task>"
// To use an Anthropic-compatible proxy, set ANTHROPIC_PROXY: @mcp-use/agent's
// Anthropic provider has no base-URL option, so its fetch to api.anthropic.com
// is routed there.
import { MCPAgent } from "@mcp-use/agent";

const url = process.env.CLIFY_MCP_URL ?? "https://bold-cloud-h4u6s.run.mcp-use.com/mcp";
const task = process.argv[2];
const proxy = process.env.ANTHROPIC_PROXY ?? "https://api.anthropic.com";
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");

const models = new Set();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!u.startsWith("https://api.anthropic.com/")) return realFetch(input, init);
  const res = await realFetch(u.replace("https://api.anthropic.com", proxy), init);
  res.clone().text().then((t) => { for (const m of t.matchAll(/"model"\s*:\s*"([^"]+)"/g)) models.add(m[1]); }, () => {});
  return res;
};

const agent = new MCPAgent({
  llm: "anthropic/claude-opus-5-5",
  llmConfig: { maxTokens: 2000 },
  mcpServers: { clify: { url } },
  maxSteps: 15,
});

const t0 = Date.now();
try {
  await agent.initialize();
  emit({ type: "meta", client: "@mcp-use/agent MCPAgent", server: url, llm: "anthropic/claude-opus-5-5" });
  const stream = agent.stream({ prompt: task });
  while (true) {
    const next = await stream.next();
    if (next.done) {
      emit({ type: "final", text: next.value });
      break;
    }
    const { action, observation } = next.value;
    if (!observation) emit({ type: "tool_call", tool: action.tool, input: action.toolInput });
    else emit({ type: "tool_result", tool: action.tool, output: observation });
  }
} finally {
  await agent.close();
  emit({ type: "meta", seconds: (Date.now() - t0) / 1000, responseModels: [...models] });
}
