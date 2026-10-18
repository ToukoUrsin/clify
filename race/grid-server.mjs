#!/usr/bin/env node
/* Grid server: one tile per (site, racer) for a grid run (race/bin/grid runs one
   race per site, all six at once). Live: --dir <grid dir> tails every site's run.
   Replay: --replay <grid dir> re-emits the recorded run on one clock
   (RACE_REPLAY_SPEED, default 1). */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argOf = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const replayDir = argOf('--replay');
const dir = path.resolve(replayDir || argOf('--dir') || '.');
const replay = !!replayDir;
const port = Number(process.env.PORT || 8870);
const speed = Number(process.env.RACE_REPLAY_SPEED || 1);
const readLines = p => fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(x => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean) : [];

// The grid's tile order comes from the full task file bin/grid wrote; each site's run sits in <dir>/<site>.
const order = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'grid.json'), 'utf8')); } catch { return null; } };
const S = {}; // site -> {events, frames, sent, lastFrame, t0}
function load() {
  for (const site of order()?.sites || []) {
    const s = S[site] ||= {events: [], frames: [], sent: 0, lastFrame: null, t0: null};
    s.events = readLines(path.join(dir, site, 'events.jsonl'));
    s.frames = readLines(path.join(dir, site, 'browser-frames.jsonl'));
    const start = s.events.find(e => e.kind === 'run_start'); s.t0 = start ? Date.parse(start.at) : null;
  }
}
// One clock for all tiles: ms since the grid started (grid.json startedAt). Replay starts 1.5 s before the first racer.
let replayStart = null, offset = 0;
const gridT0 = () => order()?.startedAt ?? null;
function clockMs() {
  const g = gridT0(); if (g == null) return 0;
  if (!replay) return Date.now() - g;
  return replayStart == null ? offset : offset + (Date.now() - replayStart) * speed;
}
const abs = (s, ms) => s.t0 - gridT0() + ms; // a site's event time on the grid clock
const done = () => Object.keys(S).length > 0 && Object.values(S).every(s => s.events.some(e => e.kind === 'run_finish') && s.sent >= s.events.length);

const clients = new Set();
const send = (res, e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
const broadcast = e => { for (const res of clients) send(res, e); };
let loaded = false;
function tick() {
  if (!replay || !loaded) { load(); loaded = true; }
  if (replay && replayStart == null) return;
  const ms = clockMs();
  for (const [site, s] of Object.entries(S)) {
    if (s.t0 == null) continue;
    while (s.sent < s.events.length && (!replay || abs(s, s.events[s.sent].ms) <= ms)) broadcast({...s.events[s.sent++], site});
    const f = s.frames.filter(x => !replay || abs(s, x.ms) <= ms).at(-1);
    if (f && f.file !== s.lastFrame) { s.lastFrame = f.file; broadcast({kind: 'browser_frame', site, file: f.file}); }
  }
  broadcast({kind: 'clock', ms, done: done()});
}
if (replay) {
  load(); loaded = true;
  const starts = Object.values(S).flatMap(s => s.events.filter(e => e.kind === 'racer_start').map(e => abs(s, e.ms)));
  offset = Math.max(0, Math.min(...starts) - 1500);
}
setInterval(tick, 100);

const types = {'.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html', '.jpg': 'image/jpeg'};
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/events') {
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'});
    const o = order(); send(res, {kind: 'hello', replay, sites: o?.sites || [], labels: o?.labels || {}, started: o?.startedAt != null});
    if (replay && replayStart == null) replayStart = Date.now();
    for (const [site, s] of Object.entries(S)) { for (const e of s.events.slice(0, s.sent)) send(res, {...e, site}); if (s.lastFrame) send(res, {kind: 'browser_frame', site, file: s.lastFrame}); } // catch up a late viewer
    clients.add(res); req.on('close', () => clients.delete(res)); return;
  }
  if (u.pathname === '/start' && req.method === 'POST') { if (!replay) fs.writeFileSync(path.join(dir, 'start'), ''); res.writeHead(204); res.end(); return; }
  const m = u.pathname.match(/^\/frames\/([\w-]+)\/([\w.-]+\.jpg)$/);
  const file = m ? path.join(dir, m[1], 'browser-frames', m[2]) : path.join(HERE, 'web', u.pathname === '/' ? 'grid.html' : u.pathname.replace(/^\/web\//, ''));
  if (!m && (u.pathname.includes('..') || !/^\/(web\/)?[\w.-]*$/.test(u.pathname))) { res.writeHead(404); res.end(); return; }
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store'}); fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`race grid http://127.0.0.1:${port} ${replay ? 'replay' : 'live'} ${dir}`));
