import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Seq, Terminal} from '../components/Terminal';
import {Chapter, SceneFade} from '../components/ui';
import {step, stdoutLines} from '../data';
import {C, MONO, SANS, lerp, soft} from '../theme';

type Cmd = {name: string; summary: string; params?: {name: string; type: string; required?: boolean; default?: unknown; enum?: string[]}[]; writes?: boolean; example?: string};

export const Spec: React.FC = () => {
	const frame = useCurrentFrame();
	const help = step('help-books');
	const h = JSON.parse(help.stdout) as {commands: Cmd[]; usage: string};
	const seq = new Seq(20).cmd(help.cmd, 1.6, 0).wait(Math.round((help.ms / 1000) * 30));
	seq.json(stdoutLines('help-books'), 0.5);

	return (
		<SceneFade>
			<AbsoluteFill>
				<Chapter n="02" title="Turn it into a CLI" sub="A spec is written from the recording. One JSON help page; the same commands run as MCP tools (clify mcp)." />
				<div style={{position: 'absolute', left: 120, top: 268}}>
					<Terminal lines={seq.lines} width={860} height={700} fontSize={17} title="clify books" />
				</div>
				<div style={{position: 'absolute', left: 1040, top: 278, width: 760, fontFamily: SANS}}>
					<div style={{fontSize: 16, fontWeight: 600, letterSpacing: 1.2, color: C.dim, textTransform: 'uppercase', marginBottom: 18, opacity: soft(frame, 40)}}>
						books · {h.commands.length} commands
					</div>
					{h.commands.map((c, i) => {
						const at = 60 + i * 22;
						const o = soft(frame, at);
						return (
							<div
								key={c.name}
								style={{
									opacity: o,
									transform: `translateY(${(1 - o) * 18}px)`,
									padding: '20px 24px',
									marginBottom: 18,
									borderRadius: 14,
									background: 'rgba(255,255,255,0.035)',
									border: `1px solid ${C.line2}`,
								}}
							>
								<div style={{display: 'flex', alignItems: 'baseline', gap: 14}}>
									<div style={{fontFamily: MONO, fontSize: 28, fontWeight: 700, color: C.text}}>{c.name}</div>
									<div style={{fontSize: 21, color: C.dim}}>{c.summary}</div>
								</div>
								<div style={{display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap'}}>
									{(c.params ?? []).map((p, k) => (
										<div key={p.name} style={{fontFamily: MONO, fontSize: 18, color: p.required ? C.jsonKey : C.dim, padding: '5px 10px', borderRadius: 7, border: `1px solid ${p.required ? C.accent + '66' : C.line2}`, opacity: lerp(frame, at + 8 + k * 4, at + 16 + k * 4, 0, 1)}}>
											{p.name} <span style={{color: C.dimmer}}>{p.type}{p.required ? ' · required' : ''}</span>
										</div>
									))}
								</div>
							</div>
						);
					})}
					<div style={{marginTop: 10, fontSize: 21, color: C.dim, lineHeight: 1.5, opacity: soft(frame, 150)}}>
						Typed params, examples, <span style={{fontFamily: MONO, color: C.text}}>--fields</span> to trim output,{' '}
						<span style={{fontFamily: MONO, color: C.text}}>count</span> and <span style={{fontFamily: MONO, color: C.text}}>nextPage</span> for paging.
						<br />
						<span style={{color: C.dimmer}}>Today the specs are hand-written from recordings.</span>
					</div>
				</div>
			</AbsoluteFill>
		</SceneFade>
	);
};
