// Sandbox end of the LLM bridge. Listens on 127.0.0.1:$BRIDGE_PORT (default
// 18318) inside the InstaBox and carries each HTTP request as one JSON line on
// stdout to the box end, which answers on stdin. The box end holds the model
// key; nothing secret lives here.
//
// It runs as the remote command of `instabox ssh <box> -- -T node sandbox-end.mjs`
// (the InstaBox SSH gateway refuses `ssh -R`, but stdio is clean).
import http from "node:http";
import readline from "node:readline";

const PORT = Number(process.env.BRIDGE_PORT || 18318);
const pending = new Map();
let seq = 0;

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const id = `${process.pid}-${++seq}`;
    const headers = {};
    for (const k of ["content-type", "anthropic-version", "anthropic-beta", "accept"]) if (req.headers[k]) headers[k] = req.headers[k];
    pending.set(id, res);
    process.stdout.write(JSON.stringify({ id, method: req.method, path: req.url, headers, body: Buffer.concat(chunks).toString("utf8") }) + "\n");
    res.setTimeout(15 * 60_000, () => {
      if (!pending.delete(id)) return;
      res.writeHead(504, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type: "bridge_timeout", message: "box end did not answer" } }));
    });
  });
});

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  const res = pending.get(m.id);
  if (!res) return;
  pending.delete(m.id);
  res.writeHead(m.status, { "content-type": m.contentType || "application/json", ...(m.model ? { "x-bridge-model": m.model } : {}) }).end(m.body);
});

// The box end went away (SSH dropped): exit so the port frees and the box end can reconnect.
process.stdin.on("end", () => process.exit(0));
server.on("error", (e) => {
  process.stderr.write(`bridge: ${e.message}\n`);
  process.exit(1);
});
server.listen(PORT, "127.0.0.1", () => process.stderr.write(`bridge: listening on 127.0.0.1:${PORT}\n`));
