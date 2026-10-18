// Messages API client for the agent loop. On the InstaBox it talks to the LLM
// bridge on 127.0.0.1:18318 (see bridge/), which forwards to the Claude Opus
// 5.5 pool and holds the key; locally any Anthropic-compatible endpoint works.
// Every call returns the model that actually answered, so a fallback to
// another model is visible in the job log.
export const MODEL = process.env.CLIFY_AGENT_MODEL || "claude-opus-5-5";
const BASE = (process.env.CLIFY_AGENT_LLM_URL || process.env.ANTHROPIC_BASE_URL || "http://127.0.0.1:18318").replace(/\/$/, "");
const KEY = process.env.ANTHROPIC_API_KEY || "bridge"; // the bridge adds the real key on the box

export interface Block {
  type: string;
  [k: string]: any;
}
export interface Msg {
  role: "user" | "assistant";
  content: string | Block[];
}
export interface Tool {
  name: string;
  description: string;
  input_schema: object;
}
export interface Reply {
  content: Block[];
  stop_reason: string;
  model: string;
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function complete(o: { system: string; messages: Msg[]; tools: Tool[]; maxTokens?: number; effort?: string }): Promise<Reply> {
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: o.maxTokens ?? 8000,
    system: o.system,
    messages: o.messages,
    tools: o.tools,
    ...(o.effort ? { output_config: { effort: o.effort } } : {}),
  });
  for (let attempt = 1; ; attempt++) {
    let status = 0;
    let text = "";
    try {
      const res = await fetch(`${BASE}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": KEY },
        body,
        signal: AbortSignal.timeout(10 * 60_000),
      });
      status = res.status;
      text = await res.text();
      if (res.ok) return JSON.parse(text) as Reply;
    } catch (e) {
      text = (e as Error).message;
    }
    const retry = status === 0 || status === 429 || status === 529 || status >= 500;
    if (!retry || attempt >= 6) throw new Error(`LLM ${status}: ${text.slice(0, 300)}`);
    await sleep(Math.min(60_000, 3000 * 2 ** (attempt - 1)));
  }
}
