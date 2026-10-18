import React from 'react';
import {AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {agg, bench, fmtX, MODE_LABEL, MODE_SUB, type Mode} from './bench';
import {Browser, type CursorKey, type Shot} from './components/Browser';
import {ClaudeCode} from './components/ClaudeCode';
import {Check} from './components/Glyphs';
import {Seq, Terminal, prettyLines} from './components/Terminal';
import {Backdrop, Caption, Grain, Pill, SceneFade, Vignette, Wordmark} from './components/ui';
import {logLines, shots, step, stdoutLines} from './data';
import vo from './data/vo.json';
import {Race, raceRuns} from './scenes/Race';
import {Record} from './scenes/Record';
import {FFBadge, Stat, Struggle, heroRun, heroTask, statsAt} from './scenes/Struggle';
import {C, MONO, SANS, clamp, fmtTokens, pop, soft} from './theme';

// Primary judge cut, 72 s. Frame plan (30 fps):
//   0-3 s hook · 3-10 browser struggle · 10-30 clify CLI/MCP real flow · 30-45 benchmark (exact n)
//   45-58 held write + CAPTCHA stop · 58-72 value line + CTA
const FPS = 30;
const S = {hook: 90, struggle: 210, cliRun: 240, record: 180, mcp: 180, race: 330, results: 120, safety: 390, cta: 420};
export const PRIMARY_DUR = Object.values(S).reduce((a, b) => a + b, 0);

const ui = () => heroRun('browser-ui');
const cli = () => heroRun('cli');
const toolsOf = (r: ReturnType<typeof ui>) => statsAt(r, 1e9).tools;
const HERO_SCOPE = 'One real task on quotes.toscrape.com · Claude Code (Opus 5.5) · trial 1 of each mode';

// ---------- 0-3 s: outcome hook ----------
const Hook: React.FC = () => {
	const frame = useCurrentFrame();
	const b = ui();
	const c = cli();
	const a = pop(frame, 4, 30, 16, 0.8);
	const s2 = soft(frame, 16);
	return (
		<SceneFade inF={4} outF={10}>
			<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', fontFamily: SANS}}>
				<div style={{fontSize: 30, color: C.dim, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase', opacity: s2, marginBottom: 18}}>Same question, same model, same answer</div>
				<div style={{fontSize: 96, fontWeight: 780, color: C.text, letterSpacing: -3.5, transform: `scale(${0.92 + 0.08 * a})`, opacity: Math.min(1, a * 1.5)}}>
					<span style={{color: C.green}}>{fmtX(b.wallMs / c.wallMs)}</span> faster · <span style={{color: C.green}}>{fmtX(b.tokens.total / c.tokens.total)}</span> fewer tokens
				</div>
				<div style={{fontSize: 24, color: C.dim, marginTop: 22, opacity: s2}}>with clify instead of a browser · {HERO_SCOPE}</div>
			</AbsoluteFill>
		</SceneFade>
	);
};

// ---------- 10-18 s: the same task with clify ----------
const CLI_FF = 3;
const CliRun: React.FC = () => {
	const frame = useCurrentFrame();
	const b = ui();
	const c = cli();
	const START = 12;
	const sToF = (s: number) => START + (s * FPS) / CLI_FF;
	const fToS = (f: number) => ((f - START) * CLI_FF) / FPS;
	const t = Math.min(c.wallMs / 1000, Math.max(0, fToS(frame)));
	const done = frame >= sToF(c.wallMs / 1000);
	const {tools, tok} = statsAt(c, t);
	const p = pop(frame, sToF(c.wallMs / 1000) + 1, 30, 12, 0.7);
	return (
		<SceneFade inF={8}>
			<AbsoluteFill style={{fontFamily: SANS}}>
				<div style={{position: 'absolute', left: 60, top: 48, fontSize: 40, fontWeight: 700, color: C.text, letterSpacing: -1}}>Same task. This time the site is a CLI.</div>
				<FFBadge x={1560} y={58} ff={CLI_FF} />
				<div style={{position: 'absolute', left: 60, top: 150}}>
					<ClaudeCode run={c} width={1100} height={800} fontSize={16} title="claude — bash + clify (headless)" sToF={sToF} fToS={fToS} typeAt={-200} showPrompt={heroTask()} />
				</div>
				<div style={{position: 'absolute', left: 1220, top: 160, width: 640}}>
					<div style={{fontSize: 20, fontWeight: 650, color: C.green, letterSpacing: 1, textTransform: 'uppercase'}}>clify · live</div>
					<div style={{display: 'flex', gap: 26, marginTop: 10}}>
						<Stat label="seconds (real)" value={t.toFixed(1)} color={done ? C.green : C.text} w={180} />
						<Stat label="tool calls" value={String(tools)} w={140} />
						<Stat label="tokens" value={fmtTokens(tok)} w={180} />
					</div>
					<div style={{marginTop: 48, fontSize: 20, fontWeight: 650, color: C.dim, letterSpacing: 1, textTransform: 'uppercase'}}>browser run, same task</div>
					<div style={{display: 'flex', gap: 26, marginTop: 10, opacity: 0.85}}>
						<Stat label="seconds (real)" value={(b.wallMs / 1000).toFixed(1)} w={180} />
						<Stat label="tool calls" value={String(toolsOf(b))} w={140} />
						<Stat label="tokens" value={fmtTokens(b.tokens.total)} w={180} />
					</div>
					{done ? (
						<div style={{marginTop: 54, display: 'flex', alignItems: 'center', gap: 14, transform: `scale(${p})`, transformOrigin: '0 50%', fontSize: 28, color: C.text}}>
							<div style={{width: 44, height: 44, borderRadius: 22, background: C.greenSoft, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
								<Check size={30} color={C.green} />
							</div>
							<span>
								Both correct: <b>{c.answer}</b>
							</span>
						</div>
					) : null}
				</div>
				<Caption text="Real run: Claude Code reads `clify quotes` help, fetches all pages as JSON, counts in the shell." at={14} until={S.cliRun - 6} />
			</AbsoluteFill>
		</SceneFade>
	);
};

// ---------- 24-30 s: same commands over CLI and MCP ----------
const Mcp: React.FC = () => {
	const frame = useCurrentFrame();
	const r = step('books-mystery');
	const m = step('mcp-read');
	const [toolsLine, resLine] = m.stdout.trim().split('\n');
	const seq = new Seq(6).cmd(r.cmd, 5, 0).wait(Math.round((r.ms / 1000) * FPS));
	seq.json(stdoutLines('books-mystery'), 0.4);
	seq.out(`exit ${r.exit} · ${r.ms} ms (real time)`, 'meta');
	const seq2 = new Seq(20).cmd(`node test/smoke/mcp-smoke.mjs bin/clify books books__get-book '{"slug":"the-mysterious-affair-at-styles-hercule-poirot-1_452"}'`, 7, 0).wait(Math.round((m.ms / 1000) * FPS));
	seq2.out(toolsLine, 'dim').out(resLine.slice(0, resLine.indexOf('{')).trim(), 'dim');
	seq2.json(prettyLines(resLine.slice(resLine.indexOf('{'))), 0.4);
	return (
		<SceneFade>
			<AbsoluteFill style={{fontFamily: SANS}}>
				<div style={{position: 'absolute', left: 60, top: 48}}>
					<div style={{fontSize: 40, fontWeight: 700, color: C.text, letterSpacing: -1}}>One spec, two interfaces: CLI and MCP.</div>
					<div style={{fontSize: 22, color: C.dim, marginTop: 6}}>Real calls to books.toscrape.com from a Linux box, read-only.</div>
				</div>
				<div style={{position: 'absolute', left: 60, top: 170}}>
					<Terminal lines={seq.lines} width={880} height={720} fontSize={15} title="clify (CLI)" />
				</div>
				<div style={{position: 'absolute', left: 980, top: 170}}>
					<Terminal lines={seq2.lines} width={880} height={720} fontSize={15} title="clify mcp (MCP over stdio)" />
				</div>
				<div style={{position: 'absolute', left: 60, top: 912, display: 'flex', gap: 14, opacity: soft(frame, 100)}}>
					<Pill color={C.text}>typed params + JSON help</Pill>
					<Pill color={C.text}>--fields / --limit</Pill>
					<Pill color={C.text}>one tool per command</Pill>
					<Pill color={C.green} bg={C.greenSoft}>writes need --yes / confirm: true</Pill>
				</div>
				<Caption text="Specs are hand-written from real recordings; the same commands are served as MCP tools." at={8} until={S.mcp - 6} y={1000} />
			</AbsoluteFill>
		</SceneFade>
	);
};

// ---------- 41-45 s: results with exact n ----------
const MODES: Mode[] = ['browser-ui', 'browser', 'cli'];
const ResultsCompact: React.FC = () => {
	const frame = useCurrentFrame();
	const u = agg('browser-ui');
	const br = agg('browser');
	const c = agg('cli');
	const rows: [string, (m: Mode) => string][] = [
		['correct', (m) => `${agg(m).ok}/${agg(m).n}`],
		['median time', (m) => `${agg(m).medianSec.toFixed(1)} s`],
		['median tokens', (m) => fmtTokens(agg(m).medianTokens)],
	];
	return (
		<SceneFade inF={8} outF={10}>
			<AbsoluteFill style={{fontFamily: SANS}}>
				<div style={{position: 'absolute', left: 120, top: 70, opacity: soft(frame, 2)}}>
					<div style={{fontSize: 52, fontWeight: 750, color: C.text, letterSpacing: -1.8}}>
						{MODES.every((m) => agg(m).ok === agg(m).n && agg(m).n === c.n) ? `All three: ${c.ok}/${c.n} correct. ` : ''}clify: <span style={{color: C.green}}>{fmtX(u.medianSec / c.medianSec)} faster</span>, <span style={{color: C.green}}>{fmtX(u.medianTokens / c.medianTokens)} fewer tokens</span>
					</div>
					<div style={{fontSize: 24, color: C.dim, marginTop: 8}}>
						vs the UI-only browser agent, medians. vs Playwright with page JavaScript: {fmtX(br.medianSec / c.medianSec)} faster, {fmtX(br.medianTokens / c.medianTokens)} fewer tokens.
					</div>
				</div>
				<div style={{position: 'absolute', left: 120, top: 280, width: 1680}}>
					<div style={{display: 'flex', borderBottom: `1px solid ${C.line2}`, paddingBottom: 12}}>
						<div style={{width: 360}} />
						{MODES.map((m) => (
							<div key={m} style={{width: 440}}>
								<div style={{fontSize: 30, fontWeight: 700, color: m === 'cli' ? C.green : C.text}}>{MODE_LABEL[m]}</div>
								<div style={{fontSize: 19, color: C.dim}}>
									{MODE_SUB[m]} · n = {agg(m).n} runs
								</div>
							</div>
						))}
					</div>
					{rows.map(([k, get], i) => (
						<div key={k} style={{display: 'flex', alignItems: 'center', height: 118, borderBottom: `1px solid ${C.line}`, opacity: soft(frame, 8 + i * 6)}}>
							<div style={{width: 360, fontSize: 28, color: C.dim}}>{k}</div>
							{MODES.map((m) => (
								<div key={m} style={{width: 440, fontFamily: MONO, fontSize: 60, fontWeight: 700, letterSpacing: -2, color: m === 'cli' ? C.green : C.text}}>
									{get(m)}
								</div>
							))}
						</div>
					))}
				</div>
				<div style={{position: 'absolute', left: 120, bottom: 54, width: 1680, fontSize: 19, color: C.dimmer, lineHeight: 1.5}}>
					{bench.nTasks} read-only tasks on {bench.nSites} public sites × 2 trials per mode = {c.n} runs per mode · Claude Code -p, {bench.model.join(', ')}, fresh headless session per run · answers graded against the live site · tokens = input + cache + output (API usage) · {bench.generatedAt.slice(0, 10)}
				</div>
			</AbsoluteFill>
		</SceneFade>
	);
};

// ---------- 45-58 s: held write + CAPTCHA stop ----------
const Safety: React.FC = () => {
	const frame = useCurrentFrame();
	// left: held write
	const rec = step('record-httpbinform');
	const held = (rec.recording ?? []).find((e) => e.held)!;
	const st = shots.flows.httpbinform.steps;
	const f = (n: string) => st.find((s) => s.file === n)!;
	const [field, button] = st.filter((s) => s.target).map((s) => s.target!);
	const cx = (t: {x: number; width: number}) => t.x + t.width / 2;
	const cy = (t: {y: number; height: number}) => t.y + t.height / 2;
	const shotsW: Shot[] = [
		{src: 'shots/httpbinform-0.png', url: f('httpbinform-0.png').url, at: 0},
		{src: 'shots/httpbinform-1.png', url: f('httpbinform-1.png').url, at: 34},
		{src: 'shots/httpbinform-2-pre.png', url: f('httpbinform-2-pre.png').url, at: 52},
	];
	const cur: CursorKey[] = [
		{at: 10, x: 520, y: 260},
		{at: 30, x: cx(field), y: cy(field), click: true},
		{at: 62, x: cx(button), y: cy(button), click: true},
		{at: 100, x: cx(button) + 40, y: cy(button) + 50},
	];
	const heldAt = 66;
	const stamp = pop(frame, heldAt, 30, 12, 0.7);
	const pv = step('write-preview');
	const seqW = new Seq(80).cmd(pv.cmd, 5, 0).wait(Math.round((pv.ms / 1000) * FPS));
	const pvJson = JSON.parse(pv.stdout);
	// the real dry-run JSON, compacted to the fields that matter (preview kept verbatim on one line)
	['{', `  "ok": ${pvJson.ok},`, `  "needsConfirmation": ${pvJson.needsConfirmation},`, `  "preview": ${JSON.stringify(pvJson.preview)}`, '}'].forEach((l) => seqW.out(l, 'json', 0.6, {hl: /needsConfirmation/.test(l)}));
	seqW.out(pvJson.error, 'warn', 1);
	// right: CAPTCHA stop (starts 180 frames in)
	const R = 180;
	const cap = step('captcha');
	const logs = logLines('captcha');
	const seqC = new Seq(R + 8).cmd(cap.cmd, 6, 2);
	const t0 = seqC.t;
	logs.forEach((l, i) => seqC.at(t0 + Math.round(l.t * FPS) + i * 6).out(l.text, 'log', 1, {icon: l.icon}));
	const stopAt = t0 + Math.round(logs.find((l) => l.icon === 'stop')!.t * FPS) + 6;
	seqC.wait(4).out(`exit ${cap.exit} · the scripted click never ran`, 'warn');
	const BOX = {x: 33, y: 336, w: 303, h: 76};
	const ring = pop(frame, stopAt, 30, 12, 0.7);
	const rightIn = soft(frame, R - 10);
	return (
		<SceneFade>
			<AbsoluteFill style={{fontFamily: SANS}}>
				<div style={{position: 'absolute', left: 60, top: 44, fontSize: 40, fontWeight: 700, color: C.text, letterSpacing: -1}}>Safe by default.</div>
				{/* held write */}
				<div style={{position: 'absolute', left: 80, top: 120, width: 840}}>
					<div style={{fontSize: 26, fontWeight: 650, color: C.amber}}>Writes are held</div>
					<div style={{fontSize: 19, color: C.dim, marginTop: 4}}>Recording httpbin.org's test form: the submit POST is held, never sent.</div>
					<div style={{marginTop: 16}}>
						<Browser width={840} shots={shotsW} cursor={cur} zoom={[{at: 0, s: 1.75, x: 330, y: 200}, {at: 52, s: 1.75, x: 330, y: 440}]} label="headless">
							{frame >= heldAt ? (
								<div style={{position: 'absolute', left: button.x + button.width + 24, top: button.y - 50, transform: `scale(${stamp}) rotate(-3deg)`, transformOrigin: '0 50%', padding: '8px 14px', borderRadius: 10, border: `3px solid ${C.amber}`, background: '#1A1408EE', fontFamily: MONO, color: C.amber, fontSize: 20, fontWeight: 700, whiteSpace: 'nowrap'}}>
									HELD · {held.method} {held.url.replace(/^https:\/\//, '')}
								</div>
							) : null}
						</Browser>
					</div>
					<div style={{marginTop: 14}}>
						<Terminal lines={seqW.lines} width={840} height={210} fontSize={13.5} title="dry run" chrome={false} />
					</div>
				</div>
				{/* captcha */}
				<div style={{position: 'absolute', left: 1000, top: 120, width: 840, opacity: rightIn, transform: `translateY(${(1 - rightIn) * 20}px)`}}>
					<div style={{fontSize: 26, fontWeight: 650, color: C.amber}}>A CAPTCHA means stop</div>
					<div style={{fontSize: 19, color: C.dim, marginTop: 4}}>Google's public reCAPTCHA demo: clify reports the blocker and touches nothing.</div>
					<div style={{marginTop: 16}}>
						<Browser width={840} shots={[{src: 'shots/captcha-0.png', url: shots.flows.captcha.url, at: 0}]} zoom={[{at: 0, s: 2.1, x: 190, y: 250}]} label="headless">
							{frame >= stopAt ? (
								<div style={{position: 'absolute', left: BOX.x - 8, top: BOX.y - 8, width: BOX.w + 16, height: BOX.h + 16, borderRadius: 8, border: `3px solid ${C.amber}`, boxShadow: `0 0 ${10 + 12 * (0.5 + 0.5 * Math.sin((frame - stopAt) / 5))}px ${C.amber}88`, transform: `scale(${0.9 + 0.1 * ring})`, opacity: Math.min(1, ring)}} />
							) : null}
						</Browser>
					</div>
					<div style={{marginTop: 14}}>
						<Terminal lines={seqC.lines} width={840} height={210} fontSize={13.5} title="clify record" chrome={false} />
					</div>
				</div>
				<Caption text="No CAPTCHA solving, no bot-check evasion, no account creation. Writes send only with --yes or confirm: true." at={200} until={S.safety - 6} y={1010} />
			</AbsoluteFill>
		</SceneFade>
	);
};

// ---------- 58-72 s: value + CTA ----------
const Cta: React.FC = () => {
	const frame = useCurrentFrame();
	const s = pop(frame, 6, 30, 16, 0.8);
	const c = agg('cli');
	return (
		<SceneFade inF={10} outF={24}>
			<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', fontFamily: SANS, transform: `scale(${1 + frame * 0.00012})`}}>
				<div style={{transform: `scale(${0.88 + 0.12 * s})`, opacity: Math.min(1, s * 1.4)}}>
					<Wordmark size={140} />
				</div>
				<div style={{marginTop: 30, fontSize: 46, fontWeight: 650, color: C.text, letterSpacing: -1, opacity: soft(frame, 18)}}>Give your agent the website as a CLI.</div>
				<div style={{marginTop: 38, display: 'flex', gap: 16, opacity: soft(frame, 34)}}>
					{['clify record <url>', 'clify <site> <command>', 'clify mcp'].map((x) => (
						<div key={x} style={{fontFamily: MONO, fontSize: 27, color: C.text, padding: '12px 20px', borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.line2}`}}>
							<span style={{color: C.accent, fontWeight: 700}}>$ </span>
							{x}
						</div>
					))}
				</div>
				<div style={{marginTop: 44, display: 'flex', gap: 14, opacity: soft(frame, 60)}}>
					<Pill color={C.green} bg={C.greenSoft}>
						clify: {c.ok}/{c.n} benchmark runs correct
					</Pill>
					<Pill color={C.amber} bg={C.amberSoft}>writes held until confirmed</Pill>
					<Pill color={C.amber} bg={C.amberSoft}>CAPTCHA = stop</Pill>
				</div>
				<div style={{position: 'absolute', bottom: 70, fontSize: 24, color: C.text, fontWeight: 600, opacity: soft(frame, 80)}}>Built at YC · Make Something Agents Want</div>
			</AbsoluteFill>
		</SceneFade>
	);
};

// ---------- assembly ----------
const ORDER: [keyof typeof S, React.FC][] = [
	['hook', Hook],
	['struggle', () => <Struggle ff={8} typeAt={-38} />],
	['cliRun', CliRun],
	['record', () => <Record speed={2} />],
	['mcp', Mcp],
	['race', () => <Race ff={6} />],
	['results', ResultsCompact],
	['safety', Safety],
	['cta', Cta],
];
export const primaryStarts = () => {
	let t = 0;
	return ORDER.map(([k]) => {
		const o = {k, from: t, dur: S[k]};
		t += S[k];
		return o;
	});
};

const musicVol = (f: number) => 0.3 * interpolate(f, [0, 30], [0, 1], clamp) * interpolate(f, [PRIMARY_DUR - 75, PRIMARY_DUR - 3], [1, 0], clamp);

export const Primary: React.FC<{music?: boolean}> = ({music = true}) => {
	const starts = primaryStarts();
	return (
		<AbsoluteFill>
			<Backdrop />
			{ORDER.map(([k, Comp], i) => (
				<Sequence key={k} from={starts[i].from} durationInFrames={starts[i].dur} name={k}>
					<Comp />
				</Sequence>
			))}
			<Vignette />
			<Grain />
			{music && vo.music ? <Audio src={staticFile(vo.music)} volume={musicVol} /> : null}
		</AbsoluteFill>
	);
};

// race must fit its slot at 6x
export const raceFits = () => {
	const maxS = Math.max(...raceRuns().flatMap((r) => Object.values(r.runs).map((x) => (x?.wallMs ?? 0) / 1000)));
	return 50 + (maxS * FPS) / 6 <= S.race;
};
