#!/usr/bin/env node
// Benchmark data for the film, from ~/clify-demo/bench2 (real Claude Code runs).
//   src/data/bench.json  per-mode aggregates, every run (for the race), hero runs with events
//   public/hero/<task>/<mode>.mp4  screencast of the browser runs (from CDP frames, real timing)
// Usage: node scripts/import-bench.mjs --tags main,hard,ui --hero hockey-best-1990
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const film = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const B = path.join(os.homedir(), 'clify-demo/bench2');
const A = process.argv.slice(2);
const opt = (k, d) => (A.includes(`--${k}`) ? A[A.indexOf(`--${k}`) + 1] : d);
const tags = opt('tags', 'main,hard,ui').split(',');
const heroIds = opt('hero', 'hockey-best-1990').split(',');

execFileSync('node', [path.join(B, 'summarize.mjs'), ...tags], {stdio: 'inherit'});
const S = JSON.parse(fs.readFileSync(path.join(B, 'results', `summary-${tags.join('+')}.json`), 'utf8'));

const readTranscript = (dir) =>
	fs
		.readFileSync(path.join(B, dir, 'transcript.jsonl'), 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((l) => {
			const r = JSON.parse(l);
			try {
				return {ms: r.ms, o: JSON.parse(r.line)};
			} catch {
				return null;
			}
		})
		.filter(Boolean);

// cumulative tokens processed after each model call (input + cache + output), deduped by message id
const tokenTimeline = (dir) => {
	const seen = new Map();
	for (const {ms, o} of readTranscript(dir)) {
		if (o.type !== 'assistant' || !o.message?.usage) continue;
		const u = o.message.usage;
		seen.set(o.message.id, {ms, t: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0)});
	}
	let acc = 0;
	return [...seen.values()].sort((a, b) => a.ms - b.ms).map((x) => ({ms: x.ms, total: (acc += x.t)}));
};

const makeVideo = (dir, outFile, offsetMs, endMs) => {
	const fj = path.join(B, dir, 'frames.jsonl');
	if (!fs.existsSync(fj)) return null;
	const frames = fs.readFileSync(fj, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((f) => ({...f, t: f.ms - offsetMs})).filter((f) => f.t <= endMs + 500);
	if (!frames.length) return null;
	const list = [];
	for (let i = 0; i < frames.length; i++) {
		const next = i + 1 < frames.length ? frames[i + 1].t : endMs;
		const dur = Math.max(0.034, (next - Math.max(0, frames[i].t)) / 1000);
		if (next < 0) continue;
		list.push(`file '${path.join(B, dir, 'frames', frames[i].file)}'`, `duration ${dur.toFixed(3)}`);
	}
	list.push(`file '${path.join(B, dir, 'frames', frames[frames.length - 1].file)}'`);
	const lf = path.join(os.tmpdir(), `concat-${process.pid}.txt`);
	fs.writeFileSync(lf, list.join('\n'));
	fs.mkdirSync(path.dirname(outFile), {recursive: true});
	// start the video at the agent's t=0: blank (white) until the first frame
	const first = Math.max(0, frames[0].t) / 1000;
	execFileSync('nice', ['-n', '19', 'ffmpeg', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lf, '-vf', `tpad=start_duration=${first.toFixed(3)}:color=white,fps=30,scale=1280:600:force_original_aspect_ratio=decrease,pad=1280:600:(ow-iw)/2:0:white`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', outFile]);
	const urls = [];
	for (const f of frames) if (f.url && f.url !== 'about:blank' && urls[urls.length - 1]?.url !== f.url) urls.push({s: Math.max(0, f.t) / 1000, url: f.url});
	return {firstFrameSec: first, frames: frames.length, w: 1280, h: 600, urls};
};

const heroes = {};
for (const id of heroIds) {
	heroes[id] = {};
	for (const mode of ['browser-ui', 'browser', 'cli']) {
		const r = S.runs.filter((x) => x.task === id && x.mode === mode).sort((a, b) => (b.ok - a.ok) || a.trial - b.trial)[0];
		if (!r) continue;
		const events = JSON.parse(fs.readFileSync(path.join(B, r.dir, 'events.json'), 'utf8'));
		let video = null;
		if (mode.startsWith('browser')) {
			const cdp = fs.readFileSync(path.join(B, r.dir, 'cdp.txt'), 'utf8').split('\n');
			const offset = Date.parse(r.startedAt) - Number(cdp[1]);
			const rel = `hero/${id}/${mode}.mp4`;
			const v = makeVideo(r.dir, path.join(film, 'public', rel), offset, r.wallMs);
			if (v) video = {src: rel, ...v};
		}
		heroes[id][mode] = {
			dir: r.dir, ok: r.ok, why: r.why, answer: r.answer, wallMs: r.wallMs, turns: r.turns, toolCalls: r.toolCalls, tokens: r.tokens, costUsd: r.costUsd, models: r.models,
			prompt: fs.readFileSync(path.join(B, r.dir, 'prompt.txt'), 'utf8'),
			events, tokensOverTime: tokenTimeline(r.dir), video,
		};
	}
}

const strip = ({runs, perTask, ...rest}) => rest;
const out = {
	...strip(S),
	perTask: S.perTask,
	runs: S.runs.map((r) => ({task: r.task, site: r.site, mode: r.mode, trial: r.trial, tag: r.tag, ok: r.ok, why: r.why, wallMs: r.wallMs, tokens: r.tokens.total, toolCalls: r.toolCalls, costUsd: r.costUsd, answer: r.answer})),
	heroes,
	source: `~/clify-demo/bench2/results/summary-${tags.join('+')}.json`,
};
fs.writeFileSync(path.join(film, 'src/data/bench.json'), JSON.stringify(out, null, 1));
console.log(`bench.json: ${out.runs.length} runs, heroes ${Object.keys(heroes)}`);
