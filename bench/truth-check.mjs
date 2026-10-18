// Independent check of the benchmark's ground truth. run.mjs computes the truth with
// clify (tasks.mjs); this recomputes it without clify, from each site's own HTML or
// public JSON with plain fetch and regexes, and compares it with every truth.json the
// runs recorded. Facts that change over time (latest versions, releases) are marked
// "may have moved": a mismatch there means the site changed, not that clify was wrong.
//   node bench/truth-check.mjs            > results/truth-check.txt
// run.mjs --truth fetch uses CHECKS as the ground truth instead of clify.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const UA = 'clify-bench-truth-check (independent ground truth; https://github.com/ToukoUrsin/clify)';
const get = async (url, json = false) => {
	const r = await fetch(url, {headers: {'user-agent': UA, accept: json ? 'application/json' : 'text/html'}});
	if (!r.ok) throw Error(`${url}: HTTP ${r.status}`);
	await new Promise((ok) => setTimeout(ok, 300)); // polite pacing
	return json ? r.json() : r.text();
};
const all = (re, s) => [...s.matchAll(re)];
const dec = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
const price = (s) => Number(String(s).replace(/[^0-9.]/g, ''));
const books = async (url) => all(/<h3><a href="[^"]*" title="([^"]+)">[\s\S]*?<p class="price_color">£?([\d.]+)</g, await get(url)).map((m) => ({title: dec(m[1]), price: m[2]}));
const quotes = async (url) => all(/<small class="author" itemprop="author">([^<]+)<\/small>\s*<a href="\/author\/([^"]+)"/g, await get(url)).map((m) => ({author: dec(m[1]), slug: m[2]}));
const hockey = async (qs) => all(/<td class="name">\s*([^<]+?)\s*<\/td>\s*<td class="year">\s*(\d+)\s*<\/td>\s*<td class="wins">\s*(\d+)/g, await get(`https://www.scrapethissite.com/pages/forms/?${qs}`)).map((m) => ({name: dec(m[1]), year: m[2], wins: +m[3]}));
const crate = (n) => get(`https://crates.io/api/v1/crates/${n}`, true);

export const CHECKS = {
	'books-mystery-max': async () => {
		const b = [...(await books('https://books.toscrape.com/catalogue/category/books/mystery_3/index.html')), ...(await books('https://books.toscrape.com/catalogue/category/books/mystery_3/page-2.html'))];
		const t = b.sort((x, y) => price(y.price) - price(x.price))[0];
		return {expect: [t.title.replace(/\s*\(.*\)$/, ''), t.price]};
	},
	'books-travel-over-40': async () => ({number: (await books('https://books.toscrape.com/catalogue/category/books/travel_2/index.html')).filter((b) => price(b.price) > 40).length}),
	'books-cheapest-first-5-pages': async () => {
		const b = [];
		for (let p = 1; p <= 5; p++) b.push(...(await books(`https://books.toscrape.com/catalogue/page-${p}.html`)));
		const t = b.sort((x, y) => price(x.price) - price(y.price))[0];
		return {expect: [t.title.replace(/\s*\(.*\)$/, ''), t.price]};
	},
	'quotes-humor-author': async () => {
		const q = (await quotes('https://quotes.toscrape.com/tag/humor/'))[0];
		const born = (await get(`https://quotes.toscrape.com/author/${q.slug}/`)).match(/author-born-date">([^<]+)</)[1];
		return {expect: [q.author, born.replace(/,/g, '')]};
	},
	'quotes-love-count': async () => {
		let n = 0;
		for (let p = 1; p < 10; p++) { const q = await quotes(`https://quotes.toscrape.com/tag/love/page/${p}/`); n += q.length; if (q.length < 10) break; }
		return {number: n};
	},
	'quotes-top-author': async () => {
		const cnt = {};
		for (let p = 1; p <= 10; p++) for (const q of await quotes(`https://quotes.toscrape.com/page/${p}/`)) cnt[q.author] = (cnt[q.author] || 0) + 1;
		const [a, n] = Object.entries(cnt).sort((x, y) => y[1] - x[1])[0];
		return {expect: [a], number: n};
	},
	'scrapethis-oscar-2012': async () => {
		const f = (await get('https://www.scrapethissite.com/pages/ajax-javascript/?ajax=true&year=2012', true)).find((x) => x.best_picture);
		return {expect: [f.title.trim()], number: f.awards};
	},
	'scrapethis-hockey-detroit-1995': async () => ({number: (await hockey('q=detroit&per_page=100')).find((r) => r.year === '1995' && /detroit/i.test(r.name)).wins}),
	'hockey-best-1990': async () => {
		const rows = [];
		for (let p = 1; p <= 8; p++) { const r = await hockey(`per_page=100&page_num=${p}`); if (!r.length) break; rows.push(...r); }
		const t = rows.filter((r) => r.year === '1990').sort((a, b) => b.wins - a.wins)[0];
		return {expect: [t.name], number: t.wins};
	},
	'webscraper-laptop-max': async () => {
		const h = await get('https://webscraper.io/test-sites/e-commerce/allinone/computers/laptops');
		const items = all(/<h4 class="price[^"]*"[^>]*>\s*<span[^>]*>\$([\d.,]+)<\/span>[\s\S]*?class="title"[^>]*title="([^"]+)"|\$([\d.,]+)<\/h4>[\s\S]*?class="title"[^>]*title="([^"]+)"/g, h).map((m) => ({price: m[1] ?? m[3], title: dec(m[2] ?? m[4])}));
		const t = items.sort((a, b) => price(b.price) - price(a.price))[0];
		return {expect: [t.title, String(Math.round(price(t.price)))]};
	},
	'endoflife-ubuntu-2204': async () => ({expect: [(await get('https://endoflife.date/api/ubuntu.json', true)).find((r) => r.cycle === '22.04').eol]}),
	'ubuntu-lts-supported': async () => ({expect: (await get('https://endoflife.date/api/ubuntu.json', true)).filter((r) => r.lts && String(r.eol) > '2026-10-17').map((r) => r.cycle)}),
	'crates-serde-vs-tokio': async () => ({expect: [(await crate('serde')).crate.downloads > (await crate('tokio')).crate.downloads ? 'serde' : 'tokio']}),
	'crates-tokio': async () => {
		const v = (await crate('tokio')).crate.max_stable_version;
		return {expect: [v, (await get(`https://crates.io/api/v1/crates/tokio/${v}`, true)).version.license], moves: true};
	},
	'hex-phoenix': async () => { const r = await get('https://hex.pm/api/packages/phoenix', true); return {expect: [r.latest_stable_version, ...r.meta.licenses], moves: true}; },
	'homebrew-ffmpeg': async () => { const r = await get('https://formulae.brew.sh/api/formula/ffmpeg.json', true); return {expect: [r.versions.stable, r.license], moves: true}; },
	'nodejs-latest-lts': async () => { const r = (await get('https://nodejs.org/dist/index.json', true)).find((x) => x.lts); return {expect: [r.version.replace(/^v/, ''), r.lts], moves: true}; },
	'debian-nginx-bookworm': async () => ({expect: [(await get('https://packages.debian.org/bookworm/nginx')).match(/<h1>Package: nginx \(([^ )]+)/)[1]], moves: true}),
	'github-playwright-release': async () => { const r = await get('https://api.github.com/repos/microsoft/playwright/releases/latest', true); return {expect: [r.tag_name.replace(/^v/, ''), r.published_at.slice(0, 10)], moves: true}; },
	'github-playwright-releases-2026': async () => ({number: (await get('https://api.github.com/repos/microsoft/playwright/releases?per_page=20', true)).filter((r) => r.published_at.startsWith('2026')).length, moves: true}),
};

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}.+-]+/gu, ' ').trim();
const same = (a, b) => JSON.stringify((a.expect ?? []).map(norm).sort()) === JSON.stringify((b.expect ?? []).map(norm).sort()) && (a.number ?? null) === (b.number ?? null);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const recorded = {};
	for (const tag of fs.readdirSync(path.join(HERE, 'runs'))) for (const task of fs.readdirSync(path.join(HERE, 'runs', tag))) {
		const f = path.join(HERE, 'runs', tag, task, 'truth.json');
		if (fs.existsSync(f)) (recorded[task] ??= []).push({tag, truth: JSON.parse(fs.readFileSync(f, 'utf8'))});
	}
	let agree = 0, stable = 0, moved = 0, failed = 0;
	console.log(`bench ground truth, recomputed without clify on ${new Date().toISOString()}\n`);
	for (const [task, check] of Object.entries(CHECKS)) {
		let mine;
		try { mine = await check(); } catch (e) { failed++; console.log(`ERROR   ${task}: ${e.message}`); continue; }
		const recs = recorded[task] ?? [];
		const ok = recs.length > 0 && recs.every((r) => same(mine, r.truth));
		const shown = JSON.stringify({expect: mine.expect, number: mine.number});
		if (!mine.moves) stable++;
		if (ok) agree++;
		else if (mine.moves) moved++;
		console.log(`${ok ? 'AGREE ' : mine.moves ? 'MOVED?' : 'DIFFER'}  ${task}: ${shown}${ok ? '' : `  recorded: ${[...new Set(recs.map((r) => JSON.stringify({expect: r.truth.expect, number: r.truth.number})))].join(' | ')}`} (${recs.map((r) => r.tag).join(',')})`);
	}
	console.log(`\n${agree} of ${Object.keys(CHECKS).length} tasks agree with every recorded truth; ${Object.keys(CHECKS).length - stable} track facts that may have moved since the runs (${moved} did); ${failed} errors.`);
}
