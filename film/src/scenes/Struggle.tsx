import React from 'react';
import {AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {bench, type HeroRun} from '../bench';
import {ClaudeCode} from '../components/ClaudeCode';
import {Check, FastForward} from '../components/Glyphs';
import {SceneFade} from '../components/ui';
import {C, MONO, SANS, fmtTokens, lerp, pop, soft} from '../theme';

export const HERO = 'quotes-top-author';
export const FF = 4; // fast-forward factor, shown on screen
const FPS = 30;

export const heroRun = (mode: 'browser-ui' | 'cli') => bench.heroes[HERO][mode] as HeroRun;
export const heroTask = () => heroRun('cli').prompt.split('\n\nStart from')[0];

// live counters for a run at run-second t
export const statsAt = (run: HeroRun, t: number) => {
	const tools = run.events.filter((e) => e.kind === 'tool' && e.ms / 1000 <= t).length; // all tool calls, as in the run's result.json
	let tok = 0;
	for (const p of run.tokensOverTime) if (p.ms / 1000 <= t) tok = p.total;
	// at the end show the API's own usage total for the run
	if (t >= run.wallMs / 1000) tok = run.tokens.total;
	return {tools, tok};
};

export const Stat: React.FC<{label: string; value: string; color?: string; w?: number}> = ({label, value, color = C.text, w = 190}) => (
	<div style={{width: w}}>
		<div style={{fontFamily: MONO, fontSize: 40, fontWeight: 700, color, letterSpacing: -1, fontVariantNumeric: 'tabular-nums'}}>{value}</div>
		<div style={{fontFamily: SANS, fontSize: 17, color: C.dim, marginTop: -2}}>{label}</div>
	</div>
);

export const FFBadge: React.FC<{x: number; y: number; ff?: number}> = ({x, y, ff = FF}) => (
	<div style={{position: 'absolute', left: x, top: y, display: 'flex', alignItems: 'center', gap: 8, fontFamily: MONO, fontSize: 18, color: C.dim, padding: '6px 12px', border: `1px solid ${C.line2}`, borderRadius: 8}}>
		<FastForward size={16} color={C.dim} /> {ff}× speed · real timings
	</div>
);

export const Struggle: React.FC<{ff?: number; typeAt?: number; kicker?: string; ccH?: number; foot?: string; footY?: number}> = ({ff = FF, typeAt = 18, kicker = 'Claude Code + a browser · real run', ccH = 830, foot, footY}) => {
	const frame = useCurrentFrame();
	const run = heroRun('browser-ui');
	const promptText = heroTask();
	const submit = typeAt + Math.ceil(promptText.length / 4) + 4;
	const sToF = (s: number) => submit + (s * FPS) / ff;
	const fToS = (f: number) => ((f - submit) * ff) / FPS;
	const t = Math.min(run.wallMs / 1000, Math.max(0, fToS(frame)));
	const done = frame >= sToF(run.wallMs / 1000);
	const {tools, tok} = statsAt(run, t);
	const v = run.video!;
	const url = [...v.urls].reverse().find((u) => u.s <= t)?.url ?? 'about:blank';
	const bw = 880;
	const vh = (bw * v.h) / v.w;
	const endF = sToF(run.wallMs / 1000);
	const fin = pop(frame, endF + 2);
	const head = soft(frame, 2);

	return (
		<SceneFade inF={6}>
			<AbsoluteFill>
				<div style={{position: 'absolute', left: 60, top: 44, fontFamily: SANS, opacity: head}}>
					<div style={{fontSize: 20, fontWeight: 600, letterSpacing: 1.4, color: C.dim, textTransform: 'uppercase'}}>{kicker}</div>
					<div style={{fontSize: 40, fontWeight: 700, color: C.text, letterSpacing: -1, marginTop: 6, maxWidth: 1500}}>“{promptText.replace(/^On Quotes to Scrape \(quotes\.toscrape\.com\), /, '').replace(/^./, (c) => c.toUpperCase())}”</div>
				</div>
				<div style={{position: 'absolute', left: 60, top: 196}}>
					<ClaudeCode run={run} width={880} height={ccH} fontSize={15} title="claude — playwright mcp (headless)" sToF={sToF} fToS={fToS} typeAt={typeAt} showPrompt={promptText} />
				</div>
				<div style={{position: 'absolute', left: 980, top: 196, width: bw, borderRadius: 14, overflow: 'hidden', border: `1px solid ${C.line2}`, background: '#1A1C22', boxShadow: '0 50px 120px rgba(0,0,0,0.55)'}}>
					<div style={{height: 42, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 8, borderBottom: `1px solid ${C.line}`}}>
						{['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
							<div key={c} style={{width: 11, height: 11, borderRadius: 6, background: c, opacity: 0.85}} />
						))}
						<div style={{marginLeft: 12, flex: 1, height: 26, borderRadius: 7, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', padding: '0 12px', fontFamily: MONO, fontSize: 14, color: '#C9CDD6', whiteSpace: 'nowrap', overflow: 'hidden'}}>{url.replace(/^https?:\/\//, '')}</div>
						<div style={{fontFamily: SANS, fontSize: 12, fontWeight: 600, letterSpacing: 0.6, color: C.dim, padding: '3px 8px', border: `1px solid ${C.line2}`, borderRadius: 6}}>HEADLESS</div>
					</div>
					<div style={{width: bw, height: vh, background: '#fff', position: 'relative'}}>
						<Sequence from={Math.round(submit)} layout="none">
							<OffthreadVideo src={staticFile(v.src)} playbackRate={ff} muted style={{width: bw, height: vh, display: 'block'}} />
						</Sequence>
					</div>
				</div>
				<div style={{position: 'absolute', left: 980, top: 196 + 42 + vh + 40, display: 'flex', gap: 30}}>
					<Stat label="seconds (real)" value={t.toFixed(1)} color={done ? C.text : C.text} />
					<Stat label="tool calls" value={String(tools)} />
					<Stat label="tokens processed" value={fmtTokens(tok)} w={240} />
				</div>
				<FFBadge x={980} y={196 + 42 + vh + 150} ff={ff} />
				{done ? (
					<div style={{position: 'absolute', left: 980, top: 196 + 42 + vh + 210, display: 'flex', alignItems: 'center', gap: 14, transform: `scale(${fin})`, transformOrigin: '0 50%', fontFamily: SANS, fontSize: 26, color: C.text}}>
						<div style={{width: 38, height: 38, borderRadius: 19, background: C.greenSoft, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
							<Check size={26} color={C.green} />
						</div>
						Correct: <span style={{fontWeight: 700}}>{run.answer}</span>
					</div>
				) : null}
				<div style={{position: 'absolute', left: 980, ...(footY ? {top: footY} : {bottom: 44}), width: 880, fontFamily: SANS, fontSize: 19, color: C.dimmer, opacity: lerp(frame, 40, 60, 0, 1)}}>
					{foot ?? 'The slowest of our 20 benchmark tasks: 10 pages to read. Claude Code (Opus 5.5) · Playwright MCP, no page JavaScript.'}
				</div>
			</AbsoluteFill>
		</SceneFade>
	);
};

export const strugglesDur = (ff = FF, hold = 75, typeAt = 18) => {
	const run = heroRun('browser-ui');
	const submit = typeAt + Math.ceil(heroTask().length / 4) + 4;
	return Math.round(submit + ((run.wallMs / 1000) * FPS) / ff + hold);
};
