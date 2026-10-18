// Minimal streamable-HTTP MCP client for probes and measurements (no deps).
//   import { connect } from "./rpc.mjs"; const c = await connect(url); await c.call("tools/list");
export async function connect(url) {
  let session;
  let id = 0;
  const post = async (method, params, notify = false) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}), ...(notify ? {} : { id: ++id }) }),
    });
    session ??= res.headers.get("mcp-session-id") ?? undefined;
    if (notify) return;
    const body = await res.text();
    const msgs = /event-stream/.test(res.headers.get("content-type") ?? "")
      ? body.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)))
      : [JSON.parse(body)];
    const m = msgs.find((x) => x.id === id) ?? msgs.at(-1);
    if (m?.error) throw new Error(`${method}: ${JSON.stringify(m.error)}`);
    return m?.result;
  };
  const init = await post("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "clify-probe", version: "1" } });
  await post("notifications/initialized", undefined, true);
  return {
    init,
    call: post,
    tool: async (name, args = {}) => {
      const r = await post("tools/call", { name, arguments: args });
      const t = r?.content?.[0]?.text;
      try {
        return { isError: !!r?.isError, json: JSON.parse(t) };
      } catch {
        return { isError: !!r?.isError, text: t };
      }
    },
  };
}
