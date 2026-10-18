// Runs inside a Blaxel sandbox next to a headless Chrome (--remote-debugging-port=9222).
// Chrome only accepts DevTools connections whose Host is localhost/an IP, and a
// preview URL arrives with its own host, so this forwards HTTP and the WebSocket
// upgrade with Host rewritten. Any WebSocket path that isn't /devtools/... goes
// to the browser endpoint, so the client can connect to wss://<preview>/ directly.
import http from "node:http";
import net from "node:net";

const CHROME = Number(process.env.CHROME_PORT || 9222);
const PORT = Number(process.env.PROXY_PORT || 9300);

async function browserPath() {
  const r = await fetch(`http://127.0.0.1:${CHROME}/json/version`);
  return new URL((await r.json()).webSocketDebuggerUrl).pathname;
}

const server = http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://x").pathname;
    if (!path.startsWith("/json")) return res.writeHead(200).end("clify cdp proxy\n");
    const r = await fetch(`http://127.0.0.1:${CHROME}${path}`);
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const body = (await r.text()).replaceAll(`ws://127.0.0.1:${CHROME}`, `wss://${host}`);
    res.writeHead(r.status, { "content-type": "application/json" }).end(body);
  } catch (e) {
    res.writeHead(502).end(String(e));
  }
});

server.on("upgrade", async (req, sock, head) => {
  sock.on("error", () => {});
  let path = new URL(req.url, "http://x").pathname;
  try {
    if (!path.startsWith("/devtools/")) path = await browserPath();
  } catch {
    return sock.destroy();
  }
  const up = net.connect(CHROME, "127.0.0.1", () => {
    up.write(
      `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${CHROME}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${req.headers["sec-websocket-key"]}\r\nSec-WebSocket-Version: ${req.headers["sec-websocket-version"] || 13}\r\n\r\n`,
    );
    if (head?.length) up.write(head);
    up.pipe(sock);
    sock.pipe(up);
  });
  up.on("error", () => sock.destroy());
  sock.on("close", () => up.destroy());
});

server.listen(PORT, "::", () => console.log(`cdp proxy :${PORT} -> chrome :${CHROME}`));
