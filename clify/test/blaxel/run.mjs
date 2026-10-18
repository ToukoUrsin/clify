// `clify add` on many sites, each with its exploration browser in its own Blaxel
// sandbox, then the generated CLI verified live inside that same sandbox
// (`clify check`: node + clify + the spec, no model calls). The model calls of
// `clify add` run here, on the machine that runs this script.
//   node test/blaxel/run.mjs sites.txt [jobs]     sites.txt: "url category [goal...]" per line
// Needs BL_API_KEY/BL_WORKSPACE (Blaxel) and the usual clify model env.
// Results: $OUT/<tag>.json (one per site), $OUT/home (CLIFY_HOME with the specs).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { startBrowser, checkInSandbox, remove } from "./sandbox.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const CLIFY = path.resolve(here, "../..");
const list = process.argv[2] || path.join(here, "sites.txt");
const jobs = Math.min(6, Number(process.argv[3] || 6));
const OUT = process.env.OUT || path.join(os.homedir(), "clify-runs", `blaxel-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}`);
const HOME = process.env.CLIFY_HOME || path.join(OUT, "home");
const BUNDLE = process.env.CLIFY_BUNDLE || "/tmp/clify-bundle.tgz";
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(BUNDLE)) throw new Error(`no bundle at ${BUNDLE}: run test/blaxel/bundle.sh first`);

const sites = fs
  .readFileSync(list, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => {
    const [url, category = "", ...goal] = l.split(/\s+/);
    return { url, category, goal: goal.join(" ") };
  });

const tagOf = (url) => url.replace(/^https?:\/\//, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/_+$/, "");
const stamp = () => new Date().toISOString().slice(11, 19);

function clifyAdd(url, goal, cdp, logFile) {
  return new Promise((resolve) => {
    const args = ["-n", "10", "timeout", "1800", "bin/clify", "add", url, "--account", "none", ...(goal ? ["--goal", goal] : [])];
    const p = spawn("nice", args, { cwd: CLIFY, env: { ...process.env, CLIFY_HOME: HOME, CLIFY_CDP_URL: cdp.cdpUrl, ...(cdp.cdpHeaders ? { CLIFY_CDP_HEADERS: JSON.stringify(cdp.cdpHeaders) } : {}) } });
    let out = "";
    const log = fs.createWriteStream(logFile);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.pipe(log);
    p.on("close", (code) => {
      let summary = null;
      try {
        summary = JSON.parse(out.slice(Math.max(0, out.search(/^\{/m)))); // the summary is the last thing printed
      } catch {
        /* crash or timeout */
      }
      resolve({ code, summary, ...(summary ? {} : { stdoutTail: out.slice(-400) }) });
    });
  });
}

async function one(s) {
  const tag = tagOf(s.url);
  const file = path.join(OUT, `${tag}.json`);
  if (fs.existsSync(file)) return;
  // several runners can share one list and OUT: the first to claim a site runs it
  try {
    fs.writeFileSync(path.join(OUT, `${tag}.lock`), String(process.pid), { flag: "wx" });
  } catch {
    return;
  }
  const sandbox = `clify-${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.slice(0, 45).replace(/-+$/, "");
  const rec = { url: s.url, category: s.category, sandbox, startedAt: new Date().toISOString() };
  const t0 = Date.now();
  console.log(`${stamp()} start ${s.url} (${sandbox})`);
  try {
    await remove(sandbox); // leftover from an interrupted run
    const b = await startBrowser(sandbox);
    Object.assign(rec, { region: b.region, chrome: b.chrome, sandboxStartMs: b.startMs });
    const t1 = Date.now();
    const add = await clifyAdd(s.url, s.goal, b, path.join(OUT, `${tag}.log`));
    rec.addSeconds = Math.round((Date.now() - t1) / 1000);
    rec.addExit = add.code;
    rec.add = add.summary;
    if (add.stdoutTail !== undefined) rec.addStdoutTail = add.stdoutTail;
    const site = add.summary?.site;
    const specFile = site && path.join(HOME, "sites", site, "spec.json");
    const spec = specFile && fs.existsSync(specFile) ? JSON.parse(fs.readFileSync(specFile, "utf8")) : null;
    if (spec?.commands?.length) {
      const c = await checkInSandbox(b.sb, BUNDLE, spec);
      const reads = new Set(spec.commands.filter((x) => !x.mutates).map((x) => x.name));
      const results = c.out?.results ?? [];
      rec.check = {
        on: "blaxel",
        node: c.node,
        seconds: Math.round(c.ms / 1000),
        reads: reads.size,
        verified: results.filter((r) => r.ok && reads.has(r.name)).length,
        failed: results.filter((r) => !r.ok).map((r) => ({ name: r.name, reason: (r.reason ?? "").slice(0, 160) })),
        results,
        ...(c.err ? { error: c.err } : {}),
      };
    }
  } catch (e) {
    rec.error = (e?.message ?? JSON.stringify(e)).slice(0, 400);
  } finally {
    rec.deleted = await remove(rec.sandbox);
    fs.rmSync(path.join(OUT, `${tag}.lock`), { force: true });
    if (!rec.add && rec.error) {
      // never got as far as `clify add` (sandbox start failed): leave no record, so a re-run retries
      console.log(`${stamp()} retry later ${s.url}: ${rec.error}`);
      return;
    }
    rec.seconds = Math.round((Date.now() - t0) / 1000);
    fs.writeFileSync(file, JSON.stringify(rec, null, 2) + "\n");
    console.log(`${stamp()} done ${s.url}: add ${rec.add?.verified ?? "-"} verified, blaxel ${rec.check?.verified ?? "-"}/${rec.check?.reads ?? "-"} (${rec.seconds}s)${rec.error ? " ERROR " + rec.error : ""}`);
  }
}

let next = 0;
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (next < sites.length) await one(sites[next++]);
  }),
);
console.log(`${stamp()} all done: ${OUT}`);
