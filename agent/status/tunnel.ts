// Brings the status page (server.ts on 127.0.0.1:18320) online at the Inkbox
// identity's own internet address, https://<handle>.inkboxwire.com, over one
// outbound connection: the InstaBox has no inbound ports. Only GET/HEAD of the
// status paths are passed on; the SDK reconnects by itself.
//
// Environment:
//   CLIFY_HOME          the clify home whose vault holds the Inkbox identity (the peer's)
//   STATUS_PORT         default 18320
//   STATUS_TUNNEL_FILE  where the connection state goes for the status page
//   STATUS_TUNNEL_STATE the SDK's state dir (default /data/home/.clify-tunnel/sdk)
import fs from "node:fs";
import path from "node:path";
import { Inkbox } from "@inkbox/sdk";
import { connect } from "@inkbox/sdk/tunnels/connect";
import { getIdentity } from "../../clify/src/vault.ts";

const env = (k: string, d = "") => process.env[k]?.trim() || d;
const PORT = Number(env("STATUS_PORT", "18320"));
const FILE = env("STATUS_TUNNEL_FILE", "/data/home/.clify-tunnel/status.json");
const i = getIdentity();
const key = i?.apiKeys?.inkbox;
const handle = i?.handle ?? i?.email?.split("@")[0];
if (!key || !handle) throw new Error("no Inkbox identity/key in the vault at $CLIFY_HOME");

fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
let since = new Date().toISOString();
let publicUrl = `https://${handle}.inkboxwire.com`;
const note = (status: string) => {
  if (status === "connected") since = new Date().toISOString();
  fs.writeFileSync(FILE, JSON.stringify({ handle, public_url: publicUrl, status, since }));
  process.stdout.write(`${new Date().toISOString().slice(11, 19)} tunnel ${status}\n`);
};

const local = `http://127.0.0.1:${PORT}`;
const listener = await connect(new Inkbox({ apiKey: key }), {
  name: handle,
  stateDir: env("STATUS_TUNNEL_STATE", path.join(path.dirname(FILE), "sdk")),
  maxInboundBodyBytes: 4096,
  maxResponseBytes: 256 * 1024,
  installSignalHandlers: true,
  onStatus: (s) => note(s),
  // Read-only: only GET/HEAD reach the status server; it rate-limits by X-Forwarded-For.
  handler: async (req, ctx) => {
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("read-only: GET or HEAD\n", { status: 405, headers: { allow: "GET, HEAD" } });
    const u = new URL(req.url);
    const r = await fetch(local + u.pathname + u.search, {
      method: req.method,
      headers: { accept: req.headers.get("accept") ?? "*/*", "x-forwarded-for": ctx.forwardedForIp ?? "unknown" },
      redirect: "manual",
      signal: ctx.signal,
    });
    const headers = new Headers(r.headers);
    for (const h of ["connection", "keep-alive", "transfer-encoding", "content-length"]) headers.delete(h);
    return new Response(req.method === "HEAD" ? null : await r.arrayBuffer(), { status: r.status, headers });
  },
});
publicUrl = listener.publicUrl || publicUrl;
process.stdout.write(`status page public at ${publicUrl}/status\n`);
await listener.wait();
