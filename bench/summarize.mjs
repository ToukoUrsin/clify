#!/usr/bin/env node
// Re-grade every run under runs/<tag>/ with the current grader and write results/summary-<tags>.json.
// Usage: node summarize.mjs main hard
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {grade} from './tasks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tags = process.argv.slice(2);
const runs = [];
for (const tag of tags) {
	const td = path.join(HERE, 'runs', tag);
	for (const task of fs.readdirSync(td)) {
		const dir = path.join(td, task);
		if (!fs.statSync(dir).isDirectory()) continue;
		const truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json'), 'utf8'));
		for (const r of fs.readdirSync(dir)) {
			const f = path.join(dir, r, 'result.json');
			if (!fs.existsSync(f)) continue;
			const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
			const invalid = /invalid run/.test(rec.why);
			const g = grade(rec.answer, truth);
			rec.ok = g.ok && !invalid && !rec.timedOut;
			rec.why = rec.timedOut ? 'timed out' : invalid ? rec.why : g.why;
			rec.dir = path.relative(HERE, path.join(dir, r));
			runs.push(rec);
		}
	}
}
const med = (xs) => {
	const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
	if (!s.length) return null;
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const agg = (rs) => ({
	n: rs.length,
	ok: rs.filter((r) => r.ok).length,
	rate: rs.length ? rs.filter((r) => r.ok).length / rs.length : null,
	medianSec: med(rs.map((r) => r.wallMs / 1000)),
	meanSec: rs.reduce((a, r) => a + r.wallMs / 1000, 0) / (rs.length || 1),
	medianTokens: med(rs.map((r) => r.tokens.total)),
	medianToolCalls: med(rs.map((r) => r.toolCalls)),
	medianTurns: med(rs.map((r) => r.turns)),
	totalCostUsd: rs.reduce((a, r) => a + (r.costUsd || 0), 0),
	medianCostUsd: med(rs.map((r) => r.costUsd)),
});
const by = (m) => runs.filter((r) => r.mode === m);
const tasks = [...new Set(runs.map((r) => r.task))];
const perTask = tasks.map((t) => {
	const b = runs.filter((r) => r.task === t && r.mode === 'browser');
	const c = runs.filter((r) => r.task === t && r.mode === 'cli');
	const u = runs.filter((r) => r.task === t && r.mode === 'browser-ui');
	const k = runs.filter((r) => r.task === t && r.mode === 'curl');
	return {task: t, site: runs.find((r) => r.task === t).site, browser: agg(b), browserUi: agg(u), cli: agg(c), curl: agg(k)};
});
const S = {
	generatedAt: new Date().toISOString(),
	tags,
	model: [...new Set(runs.flatMap((r) => r.models))],
	setup: {
		browser: 'Claude Code -p, Playwright MCP 0.0.83 (default tools) over CDP to headless Chromium; built-in tools disabled',
		browserUi: 'same as browser, with browser_evaluate and browser_run_code_unsafe disabled (no page JavaScript)',
		cli: 'Claude Code -p, Bash only, clify on PATH; told to use clify, no curl/WebFetch',
		curl: 'Claude Code -p, Bash (curl, jq, python3) + WebFetch + WebSearch; no clify, no browser',
		grading: 'every expected value must appear in the final ANSWER line; ground truth recomputed with clify right before each task',
	},
	nTasks: tasks.length,
	nSites: new Set(runs.map((r) => r.site)).size,
	browser: agg(by('browser')),
	browserUi: agg(by('browser-ui')),
	cli: agg(by('cli')),
	curl: agg(by('curl')),
	perTask,
	runs,
};
S.speedupMedian = S.browser.medianSec / S.cli.medianSec;
S.tokenRatioMedian = S.browser.medianTokens / S.cli.medianTokens;
fs.mkdirSync(path.join(HERE, 'results'), {recursive: true});
const out = path.join(HERE, 'results', `summary-${tags.join('+')}.json`);
fs.writeFileSync(out, JSON.stringify(S, null, 1));
const p = (x) => (x * 100).toFixed(0) + '%';
console.log(`${out}\nruns ${runs.length}, tasks ${S.nTasks}, sites ${S.nSites}, models ${S.model}`);
for (const [m, k] of [['browser', 'browser'], ['browser-ui', 'browserUi'], ['cli', 'cli'], ['curl', 'curl']]) {
	const a = S[k];
	if (!a.n) continue;
	console.log(`${m.padEnd(8)} ${a.ok}/${a.n} ${p(a.rate)}  median ${a.medianSec.toFixed(1)}s  mean ${a.meanSec.toFixed(1)}s  tokens ${a.medianTokens}  tools ${a.medianToolCalls}  cost $${a.totalCostUsd.toFixed(2)}`);
}
console.log(`speedup ${S.speedupMedian.toFixed(2)}x  tokens ${S.tokenRatioMedian.toFixed(2)}x`);
for (const r of runs.filter((r) => !r.ok)) console.log(`  FAIL ${r.task} ${r.mode}#${r.trial}: ${r.why} | ${r.answer.slice(0, 100)}`);
