#!/usr/bin/env node
/* Dashboard server. Live: tails the newest (or --dir) run. Replay: --replay <run>
   re-emits events on a virtual clock. RACE_REPLAY_SPEED=4 RACE_REPLAY_FAST_AFTER_MS=10000
   plays the first 10 s at real speed, then 4x. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argOf = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const replayDir = argOf('--replay');
const port = Number(process.env.PORT || 8870);
const speed = Number(process.env.RACE_REPLAY_SPEED || 1);
const fastAfter = Number(process.env.RACE_REPLAY_FAST_AFTER_MS || 0);
const newestRun = () => { const d = path.join(HERE, 'runs'); return fs.existsSync(d) ? fs.readdirSync(d, {withFileTypes: true}).filter(x => x.isDirectory()).map(x => path.join(d, x.name)).sort().at(-1) : null; };
const dir = path.resolve(replayDir || argOf('--dir') || newestRun() || '.');
const replay = !!replayDir;
if (replay && !fs.existsSync(path.join(dir, 'events.jsonl'))) { console.error(`no events.jsonl in ${dir}; play race/artifacts/accounts-4x.mp4`); process.exit(1); }
const readLines = p => fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(x => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean) : [];

// Mode B numbers for the scoreboard footnote (race/results/<task set>-modes.json, written by stats.mjs --modes).
function baseline() {
  try { const t = JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')); if (Array.isArray(t)) return null;
    return JSON.parse(fs.readFileSync(process.env.RACE_BASELINE || path.join(HERE, 'results', 'accounts-modes.json'), 'utf8')); } catch { return null; }
}
let events = [], frames = [], sent = 0, replayStart = null, offset = 0;
const clients = new Set();
function load() {
  events = readLines(path.join(dir, 'events.jsonl'));
  frames = readLines(path.join(dir, 'browser-frames.jsonl'));
  // Replay starts 1.5 s before the racers (skips the truth fetch).
  if (replay) offset = Math.max(0, (events.find(e => e.kind === 'racer_start')?.ms ?? 1500) - 1500);
}
function clockMs() {
  if (replay) {
    if (replayStart == null) return offset;
    const t = Date.now() - replayStart;
    return offset + (fastAfter && t > fastAfter ? fastAfter + (t - fastAfter) * speed : fastAfter ? t : t * speed);
  }
  const start = events.find(e => e.kind === 'run_start');
  return start ? Date.now() - Date.parse(start.at) : 0;
}
const currentSpeed = () => replay && replayStart != null && (!fastAfter || Date.now() - replayStart > fastAfter) ? speed : 1;
const done = () => events.some(e => e.kind === 'run_finish') && sent >= events.length;
const send = (res, e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
const broadcast = e => { for (const res of clients) send(res, e); };

let lastFrame = null;
function tick() {
  if (!replay || !done()) load();
  if (replay && replayStart == null) return;
  const ms = clockMs();
  while (sent < events.length && (!replay || events[sent].ms <= ms)) broadcast(events[sent++]);
  const f = frames.filter(x => !replay || x.ms <= ms).at(-1);
  if (f && f.file !== lastFrame) { lastFrame = f.file; broadcast({kind: 'browser_frame', file: f.file, ms: f.ms, url: f.url}); }
  broadcast({kind: 'clock', ms, speed: currentSpeed(), done: done()});
}
load();
setInterval(tick, 100);

const types = {'.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html', '.jpg': 'image/jpeg'};
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/events') {
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'});
    send(res, {kind: 'hello', dir: path.basename(dir), replay, speed, fastAfter, baseline: baseline()});
    if (replay && replayStart == null) replayStart = Date.now();
    for (const e of events.slice(0, sent)) send(res, e); // catch up a late viewer
    clients.add(res); req.on('close', () => clients.delete(res)); return;
  }
  if (u.pathname === '/api/state') { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify({dir, replay, clockMs: clockMs(), done: done(), events: events.length, sent})); return; }
  const m = u.pathname.match(/^\/frames\/([\w.-]+\.jpg)$/);
  const file = m ? path.join(dir, 'browser-frames', m[1]) : path.join(HERE, 'web', u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\/web\//, ''));
  if (!m && (u.pathname.includes('..') || !/^\/(web\/)?[\w.-]*$/.test(u.pathname))) { res.writeHead(404); res.end(); return; }
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store'}); fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`race dashboard http://127.0.0.1:${port} ${replay ? 'replay' : 'live'} ${dir}`));
