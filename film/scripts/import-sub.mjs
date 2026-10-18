#!/usr/bin/env node
// Data for the 2-minute submission cut (composition "Submission").
// Every number the film shows is read here from a file in this repo and written to src/data/sub.json
// together with the file it came from. Run from anywhere: node film/scripts/import-sub.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const film = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(film, '..');
const rel = (p) => path.relative(repo, p);
const J = (p) => JSON.parse(fs.readFileSync(path.join(repo, p), 'utf8'));
const T = (p) => fs.readFileSync(path.join(repo, p), 'utf8');

// ---------- scripts/counts.mjs: the repo's checked headline numbers (README source of truth) ----------
import {execFileSync} from 'node:child_process';
const countsOut = execFileSync('node', [path.join(repo, 'scripts/counts.mjs'), '--print'], {encoding: 'utf8'});
if (!/\ncounts OK:/.test(countsOut)) throw new Error('scripts/counts.mjs did not pass');
const counts = JSON.parse(countsOut.slice(0, countsOut.indexOf('\nsnippets:')));
const snippets = Object.fromEntries([...countsOut.matchAll(/^  ([^:\n]+): (.+)$/gm)].map((m) => [m[1], m[2]]));

// ---------- bench (committed 20-task benchmark) ----------
const BENCH = 'bench/results/summary-main+hard+ui+ui2.json';
const b = J(BENCH);
const mode = (m) => ({n: m.n, ok: m.ok, medianSec: m.medianSec, medianTokens: m.medianTokens, totalCostUsd: m.totalCostUsd});
const bench = {
	source: BENCH,
	readme: 'bench/README.md',
	nTasks: b.nTasks,
	nSites: b.nSites,
	model: b.model,
	browserUi: mode(b.browserUi),
	browser: mode(b.browser),
	cli: mode(b.cli),
};
// the ratios bench/README.md states (checked against the summary below)
const readme = T('bench/README.md');
const m = readme.match(/clify vs clicks-only browser: ([\d.]+)× faster, ([\d.]+)× fewer tokens, ([\d.]+)× cheaper\. vs browser with page JS: ([\d.]+)× faster, ([\d.]+)× fewer tokens, ([\d.]+)× cheaper/);
if (!m) throw new Error('bench/README.md ratio line not found');
bench.vsUi = {faster: +m[1], tokens: +m[2], cheaper: +m[3]};
bench.vsJs = {faster: +m[4], tokens: +m[5], cheaper: +m[6]};
bench.practice = snippets['bench practice'];
if (!bench.practice) throw new Error('counts.mjs bench practice snippet missing');
const r1 = (x) => Math.round(x * 10) / 10;
const chk = [
	[bench.vsUi.faster, b.browserUi.medianSec / b.cli.medianSec],
	[bench.vsUi.tokens, b.browserUi.medianTokens / b.cli.medianTokens],
	[bench.vsUi.cheaper, b.browserUi.totalCostUsd / b.cli.totalCostUsd],
	[bench.vsJs.faster, b.browser.medianSec / b.cli.medianSec],
	[bench.vsJs.tokens, b.browser.medianTokens / b.cli.medianTokens],
	[bench.vsJs.cheaper, b.browser.totalCostUsd / b.cli.totalCostUsd],
];
for (const [said, calc] of chk) if (Math.abs(said - r1(calc)) > 0.051) throw new Error(`bench README ratio ${said} != summary ${calc}`);

// hero task: one run per mode (committed result.json per run)
const HB = 'bench/runs/ui/quotes-top-author/browser-ui-1/result.json';
const HC = 'bench/runs/hard/quotes-top-author/cli-1/result.json';
const hr = (p) => {
	const r = J(p);
	return {source: p, wallMs: r.wallMs, toolCalls: r.toolCalls, tokens: r.tokens.total, answer: r.answer, ok: r.ok, costUsd: r.costUsd};
};
const hero = {browser: hr(HB), cli: hr(HC)};
// the film's replay (src/data/bench.json, from the same runs' transcripts) must agree with the committed results
const fb = JSON.parse(fs.readFileSync(path.join(film, 'src/data/bench.json'), 'utf8')).heroes['quotes-top-author'];
for (const [k, mm] of [['browser', 'browser-ui'], ['cli', 'cli']]) {
	if (fb[mm].wallMs !== hero[k].wallMs || fb[mm].tokens.total !== hero[k].tokens) throw new Error(`hero ${k} replay disagrees with ${hero[k].source}`);
	const tools = fb[mm].events.filter((e) => e.kind === 'tool').length;
	if (tools !== hero[k].toolCalls) throw new Error(`hero ${k}: ${tools} tool events vs ${hero[k].toolCalls}`);
}

// ---------- clify add on ycombinator.com (automatic; the run listed in clify/proofs/sites.md) ----------
const ADD = 'clify/proofs/sites/ycombinator.add-report.json';
const ADDLOG = 'film/evidence/sweep/ycombinator-add.log';
const a = J(ADD);
const t0 = (s) => {
	const [h, mi, se] = s.split(':').map(Number);
	return h * 3600 + mi * 60 + se;
};
const logRaw = T(ADDLOG).split('\n').filter(Boolean);
const start = t0(logRaw[0].slice(0, 8));
const log = logRaw.map((l) => ({t: t0(l.slice(0, 8)) - start, text: l.slice(9)}));
const RUN = 'film/evidence/sweep/ycombinator-run.json';
const run = J(RUN);
const add = {
	source: ADD,
	log: ADDLOG,
	url: a.url,
	site: a.site,
	seconds: a.seconds,
	explored: a.explored,
	verified: a.verified,
	commands: a.commands.filter((c) => c.verified).map((c) => c.name),
	dropped: a.dropped.map((d) => ({name: d.name, reason: d.reason})),
	lines: log,
	run: {source: RUN, cmd: run.cmd, ms: run.ms, exit: run.exit, stdout: run.stdout},
};
if (!log.some((l) => l.text.includes(a.commands.find((c) => c.verified).name))) throw new Error('add log is not the run in the add report');

// ---------- the 44-site sweep (clify/proofs/sites.md) + cold start ----------
const SITES = 'clify/proofs/sites.md';
const sm = T(SITES).match(/(\d+) sites; (\d+) \((\d+)%\) with ≥3 verified commands; (\d+) verified commands total/);
if (!sm) throw new Error('sites.md summary line not found');
const hostOf = (u) => new URL(u).host.replace(/^www\./, '');
const repDir = path.join(repo, 'clify/proofs/sites');
const sweepSites = fs
	.readdirSync(repDir)
	.filter((f) => f.endsWith('.add-report.json'))
	.map((f) => {
		const d = JSON.parse(fs.readFileSync(path.join(repDir, f), 'utf8'));
		return {site: d.site, host: hostOf(d.url), verified: d.verified || 0, file: rel(path.join(repDir, f))};
	});
const sweep = {source: SITES, attempted: +sm[1], ok3: +sm[2], pct: +sm[3], verifiedCommands: +sm[4], sites: sweepSites.sort((x, y) => y.verified - x.verified)};
if (sweepSites.length !== sweep.attempted) throw new Error(`proofs/sites has ${sweepSites.length} reports, sites.md says ${sweep.attempted}`);
const CS = 'clify/proofs/cold-start.md';
const cs = T(CS);
const c1 = cs.match(/ran `clify add (\S+)` itself \((\d+) s, (?:\d+ exploration steps, )?(\d+) commands generated, (\d+) verified live/);
const c2 = cs.match(/Duration (\d+) s, (\d+) turns, (\d+) shell commands/);
const c3 = cs.match(/The answer matches [^(]*\(([^)]+)\)/);
if (!c1 || !c2 || !c3) throw new Error('cold-start.md figures not found');
// what the agent cloned, as the proof states it (a local copy of the public export until the GitHub repo is public, then GitHub)
const cloned = (cs.match(/\*\*What it cloned:\*\* ([^\n]+)/) || [])[1] || '';
const clonedSay = /^the exported public tree/.test(cloned) ? 'the public export' : /github\.com/.test(cloned) ? 'clify from GitHub' : null;
if (!clonedSay) throw new Error('cold-start.md: "What it cloned" line not recognized');
const coldStart = {source: CS, url: c1[1], addSec: +c1[2], generated: +c1[3], verified: +c1[4], totalSec: +c2[1], answer: c3[1], cloned: clonedSay};

// ---------- verified-site wall: clify/proofs/wall.json only (both sweeps, one entry per site with ≥3 verified commands) ----------
const WJ = 'clify/proofs/wall.json';
const wj = J(WJ);
const filmWall = JSON.parse(fs.readFileSync(path.join(film, 'src/data/wall.json'), 'utf8'));
// screenshots under 3 KB are solid-colour captures (e.g. crates.io's blank render); those tiles show the site name instead
const blankImg = (img) => !fs.existsSync(path.join(film, 'public', img)) || fs.statSync(path.join(film, 'public', img)).size < 3000;
const imgOf = Object.fromEntries(filmWall.sites.filter((s) => s.img && !blankImg(s.img)).map((s) => [s.site, s.img]));
// the famous ones first so the opening close-up is recognizable
const FIRST = ['github', 'endoflife', 'hex', 'pub', 'caniuse', 'nhl', 'registry-terraform', 'themoviedb', 'rijksmuseum', 'loc', 'pubchem-ncbi', 'artifacthub', 'swiftpackageindex', 'ons'];
const rank = (s) => FIRST.indexOf(s.site) + 1 || (imgOf[s.site] ? 50 : 99);
const tiles = [...wj].sort((x, y) => rank(x) - rank(y)).map((e) => ({name: e.site, host: new URL(e.origin).host.replace(/^www\./, ''), img: imgOf[e.site] || null, n: e.verified, on: e.verifiedOn}));
const wallVerified = wj.reduce((a, e) => a + e.verified, 0);
if (wj.length !== counts.wall.sites || wallVerified !== counts.wall.verified || wj.length !== counts.sweep.all.ok) throw new Error('wall.json disagrees with scripts/counts.mjs');
const wall = {source: WJ, distinctSites: wj.length, verifiedOnWall: wallVerified, attempted: counts.sweep.all.sites, verifiedAll: counts.sweep.all.verified, snippet: snippets.sweep, tiles};

// ---------- Blaxel sweep (clify/proofs/sites-blaxel.md: one sandbox per site, clify check inside it) ----------
const BX = 'clify/proofs/sites-blaxel.md';
const bxRows = T(BX)
	.split('\n')
	.filter((l) => /^\| https?:/.test(l))
	.map((l) => {
		const c = l.split('|').map((x) => x.trim());
		const [ok, of] = c[6].split('/').map(Number);
		return {url: c[1], site: c[3], checked: ok, of, sandbox: c[8].replace(/`/g, ''), blocked: /captcha|bot-check/.test(c[9])};
	});
const bx = counts.sweep.blaxel;
if (bxRows.length !== bx.sites || bxRows.filter((r) => r.checked >= 3).length !== bx.ok || bxRows.reduce((a, r) => a + r.checked, 0) !== bx.verified) throw new Error('sites-blaxel.md table disagrees with scripts/counts.mjs');
const blaxel = {source: BX, sites: bx.sites, ok: bx.ok, verified: bx.verified, rows: bxRows.map((r) => ({site: r.site, sandbox: r.sandbox, checked: r.checked, of: r.of, ok: r.checked >= 3, blocked: r.blocked}))};

// ---------- InstaBox email agent (agent/README.md, agent/proofs/) ----------
const AR = 'agent/README.md';
const ar = T(AR);
const addr = ar.match(/email `([^`]+@[^`]+)`/);
const cap = ar.match(/public sites only, (\d+) jobs a day/);
if (!addr || !cap) throw new Error('agent/README.md address or public cap not found');
const agent = {source: AR, video: 'agent/proofs/video/clify-agent.mp4', proof: 'agent/proofs/public-tier.md', address: addr[1], jobsPerDay: +cap[1]};

// ---------- accounts ----------
const RES = 'clify/test/accounts/results.md';
const res = T(RES);
const signed = res.match(/## Signed in \((\d+)\)/);
const stopped = res.match(/## Stopped \((\d+)\)/);
const signedRows = res.split('## Signed in')[1].split('## Stopped')[0].split('\n').filter((l) => /^\| [a-z]/.test(l) && !/^\| site/.test(l));
const stoppedRows = res.split('## Stopped')[1].split('## Phone')[0].split('\n').filter((l) => /^\| [a-z]/.test(l) && !/^\| site/.test(l));
const sms = res.match(/Appwrite texted `(Your SMS verification code is: (\d+))` from (\+[\d ]+)/);
const SIGNLOG = 'film/evidence/accounts/appwrite.log';
const slog = T(SIGNLOG).split('\n').filter(Boolean);
const s0 = t0(slog[0].slice(0, 8));
const accounts = {
	source: RES,
	signedIn: +signed[1],
	stopped: +stopped[1],
	sites: signedRows.map((l) => l.split('|')[1].trim()),
	// verification column: email-link / email-code, or "none required by site"; logged-in column must be yes for every row
	verified: signedRows.filter((l) => /^email/.test(l.split('|')[4].trim())).length,
	noVerification: signedRows.filter((l) => /^none/.test(l.split('|')[4].trim())).map((l) => l.split('|')[1].trim()),
	loggedIn: signedRows.filter((l) => l.split('|')[5].trim() === 'yes').length,
	captchaStops: stoppedRows.filter((l) => /captcha|bot-check/.test(l.split('|')[7])).length,
	identity: {email: 'clify-agent-b3d326@inkboxmail.com', phone: '+1 209 ••• 1736', source: 'clify/ACCOUNTS.md'},
	sms: {text: sms[1], code: sms[2], from: sms[3].trim()},
	signupLog: {source: SIGNLOG, lines: slog.map((l) => ({t: t0(l.slice(0, 8)) - s0, text: l.slice(9)}))},
};
if (accounts.sites.length !== accounts.signedIn) throw new Error('signed-in rows != heading count');
if (accounts.verified + accounts.noVerification.length !== accounts.signedIn) throw new Error('signed-in rows: unknown verification kind');

// ---------- ask a human ----------
const ASK = 'film/evidence/ask/ask-35cb4902.json';
const ak = J(ASK);
const ask = {
	source: ASK,
	proof: 'clify/test/ask/1-signup-skip.md',
	from: ak.from,
	subject: ak.subject.replace('[clify test, no reply needed] ', ''),
	question: ak.question,
	options: ak.options,
	blocker: ak.blocker,
	sentAt: ak.sent[0].at,
	answer: ak.answer,
	shot: 'ask/tally-captcha.jpg',
};

// ---------- MCP on Manufact: the four current client recordings (mcp/demo/out) ----------
const MCPC = [
	['claude', 'Claude Code', 'transcript-claude-code.md'],
	['codex', 'Codex CLI', 'transcript-codex.md'],
	['mcp-use', 'mcp-use agent', 'transcript-mcp-use.md'],
	['inspector', 'mcp-use Inspector', 'transcript-inspector.md'],
];
// the Claude Code run, shown large: its tool calls (args + a condensed result, real values only) and the answer
const ccT = T('mcp/demo/transcript-claude-code.md');
const block = (sec) => [...sec.matchAll(/```json\n([^\n]+)\n```/g)].map((m) => m[1]);
const prims = (o) => Object.entries(o).filter(([, v]) => v === null || typeof v !== 'object').filter(([, v]) => !/^https?:/.test(String(v)));
const objStr = (o, n) => {
	const e = prims(o);
	return `{${e.slice(0, n).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',')}${e.length > n || Object.keys(o).length > e.slice(0, n).length ? ',…' : ''}}`;
};
const condense = (raw) => {
	let r;
	try {
		r = JSON.parse(raw);
	} catch {
		const sm = raw.match(/^\{"sites":\[\{"site":"([^"]+)","host":"([^"]+)".*?"commands":(\d+)/);
		if (!sm) throw new Error(`transcript result not parsed: ${raw.slice(0, 80)}`);
		return `{"sites":[{"site":"${sm[1]}","host":"${sm[2]}","commands":${sm[3]},…}]}`;
	}
	const head = `"ok":${r.ok},"status":${r.status}`;
	const more = Object.keys(r).some((k) => !['ok', 'status', 'data'].includes(k)) ? ',…' : '';
	if (Array.isArray(r.data)) return `{${head},"data":[${r.data.map((d) => objStr(d, 4)).join(',')}]${more}}`;
	return `{${head},"data":${objStr(r.data, 3)}${more}}`;
};
const ccCalls = ccT
	.split('## Answer')[0]
	.split(/\n### \d+\. /)
	.slice(1)
	.map((sec) => {
		const [args, result] = block(sec);
		return {tool: sec.match(/^`([^`]+)`/)[1], args, result: condense(result)};
	});
const ccRun = ccT.match(/\*\*Run:\*\* [^,]+, ([\d.]+) s, (\d+) turns, \$([\d.]+)/);
const ccAnswer = ccT
	.split('## Answer')[1]
	.trim()
	.split('\n')
	.filter((l) => l.startsWith('- '))
	.map((l) => l.replace(/\*\*/g, ''));
if (!ccRun || ccCalls.length !== +ccT.match(/## Tool calls \((\d+)\)/)[1] || !ccAnswer.some((l) => l.includes('1.0.229'))) throw new Error('transcript-claude-code.md not parsed');
const mcp = {
	source: 'mcp/demo/out/*.mp4',
	url: 'https://bold-cloud-h4u6s.run.mcp-use.com/mcp',
	task: T('mcp/demo/task.txt').trim(),
	hosted: counts.hosted,
	tools: counts.tokens,
	tokensSnippet: snippets['tool tokens'],
	claudeCode: {source: 'mcp/demo/transcript-claude-code.md', task: T('mcp/demo/task.txt').trim().split('\n').slice(1, 3), calls: ccCalls, sec: +ccRun[1], turns: +ccRun[2], costUsd: +ccRun[3], answer: ccAnswer},
	clients: MCPC.map(([id, title, tr]) => {
		const t = T(`mcp/demo/${tr}`);
		if (!/1\.0\.229/.test(t) || !/58/.test(t) || !/Mostly Clear/.test(t)) throw new Error(`${tr}: serde / SF forecast answer not found`);
		return {id, title, clip: `mcp/demo/out/${id}.mp4`, transcript: `mcp/demo/${tr}`, model: (t.match(/\*\*Model:\*\* ([^\n]+)/) || [])[1]?.replace(/`/g, '').replace(/\s*\(.*$/, '') ?? ''};
	}),
};

// ---------- race (swappable: film/race.json names the footage + its run summary) ----------
const RC = 'film/race.json';
const rc = J(RC);
const race = {...rc, config: RC};
// race files not merged yet can be read from the race worktree (RACE_ROOT); the film cites the same repo path
const raceFile = (p) => {
	if (fs.existsSync(path.join(repo, p))) return path.join(repo, p);
	if (process.env.RACE_ROOT && fs.existsSync(path.join(process.env.RACE_ROOT, p))) {
		race.unmerged = true;
		return path.join(process.env.RACE_ROOT, p);
	}
	throw new Error(`${p} not found (set RACE_ROOT to the race worktree if it is not merged yet)`);
};
raceFile(rc.video);
if (rc.summary) {
	const s = JSON.parse(fs.readFileSync(raceFile(rc.summary), 'utf8'));
	const r = (k) => {
		const x = s.racers[k];
		return {elapsedMs: x.elapsedMs, freshTokens: x.freshTokens, totalTokens: x.totalTokens, costUsd: x.costUsd, peakRamMB: x.peakRamMB, avgCpu: x.avgCpu, success: x.success, toolCalls: x.toolCalls, tasks: Object.keys(x.tasks).length};
	};
	race.model = s.model;
	race.taskFile = s.taskFile || 'main.json';
	race.browserMode = s.browserMode || 'full';
	race.browser = r('browser');
	race.clify = r('clify');
}
// headline: ratio of means and paired per-run mean over all generated-spec runs, exactly as counts.mjs derives them for the README
const G = counts.race.generated;
const modes = J('race/results/accounts-modes.json');
const runId = path.basename(rc.summary).replace(/^[a-z]+-/, '').replace('.summary.json', '');
if (!modes.runs.includes(runId)) throw new Error(`race.json run ${runId} is not one of the generated-spec runs in race/results/accounts-modes.json`);
race.runId = runId;
race.gen = {runs: G.runs, nA: G.nA, nC: G.nC, allVerified: G.allVerified, timeA: G.timeA, timeC: G.timeC, costA: G.costA, costC: G.costC, means: G.means, paired: G.paired, specs: counts.race.generatedSpecs, headline: snippets['race generated headline'], detail: snippets['race generated detail']};
if (rc.tasks) {
	const tj = JSON.parse(fs.readFileSync(raceFile(rc.tasks), 'utf8'));
	race.jobs = (Array.isArray(tj) ? tj : tj.tasks).map((t) => ({id: t.id, label: t.label, kind: t.kind}));
}
if (rc.realtime) raceFile(rc.realtime);

// ---------- versus an agent with curl and the same saved sessions (race mode D; v11 cut) ----------
// D and C: the same runs (race/results/curl-modes.json via counts.mjs); A: the round 5 browser mean (race.gen)
const RCURL = 'race/results/curl-modes.json';
const CU = counts.curl.race;
const cm = J(RCURL);
if (cm.D.runs !== cm.C.runs || cm.runs.length !== cm.D.runs) throw new Error(`${RCURL}: D and C run counts differ`);
if (!snippets['race curl'] || !T('README.md').includes(snippets['race curl'])) throw new Error('counts.mjs race curl snippet missing from README.md');
const tasks = race.jobs?.length ?? 6;
if (CU.D.ok !== tasks || CU.C.ok !== tasks || !G.allVerified) throw new Error('race mode D: a lane is not 6/6 every run');
const curl = {
	source: RCURL,
	readme: 'race/README.md',
	runs: cm.runs.length,
	tasks,
	A: {time: G.timeA, cost: G.costA, n: G.nA, ok: tasks},
	D: CU.D,
	C: CU.C,
	paired: CU.paired,
	snippet: snippets['race curl'],
};

const out = {generatedAt: new Date().toISOString(), bench, hero, add, sweep, coldStart, wall, blaxel, agent, accounts, ask, mcp, race, curl};
fs.writeFileSync(path.join(film, 'src/data/sub.json'), JSON.stringify(out, null, 1));
console.log(
	`sub.json: bench ${bench.cli.ok}/${bench.cli.n}, ${bench.vsUi.faster}x/${bench.vsUi.tokens}x; hero ${hero.browser.wallMs}/${hero.cli.wallMs} ms; add ${add.verified} cmds; sweep ${sweep.ok3}/${sweep.attempted} (${sweep.verifiedCommands} cmds); cold ${coldStart.totalSec}s; wall ${wall.distinctSites} sites; blaxel ${blaxel.ok}/${blaxel.sites}; accounts ${accounts.signedIn}/${accounts.signedIn + accounts.stopped}; race ${race.runId} ${race.gen.headline}`,
);
