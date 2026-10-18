import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Browser, type Shot} from '../components/Browser';
import {Seq, Terminal} from '../components/Terminal';
import {Chapter, SceneFade} from '../components/ui';
import {logLines, shots, step, stdoutLines} from '../data';
import {C, MONO, SANS, lerp, pop} from '../theme';

const FPS = 30;
// reCAPTCHA widget box on Google's public demo page (1440x900 screenshot, measured from captcha-0.png)
const BOX = {x: 33, y: 336, w: 303, h: 76};

export const Captcha: React.FC = () => {
	const frame = useCurrentFrame();
	const cap = step('captcha');
	const logs = logLines('captcha');
	const seq = new Seq(18).cmd(cap.cmd, 2.6, 4);
	const t0 = seq.t;
	logs.forEach((l, i) => seq.at(t0 + Math.round(l.t * FPS) + i * 6).out(l.text, 'log', 1, {icon: l.icon}));
	const stopAt = t0 + Math.round(logs.find((l) => l.icon === 'stop')!.t * FPS) + 6;
	seq.at(Math.max(seq.t + 4, t0 + Math.round((cap.ms / 1000) * FPS)));
	stdoutLines('captcha').forEach((l) => seq.out(l, 'json', 1, {hl: false}));
	seq.wait(2).out(`exit ${cap.exit} · the scripted click never ran`, 'warn');

	const sh: Shot[] = [{src: 'shots/captcha-0.png', url: shots.flows.captcha.url, at: 0}];
	const ring = pop(frame, stopAt, 30, 12, 0.7);
	const pulse = 0.5 + 0.5 * Math.sin((frame - stopAt) / 5);

	return (
		<SceneFade>
			<AbsoluteFill>
				<Chapter n="04" title="A CAPTCHA means stop" sub="clify never solves CAPTCHAs or works around bot checks. It stops the flow and reports it." />
				<div style={{position: 'absolute', left: 120, top: 268}}>
					<Browser width={840} shots={sh} zoom={[{at: 0, s: 2.1, x: 190, y: 250}]} label="headless">
						{frame >= stopAt ? (
							<>
								<div
									style={{
										position: 'absolute',
										left: BOX.x - 8,
										top: BOX.y - 8,
										width: BOX.w + 16,
										height: BOX.h + 16,
										borderRadius: 8,
										border: `3px solid ${C.amber}`,
										boxShadow: `0 0 ${10 + pulse * 14}px ${C.amber}88`,
										transform: `scale(${0.9 + 0.1 * ring})`,
										opacity: Math.min(1, ring),
									}}
								/>
								<div style={{position: 'absolute', left: BOX.x + BOX.w + 22, top: BOX.y + 18, fontFamily: MONO, fontWeight: 700, fontSize: 16, color: C.amber, background: '#1A1408EE', border: `2px solid ${C.amber}`, borderRadius: 7, padding: '5px 9px', opacity: Math.min(1, ring)}}>STOP</div>
							</>
						) : null}
					</Browser>
				</div>
				<div style={{position: 'absolute', left: 1000, top: 268}}>
					<Terminal lines={seq.lines} width={800} height={600} fontSize={16.5} title="clify record" />
				</div>
				<div style={{position: 'absolute', left: 120, top: 868, width: 840, fontFamily: SANS, fontSize: 22, color: C.dim, lineHeight: 1.45, opacity: lerp(frame, stopAt + 10, stopAt + 24, 0, 1)}}>
					Google's public reCAPTCHA demo page. clify saw the challenge, touched nothing, and exited with the blocker named.
				</div>
			</AbsoluteFill>
		</SceneFade>
	);
};
