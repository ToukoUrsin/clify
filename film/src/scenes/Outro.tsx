import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {SceneFade, Wordmark} from '../components/ui';
import {C, MONO, SANS, pop, soft} from '../theme';

const PROOF_END = 0;

export const Outro: React.FC = () => {
	const frame = useCurrentFrame();
	const f = frame - PROOF_END;
	const s = pop(f, 4, 30, 16, 0.8);
	const t = soft(f, 16);
	const u = soft(f, 30);
	return (
		<SceneFade inF={10} outF={20}>
			{f >= 0 ? (
				<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', fontFamily: SANS}}>
					<div style={{transform: `scale(${0.88 + 0.12 * s})`, opacity: Math.min(1, s * 1.4)}}>
						<Wordmark size={130} />
					</div>
					<div style={{marginTop: 30, fontSize: 40, fontWeight: 600, color: C.text, letterSpacing: -0.8, opacity: t}}>Give your agent the website as a CLI.</div>
					<div style={{marginTop: 34, display: 'flex', gap: 16, opacity: u}}>
						{['clify <site> <command>', 'clify mcp'].map((c) => (
							<div key={c} style={{fontFamily: MONO, fontSize: 26, color: C.text, padding: '12px 20px', borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.line2}`}}>
								<span style={{color: C.accent, fontWeight: 700}}>$ </span>
								{c}
							</div>
						))}
					</div>
					<div style={{position: 'absolute', bottom: 120, fontSize: 21, color: C.dim, opacity: soft(f, 44), textAlign: 'center', lineHeight: 1.6}}>
						Tested on public, read-only sites · specs hand-written from recordings · writes need confirmation · no CAPTCHA solving
					</div>
					<div style={{position: 'absolute', bottom: 64, fontSize: 22, color: C.text, fontWeight: 600, letterSpacing: 0.2, opacity: soft(f, 52)}}>
						Built at YC · Make Something Agents Want
					</div>
				</AbsoluteFill>
			) : null}
		</SceneFade>
	);
};
