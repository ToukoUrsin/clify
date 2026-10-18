import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {fmtX} from '../bench';
import {ClaudeCode} from '../components/ClaudeCode';
import {Check} from '../components/Glyphs';
import {SceneFade} from '../components/ui';
import {C, MONO, SANS, fmtTokens, lerp, pop, soft} from '../theme';
import {FFBadge, FF, heroRun, heroTask, statsAt} from './Struggle';

const FPS = 30;
const START = 40;

export const sideDur = () => Math.round(START + ((heroRun('browser-ui').wallMs / 1000) * FPS) / FF + 150);

const Lane: React.FC<{mode: 'browser-ui' | 'cli'; x: number; title: string; sub: string}> = ({mode, x, title, sub}) => {
	const frame = useCurrentFrame();
	const run = heroRun(mode);
	const sToF = (s: number) => START + (s * FPS) / FF;
	const fToS = (f: number) => ((f - START) * FF) / FPS;
	const t = Math.min(run.wallMs / 1000, Math.max(0, fToS(frame)));
	const endF = sToF(run.wallMs / 1000);
	const done = frame >= endF;
	const {tools, tok} = statsAt(run, t);
	const p = pop(frame, endF + 1, 30, 12, 0.7);
	const isCli = mode === 'cli';
	const accent = isCli ? C.green : C.text;
	return (
		<div style={{position: 'absolute', left: x, top: 150, width: 880}}>
			<div style={{display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', fontFamily: SANS, height: 110}}>
				<div>
					<div style={{fontSize: 34, fontWeight: 700, color: isCli ? C.green : C.text, letterSpacing: -0.6}}>{title}</div>
					<div style={{fontSize: 19, color: C.dim, marginTop: 4}}>{sub}</div>
				</div>
				<div style={{textAlign: 'right'}}>
					<div style={{fontFamily: MONO, fontSize: 64, fontWeight: 700, color: done ? accent : C.text, letterSpacing: -2, fontVariantNumeric: 'tabular-nums', lineHeight: 1}}>{t.toFixed(1)}s</div>
					<div style={{fontFamily: MONO, fontSize: 17, color: C.dim, marginTop: 6}}>
						{tools} tool calls · {fmtTokens(tok)} tokens
					</div>
				</div>
			</div>
			<div style={{marginTop: 18, position: 'relative'}}>
				<ClaudeCode run={run} width={880} height={640} fontSize={14} title={isCli ? 'claude — bash + clify' : 'claude — playwright mcp (headless)'} sToF={sToF} fToS={fToS} typeAt={-200} showPrompt={heroTask()} />
				{done ? (
					<div style={{position: 'absolute', inset: 0, borderRadius: 14, border: `2px solid ${accent}`, opacity: lerp(frame, endF, endF + 8, 0, 0.9), pointerEvents: 'none'}} />
				) : null}
				{done ? (
					<div style={{position: 'absolute', right: 24, top: 56, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderRadius: 12, background: 'rgba(10,12,16,0.92)', border: `1px solid ${C.green}66`, transform: `scale(${p})`, transformOrigin: '100% 0', fontFamily: SANS, fontSize: 22, color: C.text}}>
						<Check size={26} color={C.green} />
						{run.answer}
					</div>
				) : null}
			</div>
		</div>
	);
};

export const SideBySide: React.FC = () => {
	const frame = useCurrentFrame();
	const b = heroRun('browser-ui');
	const c = heroRun('cli');
	const endB = START + ((b.wallMs / 1000) * FPS) / FF;
	const pun = soft(frame, endB + 24);
	return (
		<SceneFade>
			<AbsoluteFill>
				<div style={{position: 'absolute', left: 60, top: 50, fontFamily: SANS, fontSize: 40, fontWeight: 700, color: C.text, letterSpacing: -1, opacity: soft(frame, 2)}}>Same task, same model. One gets a CLI.</div>
				<FFBadge x={1580} y={60} />
				<Lane mode="browser-ui" x={60} title="Browser" sub="Playwright MCP, clicking and reading pages" />
				<Lane mode="cli" x={980} title="clify" sub="Bash + the site's clify CLI" />
				<div style={{position: 'absolute', left: 0, right: 0, top: 960, display: 'flex', justifyContent: 'center', gap: 70, fontFamily: SANS, opacity: pun, transform: `translateY(${(1 - pun) * 16}px)`}}>
					{[
						[fmtX(b.wallMs / c.wallMs), 'faster'],
						[fmtX(b.tokens.total / c.tokens.total), 'fewer tokens'],
						[`${statsAt(b, 1e9).tools} → ${statsAt(c, 1e9).tools}`, 'tool calls'],
					].map(([big, small]) => (
						<div key={small} style={{display: 'flex', alignItems: 'baseline', gap: 12}}>
							<span style={{fontSize: 54, fontWeight: 750, color: C.green, letterSpacing: -2}}>{big}</span>
							<span style={{fontSize: 24, color: C.dim}}>{small}</span>
						</div>
					))}
					<span style={{alignSelf: 'center', fontSize: 18, color: C.dimmer}}>on this task, both answers correct</span>
				</div>
			</AbsoluteFill>
		</SceneFade>
	);
};
