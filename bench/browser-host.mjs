#!/usr/bin/env node
// Headless Chromium for one browser-agent run. Playwright MCP connects to it over CDP; this
// process records a CDP screencast of every page (JPEG frames + timestamps) so the agent's own
// tool calls stay untouched. Writes <dir>/cdp.txt once ready. Stops on SIGTERM.
// Usage: node browser-host.mjs <runDir> <port>
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

const [dir, port] = process.argv.slice(2);
const require = createRequire(path.join(path.dirname(new URL(import.meta.url).pathname), '../clify/package.json'));
const {chromium} = require('playwright');
const frames = path.join(dir, 'frames');
fs.mkdirSync(frames, {recursive: true});
const exe = chromium.executablePath();
const profile = fs.mkdtempSync('/tmp/bench-chrome-');
const chrome = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, '--window-size=1280,800', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--disable-dev-shm-usage', '--no-sandbox', 'about:blank'], {stdio: 'ignore'});
const t0 = Date.now();
const log = fs.createWriteStream(path.join(dir, 'frames.jsonl'));

let browser;
for (let i = 0; i < 60 && !browser; i++) {
	try {
		browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
	} catch {
		await new Promise((r) => setTimeout(r, 250));
	}
}
if (!browser) process.exit(2);
let n = 0;
const watch = async (page, pi) => {
	try {
		const s = await page.context().newCDPSession(page);
		s.on('Page.screencastFrame', async (f) => {
			const file = `p${pi}-${String(n++).padStart(6, '0')}.jpg`;
			fs.writeFileSync(path.join(frames, file), Buffer.from(f.data, 'base64'));
			log.write(JSON.stringify({file, page: pi, ms: Date.now() - t0, ts: f.metadata.timestamp, url: page.url()}) + '\n');
			s.send('Page.screencastFrameAck', {sessionId: f.sessionId}).catch(() => {});
		});
		await s.send('Page.startScreencast', {format: 'jpeg', quality: 70, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1});
	} catch {}
};
let pi = 0;
const ctx = browser.contexts()[0];
for (const p of ctx.pages()) watch(p, pi++);
ctx.on('page', (p) => watch(p, pi++));
fs.writeFileSync(path.join(dir, 'cdp.txt'), `http://127.0.0.1:${port}\n${t0}\n`);

const stop = async () => {
	log.end();
	try {
		await browser.close();
	} catch {}
	chrome.kill('SIGTERM');
	fs.rmSync(profile, {recursive: true, force: true});
	process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
