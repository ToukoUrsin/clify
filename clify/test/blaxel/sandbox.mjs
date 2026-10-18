// Blaxel sandboxes for clify: one per site, holding the exploration browser
// (Chrome + CDP behind a private preview URL) and later the verification run of
// the generated CLI (node + clify + the spec, no model calls).
// Needs BL_API_KEY and BL_WORKSPACE in the environment.
import fs from "node:fs";
import path from "node:path";
import { SandboxInstance } from "@blaxel/core";

const here = path.dirname(new URL(import.meta.url).pathname);
export const REGION = process.env.BL_REGION || "us-pdx-1";
export const IMAGE = process.env.BL_IMAGE || "blaxel/playwright-chromium:latest";

// Runs a shell script in the sandbox (written to a file first, so no quoting
// layers between here and bash).
let seq = 0;
async function sh(sb, script, opts = {}) {
  const f = `/tmp/clify-sh-${++seq}.sh`;
  await sb.fs.write(f, script);
  const r = await sb.process.exec({ command: `bash ${f}`, waitForCompletion: true, ...opts });
  return { code: r.exitCode, logs: r.logs ?? "" };
}

async function spawn(sb, name, script) {
  const f = `/tmp/clify-${name}.sh`;
  await sb.fs.write(f, script);
  await sb.process.exec({ name, command: `bash ${f}`, waitForCompletion: false, keepAlive: true, timeout: 3600 });
}

// Starts a sandbox with headless Chrome and returns a CDP WebSocket URL for
// `CLIFY_CDP_URL` plus the auth headers for `CLIFY_CDP_HEADERS`: by default the
// sandbox API's port route (Blaxel API key as bearer), or with BL_CDP_VIA=preview
// a private preview URL whose short-lived token is in the URL.
export async function startBrowser(name, { ttl = "2h" } = {}) {
  const t0 = Date.now();
  let sb;
  for (let attempt = 1; ; attempt++) {
    try {
      sb = await SandboxInstance.create({ name, image: IMAGE, memory: 4096, region: REGION, ttl, labels: { app: "clify" }, ports: [{ target: 9300, protocol: "HTTP" }] });
      break;
    } catch (e) {
      // e.g. "Sandbox deployment failed" while the workspace is at its sandbox limit
      await remove(name);
      if (attempt >= 6) throw e;
      await new Promise((r) => setTimeout(r, 20_000 * attempt));
    }
  }
  await sb.fs.write("/tmp/cdp-proxy.mjs", fs.readFileSync(path.join(here, "cdp-proxy.mjs"), "utf8"));
  // Stock headless Chrome from the image (no stealth flags, default user agent).
  await spawn(
    sb,
    "chrome",
    'exec "$(ls -d /home/playwright/.cache/ms-playwright/chromium-*/chrome-linux64/chrome | head -1)" --headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu --no-first-run --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-profile about:blank',
  );
  await spawn(sb, "cdp-proxy", "exec node /tmp/cdp-proxy.mjs");
  const ready = await sh(sb, "for i in $(seq 1 80); do curl -sf http://127.0.0.1:9300/json/version >/dev/null && exit 0; sleep 0.25; done; exit 1");
  if (ready.code !== 0) throw new Error(`chrome did not start in sandbox ${name}: ${ready.logs.slice(-300)}`);
  const version = JSON.parse((await sh(sb, "curl -s http://127.0.0.1:9222/json/version")).logs).Browser;
  if (process.env.BL_CDP_VIA === "preview") {
    // private preview URL with a short-lived token (counts against the workspace's preview quota)
    const preview = await sb.previews.createIfNotExists({ metadata: { name: "cdp" }, spec: { port: 9300, public: false } });
    const token = await preview.tokens.create(new Date(Date.now() + 3 * 3600_000));
    const host = new URL(preview.spec.url).host;
    return { sb, name, region: REGION, chrome: version, cdpUrl: `wss://${host}/?bl_preview_token=${token.value}`, startMs: Date.now() - t0 };
  }
  // default: the sandbox API's authenticated port route, https://<sandbox>/port/9300
  const host = new URL(sb.metadata.url).host;
  const headers = { Authorization: `Bearer ${process.env.BL_API_KEY}` };
  return { sb, name, region: REGION, chrome: version, cdpUrl: `wss://${host}/port/9300/`, cdpHeaders: headers, startMs: Date.now() - t0 };
}

// Copies the clify bundle (tar.gz with production node_modules) into the
// sandbox once, then runs `clify check <site>` on the given spec there.
export async function checkInSandbox(sb, bundle, spec) {
  const t0 = Date.now();
  const has = await sh(sb, "test -x /opt/clify/bin/clify");
  if (has.code !== 0) {
    await sb.fs.writeBinary("/tmp/clify.tgz", fs.readFileSync(bundle));
    const x = await sh(sb, "mkdir -p /opt/clify && tar xzf /tmp/clify.tgz -C /opt/clify && rm /tmp/clify.tgz");
    if (x.code !== 0) throw new Error(`bundle unpack failed: ${x.logs.slice(-300)}`);
  }
  await sb.fs.write(`/tmp/ch/sites/${spec.name}/spec.json`, JSON.stringify(spec));
  const r = await sh(
    sb,
    `cd /opt/clify && CLIFY_HOME=/tmp/ch CLIFY_NO_BUILTINS=1 CLIFY_QUIET=1 timeout 900 bin/clify check ${spec.name} > /tmp/check.json 2>/tmp/check.err; echo exit=$?`,
    { timeout: 960 },
  );
  let out = null;
  try {
    out = JSON.parse(await sb.fs.read("/tmp/check.json"));
  } catch {
    /* reported below */
  }
  const node = (await sh(sb, "node -v")).logs.trim();
  return { out, exit: r.logs.trim(), node, ms: Date.now() - t0, err: out ? undefined : (await sb.fs.read("/tmp/check.err").catch(() => "")).slice(-500) };
}

export async function remove(name) {
  try {
    const sb = await SandboxInstance.get(name);
    await sb.delete();
    return true;
  } catch {
    return false;
  }
}

export async function listClify() {
  const l = await SandboxInstance.list();
  const items = Array.isArray(l) ? l : (l.data ?? []);
  return items.filter((s) => s.metadata?.labels?.app === "clify" || s.metadata?.name?.startsWith("clify-"));
}
