import Anthropic from "@anthropic-ai/sdk";
import { execFileSync } from "node:child_process";
import { log } from "./store.ts";

export const MODEL = process.env.CLIFY_MODEL || "claude-opus-5-5";

// The API key comes from ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN, or from the
// stdout of CLIFY_LLM_KEY_CMD (a key helper, e.g. a local proxy's key printer).
// Never logged.
function apiKey(): string | undefined {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return undefined; // SDK reads them itself
  const cmd = process.env.CLIFY_LLM_KEY_CMD;
  if (!cmd) return undefined;
  try {
    return execFileSync("/bin/sh", ["-c", cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

// Created on first use so deterministic paths (scripted runs, running
// generated CLIs) work without an API key.
let _client: Anthropic | undefined;
export const client = new Proxy({} as Anthropic, {
  get(_, prop) {
    _client ??= new Anthropic({ maxRetries: 0, apiKey: apiKey() ?? process.env.ANTHROPIC_API_KEY ?? null, timeout: 10 * 60_000 });
    return (_client as any)[prop];
  },
});

export function hasApiKey(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.CLIFY_LLM_KEY_CMD);
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// Some proxies silently answer with another model when the requested one is
// rate limited. Those answers are discarded and retried like a 429.
class WrongModel extends Error {
  status = 429;
  constructor(got: string) {
    super(`answered by ${got}, not ${MODEL}`);
  }
}

export function checkModel<T extends { model?: string }>(res: T): T {
  if (process.env.CLIFY_ANY_MODEL) return res;
  const got = String(res.model ?? "");
  if (!got.startsWith(MODEL)) throw new WrongModel(got || "unknown model");
  return res;
}

// Retries rate limits, overloads, 5xx, network errors and wrong-model answers
// with exponential backoff.
export async function withRetry<T>(fn: () => Promise<T>, tries = 8): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      const status = e?.status ?? 0;
      const retryable = status === 429 || status === 529 || status >= 500 || status === 0 || /overloaded|ECONNRESET|ETIMEDOUT|fetch failed|socket|terminated/i.test(String(e?.message));
      if (!retryable || attempt >= tries) throw e;
      const wait = Math.min(90_000, 3000 * 2 ** (attempt - 1)) + Math.random() * 2000;
      log(`  ↻ LLM ${e instanceof WrongModel ? e.message : status || "network"} error, retry ${attempt}/${tries - 1} in ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// One-shot question; returns the text answer.
export async function ask(prompt: string, effort: Effort = "medium", maxTokens = 32000, system?: string): Promise<string> {
  const msg = await withRetry(async () =>
    checkModel(
      await client.messages
        .stream({
          model: MODEL,
          max_tokens: maxTokens,
          output_config: { effort },
          ...(system ? { system } : {}),
          messages: [{ role: "user", content: prompt }],
        } as any)
        .finalMessage(),
    ),
  );
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// Ask for JSON; one re-ask if the answer does not parse.
export async function askJson<T>(prompt: string, effort: Effort = "medium", maxTokens = 32000, system?: string): Promise<T> {
  let text = await ask(prompt, effort, maxTokens, system);
  try {
    return parseJson<T>(text);
  } catch (e) {
    log(`  ↻ LLM answer was not valid JSON (${(e as Error).message.slice(0, 80)}), asking again`);
    text = await ask(`${prompt}\n\nYour previous answer was not valid JSON. Answer with only the JSON object.`, effort, maxTokens, system);
    return parseJson<T>(text);
  }
}

// Pull the first JSON object/array out of a model answer.
export function parseJson<T>(text: string): T {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = m ? m[1] : text;
  const start = raw.search(/[[{]/);
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  return JSON.parse(raw.slice(start, end + 1)) as T;
}
