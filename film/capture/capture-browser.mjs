#!/usr/bin/env node
// Headless screenshots for the film: the same click paths clify's recorder runs, one PNG per step,
// plus the target element's box so the film can animate a cursor to the real spot.
// Public sandbox sites only. httpbin: the form POST is aborted in the browser (nothing sent).
// reCAPTCHA demo: page load + screenshot only, no interaction.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import os from 'node:os';

const film = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(os.homedir(), 'clify-dev/package.json'));
const {chromium} = require('playwright');
const outDir = path.join(film, 'public/shots');
fs.mkdirSync(outDir, {recursive: true});
const VW = 1440, VH = 900;
const meta = {capturedAt: new Date().toISOString(), viewport: [VW, VH], flows: {}};

const browser = await chromium.launch({headless: true});
const flow = async (name, url, steps) => {
	const ctx = await browser.newContext({viewport: {width: VW, height: VH}, deviceScaleFactor: 1});
	const page = await ctx.newPage();
	let sent = [];
	await page.route('**/*', (route) => {
		const r = route.request();
		if (r.method() !== 'GET' && r.method() !== 'HEAD' && name === 'httpbinform') {
			sent.push({method: r.method(), url: r.url(), aborted: true});
			return route.abort();
		}
		return route.continue();
	});
	const out = [];
	await page.goto(url, {waitUntil: 'load', timeout: 60000});
	await page.waitForTimeout(800);
	const snap = async (i, extra) => {
		const file = `${name}-${i}.png`;
		await page.screenshot({path: path.join(outDir, file)});
		out.push({file, url: page.url(), ...extra});
	};
	await snap(0, {intent: 'page load'});
	let i = 1;
	for (const s of steps) {
		let box = null;
		if (s.selector) {
			const el = page.locator(s.selector).first();
			await el.scrollIntoViewIfNeeded().catch(() => {});
			box = await el.boundingBox();
			// screenshot with the target in view, before acting
			const file = `${name}-${i}-pre.png`;
			await page.screenshot({path: path.join(outDir, file)});
			out.push({file, url: page.url(), intent: s.intent, action: s.tool, target: box, text: s.text});
			if (s.tool === 'click') await el.click({timeout: 15000}).catch((e) => out.push({error: e.message}));
			if (s.tool === 'type') {
				await el.fill(s.text);
				if (s.submit) await el.press('Enter');
			}
		} else if (s.tool === 'goto') {
			await page.goto(new URL(s.url, page.url()).toString(), {waitUntil: 'load'});
		}
		await page.waitForLoadState('load').catch(() => {});
		await page.waitForTimeout(900);
		await snap(i, {intent: s.intent, after: true});
		i++;
		await page.waitForTimeout(1000);
	}
	meta.flows[name] = {url, steps: out, nonGet: sent};
	await ctx.close();
	console.log(`${name}: ${out.length} shots, nonGet=${sent.length}`);
};

await flow('books', 'https://books.toscrape.com/', [
	{tool: 'click', selector: 'a:has-text("Mystery")', intent: 'filter by category'},
	{tool: 'click', selector: 'li.next a', intent: 'next page'},
	{tool: 'click', selector: 'article.product_pod h3 a', intent: 'open book detail'},
]);
await flow('httpbinform', 'https://httpbin.org/forms/post', [
	{tool: 'type', selector: 'input[name=custname]', text: 'Write guard test', intent: 'fill order form'},
	{tool: 'click', selector: 'button', intent: 'submit order (held, never sent)'},
]);
await flow('hnsearch', 'https://hn.algolia.com/', [{tool: 'type', selector: 'input[type=search]', text: 'playwright', intent: 'keyword search'}]);
await flow('quotes', 'https://quotes.toscrape.com/', []);
await flow('wikipedia', 'https://en.wikipedia.org/wiki/Hacker_News', []);
await flow('scrapethis', 'https://www.scrapethissite.com/pages/', []);
await flow('captcha', 'https://www.google.com/recaptcha/api2/demo', []);
await browser.close();
fs.writeFileSync(path.join(film, 'src/data/shots.json'), JSON.stringify(meta, null, 1));
