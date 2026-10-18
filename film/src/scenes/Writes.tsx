import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Browser, type CursorKey, type Shot} from '../components/Browser';
import {Seq, Terminal} from '../components/Terminal';
import {Chapter, Pill, SceneFade} from '../components/ui';
import {logLines, shots, step, stdoutLines} from '../data';
import {C, MONO, SANS, lerp, pop, soft} from '../theme';

const FPS = 30;

export const Writes: React.FC = () => {
	const frame = useCurrentFrame();
	const rec = step('record-httpbinform');
	const logs = logLines('record-httpbinform');
	const held = (rec.recording ?? []).find((e) => e.held)!;
	const st = shots.flows.httpbinform.steps;
	const f = (n: string) => st.find((s) => s.file === n)!;
	const [field, button] = st.filter((s) => s.target).map((s) => s.target!);

	const seq = new Seq(20).cmd(rec.cmd, 2.6, 4);
	const t0 = seq.t;
	// log timestamps are 1 s resolution; the type/click/held lines share a second, so space them a little
	const at = (i: number) => t0 + Math.round(logs[i].t * FPS) + (i > 1 ? (i - 1) * 8 : 0);
	logs.forEach((l, i) => seq.at(at(i)).out(l.text.replace(/\{"selector":.*"intent":"(.+)"\}/, '“$1”'), 'log', 1, {icon: l.icon}));
	const heldIdx = logs.findIndex((l) => l.icon === 'stop');
	const heldAt = at(heldIdx);
	const clickAt = at(heldIdx - 1);
	const typeAt = at(heldIdx - 2);

	const pv = step('write-preview');
	seq.at(Math.max(seq.t, heldAt + 60)).out('', 'blank').cmd(pv.cmd, 2.4, 0).wait(Math.round((pv.ms / 1000) * FPS));
	const pvLines = stdoutLines('write-preview');
	pvLines.forEach((l) => seq.out(l, 'json', 1, {hl: /needsConfirmation/.test(l)}));
	const pvEnd = seq.t;

	const shotsList: Shot[] = [
		{src: 'shots/httpbinform-0.png', url: f('httpbinform-0.png').url, at: 0},
		{src: 'shots/httpbinform-1.png', url: f('httpbinform-1.png').url, at: typeAt + 6},
		{src: 'shots/httpbinform-2-pre.png', url: f('httpbinform-2-pre.png').url, at: clickAt - 4},
	];
	const cx = (t: {x: number; width: number}) => t.x + t.width / 2;
	const cy = (t: {y: number; height: number}) => t.y + t.height / 2;
	const cursor: CursorKey[] = [
		{at: t0, x: 520, y: 260},
		{at: typeAt, x: cx(field), y: cy(field), click: true},
		{at: clickAt, x: cx(button), y: cy(button), click: true},
		{at: clickAt + 40, x: cx(button) + 40, y: cy(button) + 50},
	];
	const stamp = pop(frame, heldAt, 30, 12, 0.7);
	const mcp = step('mcp-write');
	const mcpHeld = /needsConfirmation":true/.test(mcp.stdout);

	return (
		<SceneFade>
			<AbsoluteFill>
				<Chapter n="03" title="Writes wait for a human" sub="Recording holds every POST. Replays show the exact request and send nothing until you confirm." />
				<div style={{position: 'absolute', left: 120, top: 268}}>
					<Browser width={840} shots={shotsList} cursor={cursor} zoom={[{at: 0, s: 1.75, x: 330, y: 330}]} label="headless">
						{frame >= heldAt ? (
							<div
								style={{
									position: 'absolute',
									left: button.x + button.width + 28,
									top: button.y - 34,
									transform: `scale(${stamp}) rotate(-3deg)`,
									transformOrigin: '0 50%',
									padding: '10px 16px',
									borderRadius: 10,
									border: `3px solid ${C.amber}`,
									background: '#1A1408EE',
									fontFamily: MONO,
									color: C.amber,
									fontSize: 20,
									fontWeight: 700,
									whiteSpace: 'nowrap',
								}}
							>
								HELD · {held.method} {held.url.replace(/^https:\/\//, '')}
								<div style={{fontSize: 15, fontWeight: 500, marginTop: 3, color: '#E8C987'}}>never sent</div>
							</div>
						) : null}
					</Browser>
				</div>
				<div style={{position: 'absolute', left: 1000, top: 268}}>
					<Terminal lines={seq.lines} width={800} height={600} fontSize={16.5} title="clify httpbinform" />
				</div>
				<div style={{position: 'absolute', left: 1000, top: 890, width: 800, display: 'flex', gap: 12, flexWrap: 'wrap', opacity: soft(frame, pvEnd + 10)}}>
					<Pill color={C.green} bg={C.greenSoft}>CLI sends only with --yes</Pill>
					{mcpHeld ? <Pill color={C.green} bg={C.greenSoft}>MCP sends only with confirm: true</Pill> : null}
				</div>
				<div style={{position: 'absolute', left: 120, top: 868, width: 840, fontFamily: SANS, fontSize: 22, color: C.dim, lineHeight: 1.45, opacity: lerp(frame, heldAt + 10, heldAt + 24, 0, 1)}}>
					The recorder clicked <span style={{color: C.text}}>Submit order</span> on httpbin.org's test form. The form POST was held in the browser: {JSON.parse(rec.stdout).heldWrites} held write, nothing sent.
				</div>
			</AbsoluteFill>
		</SceneFade>
	);
};
