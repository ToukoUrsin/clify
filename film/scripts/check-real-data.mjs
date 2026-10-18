#!/usr/bin/env node
// Fails (exit 1) unless every data file the film reads is real, present and internally consistent.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const film = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = (f) => JSON.parse(fs.readFileSync(path.join(film, 'src/data', f), 'utf8'));
const problems = [];
const bench = J('bench.json');
const wall = J('wall.json');
const capture = J('capture.json');
J('evidence.json');
const shots = J('shots.json');

const {heroes, runs, ...aggs} = bench;
if (/\bplaceholder\b/i.test(JSON.stringify(aggs) + JSON.stringify(wall))) problems.push('the word placeholder appears in bench/wall data');
if (!bench.runs?.length) problems.push('bench has no runs');
if (bench.model.some((m) => !m.startsWith('claude-opus-5-5'))) problems.push(`unexpected models: ${bench.model}`);
for (const m of ['browser', 'browserUi', 'cli']) if (!bench[m]?.n) problems.push(`no runs for mode ${m}`);
for (const [id, h] of Object.entries(bench.heroes)) {
	for (const [m, r] of Object.entries(h)) {
		if (!r.events?.length) problems.push(`hero ${id}/${m} has no events`);
		if (r.video && !fs.existsSync(path.join(film, 'public', r.video.src))) problems.push(`hero video missing: ${r.video.src}`);
	}
}
if (!wall.count || wall.count !== wall.sites.length) problems.push('wall count mismatch');
for (const s of wall.sites) if (s.img && !fs.existsSync(path.join(film, 'public', s.img))) problems.push(`wall image missing: ${s.img}`);
if (!wall.sites.every((s) => s.commands.length >= 1)) problems.push('wall site without a verified command');
for (const id of ['record-books', 'record-httpbinform', 'captcha', 'help-books', 'write-preview', 'mcp-write']) if (!capture.steps[id]) problems.push(`capture step missing: ${id}`);
if (capture.steps.captcha?.exit === 0 || !/captcha at/.test(capture.steps.captcha?.stdout ?? '')) problems.push('captcha capture did not stop with a blocker');
if (!/"needsConfirmation": true/.test(capture.steps['write-preview']?.stdout ?? '')) problems.push('write preview did not hold the write');
for (const f of Object.values(shots.flows).flatMap((x) => x.steps.map((s) => s.file))) if (!fs.existsSync(path.join(film, 'public/shots', f))) problems.push(`shot missing: ${f}`);

// spoken numbers must match the data on screen
const voPath = path.join(film, 'src/data/vo.json');
if (fs.existsSync(voPath)) {
	const {basis} = JSON.parse(fs.readFileSync(voPath, 'utf8'));
	const h = bench.heroes['quotes-top-author'];
	const now = {uiMedianSec: bench.browserUi.medianSec, cliMedianSec: bench.cli.medianSec, uiMedianTokens: bench.browserUi.medianTokens, cliMedianTokens: bench.cli.medianTokens, nTasks: bench.nTasks, wallCount: wall.count, heroUiMs: h['browser-ui'].wallMs, heroCliMs: h.cli.wallMs, heroUiTools: h['browser-ui'].events.filter((e) => e.kind === 'tool' && e.name !== 'ToolSearch').length, heroUiTokens: h['browser-ui'].tokens.total};
	for (const [k, v] of Object.entries(now)) if (basis?.[k] !== v) problems.push(`vo.json was generated from different data (${k}: ${basis?.[k]} vs ${v}); re-run make-vo.mjs`);
}

// numbers in scene source must come from data, not literals
for (const f of fs.readdirSync(path.join(film, 'src/scenes'))) {
	const src = fs.readFileSync(path.join(film, 'src/scenes', f), 'utf8');
	const m = src.match(/['"`>][^'"`<\n{]*(\b\d+(\.\d+)?\s*(×|x faster|tokens\b|s faster)|\b\d+%\s+(success|correct|faster|fewer))[^'"`<\n]*/g);
	if (m) problems.push(`${f}: literal numeric claim: ${m.join(' | ')}`);
}
if (problems.length) {
	console.error('REAL-DATA CHECK FAILED:\n - ' + problems.join('\n - '));
	process.exit(1);
}
console.log(`real-data check OK: ${bench.runs.length} runs (${bench.source}), wall ${wall.count} sites, capture ${Object.keys(capture.steps).length} steps`);
