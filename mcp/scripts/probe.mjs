// Live probe of a running server (local or deployed): discovery, help, real
// calls on two sites, error paths and the write gate. Exits 1 on any failure.
//   node scripts/probe.mjs [url]     (default http://localhost:3000/mcp)
import { connect } from "./rpc.mjs";

const url = process.argv[2] ?? "http://localhost:3000/mcp";
const c = await connect(url);
let fail = 0;
const check = async (label, name, args, ok) => {
  const t0 = Date.now();
  let r;
  try {
    r = await c.tool(name, args);
    const pass = ok(r.json ?? {}, r);
    if (!pass) fail++;
    console.log(`${pass ? "PASS" : "FAIL"} ${label} (${Date.now() - t0} ms, ${JSON.stringify(r.json ?? r.text).length} chars)`);
    if (!pass) console.log("  ", JSON.stringify(r).slice(0, 600));
  } catch (e) {
    fail++;
    console.log(`FAIL ${label}: ${e.message}`);
  }
  return r?.json;
};

const { tools } = await c.call("tools/list");
console.log(`server ${c.init.serverInfo.name} ${c.init.serverInfo.version}: ${tools.length} tools (${tools.map((t) => t.name).join(", ")})`);

const row = (s) => /^([\w.-]+) \(([\w-]+), \d+\): \S/.exec(s) ?? [];
const first = await check("clify_sites pages the catalogue (one line per site)", "clify_sites", {}, (j) => j.total >= 100 && j.count === j.sites?.length && j.count <= 40 && j.sites.every((s) => row(s)[1]) && j.nextPage?.offset === j.count && Object.values(j.categories ?? {}).reduce((a, b) => a + b, 0) === j.total);
if (first?.nextPage) {
  const seen = new Set(first.sites.map((s) => row(s)[1]));
  let next = first.nextPage;
  let pages = 1;
  while (next && pages < 10) {
    const r = await c.tool("clify_sites", next);
    r.json.sites.forEach((s) => seen.add(row(s)[1]));
    next = r.json.nextPage;
    pages++;
  }
  const pass = seen.size === first.total && seen.has("crates");
  if (!pass) fail++;
  console.log(`${pass ? "PASS" : "FAIL"} clify_sites nextPage walks all ${first.total} sites (${pages} pages, ${seen.size} unique)`);
}
await check("clify_sites finds crates for a rust query", "clify_sites", { query: "rust crate versions" }, (j) => j.sites?.[0]?.site === "crates");
await check("clify_sites finds weather for a forecast query", "clify_sites", { query: "weather forecast San Francisco" }, (j) => j.sites?.[0]?.site === "weather");
await check("clify_sites category filter", "clify_sites", { category: "science" }, (j) => j.sites.every((s) => row(s)[2] === "science") && j.count > 3 && j.total === j.count);
await check("clify_help site", "clify_help", { site: "weather" }, (j) => j.commands.some((x) => x.command === "get-forecast" && x.params.includes("wfo*")));
await check("clify_help command", "clify_help", { site: "crates", command: "get-crate" }, (j) => j.example?.tool === "clify_run" && j.params.length > 0);
const crate = await check("clify_run crates get-crate serde", "clify_run", { site: "crates", command: "get-crate", args: { name: "serde" } }, (j) => j.ok && /^\d+\.\d+\.\d+/.test(j.data?.default_version ?? ""));
const point = await check("clify_run weather get-point (San Francisco)", "clify_run", { site: "weather", command: "get-point", args: { lat: 37.7749, lon: -122.4194 } }, (j) => j.ok && j.data?.gridId === "MTR");
if (point?.ok) {
  await check("clify_run weather get-forecast", "clify_run", { site: "weather", command: "get-forecast", args: { wfo: point.data.gridId, x: point.data.gridX, y: point.data.gridY }, limit: 2 }, (j) => j.ok && j.data?.length === 2 && typeof j.data[0].temperature === "number");
}
await check("clify_run arxiv list-new (XML/HTML site)", "clify_run", { site: "arxiv", command: "list-new", args: { category: "cs.LG" }, limit: 2 }, (j) => j.ok && j.data?.length === 2);
await check("site by host name (crates.io)", "clify_run", { site: "crates.io", command: "get-crate", args: { name: "serde" } }, (j) => j.ok === true);
await check("unknown field names the real ones", "clify_run", { site: "crates", command: "list-versions", args: { name: "serde", per_page: 1 }, fields: "versions" }, (j) => j.ok && j.unknownFields?.[0] === "versions" && j.availableFields?.includes("num"));
await check("unknown site error", "clify_run", { site: "nosuchsite", command: "x" }, (j, r) => r.isError && j.next);
await check("missing param names the fix", "clify_run", { site: "crates", command: "get-crate", args: {} }, (j, r) => r.isError && /missing name/.test(j.error) && /clify_help/.test(j.next));
await check("unknown command lists commands", "clify_run", { site: "crates", command: "nope" }, (j, r) => r.isError && j.commands?.includes("get-crate"));
await check("write gate: preview, nothing sent", "clify_run", { site: "httpbinform", command: "place-order", args: { custname: "Ada", size: "large" } }, (j) => j.needsConfirmation === true && j.preview?.method === "POST");
if (tools.some((t) => t.name === "crates__get-crate")) {
  await check("featured crates__get-crate", "crates__get-crate", { name: "serde" }, (j) => j.ok && j.data?.default_version === crate?.data?.default_version);
}
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
