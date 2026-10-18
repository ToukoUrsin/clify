#!/usr/bin/env node
// Every headline number in the docs, derived from the files that prove it.
//   node scripts/counts.mjs           check: exit 1 if any doc disagrees with the sources
//   node scripts/counts.mjs --print   print the numbers and the exact README snippets
//   node scripts/counts.mjs [ROOT]    check another tree (e.g. the public export)
// Sources: clify/specs (built-in CLIs), mcp/src/specs.generated.ts (hosted catalogue),
// clify/proofs/sites.md + sites-blaxel.md (the `clify add` sweeps), clify/proofs/wall.json,
// mcp/demo/tool-tokens.json, race/results (modes + per-run summaries), bench/results.
// When a race is re-run, point RACE below at the new modes file, then copy the snippets
// that --print shows into README.md and race/README.md.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const PRINT = args.includes("--print");
const ROOT = path.resolve(args.find((a) => !a.startsWith("--")) ?? path.join(path.dirname(new URL(import.meta.url).pathname), ".."));
const RACE = {
  generated: { modes: "race/results/accounts-modes.json", prefix: "generated-" },
  handwritten: { modes: "race/results/accounts-modes-handwritten.json", prefix: "accounts-" },
  round4: { modes: "race/results/accounts-modes-generated-r4.json" },
};
// the run the README's hero GIF (assets/race.gif) replays
const GIF_RUN = "2026-10-18T09-57-57-642Z";
// the bench's scraping-practice sites (site ids in bench/tasks.mjs)
const PRACTICE = ["books", "quotes", "scrapethis", "webscraper"];
const BENCH = "bench/results/summary-main+hard+ui+ui2.json";
// versus an agent with curl: bench mode `curl` (all 20 tasks), clify re-run on the same box (14 tasks), race mode D
const BENCH_CURL = "bench/results/summary-curl.json";
const BENCH_CLI_SAME = "bench/results/summary-clisame.json";
const RACE_CURL = "race/results/curl-modes.json";

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const exists = (f) => fs.existsSync(path.join(ROOT, f));
const json = (f) => JSON.parse(read(f));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => sum(a) / a.length;
const fmt = (n) => n.toLocaleString("en-US");
const x1 = (r) => `${r.toFixed(1)}×`;
const problems = [];
const assert = (ok, msg) => ok || problems.push(msg);

// ---- built-in CLIs ----
const builtinNames = fs.readdirSync(path.join(ROOT, "clify/specs")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
const builtin = builtinNames.length;

// ---- hosted catalogue ----
function hostedSites() {
  const src = read("mcp/src/specs.generated.ts");
  const str = src.match(/JSON\.parse\(("(?:[^"\\]|\\.)*")\)/s);
  if (str) return JSON.parse(JSON.parse(str[1]));
  return JSON.parse(src.slice(src.indexOf("["), src.lastIndexOf("]") + 1));
}
const hosted = hostedSites();
const hostedCommands = sum(hosted.map((s) => s.commands.length));
const hostedExtra = hosted.filter((s) => !builtinNames.includes(s.name)).map((s) => s.name);
assert(builtinNames.every((n) => hosted.some((s) => s.name === n)), `built-in specs missing from the hosted catalogue: ${builtinNames.filter((n) => !hosted.some((s) => s.name === n))}`);
assert(hosted.length === builtin + hostedExtra.length, `hosted ${hosted.length} != built-in ${builtin} + extra ${hostedExtra.length}`);

// ---- `clify add` sweeps ----
function table(file, nameCol, verifiedCol) {
  return read(file).split("\n").filter((l) => /^\| https?:/.test(l)).map((l) => {
    const c = l.split("|").map((s) => s.trim());
    return { url: c[1], name: c[nameCol], verified: Number(String(c[verifiedCol]).split("/")[0]) };
  });
}
const box = table("clify/proofs/sites.md", 2, 4);
const blaxel = table("clify/proofs/sites-blaxel.md", 3, 6);
const sweepOf = (rows) => ({ sites: rows.length, ok: rows.filter((r) => r.verified >= 3).length, verified: sum(rows.map((r) => r.verified)) });
const sweep = { box: sweepOf(box), blaxel: sweepOf(blaxel), all: sweepOf([...box, ...blaxel]) };
const okRows = [...box, ...blaxel].filter((r) => r.verified >= 3);
sweep.all.verifiedOnOk = sum(okRows.map((r) => r.verified));
sweep.all.small = [...box, ...blaxel].filter((r) => r.verified > 0 && r.verified < 3).map((r) => `${r.name} ${r.verified}`);

// ---- wall.json (one entry per verified site) ----
const wall = json("clify/proofs/wall.json");
const wallVerified = sum(wall.map((s) => s.verified));
const notShipped = wall.map((s) => s.site).filter((n) => !builtinNames.includes(n));
assert(wall.length === sweep.all.ok, `wall.json has ${wall.length} sites, the sweep tables have ${sweep.all.ok} with >=3 verified`);
assert(wallVerified === sweep.all.verifiedOnOk, `wall.json sums to ${wallVerified} verified, the sweep tables to ${sweep.all.verifiedOnOk} on sites with >=3`);
assert(builtinNames.every((n) => wall.some((s) => s.site === n)), `built-in specs missing from wall.json: ${builtinNames.filter((n) => !wall.some((s) => s.site === n))}`);
assert(builtin === wall.length - notShipped.length, `built-in ${builtin} != wall ${wall.length} - not shipped ${notShipped.length}`);
// the mix of verified sites, largest group first, in the words the docs use
const MIX_LABEL = { gov: "open data and government", dev: "developer registries", science: "science", "maps-weather": "maps and weather", culture: "culture", news: "news", "sports-ent": "sports", "jobs-market": "jobs" };
const mixCount = {};
for (const s of wall) { const g = s.category.startsWith("gov-") ? "gov" : s.category; mixCount[g] = (mixCount[g] ?? 0) + 1; }
assert(Object.keys(mixCount).every((g) => MIX_LABEL[g]), `wall.json categories without a label: ${Object.keys(mixCount).filter((g) => !MIX_LABEL[g])}`);
const siteMix = Object.entries(mixCount).sort((a, b) => b[1] - a[1]).map(([g]) => MIX_LABEL[g] ?? g).join(", ");

// ---- MCP tool-list tokens ----
const tok = json("mcp/demo/tool-tokens.json");
const row = (re) => tok.rows.find((r) => re.test(r.label));
const tokens = { deployed: row(/^deployed/i), core: row(/^core only/i), perCommand: row(/every command/i) };
for (const [k, v] of Object.entries(tokens)) assert(v, `mcp/demo/tool-tokens.json: no "${k}" row`);
const kTok = (n) => `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
const shortcuts = (tokens.deployed?.tools ?? 0) - (tokens.core?.tools ?? 0);

// ---- race ----
function race({ modes, prefix }) {
  const M = json(modes);
  const runs = M.runs.map((r) => json(`race/results/${prefix}${r}.summary.json`));
  const ui = runs.filter((r) => r.browserMode === "ui");
  const paired = (k) => mean(ui.map((r) => r.racers.browser[k] / r.racers.clify[k]));
  return {
    runs: runs.length, nA: M.A.runs, nC: M.C.runs,
    allVerified: runs.every((r) => r.valid && r.racers.browser.success === 6 && r.racers.clify.success === 6),
    timeA: M.A.timeMs / 1000, timeC: M.C.timeMs / 1000, costA: M.A.cost, costC: M.C.cost,
    means: { time: M.A.timeMs / M.C.timeMs, cost: M.A.cost / M.C.cost, total: M.A.total / M.C.total, ram: M.A.peakRamMB / M.C.peakRamMB },
    paired: { time: paired("elapsedMs"), cost: paired("costUsd"), total: paired("totalTokens"), ram: paired("peakRamMB") },
    js: runs.filter((r) => r.browserMode === "js"),
  };
}
const gen = race(RACE.generated);
const hand = race(RACE.handwritten);
assert(gen.allVerified, "a generated-spec race run is invalid or a racer is not 6/6");
assert(hand.allVerified, "a hand-written race run is invalid or a racer is not 6/6");
const gifRun = json(`race/results/${RACE.generated.prefix}${GIF_RUN}.summary.json`).racers;
assert(json(RACE.generated.modes).runs.includes(GIF_RUN), `GIF run ${GIF_RUN} is not one of the generated-spec race runs`);
// mode B (browser + page JavaScript) in the generated-spec runs, against clify in the same runs
const js = gen.js;
const jsMean = (who, k) => mean(js.map((r) => r.racers[who][k]));
const raceB = {
  n: js.length, timeB: jsMean("browser", "elapsedMs") / 1000, costB: jsMean("browser", "costUsd"),
  timeC: jsMean("clify", "elapsedMs") / 1000, costC: jsMean("clify", "costUsd"),
  time: mean(js.map((r) => r.racers.browser.elapsedMs / r.racers.clify.elapsedMs)),
  cost: mean(js.map((r) => r.racers.browser.costUsd / r.racers.clify.costUsd)),
  total: mean(js.map((r) => r.racers.browser.totalTokens / r.racers.clify.totalTokens)),
  r3: json(RACE.handwritten.modes).B, r4: json(RACE.round4.modes).B,
};
assert(raceB.n > 0, "no mode-B (js) run among the generated-spec race runs");
assert(js.every((r) => r.valid && r.racers.browser.success === 6 && r.racers.clify.success === 6), "a mode-B race run is invalid or a racer is not 6/6");
const specFiles = fs.readdirSync(path.join(ROOT, "race/specs-generated")).filter((f) => f.endsWith(".spec.json"));
const generatedSpecs = specFiles.filter((f) => !f.includes("hand-written")).length;

// ---- bench ----
const bench = json(BENCH);
const benchTasks = [...read("bench/tasks.mjs").matchAll(/^\s*site: '([\w-]+)'/gm)].map((m) => m[1]);
const benchPractice = { tasks: benchTasks.filter((s) => PRACTICE.includes(s)).length, sites: new Set(benchTasks.filter((s) => PRACTICE.includes(s))).size };
assert(benchTasks.length === bench.nTasks, `bench/tasks.mjs has ${benchTasks.length} tasks, the summary ${bench.nTasks}`);
assert(new Set(benchTasks).size === bench.nSites, `bench/tasks.mjs has ${new Set(benchTasks).size} sites, the summary ${bench.nSites}`);

// ---- versus an agent with curl ----
const med = (a) => { const v = [...a].sort((x, y) => x - y), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const benchRow = (runs) => ({ n: runs.length, ok: runs.filter((r) => r.ok).length, sec: med(runs.map((r) => r.wallMs / 1000)), tokens: med(runs.map((r) => r.tokens.total)), cost: sum(runs.map((r) => r.costUsd || 0)) });
const curlBench = json(BENCH_CURL), cliSame = json(BENCH_CLI_SAME);
const curlAll = benchRow(curlBench.runs);
const sameTasks = new Set(cliSame.runs.map((r) => r.task));
const curlSame = benchRow(curlBench.runs.filter((r) => sameTasks.has(r.task))), cliSameRow = benchRow(cliSame.runs);
assert(curlAll.n === bench.cli.n, `bench curl has ${curlAll.n} runs, clify ${bench.cli.n}`);
const raceCurl = json(RACE_CURL);
const raceCurlRuns = raceCurl.runs.map((r) => json(`race/results/curl-${r}.summary.json`).racers);
const rc = (k, f) => mean(raceCurlRuns.map((x) => f(x[k])));
const rD = { time: rc("curl", (x) => x.elapsedMs / 1000), cost: rc("curl", (x) => x.costUsd), ok: Math.min(...raceCurlRuns.map((x) => x.curl.success)) };
const rC = { time: rc("clify", (x) => x.elapsedMs / 1000), cost: rc("clify", (x) => x.costUsd), ok: Math.min(...raceCurlRuns.map((x) => x.clify.success)) };
const rPaired = { time: mean(raceCurlRuns.map((x) => x.curl.elapsedMs / x.clify.elapsedMs)), cost: mean(raceCurlRuns.map((x) => x.curl.costUsd / x.clify.costUsd)) };
assert(raceCurlRuns.every((x) => !x.curl.invalid && !x.clify.invalid), "a race mode D run is invalid");
const kT = (n) => `${(n / 1000).toFixed(1)}k`;
const bRow = (r) => `${r.ok}/${r.n}, ${r.sec.toFixed(1)} s / ${kT(r.tokens)} tokens / $${r.cost.toFixed(2)}`;

// ---- the exact text the docs must carry ----
const raceHeadline = (r) =>
  `${x1(r.means.time)} faster by mean time (${Math.round(r.timeA)} s vs ${Math.round(r.timeC)} s); paired per-run mean ${x1(r.paired.time)}`;
const raceDetail = (r) =>
  `${x1(r.means.cost)} cheaper by mean cost ($${r.costA.toFixed(2)} vs $${r.costC.toFixed(2)}; paired ${x1(r.paired.cost)}), ` +
  `${x1(r.means.total)} fewer tokens incl. cache (paired ${x1(r.paired.total)}), ${x1(r.means.ram)} less RAM (paired ${x1(r.paired.ram)})`;
const SNIPPETS = {
  "race generated headline": raceHeadline(gen),
  "race generated detail": raceDetail(gen),
  "race generated specs": `${generatedSpecs} of ${specFiles.length} specs generated`,
  "race hand-written headline": raceHeadline(hand),
  "race hand-written detail": raceDetail(hand),
  "hosted": `${hosted.length} sites and ${fmt(hostedCommands)} live-verified commands`,
  "tool tokens": `about ${kTok(tokens.deployed?.claudeTokens ?? 0)} tokens instead of ${kTok(tokens.perCommand?.claudeTokens ?? 0)}`,
  "sweep": `**${sweep.all.ok} of ${sweep.all.sites} sites** with 3+ verified commands and **${fmt(sweep.all.verified)} verified commands**`,
  "number map": `${sweep.all.sites} sites tried → ${sweep.all.ok} with 3+ live-verified commands (${fmt(sweep.all.verified)} verified commands in all) → ${builtin} ship in the CLI, ${hosted.length} on the hosted MCP (the ${builtin} + ${hostedExtra.length} test-suite sites`,
  "tool set": `behind ${tokens.core?.tools} core tools`,
  "tool shortcuts": `plus ${shortcuts} direct shortcuts`,
  "core tokens": `the ${tokens.core?.tools} core tools alone about ${kTok(tokens.core?.claudeTokens ?? 0)}`,
  "race B": `B ${Math.round(raceB.timeB)} s / $${raceB.costB.toFixed(2)} vs clify ${Math.round(raceB.timeC)} s / $${raceB.costC.toFixed(2)} in the same run${raceB.n > 1 ? `s (means of ${raceB.n})` : ""}: ` +
    `clify ${x1(raceB.time)} faster, ${x1(raceB.cost)} cheaper, ${x1(raceB.total)} fewer tokens incl. cache. ` +
    `Page JavaScript barely helps on these dashboards (B ${Math.round(raceB.timeB)} s vs clicks-only A's ${Math.round(gen.timeA)} s mean); ` +
    `B's means in earlier rounds: ${Math.round(raceB.r3.timeMs / 1000)} s (round 3, n=${raceB.r3.runs}), ${Math.round(raceB.r4.timeMs / 1000)} s (round 4, n=${raceB.r4.runs})`,
  "gif caption": `Replay of one live run (\`${GIF_RUN}\`)`,
  "gif run": `This run: ${x1(gifRun.browser.elapsedMs / gifRun.clify.elapsedMs)} faster, ${x1(gifRun.browser.costUsd / gifRun.clify.costUsd)} cheaper. ` +
    `Over all ${gen.runs} runs: ${x1(gen.means.time)} faster by mean time (${Math.round(gen.timeA)} s vs ${Math.round(gen.timeC)} s), paired per-run mean ${x1(gen.paired.time)}; ` +
    `${x1(gen.means.cost)} cheaper by mean cost, paired ${x1(gen.paired.cost)}`,
  "site mix": `${sweep.all.ok} of ${sweep.all.sites} public sites tried (${siteMix})`,
  "bench practice": `${benchPractice.tasks} of the ${bench.nTasks} tasks on ${benchPractice.sites} scraping-practice sites`,
  "bench curl": `curl ${bRow(curlAll)} vs clify ${bench.cli.ok}/${bench.cli.n}, ${bench.cli.medianSec.toFixed(1)} s / ${kT(bench.cli.medianTokens)} / $${bench.cli.totalCostUsd.toFixed(2)}`,
  "bench curl same box": `same box, same hour, the ${sameTasks.size} tasks whose clify specs are in this repo: curl ${bRow(curlSame)} vs clify ${bRow(cliSameRow)}`,
  "race curl": `D ${Math.round(rD.time)} s / $${rD.cost.toFixed(2)} vs clify ${Math.round(rC.time)} s / $${rC.cost.toFixed(2)} in the same ${raceCurlRuns.length} runs (D ${rD.ok}/6 and clify ${rC.ok}/6 every run; paired: D ${x1(rPaired.time)} slower, ${x1(rPaired.cost)} the cost)`,
};
// file -> snippets it must contain
const REQUIRED = {
  "README.md": ["race generated headline", "race generated detail", "race generated specs", "race hand-written headline", "race hand-written detail", "hosted", "tool tokens", "sweep",
    "number map", "tool set", "tool shortcuts", "core tokens", "race B", "bench practice", "gif caption", "gif run", "site mix", "bench curl", "race curl"],
  "AGENTS.md": ["site mix"], "llms.txt": ["site mix"], "scripts/public/AGENTS.md": ["site mix"], "scripts/public/llms.txt": ["site mix"], "clify/llms.txt": ["site mix"],
  "race/README.md": ["race generated headline", "race hand-written headline", "race curl"],
  "bench/README.md": ["bench curl", "bench curl same box"],
};

// ---- phrase rules: any number in these phrases must be the derived one ----
const N = (s) => Number(String(s).replace(/,/g, ""));
const RULES = [
  { name: "built-in CLIs", re: /(\d[\d,]*) (?:verified )?(?:site CLIs|sites) ship built in|(\d[\d,]*) built-in (?:specs|site CLIs)|ships (\d[\d,]*) built-in/g, want: [builtin] },
  { name: "hosted sites + commands", re: /(\d[\d,]*) (?:public |real )?(?:web)?sites(?: and|,| \(| \/) (\d[\d,]*) (?:live-verified |verified )?commands/g, want: [hosted.length, hostedCommands], skipIf: /of \d+ sites|with ≥3|unseen/ },
  { name: "sweep sites", re: /(\d+) of (\d+) sites/g, want: [sweep.all.ok, sweep.all.sites] },
  { name: "verified commands", re: /(\d[\d,]{2,})\*{0,2} (?:live-)?verified commands/g, oneOf: [hostedCommands, sweep.all.verified, sweep.box.verified, sweep.blaxel.verified, sweep.all.verifiedOnOk] },
];
const STALE = [/\b43 (?:public |real )?(?:web)?sites\b/, /\b503 (?:live-)?(?:verified )?commands\b/, /\b40 (?:sites|verified site CLIs|real-site CLIs) ship/, /\b40 built-in\b/, /ships 40\b/, /\b43-site\b/, /\(43\/503\)/];
// wording the docs must not use: the hosted server has 3 core tools plus direct shortcuts, clify works on most sites, not all,
// and it records the requests behind what its explorer clicks, not every button on a site
const WORDING = [/\b(?:three|3) tools\b/i, /\bthrough three\b/i, /\b(?:any|every) website\b/i, /\bany URL\b/, /\bbehind every button\b/i, /\bany site, your accounts\b/i];
const DOCS = [
  "README.md", "scripts/public/AGENTS.md", "scripts/public/llms.txt", "AGENTS.md", "llms.txt",
  "clify/README.md", "clify/AGENTS.md", "clify/SKILL.md", "clify/llms.txt", "clify/ACCOUNTS.md", "clify/DEMO.md",
  "clify/proofs/README.md", "clify/src/cli.ts", "mcp/README.md", "mcp/package.json", "mcp/index.ts", "mcp/src/guide.ts", "mcp/scripts/sync-specs.mjs",
  "race/README.md", "race/run.mjs", "bench/README.md", "film/README.md",
].filter(exists);
// handoff.md and cold-start.md are dated transcripts: only their intro (up to the first ## or ### heading) is checked
const intro = (f) => read(f).split(/\n#{2,3} /)[0];

for (const f of [...DOCS, "clify/proofs/handoff.md", "clify/proofs/cold-start.md"].filter(exists)) {
  const text = f.startsWith("clify/proofs/") && f.endsWith(".md") && !f.endsWith("README.md") ? intro(f) : read(f);
  text.split("\n").forEach((line, i) => {
    for (const s of STALE) if (s.test(line)) problems.push(`${f}:${i + 1}: stale count "${line.match(s)[0]}"`);
    for (const s of WORDING) if (s.test(line)) problems.push(`${f}:${i + 1}: wording "${line.match(s)[0]}" (3 core tools + shortcuts; most websites, not all; requests behind what it clicks)`);
    for (const r of RULES) {
      if (r.skipIf?.test(line)) continue;
      for (const m of line.matchAll(r.re)) {
        const got = m.slice(1).filter((v) => v !== undefined).map(N);
        if (r.want && got.some((v, k) => v !== r.want[k])) problems.push(`${f}:${i + 1}: ${r.name}: "${m[0]}" should be ${r.want.map(fmt).join(" / ")}`);
        if (r.oneOf && !r.oneOf.includes(got[0])) problems.push(`${f}:${i + 1}: ${r.name}: "${m[0]}" is none of ${r.oneOf.map(fmt).join(", ")}`);
      }
    }
  });
}
for (const [f, keys] of Object.entries(REQUIRED)) {
  if (!exists(f)) continue;
  const text = read(f).replace(/\*\*/g, "");
  for (const k of keys) {
    const want = SNIPPETS[k].replace(/\*\*/g, "");
    if (!text.includes(want)) problems.push(`${f}: missing "${k}": ${SNIPPETS[k]}`);
  }
}

if (PRINT) {
  console.log(JSON.stringify({
    builtin, notShipped, hostedExtra, raceB: { ...raceB, r3: raceB.r3.timeMs, r4: raceB.r4.timeMs }, benchPractice,
    siteMix: { groups: mixCount, text: siteMix }, hosted: { sites: hosted.length, commands: hostedCommands, other: hosted.filter((s) => !s.category || s.category === "other").length },
    sweep, wall: { sites: wall.length, verified: wallVerified },
    tokens: Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, v && { tools: v.tools, tokens: v.claudeTokens }])),
    race: { generated: gen, handwritten: hand, generatedSpecs: `${generatedSpecs}/${specFiles.length}` },
    bench: { tasks: bench.nTasks, sites: bench.nSites, cli: bench.cli, browserUi: bench.browserUi, browser: bench.browser },
    curl: { bench: curlAll, sameBox: { curl: curlSame, clify: cliSameRow }, race: { D: rD, C: rC, paired: rPaired } },
  }, (k, v) => (typeof v === "number" && !Number.isInteger(v) ? Number(v.toFixed(3)) : v), 2));
  console.log("\nsnippets:");
  for (const [k, v] of Object.entries(SNIPPETS)) console.log(`  ${k}: ${v}`);
}
if (problems.length) {
  console.error(`counts FAILED (${problems.length}):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`counts OK: ${builtin} built-in, ${hosted.length} hosted sites / ${fmt(hostedCommands)} commands, ${sweep.all.ok} of ${sweep.all.sites} sites / ${fmt(sweep.all.verified)} verified, race ${x1(gen.means.time)} by means (${x1(gen.paired.time)} paired)`);
