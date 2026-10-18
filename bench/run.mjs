#!/usr/bin/env node
// Browser agent vs CLI agent benchmark. Each run is a fresh, headless Claude Code (-p) session
// on the same task with the same prompt; only the tools differ:
//   browser: Playwright MCP (headless Chromium over CDP, screencast recorded), no built-in tools
//   cli:     Bash only, with `clify` on PATH; told to use it, no curl/WebFetch
//   curl:    Bash (curl, jq, python3) + WebFetch + WebSearch, no clify, no browser
// Ground truth is recomputed with clify just before each task. Results: runs/<task>/<mode>-<n>/.
// Usage: ANTHROPIC_API_KEY=... node run.mjs [--tasks a,b] [--modes browser,cli] [--trials 1] [--conc 3]
import {execFile, spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {HARD, TASKS, grade} from './tasks.mjs';
import {CHECKS} from './truth-check.mjs';

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIFY_DIR = process.env.CLIFY_DIR || path.join(HERE, '..', 'clify');
const CLIFY_HOME = process.env.BENCH_CLIFY_HOME || path.join(HERE, '.clify-home'); // write-specs.py installs the bench sites here
const BIN = path.join(HERE, 'bin');
const MODEL = 'claude-opus-5-5';
const LIMITS = {browser: {ms: 10 * 60 * 1000, turns: 80}, 'browser-ui': {ms: 15 * 60 * 1000, turns: 120}, cli: {ms: 6 * 60 * 1000, turns: 40}, curl: {ms: 10 * 60 * 1000, turns: 80}};
// browser-ui: same Playwright MCP, but no page JavaScript (evaluate / run_code), so the agent works the UI like a person
const UI_ONLY_BLOCK = ['mcp__playwright__browser_evaluate', 'mcp__playwright__browser_run_code_unsafe'];
const A = process.argv.slice(2);
const opt = (k, d) => (A.includes(`--${k}`) ? A[A.indexOf(`--${k}`) + 1] : d);
const taskIds = opt('tasks', null)?.split(',');
const modes = opt('modes', 'browser,cli').split(',');
const trials = +opt('trials', '1');
const conc = +opt('conc', '3');
const tag = opt('tag', 'main');
const truthFrom = opt('truth', 'clify'); // fetch: truth-check.mjs's plain-fetch truth (no clify specs needed)
if (!process.env.ANTHROPIC_API_KEY) {
	console.error('ANTHROPIC_API_KEY missing (set it in the environment)');
	process.exit(2);
}

fs.mkdirSync(BIN, {recursive: true});
fs.writeFileSync(path.join(BIN, 'clify'), `#!/bin/sh\nexport CLIFY_HOME="${CLIFY_HOME}"\nexec "${path.join(CLIFY_DIR, 'bin/clify')}" "$@"\n`, {mode: 0o755});

const clify = async (...args) => {
	const r = await execFileP(path.join(BIN, 'clify'), args, {maxBuffer: 32 << 20}).catch((e) => e);
	await new Promise((res) => setTimeout(res, 1100)); // polite pacing
	return JSON.parse(r.stdout);
};

const PROMPT = (t) =>
	`${t.prompt}\n\nStart from ${t.startUrl}. Work it out using only the tools you have, then end your reply with one final line exactly in the form:\nANSWER: <short answer>`;
const MODE_NOTE = {
	browser: '\n\nYou have a web browser (Playwright tools). Use it to find the answer on the website.',
	curl: '\n\nYou have a shell with curl, jq and python3, plus WebFetch and WebSearch. Use them to find the answer from the website (its pages or any public API). There is no browser.',
	cli: (t) => `\n\nThe website is available as a command-line tool: run \`clify ${t.site}\` to see its commands (JSON help), then call them. Use clify only; do not use curl, wget, Python HTTP or other network tools.`,
};

const BUILTINS = ['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'NotebookEdit', 'TodoWrite', 'KillShell', 'BashOutput'];

let portSeq = 9400;
const runOne = async (task, mode, trial, truth) => {
	const dir = path.join(HERE, 'runs', tag, task.id, `${mode}-${trial}`);
	fs.rmSync(dir, {recursive: true, force: true});
	fs.mkdirSync(path.join(dir, 'work'), {recursive: true});
	const cfg = path.join(dir, 'claude-config');
	fs.mkdirSync(cfg, {recursive: true});
	const isBrowser = mode.startsWith('browser');
	const prompt = PROMPT(task) + (isBrowser ? MODE_NOTE.browser : mode === 'curl' ? MODE_NOTE.curl : MODE_NOTE.cli(task));
	fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt);
	const args = ['-p', prompt, '--model', MODEL, '--output-format', 'stream-json', '--verbose', '--setting-sources', '', '--no-session-persistence', '--permission-mode', 'bypassPermissions', '--max-turns', String(LIMITS[mode].turns), '--strict-mcp-config'];
	let host = null;
	if (isBrowser) {
		const port = portSeq++;
		host = spawn('node', [path.join(HERE, 'browser-host.mjs'), dir, String(port)], {stdio: 'ignore'});
		for (let i = 0; i < 80 && !fs.existsSync(path.join(dir, 'cdp.txt')); i++) await new Promise((r) => setTimeout(r, 250));
		if (!fs.existsSync(path.join(dir, 'cdp.txt'))) {
			host.kill('SIGTERM');
			throw new Error(`browser host did not start for ${task.id}`);
		}
		const mcp = {mcpServers: {playwright: {command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', '--cdp-endpoint', `http://127.0.0.1:${port}`]}}};
		fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify(mcp, null, 1));
		args.push('--mcp-config', path.join(dir, 'mcp.json'), '--disallowed-tools', ...BUILTINS, ...(mode === 'browser-ui' ? UI_ONLY_BLOCK : []));
	} else {
		fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({mcpServers: {}}));
		args.push('--mcp-config', path.join(dir, 'mcp.json'), '--tools', mode === 'curl' ? 'Bash,WebFetch,WebSearch' : 'Bash');
	}
	const env = {
		PATH: mode === 'curl' ? process.env.PATH : `${BIN}:${process.env.PATH}`, // curl: no clify
		HOME: process.env.HOME,
		USER: process.env.USER,
		TERM: 'xterm-256color',
		LANG: 'C.UTF-8',
		ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
		...(process.env.ANTHROPIC_BASE_URL ? {ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL} : {}),
		CLAUDE_CONFIG_DIR: cfg,
		DISABLE_AUTOUPDATER: '1',
		CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
		...(mode === 'curl' ? {} : {CLIFY_HOME}),
	};
	const t0 = Date.now();
	const out = fs.createWriteStream(path.join(dir, 'transcript.jsonl'));
	const child = spawn('claude', args, {cwd: path.join(dir, 'work'), env, stdio: ['ignore', 'pipe', 'pipe']});
	let buf = '';
	const lines = [];
	child.stdout.on('data', (d) => {
		buf += d;
		const parts = buf.split('\n');
		buf = parts.pop();
		for (const l of parts) {
			if (!l.trim()) continue;
			const rec = {ms: Date.now() - t0, line: l};
			lines.push(rec);
			out.write(JSON.stringify(rec) + '\n');
		}
	});
	child.stderr.on('data', (d) => fs.appendFileSync(path.join(dir, 'stderr.log'), d));
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill('SIGTERM');
	}, LIMITS[mode].ms);
	const code = await new Promise((r) => child.on('close', (c) => r(c ?? 1)));
	clearTimeout(timer);
	const wallMs = Date.now() - t0;
	out.end();
	if (host) host.kill('SIGTERM');

	const objs = lines.map((l) => ({ms: l.ms, o: (() => {
		try {
			return JSON.parse(l.line);
		} catch {
			return null;
		}
	})()})).filter((x) => x.o);
	const result = [...objs].reverse().find((x) => x.o.type === 'result')?.o;
	const models = new Set();
	const events = [];
	const pending = new Map();
	for (const {ms, o} of objs) {
		if (o.type === 'system' && o.subtype === 'init') events.push({ms, kind: 'init', tools: (o.tools || []).length, model: o.model});
		if (o.type === 'assistant') {
			if (o.message?.model) models.add(o.message.model);
			for (const c of o.message?.content || []) {
				if (c.type === 'text' && c.text.trim()) events.push({ms, kind: 'text', text: c.text.trim().slice(0, 600)});
				if (c.type === 'tool_use') {
					const e = {ms, kind: 'tool', id: c.id, name: c.name, input: c.input};
					events.push(e);
					pending.set(c.id, e);
				}
			}
		}
		if (o.type === 'user') {
			for (const c of o.message?.content || []) {
				if (c.type !== 'tool_result') continue;
				const e = pending.get(c.tool_use_id);
				if (!e) continue;
				const txt = Array.isArray(c.content) ? c.content.map((x) => x.text || (x.type === 'image' ? '[image]' : '')).join('\n') : String(c.content ?? '');
				e.endMs = ms;
				e.isError = !!c.is_error;
				e.resultChars = txt.length;
				e.result = txt.slice(0, 1500);
			}
		}
	}
	const text = result?.result ?? events.filter((e) => e.kind === 'text').map((e) => e.text).join('\n');
	const answer = ([...String(text).matchAll(/^\s*\**ANSWER\**\s*:\s*(.+)$/gim)].pop() || [])[1]?.trim() ?? '';
	const u = result?.usage || {};
	const tokens = {input: u.input_tokens || 0, output: u.output_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0};
	tokens.total = tokens.input + tokens.output + tokens.cacheWrite + tokens.cacheRead;
	const modelOk = [...models].length > 0 && [...models].every((m) => m.startsWith(MODEL));
	const invalid = !modelOk || code !== 0 && !result ? true : false;
	const g = grade(answer, truth);
	const rec = {
		task: task.id, site: task.site, mode, trial, tag,
		ok: g.ok && !invalid && !timedOut,
		why: timedOut ? 'timed out' : invalid ? `invalid run (models ${[...models].join(',')}, exit ${code})` : g.why,
		answer, expected: truth, wallMs, apiMs: result?.duration_api_ms ?? null, turns: result?.num_turns ?? null,
		toolCalls: events.filter((e) => e.kind === 'tool').length, tokens, costUsd: result?.total_cost_usd ?? null,
		models: [...models], exitCode: code, timedOut, subtype: result?.subtype ?? null, startedAt: new Date(t0).toISOString(),
	};
	fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify(events, null, 1));
	fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(rec, null, 1));
	console.log(`${rec.ok ? 'PASS' : 'FAIL'} ${task.id} ${mode}#${trial} ${(wallMs / 1000).toFixed(1)}s turns=${rec.turns} tools=${rec.toolCalls} tok=${tokens.total} $${rec.costUsd?.toFixed?.(3)} ${rec.why} | ${answer.slice(0, 120)}`);
	return rec;
};

const chosen = [...TASKS, ...HARD].filter((t) => (A.includes('--hard') ? HARD.includes(t) : true)).filter((t) => !taskIds || taskIds.includes(t.id));
const jobs = [];
for (const t of chosen) {
	let truth;
	try {
		truth = truthFrom === 'fetch' ? await CHECKS[t.id]() : await t.truth(clify);
	} catch (e) {
		console.log(`SKIP ${t.id}: ground truth failed: ${e.message}`);
		continue;
	}
	fs.mkdirSync(path.join(HERE, 'runs', tag, t.id), {recursive: true});
	fs.writeFileSync(path.join(HERE, 'runs', tag, t.id, 'truth.json'), JSON.stringify({...truth, from: truthFrom, at: new Date().toISOString()}, null, 1));
	console.log(`truth ${t.id}: ${JSON.stringify({expect: truth.expect, number: truth.number})}`);
	for (let k = 1; k <= trials; k++) for (const m of modes) jobs.push(() => runOne(t, m, k, truth));
}
const results = [];
let next = 0;
await Promise.all(
	Array.from({length: conc}, async () => {
		while (next < jobs.length) results.push(await jobs[next++]());
	}),
);
const f = path.join(HERE, 'runs', tag, `results-${Date.now()}.json`);
fs.writeFileSync(f, JSON.stringify(results, null, 1));
console.log(`wrote ${f}`);
