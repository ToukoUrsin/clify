#!/usr/bin/env node
// Runs the real clify flows (headless, public read-only sites) and saves every command's exact
// stdout, exit code and wall time to src/data/capture.json. Writes are only dry-run previews:
// no --yes, no MCP confirm. CAPTCHA page: clify must stop; nothing on the page is touched.
// Usage: CLIFY_DIR=~/clify-film-snap/clify node capture/capture-cli.mjs
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const film = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clify = process.env.CLIFY_DIR || path.join(os.homedir(), 'clify-film-snap/clify');
const home = fs.mkdtempSync('/tmp/clify-capture-');
const env = {...process.env, CLIFY_HOME: home};
const bin = path.join(clify, 'bin/clify');
const out = {capturedAt: new Date().toISOString(), host: os.hostname(), clifyDir: clify, steps: {}};

const run = (id, args, {display, timeout = 200000} = {}) => {
	const t0 = Date.now();
	const r = spawnSync(bin, args, {cwd: clify, env, encoding: 'utf8', timeout});
	const ms = Date.now() - t0;
	out.steps[id] = {cmd: display ?? `clify ${args.map((a) => (/[\s"{}]/.test(a) ? `"${a}"` : a)).join(' ')}`, exit: r.status, ms, stdout: r.stdout, stderr: (r.stderr || '').slice(-4000)};
	console.log(`${id}: exit ${r.status} ${ms}ms`);
	return out.steps[id];
};
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const T = path.join(clify, 'test/real');
const sites = [
	['books', 'https://books.toscrape.com/', 'books.script.json'],
	['quotes', 'https://quotes.toscrape.com/', 'quotes.script.json'],
	['hnsearch', 'https://hn.algolia.com/', 'hnsearch.script.json'],
	['wikipedia', 'https://en.wikipedia.org/wiki/Main_Page', 'wikipedia.script.json'],
	['scrapethis', 'https://www.scrapethissite.com/pages/', 'scrapethis.script.json'],
	['httpbinform', 'https://httpbin.org/forms/post', 'httpbin-form.script.json'],
];
for (const [n, u, s] of sites) {
	run(`record-${n}`, ['record', u, '--name', n, '--script', path.join(T, s)], {display: `clify record ${u} --name ${n} --script test/real/${s}`});
	fs.copyFileSync(path.join(T, `${n}.spec.json`), path.join(home, 'sites', n, 'spec.json'));
	const rec = path.join(home, 'sites', n, 'recording.jsonl');
	out.steps[`record-${n}`].recording = fs.existsSync(rec)
		? fs.readFileSync(rec, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
		: [];
	sleep(1500);
}

// CAPTCHA: must stop with "captcha at", exit non-zero, and never run the click.
const cap = path.join(home, 'cap.json');
fs.writeFileSync(cap, JSON.stringify([{tool: 'click', input: {selector: '#recaptcha-demo-submit', intent: 'must not run'}}]));
run('captcha', ['record', 'https://www.google.com/recaptcha/api2/demo', '--name', 'cap', '--script', cap], {
	display: 'clify record https://www.google.com/recaptcha/api2/demo --name cap --script cap.json',
});

run('list', ['list']);
run('help-books', ['books']);
run('books-mystery', ['books', 'list-category', '--category', 'mystery_3', '--limit', '3', '--fields', 'title,price']);
sleep(1000);
run('books-get', ['books', 'get-book', '--slug', 'the-mysterious-affair-at-styles-hercule-poirot-1_452', '--fields', 'title,price,upc']);
run('hn-search', ['hnsearch', 'search', '--query', 'playwright', '--limit', '3', '--fields', 'title,points']);
run('wiki-summary', ['wikipedia', 'summary', '--title', 'Y_Combinator', '--fields', 'title,description']);
run('quotes-author', ['quotes', 'get-author', '--slug', 'Albert-Einstein']);
run('scrapethis-oscars', ['scrapethis', 'oscar-films', '--year', '2015', '--limit', '3', '--fields', 'title,nominations,best_picture']);
run('err-enum', ['hnsearch', 'search', '--query', 'sqlite', '--tags', 'bogus']);
run('help-httpbin', ['httpbinform']);
run('write-preview', ['httpbinform', 'place-order', '--custname', 'demo', '--size', 'large']);

// MCP over stdio: list tools, live read, write tool without confirm (preview only)
const mcp = (id, site, tool, args) => {
	const t0 = Date.now();
	const r = spawnSync('node', [path.join(clify, 'test/smoke/mcp-smoke.mjs'), bin, site, tool, args], {cwd: clify, env, encoding: 'utf8', timeout: 120000});
	out.steps[id] = {cmd: `mcp ${tool} ${args}`, exit: r.status, ms: Date.now() - t0, stdout: r.stdout, stderr: (r.stderr || '').slice(-2000)};
	console.log(`${id}: exit ${r.status}`);
};
mcp('mcp-read', 'books', 'books__get-book', '{"slug":"the-mysterious-affair-at-styles-hercule-poirot-1_452"}');
mcp('mcp-write', 'httpbinform', 'httpbinform__place-order', '{"custname":"demo","size":"large"}');

fs.mkdirSync(path.join(film, 'src/data'), {recursive: true});
fs.writeFileSync(path.join(film, 'src/data/capture.json'), JSON.stringify(out, null, 1));
console.log(`wrote src/data/capture.json (home ${home})`);
