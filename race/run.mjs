#!/usr/bin/env node
/* Run the same six tasks through two honest tool surfaces with one agent model.
   RACE_AGENT=claude (default, claude-opus-5-5) or codex (gpt-6.1-sol).
   RACE_TASKS=race/tasks/accounts.json runs the signed-in dashboard set.
   RACE_BROWSER_MODE=ui (clicks + screenshots, no page JavaScript) or js (full
   Playwright MCP); the other racer is always clify (shell only).
   RACE_OTHER=curl replaces the browser racer with mode D: an agent with curl and
   the same saved sessions as files (no clify, no browser). */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AGENTS, PAGE_JS_TOOLS, costOf, emptyUsage, freshTokens, totalTokens} from './agents.mjs';
import {installClifyHome, storageState, writeCurlSessions} from './accounts/vault.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const agent = AGENTS[process.env.RACE_AGENT || 'claude'];
if (!agent) throw Error(`unknown RACE_AGENT ${process.env.RACE_AGENT}`);
const MODEL = agent.model;
const TASK_FILE = process.env.RACE_TASKS || path.join(HERE, 'tasks/main.json');
// A task file is either a plain task array (public sites, checks.mjs) or
// {title, intro, checks: "accounts", tasks} for the signed-in dashboards.
const taskSet = (x => Array.isArray(x) ? {tasks: x} : x)(JSON.parse(fs.readFileSync(TASK_FILE, 'utf8')));
const tasks = taskSet.tasks, ACCOUNTS = taskSet.checks === 'accounts';
// specs-generated: made by `clify add` (svix is hand-written, see README); specs-accounts: round 3's hand-written set.
const SPEC_DIR = process.env.RACE_SPECS || path.join(HERE, ACCOUNTS ? 'specs-generated' : 'specs');
const {TRUTH, VERIFY, liveRooms, deleteRooms, cleanup, preflight} = await import(ACCOUNTS ? './accounts/checks.mjs' : './checks.mjs');
const BROWSER_MODE = process.env.RACE_BROWSER_MODE || (ACCOUNTS ? 'ui' : 'js');
if (!['ui', 'js'].includes(BROWSER_MODE)) throw Error(`RACE_BROWSER_MODE must be ui or js`);
const OTHER = process.env.RACE_OTHER === 'curl' ? 'curl' : 'browser'; // the racer next to clify
const LANES = {
  browser: BROWSER_MODE === 'ui' ? {key: 'A', kicker: 'A · BROWSER AGENT · CLICKS + SCREENSHOTS', title: 'Playwright MCP, no page JavaScript'} : {key: 'B', kicker: 'B · BROWSER AGENT + PAGE JAVASCRIPT', title: 'Full Playwright MCP'},
  clify: {key: 'C', kicker: 'C · CLIFY · BASH ONLY', title: 'Agent + clify (shell only)'},
};
if (OTHER === 'curl') { delete LANES.browser; LANES.curl = {key: 'D', kicker: 'D · AGENT + CURL · SAME SESSIONS', title: 'curl + saved cookies/tokens, no clify, no browser'}; }
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runTag = process.env.RACE_TAG || stamp.slice(11, 16).replace('-', ''); // HHMM UTC, used in racer ids (bin/grid sets one per site)
const runDir = path.resolve(process.env.RACE_RUN_DIR || path.join(HERE, 'runs', stamp));
fs.mkdirSync(path.join(runDir, 'browser-frames'), {recursive: true});
fs.copyFileSync(TASK_FILE, path.join(runDir, 'tasks.json'));
if (ACCOUNTS && !process.env.RACE_SKIP_PREFLIGHT) { // a dead saved session would sink both racers: stop before anything starts
  const bad = await preflight();
  if (bad.length) { console.error(`preflight failed, saved sessions:\n${bad.join('\n')}\nRe-login: CLIFY_HOME=~/.clify-agent race/bin/clify login <site>`); process.exit(2); }
}
const writeJson = (p, x) => fs.writeFileSync(p, JSON.stringify(x, null, 2) + '\n');

const events = fs.createWriteStream(path.join(runDir, 'events.jsonl'), {flags: 'a'});
const t0 = Date.now();
const now = () => Date.now() - t0;
function emit(e) { events.write(JSON.stringify({ms: now(), ...e}) + '\n'); }
emit({kind: 'run_start', at: new Date(t0).toISOString(), agent: agent.name, model: MODEL, label: agent.label, browserMode: OTHER === 'browser' ? BROWSER_MODE : null, other: OTHER, lanes: LANES, title: taskSet.title || null, tasks: tasks.map(t => ({id: t.id, label: t.label, kind: t.kind}))});

// Live truth, fetched from the sites before the racers start.
const truth = {};
for (const t of tasks) {
  try { truth[t.id] = await TRUTH[t.id](); emit({kind: 'truth', task: t.id, ok: true, truth: truth[t.id]}); }
  catch (e) { truth[t.id] = null; emit({kind: 'truth', task: t.id, ok: false, error: String(e.message || e)}); }
}

// Process-tree CPU/RAM from /proc. CPU is % of one core.
function treePids(roots) {
  const seen = new Set(roots.filter(Boolean)); let changed = true;
  const all = fs.readdirSync('/proc').filter(x => /^\d+$/.test(x)).map(Number);
  const parent = new Map();
  for (const p of all) try { const s = fs.readFileSync(`/proc/${p}/stat`, 'utf8'); parent.set(p, Number(s.slice(s.lastIndexOf(')') + 2).split(' ')[1])); } catch {}
  while (changed) { changed = false; for (const [p, pp] of parent) if (!seen.has(p) && seen.has(pp)) { seen.add(p); changed = true; } }
  return [...seen];
}
function sampleTree(roots, prev) {
  let ticks = 0, rss = 0; const pids = treePids(roots);
  for (const p of pids) try {
    const s = fs.readFileSync(`/proc/${p}/stat`, 'utf8'); const a = s.slice(s.lastIndexOf(')') + 2).split(' '); ticks += Number(a[11]) + Number(a[12]);
    rss += Number(fs.readFileSync(`/proc/${p}/status`, 'utf8').match(/^VmRSS:\s+(\d+) kB/m)?.[1] || 0);
  } catch {}
  const t = Date.now(), prior = prev || {ticks, t};
  const cpu = Math.max(0, (ticks - prior.ticks) / 100 * 1000 / Math.max(1, t - prior.t) * 100);
  return {cpu: Math.round(cpu * 10) / 10, rssMB: Math.round(rss / 1024 * 10) / 10, pids: pids.length, ticks, t};
}

const SURFACE = {
  js: 'You have only a headless Playwright browser (the Playwright MCP tools). Do not use a shell, network libraries or any other tool.',
  ui: 'You have only a headless Playwright browser (the Playwright MCP tools: navigate, click, type, snapshots, screenshots; running JavaScript in the page is not available). Do not use a shell, network libraries or any other tool.',
  curl: `You have a shell with curl, jq and python3, plus WebFetch and WebSearch; there is no browser and no clify. The agent's saved sessions for the signed-in sites are in ./sessions: cookies.txt (a Netscape cookie jar: curl -b sessions/cookies.txt), <site>.headers (saved request headers: curl -H @sessions/<site>.headers) and <site>.localStorage.json (the dashboards' saved localStorage). Work out each site's requests yourself.`,
  clify: 'You have only a shell and the clify command (start with `clify list` and `clify <site> --help`). Do not use curl, wget, Python/Node HTTP, a browser or any other network tool; jq and other local text tools are fine.',
};
function promptFor(mode, racerId) {
  return `You are one racer in a live benchmark. ${SURFACE[mode === 'browser' ? BROWSER_MODE : mode]} Your RACER_ID is ${racerId}.

Complete ${tasks.length === 1 ? 'this task' : `these ${tasks.length} tasks in order`}, answering from live data on each site. Before starting a task, write a line RACE_TASK_START: <id> in your message. When it is done, write RACE_RESULT: <id>: PASS (or FAIL). Never invent data. ${taskSet.intro || 'Tasks 5 and 6 are approved writes on test sites: actually submit them.'}

When ${tasks.length === 1 ? 'it is' : 'all are'} done, finish with a FINAL ANSWERS section: one block per task starting with its [id].

${tasks.map((t, i) => `${i + 1}. [${t.id}] ${t.prompt.replaceAll('<RACER_ID>', racerId)}\nSite: ${t.url}`).join('\n\n')}`;
}

// Start the screencast Chrome before either racer so both start together.
async function startBrowserHost() {
  const port = 9500 + Math.floor(Math.random() * 300);
  // Signed-in tasks: the browser starts with the same saved sessions clify has
  // (cookies + localStorage from the vault). The host deletes the file once read.
  const state = ACCOUNTS ? path.join(runDir, 'browser-state.json') : '';
  if (state) fs.writeFileSync(state, JSON.stringify(storageState(SITES_WITH_LOGIN)), {mode: 0o600});
  const host = spawn('node', [path.join(HERE, 'browser-host.mjs'), runDir, String(port), String(t0), state], {stdio: 'ignore'});
  const f = path.join(runDir, 'cdp.txt');
  for (let i = 0; i < 360 && !fs.existsSync(f); i++) await new Promise(r => setTimeout(r, 250));
  if (state) fs.rmSync(state, {force: true});
  const [cdp, , chromePid] = fs.readFileSync(f, 'utf8').split('\n');
  return {host, cdp, chromePid: Number(chromePid)};
}

const seenRooms = [];
const SITES_WITH_LOGIN = ['updown', 'healthchecks', 'svix', 'appwrite', 'hookdeck'];
const racerIdOf = mode => `${mode === 'browser' ? (ACCOUNTS ? BROWSER_MODE : 'browser') : mode}-${runTag}`;
const RACERS = [OTHER, 'clify'];
const children = new Set();
async function runRacer(mode, browserHost) {
  const racerId = racerIdOf(mode);
  const dir = path.join(runDir, mode); fs.mkdirSync(dir, {recursive: true});
  const prompt = promptFor(mode, racerId); fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt);
  const env = {...process.env, TERM: 'xterm-256color', LANG: 'C.UTF-8', DISABLE_AUTOUPDATER: '1', RACE_RUN_DIR: runDir};
  if (mode === 'clify') {
    // Isolated clify home: the race's hand-written specs plus, for signed-in
    // sites, a vault holding only their saved sessions (no passwords).
    env.PATH = `${path.join(HERE, 'bin')}:${env.PATH || ''}`;
    env.CLIFY_HOME = path.join(runDir, 'clify-home');
    env.CLIFY_NO_BUILTINS = '1'; // only the race's sites, not clify's built-in specs
    installClifyHome(env.CLIFY_HOME, SPEC_DIR);
  }
  if (mode === 'curl' && ACCOUNTS) writeCurlSessions(path.join(dir, 'sessions'), SITES_WITH_LOGIN);
  const launched = agent.launch({mode, browserMode: BROWSER_MODE, prompt, dir, env, cdp: browserHost?.cdp});
  const child = launched.child, started = now(); children.add(child);
  emit({kind: 'racer_start', racer: mode, racerId, pid: child.pid, model: MODEL});

  const out = fs.createWriteStream(path.join(dir, 'stream.jsonl')), err = fs.createWriteStream(path.join(dir, 'stderr.log'));
  const models = new Set(); let usage = emptyUsage(), calls = 0, toolCalls = 0, finalText = '', reportedCost = null, messages = [], toolOut = [];
  let currentTask = null; const marks = {}, toolNames = new Set();
  const siteOf = args => { const s = JSON.stringify(args); return tasks.find(t => t.match.some(m => s.includes(m)))?.id; };
  const markText = text => {
    for (const m of text.matchAll(/RACE_TASK_START:\s*([\w-]+)/g)) if (tasks.some(t => t.id === m[1])) { currentTask = m[1]; marks[m[1]] ||= {}; marks[m[1]].startedMs ??= now(); emit({kind: 'task_start', racer: mode, task: m[1]}); }
    for (const m of text.matchAll(/RACE_RESULT:\s*([\w-]+):\s*(PASS|FAIL)/gi)) if (tasks.some(t => t.id === m[1])) { marks[m[1]] ||= {}; marks[m[1]].claimed = m[2].toUpperCase(); marks[m[1]].finishedMs = now(); emit({kind: 'task_claim', racer: mode, task: m[1], claim: m[2].toUpperCase()}); }
  };
  const emitUsage = () => { const cost = costOf(MODEL, usage); emit({kind: 'usage', racer: mode, usage, fresh: freshTokens(usage), total: totalTokens(usage), cost, calls, toolCalls}); };
  const parser = agent.parser({
    model: m => { if (!models.has(m)) { models.add(m); emit({kind: 'model', racer: mode, model: m}); } },
    usage: (u, n) => { usage = u; calls = n; emitUsage(); },
    text: t => { messages.push(t); markText(t); emit({kind: 'text', racer: mode, text: t.slice(0, 700)}); },
    tool: ({id, name, args}) => { toolCalls++; toolNames.add(name); const task = siteOf(args) || currentTask; emit({kind: 'tool', racer: mode, task, name, args: JSON.stringify(args).slice(0, 600), toolUseId: id}); emitUsage(); },
    toolResult: ({id, text, error}) => { toolOut.push(text); emit({kind: 'tool_result', racer: mode, toolUseId: id, error, text: text.slice(0, 900)}); },
    final: ({text, reportedCost: c}) => { finalText = text; reportedCost = c; markText(text); },
  }, launched);
  let buf = '';
  child.stdout.on('data', d => { buf += d; const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) { if (!l.trim()) continue; out.write(l + '\n'); try { parser.line(JSON.parse(l)); } catch {} } });
  child.stderr.on('data', d => err.write(d));
  const roots = () => [child.pid, browserHost?.chromePid];
  let prev, samples = [];
  const sampler = setInterval(() => { const s = sampleTree(roots(), prev); prev = s; samples.push({ms: now(), cpu: s.cpu, rssMB: s.rssMB}); emit({kind: 'resource', racer: mode, cpu: s.cpu, rssMB: s.rssMB, pids: s.pids}); }, 500);
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; emit({kind: 'timeout', racer: mode}); child.kill('SIGTERM'); }, Number(process.env.RACE_TIMEOUT_MS || 30 * 60 * 1000));
  const code = await new Promise(resolve => child.on('close', resolve)); children.delete(child);
  const finished = now();
  clearTimeout(timeout); clearInterval(sampler); if (buf.trim()) try { parser.line(JSON.parse(buf)); } catch {} parser.stop(); out.end(); err.end();
  emitUsage();

  // Verify every task against live truth. The answer is the racer's own text:
  // its FINAL ANSWERS block for the task if present, else all of its messages.
  const allText = [...messages, finalText].join('\n');
  const finalBlock = allText.slice(allText.lastIndexOf('FINAL ANSWERS') >= 0 ? allText.lastIndexOf('FINAL ANSWERS') : 0);
  const answerFor = id => { const i = finalBlock.indexOf(`[${id}]`); if (i < 0) return allText; const rest = finalBlock.slice(i + id.length + 2); const j = rest.search(new RegExp(`\\[(${tasks.map(t => t.id).join('|')})\\]`)); return j < 0 ? rest : rest.slice(0, j); };
  const results = {};
  for (const t of tasks) {
    let v;
    // Some list APIs (updown) lag a fresh write by seconds: a claimed PASS gets up to 30 s to show up.
    for (let i = 0; i < 7; i++) {
      try { v = truth[t.id] ? await VERIFY[t.id](truth[t.id], {answer: answerFor(t.id), all: allText, tools: toolOut.join('\n'), racerId, seenRooms}) : {ok: false, detail: 'no live truth'}; }
      catch (e) { v = {ok: false, detail: `check error: ${e.message}`}; }
      if (v.ok || !truth[t.id] || marks[t.id]?.claimed !== 'PASS') break;
      await new Promise(r => setTimeout(r, 5000));
    }
    results[t.id] = {...v, claimed: marks[t.id]?.claimed || null, startedMs: marks[t.id]?.startedMs ?? null, finishedMs: marks[t.id]?.finishedMs ?? null};
    emit({kind: 'verify', racer: mode, task: t.id, ok: v.ok, detail: v.detail});
  }
  const wrongModels = [...models].filter(m => m !== MODEL);
  const jsInUi = mode === 'browser' && BROWSER_MODE === 'ui' ? PAGE_JS_TOOLS.filter(t => toolNames.has(t)) : [];
  const invalidReason = jsInUi.length ? `page JavaScript tool used in mode A: ${jsInUi.join(', ')}` : wrongModels.length ? `unexpected model: ${wrongModels.join(', ')}` : !models.size ? 'no model observed' : timedOut ? 'timeout' : code !== 0 ? `exit ${code}` : null;
  const computedCost = costOf(MODEL, usage);
  if (mode === 'clify') fs.rmSync(path.join(env.CLIFY_HOME, 'vault.enc'), {force: true}), fs.rmSync(path.join(env.CLIFY_HOME, 'vault.key'), {force: true});
  if (mode === 'curl') fs.rmSync(path.join(dir, 'sessions'), {recursive: true, force: true});
  const summary = {racer: mode, racerId, browserMode: mode === 'browser' ? BROWSER_MODE : null, agent: agent.name, model: MODEL, models: [...models], invalid: !!invalidReason, invalidReason, exitCode: code,
    startedMs: started, finishedMs: finished, elapsedMs: finished - started, usage, freshTokens: freshTokens(usage), totalTokens: totalTokens(usage),
    costUsd: reportedCost ?? computedCost, computedCostUsd: computedCost, reportedCostUsd: reportedCost, modelCalls: calls, toolCalls,
    peakRamMB: Math.max(0, ...samples.map(s => s.rssMB)), avgCpu: samples.length ? samples.reduce((a, s) => a + s.cpu, 0) / samples.length : 0,
    success: Object.values(results).filter(r => r.ok).length, tasks: results, samples};
  writeJson(path.join(dir, 'summary.json'), summary);
  const {samples: _, ...lean} = summary; emit({kind: 'racer_finish', racer: mode, ...lean});
  return summary;
}

// Delete what this run created (signed-in dashboards: every race-<racer id> object).
async function cleanUp() {
  if (!ACCOUNTS) return deleteRooms(RACERS.map(m => `RACE-${racerIdOf(m)}`)).catch(e => emit({kind: 'note', text: `room cleanup failed: ${e.message}`}));
  const r = await cleanup(RACERS.map(m => `race-${racerIdOf(m)}`));
  emit({kind: 'cleanup', removed: r.removed, errors: r.errors});
  if (r.errors.length) console.error(`cleanup errors: ${r.errors.join('; ')} (run node race/accounts/cleanup.mjs)`);
}
let browserHost = null;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => {
  for (const c of children) c.kill('SIGTERM');
  browserHost?.host.kill('SIGTERM');
  emit({kind: 'note', text: `aborted (${sig})`}); await cleanUp().catch(() => {}); process.exit(130);
});
// Watch the admin room list during the race so a later site reset can't hide a write.
const roomWatch = ACCOUNTS ? null : setInterval(async () => { try { for (const r of await liveRooms()) if (/^RACE-/.test(r.roomName) && !seenRooms.some(s => s.roomid === r.roomid)) seenRooms.push(r); } catch {} }, 5000);
if (ACCOUNTS) await cleanUp(); // a leftover from an aborted run with the same racer ids
if (OTHER === 'browser') browserHost = await startBrowserHost();
const [browser, clify] = await Promise.all([runRacer(OTHER, browserHost), runRacer('clify')]);
clearInterval(roomWatch);
browserHost?.host.kill('SIGTERM');
await cleanUp();
const mixed = browser.model !== clify.model;
emit({kind: 'run_finish', valid: !browser.invalid && !clify.invalid && !mixed});
events.end();
const lean = s => { const {samples, ...x} = s; return x; };
writeJson(path.join(runDir, 'summary.json'), {runDir, agent: agent.name, model: MODEL, browserMode: OTHER === 'browser' ? BROWSER_MODE : null, other: OTHER, taskFile: path.basename(TASK_FILE), startedAt: new Date(t0).toISOString(), finishedAt: new Date().toISOString(), valid: !browser.invalid && !clify.invalid && !mixed, tasks, truth, racers: {[OTHER]: lean(browser), clify: lean(clify)}});
const brief = s => ({invalid: s.invalidReason, s: +(s.elapsedMs / 1000).toFixed(1), fresh: s.freshTokens, total: s.totalTokens, cost: +s.costUsd.toFixed(4), ramMB: s.peakRamMB, calls: s.modelCalls, tools: s.toolCalls, ok: `${s.success}/${tasks.length}`});
console.log(JSON.stringify({runDir, model: MODEL, other: OTHER, [OTHER]: brief(browser), clify: brief(clify)}, null, 2));
