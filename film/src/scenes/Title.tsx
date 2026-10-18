import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {SceneFade, Wordmark} from '../components/ui';
import {C, MONO, SANS, lerp, pop, soft} from '../theme';

const STEPS = ['record', 'replay', 'hand off', 'held writes', 'stops at CAPTCHAs'];

export const Title: React.FC = () => {
	const frame = useCurrentFrame();
	const s = pop(frame, 2, 30, 16, 0.8);
	const t = soft(frame, 14);
	return (
		<SceneFade inF={6} outF={14}>
			<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
				<div style={{transform: `scale(${0.86 + 0.14 * s})`, opacity: Math.min(1, s * 1.4), filter: `blur(${(1 - Math.min(1, s)) * 8}px)`}}>
					<Wordmark size={150} />
				</div>
				<div style={{marginTop: 34, fontFamily: SANS, fontSize: 44, fontWeight: 600, color: C.text, letterSpacing: -1, opacity: t, transform: `translateY(${(1 - t) * 14}px)`}}>
					Websites as CLIs and MCP tools for agents.
				</div>
				<div style={{marginTop: 40, display: 'flex', gap: 14}}>
					{STEPS.map((w, i) => {
						const o = soft(frame, 28 + i * 5);
						return (
							<div key={w} style={{display: 'flex', alignItems: 'center', gap: 14, opacity: o, transform: `translateY(${(1 - o) * 10}px)`}}>
								<div style={{fontFamily: MONO, fontSize: 22, color: C.dim, padding: '7px 14px', border: `1px solid ${C.line2}`, borderRadius: 8}}>{w}</div>
								{i < STEPS.length - 1 ? <div style={{color: C.dimmer, fontFamily: MONO, fontSize: 20, opacity: lerp(frame, 30 + i * 5, 40 + i * 5, 0, 1)}}>·</div> : null}
							</div>
						);
					})}
				</div>
			</AbsoluteFill>
		</SceneFade>
	);
};
