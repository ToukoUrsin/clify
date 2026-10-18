import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {agg, bench, fmtX, MODE_LABEL, MODE_SUB, pct, type Mode} from '../bench';
import {SceneFade} from '../components/ui';
import {C, MONO, SANS, fmtTokens, lerp, soft} from '../theme';

const MODES: Mode[] = ['browser-ui', 'browser', 'cli'];

export const Results: React.FC = () => {
	const frame = useCurrentFrame();
	const ui = agg('browser-ui');
	const br = agg('browser');
	const cli = agg('cli');
	const rows: {k: string; get: (m: Mode) => string; best: Mode}[] = [
		{k: 'Correct answers', get: (m) => `${agg(m).ok}/${agg(m).n}`, best: 'cli'},
		{k: 'Median time per task', get: (m) => `${agg(m).medianSec.toFixed(1)} s`, best: 'cli'},
		{k: 'Median tokens processed', get: (m) => fmtTokens(agg(m).medianTokens), best: 'cli'},
		{k: 'Median API cost per task', get: (m) => `$${agg(m).medianCostUsd.toFixed(3)}`, best: 'cli'},
	];
	const h = soft(frame, 2);
	const allPerfect = MODES.every((m) => agg(m).ok === agg(m).n);
	return (
		<SceneFade>
			<AbsoluteFill style={{fontFamily: SANS}}>
				<div style={{position: 'absolute', left: 120, top: 70, opacity: h, transform: `translateY(${(1 - h) * 14}px)`}}>
					<div style={{fontSize: 60, fontWeight: 750, color: C.text, letterSpacing: -2}}>
						{allPerfect ? 'Same answers. ' : ''}
						<span style={{color: C.green}}>{fmtX(ui.medianSec / cli.medianSec)} faster.</span> <span style={{color: C.green}}>{fmtX(ui.medianTokens / cli.medianTokens)} fewer tokens.</span>
					</div>
					<div style={{fontSize: 25, color: C.dim, marginTop: 10}}>
						clify vs a browser agent working the UI (medians). Against Playwright with page JavaScript: {fmtX(br.medianSec / cli.medianSec)} faster, {fmtX(br.medianTokens / cli.medianTokens)} fewer tokens.
					</div>
				</div>
				<div style={{position: 'absolute', left: 120, top: 300, width: 1680}}>
					<div style={{display: 'flex', height: 90, alignItems: 'flex-end', borderBottom: `1px solid ${C.line2}`, paddingBottom: 14}}>
						<div style={{width: 480}} />
						{MODES.map((m, i) => (
							<div key={m} style={{width: 400, opacity: soft(frame, 14 + i * 6)}}>
								<div style={{fontSize: 30, fontWeight: 700, color: m === 'cli' ? C.green : C.text}}>{MODE_LABEL[m]}</div>
								<div style={{fontSize: 18, color: C.dim}}>{MODE_SUB[m]} · n = {agg(m).n}</div>
							</div>
						))}
					</div>
					{rows.map((r, i) => (
						<div key={r.k} style={{display: 'flex', alignItems: 'center', height: 112, borderBottom: `1px solid ${C.line}`, opacity: soft(frame, 34 + i * 10)}}>
							<div style={{width: 480, fontSize: 26, color: C.dim}}>{r.k}</div>
							{MODES.map((m) => (
								<div key={m} style={{width: 400, fontFamily: MONO, fontSize: 52, fontWeight: 700, letterSpacing: -1.5, color: m === r.best ? C.green : C.text}}>
									{r.get(m)}
								</div>
							))}
						</div>
					))}
				</div>
				<div style={{position: 'absolute', left: 120, bottom: 46, width: 1680, fontSize: 18, color: C.dimmer, lineHeight: 1.5, opacity: lerp(frame, 90, 106, 0, 1)}}>
					{bench.nTasks} tasks on {bench.nSites} public sites · Claude Code -p, {bench.model.join(', ')}, fresh headless session per run · success rate {pct(cli.rate)} / {pct(br.rate)} / {pct(ui.rate)} · tokens = input + cache + output from the API usage report · run {bench.generatedAt.slice(0, 10)} · {bench.source.replace('~/clify-demo/', '')}
				</div>
			</AbsoluteFill>
		</SceneFade>
	);
};
