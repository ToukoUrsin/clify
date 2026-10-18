#!/usr/bin/env node
// Copies the repo's verified evidence files into film/evidence/ and parses them into
// src/data/evidence.json. Every number the film shows comes from here or src/data/capture.json.
// Usage: node scripts/import-evidence.mjs [path/to/clify]   (default ~/clify-film-snap/clify)
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const film = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clify = process.argv[2] || path.join(os.homedir(), 'clify-film-snap/clify');
const FILES = {
	liveRun: 'test/real/last-run.txt',
	benchmark: 'test/benchmark/last-run.json',
	handoff: 'test/real/agent-handoff.md',
	smoke: 'test/smoke/last-run.txt',
};
const evDir = path.join(film, 'evidence');
fs.mkdirSync(evDir, {recursive: true});
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files = {};
for (const [k, rel] of Object.entries(FILES)) {
	const src = path.join(clify, rel);
	const dst = path.join(evDir, path.basename(path.dirname(rel)) + '-' + path.basename(rel));
	fs.copyFileSync(src, dst);
	files[k] = {repoPath: `clify/${rel}`, copy: path.relative(film, dst), sha256: sha(dst)};
}

const live = fs.readFileSync(path.join(clify, FILES.liveRun), 'utf8');
const checks = [...live.matchAll(/^(PASS|FAIL) (.+)$/gm)].map((m) => ({ok: m[1] === 'PASS', name: m[2]}));
const tally = live.match(/---- (\d+) passed, (\d+) failed/);
const ran = (live.match(/^ran (.+)$/m) || [])[1] || '';

const bench = JSON.parse(fs.readFileSync(path.join(clify, FILES.benchmark), 'utf8'));
const handoffMd = fs.readFileSync(path.join(clify, FILES.handoff), 'utf8');
const tasks = [...handoffMd.matchAll(/^## Task (\d+) — (.+)$/gm)].map((m) => ({n: +m[1], title: m[2].replace(/`/g, '')}));
const answers = [...handoffMd.matchAll(/^Answer: \*\*(.+?)\*\*/gm)].map((m) => m[1]);

const out = {
	importedAt: new Date().toISOString(),
	files,
	live: {checks, passed: +tally[1], failed: +tally[2], ran},
	bench,
	// "solved" only when the log itself states there were no failures
	handoff: {tasks, answers, solved: /No failures occurred/.test(handoffMd) ? tasks.length : null},
};
fs.writeFileSync(path.join(film, 'src/data/evidence.json'), JSON.stringify(out, null, 1));
console.log(`evidence: live ${out.live.passed}/${out.live.passed + out.live.failed} (${ran}); bench clify ${bench.clify.passed}/${bench.clify.trials} p50 ${bench.clify.p50Ms}ms vs browser ${bench.directBrowser.passed}/${bench.directBrowser.trials} p50 ${bench.directBrowser.p50Ms}ms; handoff ${tasks.length} tasks`);
