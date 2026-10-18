#!/usr/bin/env node
/* Record the dashboard (a running server.mjs, usually --replay) to a 1920x1080 30 fps MP4.
   Headless Chrome screencast frames are piped to ffmpeg on a wall-clock schedule, so the
   video runs at the server's speed. Stops RACE_HOLD_MS after the replay is done.
   RACE_SHOTS=30000,90000 also saves PNG screenshots when the race clock passes those ms;
   the final scoreboard is always saved as <out>-final.png. */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

const out = path.resolve(process.argv[2] || 'race.mp4');
const base = `http://127.0.0.1:${process.env.PORT || 8870}`;
const hold = Number(process.env.RACE_HOLD_MS || 9000);
const maxMs = Number(process.env.RACE_RECORD_MAX_MS || 30 * 60 * 1000);
const shots = (process.env.RACE_SHOTS || '').split(',').filter(Boolean).map(Number);
const port = Number(process.env.RACE_RECORD_PORT || 9790);
// RACE_PLAYWRIGHT_FROM / RACE_CHROME let it run where Playwright or Chrome live elsewhere (a sandbox).
const require = createRequire(path.resolve(process.env.RACE_PLAYWRIGHT_FROM || path.join(os.homedir(), 'clify-dev'), 'package.json'));
const {chromium} = require('playwright');

// Refuse to record some other service that happens to own the port.
const state0 = await fetch(`${base}/api/state`).then(r => r.json()).catch(() => null);
if (!state0?.dir) throw Error(`no race server at ${base}`);
const chrome = spawn(process.env.RACE_CHROME || '/usr/bin/google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, '--window-size=1920,1080', '--force-device-scale-factor=1', '--hide-scrollbars', '--no-sandbox', '--disable-dev-shm-usage', `--user-data-dir=${fs.mkdtempSync('/tmp/race-record-')}`, 'about:blank'], {stdio: 'ignore'});
let browser;
for (let i = 0; i < 80 && !browser; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { await new Promise(r => setTimeout(r, 250)); } }
if (!browser) throw Error('Chrome CDP did not start');
const page = browser.contexts()[0].pages()[0];
await page.setViewportSize({width: 1920, height: 1080});
const ff = spawn('nice', ['-n', '10', 'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-',
  '-vf', 'scale=1920:1080:flags=lanczos,format=yuv420p', '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-threads', '4', '-movflags', '+faststart', out], {stdio: ['pipe', 'ignore', 'inherit']});
const cdp = await page.context().newCDPSession(page);
let last = null;
cdp.on('Page.screencastFrame', async f => { last = Buffer.from(f.data, 'base64'); await cdp.send('Page.screencastFrameAck', {sessionId: f.sessionId}).catch(() => {}); });
await page.goto(`${base}/?record=${Date.now()}`);
await page.evaluate(() => document.fonts.ready);
await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1});
const started = Date.now(); let written = 0;
const pump = setInterval(() => { // keep the frame count locked to wall time
  if (!last) return;
  const due = Math.floor((Date.now() - started) / (1000 / 30));
  while (written < due) { ff.stdin.write(last); written++; }
}, 10);
let doneAt = null;
while (Date.now() - started < maxMs) {
  await new Promise(r => setTimeout(r, 250));
  const st = await fetch(`${base}/api/state`).then(r => r.json()).catch(() => null); if (!st) continue;
  while (shots.length && st.clockMs >= shots[0]) await page.screenshot({path: out.replace(/\.mp4$/, `-${shots.shift()}ms.png`)});
  if (st.done && doneAt == null) doneAt = Date.now();
  if (doneAt != null && Date.now() - doneAt > hold) break;
}
await page.screenshot({path: out.replace(/\.mp4$/, '-final.png')});
clearInterval(pump); ff.stdin.end();
await cdp.send('Page.stopScreencast').catch(() => {}); await browser.close().catch(() => {}); chrome.kill('SIGTERM');
await new Promise((resolve, reject) => ff.on('close', c => c ? reject(Error(`ffmpeg exited ${c}`)) : resolve()));
console.log(JSON.stringify({out, frames: written, seconds: written / 30}));
