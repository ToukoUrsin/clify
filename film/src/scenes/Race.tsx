import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {bench, MODE_LABEL, MODE_SUB, type BRun, type Mode} from '../bench';
import {Check, Cross} from '../components/Glyphs';
import {SceneFade} from '../components/ui';
import {C, MONO, SANS, clamp, lerp, pop, soft} from '../theme';
import {FF, FFBadge} from './Struggle';

const FPS = 30;
const START = 50;
const MODES: Mode[] = ['browser-ui', 'browser', 'cli'];
const COLOR: Record<Mode, string> = {'browser-ui': '#9AA1AE', browser: '#5E6573', cli: C.green};

const LABEL: Record<string, string> = {
	'books-mystery-max': 'most expensive Mystery book',
	'books-travel-over-40': 'Travel books over £40',
	'quotes-humor-author': 'first “humor” quote: author’s birthday',
	'quotes-love-count': 'quotes tagged “love”',
	'scrapethis-oscar-2012': '2012 Best Picture + awards',
	'scrapethis-hockey-detroit-1995': 'Red Wings wins, 1995',
	'webscraper-laptop-max': 'most expensive laptop',
	'endoflife-ubuntu-2204': 'Ubuntu 22.04 end of support',
	'homebrew-ffmpeg': 'ffmpeg version + license',
	'crates-tokio': 'tokio version + license',
	'hex-phoenix': 'phoenix version + license',
	'debian-nginx-bookworm': 'nginx in bookworm',
	'github-playwright-release': 'Playwright latest release',
	'nodejs-latest-lts': 'newest Node.js LTS',
	'quotes-top-author': 'author with most quotes (10 pages)',
	'hockey-best-1990': 'most wins in 1990 (24 pages)',
	'books-cheapest-first-5-pages': 'cheapest of 100 books (5 pages)',
	'github-playwright-releases-2026': 'releases in 2026 (of last 20)',
	'ubuntu-lts-supported': 'Ubuntu LTS still supported',
	'crates-serde-vs-tokio': 'serde vs tokio downloads',
};
const HOST: Record<string, string> = {books: 'books.toscrape.com', quotes: 'quotes.toscrape.com', scrapethis: 'scrapethissite.com', webscraper: 'webscraper.io', endoflife: 'endoflife.date', homebrew: 'formulae.brew.sh', crates: 'crates.io', hex: 'hex.pm', debian: 'packages.debian.org', github: 'github.com', nodejs: 'nodejs.org'};

// The race shows trial 1 of every task in every mode.
export const raceRuns = () => {
	const pick = (task: string, mode: Mode) =>
		bench.runs.filter((r) => r.task === task && r.mode === mode && r.trial === 1 && (mode !== 'browser-ui' || r.tag === 'ui'))[0];
	const tasks = [...new Set(bench.runs.map((r) => r.task))];
	return tasks.map((t) => ({task: t, site: bench.runs.find((r) => r.task === t)!.site, runs: Object.fromEntries(MODES.map((m) => [m, pick(t, m)])) as Record<Mode, BRun>}));
};

export const raceDur = (ff = FF, hold = 110) => {
	const maxS = Math.max(...raceRuns().flatMap((r) => MODES.map((m) => (r.runs[m]?.wallMs ?? 0) / 1000)));
	return Math.round(START + (maxS * FPS) / ff + hold);
};

export const Race: React.FC<{ff?: number}> = ({ff = FF}) => {
	const frame = useCurrentFrame();
	const rows = raceRuns().sort((a, b) => (b.runs['browser-ui']?.wallMs ?? 0) - (a.runs['browser-ui']?.wallMs ?? 0));
	const maxS = Math.max(...rows.flatMap((r) => MODES.map((m) => (r.runs[m]?.wallMs ?? 0) / 1000)));
	const axisS = Math.ceil(maxS / 10) * 10;
	const t = Math.max(0, ((frame - START) * ff) / FPS);
	const L = 520;
	const trackW = 1920 - L - 140;
	const xOf = (s: number) => L + (Math.min(s, axisS) / axisS) * trackW;
	const top = 268;
	const rowH = (1008 - top) / rows.length;
	const barH = Math.min(9, (rowH - 8) / 3);

	const counters = MODES.map((m) => {
		const rs = rows.map((r) => r.runs[m]).filter(Boolean);
		const fin = rs.filter((r) => r.wallMs / 1000 <= t);
		return {m, n: rs.length, fin: fin.length, ok: fin.filter((r) => r.ok).length};
	});

	return (
		<SceneFade>
			<AbsoluteFill style={{fontFamily: SANS}}>
				<div style={{position: 'absolute', left: 120, top: 48, opacity: soft(frame, 2)}}>
					<div style={{fontSize: 44, fontWeight: 700, color: C.text, letterSpacing: -1.1}}>
						{rows.length} real tasks on {new Set(rows.map((r) => r.site)).size} sites, three ways
					</div>
					<div style={{fontSize: 21, color: C.dim, marginTop: 6}}>Each bar is one Claude Code run, from prompt to final answer. Green check = answer graded correct against the live site.</div>
				</div>
				<FFBadge x={1600} y={58} ff={ff} />
				{/* counters */}
				<div style={{position: 'absolute', left: 120, top: 158, display: 'flex', gap: 60}}>
					{counters.map((c) => (
						<div key={c.m} style={{display: 'flex', alignItems: 'center', gap: 14, opacity: soft(frame, 10)}}>
							<div style={{width: 16, height: 16, borderRadius: 4, background: COLOR[c.m]}} />
							<div>
								<div style={{fontSize: 22, fontWeight: 650, color: c.m === 'cli' ? C.green : C.text}}>
									{MODE_LABEL[c.m]} <span style={{fontWeight: 400, color: C.dim, fontSize: 18}}>{MODE_SUB[c.m]}</span>
								</div>
								<div style={{fontFamily: MONO, fontSize: 19, color: C.dim, fontVariantNumeric: 'tabular-nums'}}>
									finished {String(c.fin).padStart(2, ' ')}/{c.n} · correct <span style={{color: C.green}}>{c.ok}</span>
								</div>
							</div>
						</div>
					))}
				</div>
				{/* axis */}
				{Array.from({length: axisS / 10 + 1}).map((_, i) => (
					<div key={i} style={{position: 'absolute', left: xOf(i * 10), top: top - 26, bottom: 36, width: 1, background: i ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.15)'}}>
						<div style={{position: 'absolute', top: -2, left: 6, fontFamily: MONO, fontSize: 14, color: C.dimmer}}>{i * 10}s</div>
					</div>
				))}
				{/* playhead */}
				{t <= axisS ? <div style={{position: 'absolute', left: xOf(t), top: top - 30, bottom: 30, width: 2, background: C.accent, opacity: 0.6, boxShadow: `0 0 12px ${C.accent}`}} /> : null}
				{rows.map((r, i) => {
					const y = top + i * rowH;
					const o = lerp(frame, 6 + i * 1.2, 16 + i * 1.2, 0, 1);
					return (
						<div key={r.task} style={{opacity: o}}>
							<div style={{position: 'absolute', left: 120, top: y, width: L - 140, height: rowH, display: 'flex', flexDirection: 'column', justifyContent: 'center', whiteSpace: 'nowrap', overflow: 'hidden'}}>
								<div style={{fontSize: 17, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis'}}>{LABEL[r.task] ?? r.task}</div>
								<div style={{fontFamily: MONO, fontSize: 12.5, color: C.dimmer}}>{HOST[r.site] ?? r.site}</div>
							</div>
							{MODES.map((m, k) => {
								const run = r.runs[m];
								if (!run) return null;
								const s = run.wallMs / 1000;
								const cur = Math.min(t, s);
								const done = t >= s;
								const doneF = START + (s * FPS) / ff;
								const p = pop(frame, doneF, 30, 12, 0.6);
								const by = y + (rowH - (barH * 3 + 6)) / 2 + k * (barH + 3);
								return (
									<React.Fragment key={m}>
										<div style={{position: 'absolute', left: L, top: by, height: barH, width: Math.max(0, xOf(cur) - L), borderRadius: barH / 2, background: COLOR[m], opacity: done ? 0.95 : 0.75}} />
										{done ? (
											<div style={{position: 'absolute', left: xOf(s) + 4, top: by + barH / 2 - 8, transform: `scale(${p})`, display: 'flex', alignItems: 'center', gap: 4}}>
												{run.ok ? <Check size={16} color={C.green} stroke={4} /> : <Cross size={16} color={C.red} stroke={4} />}
												{m === 'cli' || k === 0 ? <span style={{fontFamily: MONO, fontSize: 11.5, color: m === 'cli' ? C.green : C.dim}}>{s.toFixed(0)}s</span> : null}
											</div>
										) : null}
									</React.Fragment>
								);
							})}
						</div>
					);
				})}
				<div style={{position: 'absolute', left: 120, bottom: 22, fontSize: 16, color: C.dimmer, opacity: interpolate(frame, [30, 50], [0, 1], clamp)}}>
					Claude Code -p, model {bench.model.join(', ')}, fresh headless session per run · trial 1 of each task shown · {bench.source.replace('~/clify-demo/', '')}
				</div>
			</AbsoluteFill>
		</SceneFade>
	);
};
