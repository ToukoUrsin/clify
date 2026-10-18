#!/usr/bin/env node
/* Mean and range per metric over finished runs: node race/stats.mjs race/runs/A race/runs/B ...
   Invalid runs are listed and left out of the numbers.
   Runs are grouped by browser mode: A = "ui" (clicks + screenshots), B = "js"
   (full Playwright MCP); C = the clify racer of every valid run.
   --modes out.json also writes the per-mode means (the dashboard's footnote). */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2), oi = argv.indexOf('--modes');
const modesOut = oi >= 0 ? argv.splice(oi, 2)[1] : null;
const runs = argv.map(d => ({dir: path.basename(d), s: JSON.parse(fs.readFileSync(path.join(d, 'summary.json'), 'utf8'))}));
const valid = runs.filter(r => r.s.valid), invalid = runs.filter(r => !r.s.valid);
const n = runs[0]?.s.tasks.length || 6;
const metrics = [['time s', s => s.elapsedMs / 1000], ['fresh tokens', s => s.freshTokens], ['all tokens', s => s.totalTokens], ['cost $', s => s.costUsd],
  ['peak RAM MB', s => s.peakRamMB], ['avg CPU %', s => s.avgCpu], ['model calls', s => s.modelCalls], ['tool calls', s => s.toolCalls], ['verified', s => s.success]];
const fmt = v => Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : Number(v.toFixed(v < 1 ? 4 : 1)).toString();
const agg = xs => ({mean: xs.reduce((a, b) => a + b, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs)});
const modeOf = r => r.s.browserMode || 'js'; // round-2 runs predate the field and used the full MCP
const NAMES = {ui: 'A browser, clicks + screenshots', js: 'B browser + page JavaScript', clify: 'C clify (Bash only)'};

const lines = [`valid runs: ${valid.length} (${valid.map(r => `${r.dir} [${modeOf(r)}]`).join(', ')})`];
for (const r of invalid) lines.push(`INVALID ${r.dir} [${modeOf(r)}]: ${['browser', 'clify'].map(k => `${k} ${r.s.racers[k].invalidReason || 'ok'}`).join('; ')}`);
lines.push('', 'per run:');
const line = s => `${fmt(s.elapsedMs / 1000)}s ${fmt(s.freshTokens)} fresh ${fmt(s.totalTokens)} all $${s.costUsd.toFixed(4)} ${fmt(s.peakRamMB)}MB ${fmt(s.avgCpu)}%cpu ${s.success}/${n}`;
for (const r of valid) lines.push(`  ${r.dir} ${r.s.model} [${modeOf(r)}]: browser ${line(r.s.racers.browser)} | clify ${line(r.s.racers.clify)}`);

// Per-mode table: A and B from the browser racer, C from every clify racer.
const groups = {ui: valid.filter(r => modeOf(r) === 'ui').map(r => r.s.racers.browser), js: valid.filter(r => modeOf(r) === 'js').map(r => r.s.racers.browser), clify: valid.map(r => r.s.racers.clify)};
const cell = a => `${fmt(a.mean)} [${fmt(a.min)}-${fmt(a.max)}]`.padEnd(36);
const present = Object.keys(groups).filter(k => groups[k].length);
lines.push('', 'metric            ' + present.map(k => `${NAMES[k]} (n=${groups[k].length})`.padEnd(36)).join(''));
for (const [name, f] of metrics) lines.push(name.padEnd(18) + present.map(k => cell(agg(groups[k].map(f)))).join(''));

// Paired ratios browser/clify within each browser mode (same run, same moment).
for (const m of ['ui', 'js']) {
  const rs = valid.filter(r => modeOf(r) === m); if (!rs.length) continue;
  lines.push('', `ratio ${m === 'ui' ? 'A' : 'B'}/C, paired per run (n=${rs.length}): ` + metrics.filter(([k]) => k !== 'verified').map(([k, f]) => {
    const a = agg(rs.map(r => f(r.s.racers.browser) / Math.max(1e-9, f(r.s.racers.clify)))); return `${k} ${a.mean.toFixed(2)}x [${a.min.toFixed(2)}-${a.max.toFixed(2)}]`; }).join(' · '));
  // Representative run for replay: paired time/fresh/cost ratios closest to the means (log distance).
  const keys = [metrics[0][1], metrics[1][1], metrics[3][1]];
  const ratio = (r, f) => f(r.s.racers.browser) / Math.max(1e-9, f(r.s.racers.clify));
  const means = keys.map(f => agg(rs.map(r => ratio(r, f))).mean);
  const best = rs.map(r => ({r, d: keys.reduce((a, f, i) => a + Math.abs(Math.log(ratio(r, f) / means[i])), 0)})).sort((a, b) => a.d - b.d)[0];
  lines.push(`representative ${m} run (closest to the mean ratios): ${best.r.dir}`);
}
console.log(lines.join('\n'));

if (modesOut) {
  const mean = (xs, f) => xs.length ? xs.reduce((a, s) => a + f(s), 0) / xs.length : null;
  const sum = xs => xs.length ? {runs: xs.length, timeMs: mean(xs, s => s.elapsedMs), fresh: mean(xs, s => s.freshTokens), total: mean(xs, s => s.totalTokens), cost: mean(xs, s => s.costUsd), peakRamMB: mean(xs, s => s.peakRamMB), avgCpu: mean(xs, s => s.avgCpu), success: mean(xs, s => s.success)} : null;
  const out = {model: valid[0]?.s.model, runs: valid.map(r => r.dir), A: sum(groups.ui), B: sum(groups.js), C: sum(groups.clify)};
  for (const [k, m] of [['A', 'ui'], ['B', 'js'], ['C', 'clify']]) if (out[k]) out[k].label = NAMES[m];
  fs.writeFileSync(modesOut, JSON.stringify(out, null, 2) + '\n');
}
