#!/usr/bin/env node
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// Frame times are relative to the race clock (t0 = run start) so replay lines up.
// stateFile (optional): Playwright storage state (saved sessions) to load before
// the race, so the browser racer starts signed in. It is deleted once read.
const [dir, port, t0arg, stateFile] = process.argv.slice(2);
const require = createRequire(path.join(os.homedir(), 'clify-dev/package.json'));
const {chromium} = require('playwright');
const frames = path.join(dir, 'browser-frames');
fs.mkdirSync(frames, {recursive: true});
// Throwaway profile, deleted on exit: with signed-in tasks it holds session cookies.
const profile = fs.mkdtempSync('/tmp/race-chrome-');
const chrome = spawn('/usr/bin/google-chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, '--window-size=1280,720',
  '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', '--no-sandbox',
  `--user-data-dir=${profile}`, 'about:blank'
], {stdio: 'ignore', detached: true}); // own process group, so stop() reaches every Chrome helper
let browser;
for (let i = 0; i < 80 && !browser; i++) {
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); }
  catch { await new Promise(r => setTimeout(r, 250)); }
}
if (!browser) process.exit(2);
const ctx = browser.contexts()[0];
if (stateFile) {
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); fs.rmSync(stateFile, {force: true});
  await ctx.addCookies(state.cookies.map(c => ({...c, expires: c.expires > 0 ? c.expires : -1, sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax'}))).catch(e => console.error('cookies', e.message));
  // localStorage needs a document on each origin; robots.txt is light and runs no app code.
  const prep = await ctx.newPage();
  for (const o of state.origins) {
    try {
      await prep.goto(`${o.origin}/robots.txt`, {waitUntil: 'domcontentloaded', timeout: 15000});
      await prep.evaluate(items => { for (const {name, value} of items) localStorage.setItem(name, value); }, o.localStorage);
    } catch (e) { console.error('storage', o.origin, e.message); }
  }
  await prep.close();
}
const started = Number(t0arg) || Date.now();
const log = fs.createWriteStream(path.join(dir, 'browser-frames.jsonl'));
let frameNo = 0, pageNo = 0;
async function watch(page, index) {
  try {
    const cdp = await page.context().newCDPSession(page);
    cdp.on('Page.screencastFrame', async f => {
      const file = `p${index}-${String(frameNo++).padStart(7, '0')}.jpg`;
      fs.writeFileSync(path.join(frames, file), Buffer.from(f.data, 'base64'));
      log.write(JSON.stringify({file, ms: Date.now() - started, url: page.url()}) + '\n');
      await cdp.send('Page.screencastFrameAck', {sessionId: f.sessionId}).catch(() => {});
    });
    await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 72, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1});
  } catch {}
}
for (const p of ctx.pages()) watch(p, pageNo++);
ctx.on('page', p => watch(p, pageNo++));
fs.writeFileSync(path.join(dir, 'cdp.txt'), `http://127.0.0.1:${port}\n${started}\n${chrome.pid}\n`);
async function stop() {
  log.end();
  await browser.close().catch(() => {});
  const group = sig => { try { process.kill(-chrome.pid, sig); } catch {} };
  group('SIGTERM'); await new Promise(r => setTimeout(r, 1500)); group('SIGKILL'); await new Promise(r => setTimeout(r, 300));
  try { fs.rmSync(profile, {recursive: true, force: true, maxRetries: 20, retryDelay: 250}); } catch (e) { console.error('profile cleanup', e.message); }
  process.exit(0);
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
