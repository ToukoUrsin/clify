import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Browser, type CursorKey, type Shot} from '../components/Browser';
import {Seq, Terminal} from '../components/Terminal';
import {Chapter, SceneFade} from '../components/ui';
import {logLines, shortUrl, shots, step, stdoutLines} from '../data';
import {C, MONO, SANS, lerp} from '../theme';

const FPS_REAL = 30;

export const BOOK_FLOW = () => {
	const st = shots.flows.books.steps;
	const f = (name: string) => st.find((s) => s.file === name)!;
	return {st, f, targets: st.filter((s) => s.target)};
};


export const Record: React.FC<{speed?: number}> = ({speed = 1}) => {
	const frame = useCurrentFrame();
	const FPS = FPS_REAL / speed; // frames per run-second
	const rec = step('record-books');
	const logs = logLines('record-books');
	const entries = rec.recording ?? [];

	// command typed, then the run plays in real time from the recorder's own log timestamps
	const seq = new Seq(speed === 1 ? 26 : 8).cmd(rec.cmd, speed === 1 ? 2.4 : 4, 4);
	const t0 = seq.t;
	logs.forEach((l) => seq.at(t0 + Math.round(l.t * FPS)).out(l.text.replace(/\{"selector":.*"intent":"(.+)"\}/, '“$1”'), 'log', 1, {icon: l.icon}));
	const end = t0 + Math.round((rec.ms / 1000) * FPS);
	seq.at(end).json(stdoutLines('record-books'));
	seq.wait(1).out(`exit ${rec.exit} · ${(rec.ms / 1000).toFixed(1)} s wall time${speed === 1 ? ' (real time)' : ` (shown at ${speed}×)`}`, 'meta');

	// browser in sync with the log: click at each "→ click" line
	const clickTimes = logs.filter((l) => l.icon === 'act').map((l) => t0 + Math.round(l.t * FPS));
	const {f, targets} = BOOK_FLOW();
	const c = targets.map((t) => ({x: t.target!.x + t.target!.width / 2, y: t.target!.y + t.target!.height / 2}));
	const shotsList: Shot[] = [
		{src: 'shots/books-0.png', url: f('books-0.png').url, at: 0},
		{src: 'shots/books-1.png', url: f('books-1.png').url, at: clickTimes[0] + 8},
		{src: 'shots/books-2-pre.png', url: f('books-2-pre.png').url, at: clickTimes[0] + 16},
		{src: 'shots/books-2.png', url: f('books-2.png').url, at: clickTimes[1] + 8},
		{src: 'shots/books-3-pre.png', url: f('books-3-pre.png').url, at: clickTimes[1] + 16},
		{src: 'shots/books-3.png', url: f('books-3.png').url, at: clickTimes[2] + 8},
	];
	const cursor: CursorKey[] = [
		{at: t0, x: 700, y: 500},
		{at: clickTimes[0], ...c[0], click: true},
		{at: clickTimes[1], ...c[1], click: true},
		{at: clickTimes[2], ...c[2], click: true},
	];
	// captured requests appear as they happen: page load at t0, the rest at their click
	const entryAt = (i: number) => (i === 0 ? t0 + 4 : clickTimes[i - 1] + 8);

	return (
		<SceneFade>
			<AbsoluteFill>
				<Chapter n="01" title="Record a real site" sub="Headless Chrome follows a click script. The recorder logs the request behind every click." />
				<div style={{position: 'absolute', left: 120, top: 268}}>
					<Terminal lines={seq.lines} width={800} height={660} fontSize={18} title="clify record" />
				</div>
				<div style={{position: 'absolute', left: 960, top: 268}}>
					<Browser width={840} shots={shotsList} cursor={cursor} label="headless" />
				</div>
				<div style={{position: 'absolute', left: 960, top: 868, width: 840, fontFamily: MONO, fontSize: 17}}>
					<div style={{fontFamily: SANS, fontSize: 15, fontWeight: 600, letterSpacing: 1.2, color: C.dim, textTransform: 'uppercase', marginBottom: 8}}>recording.jsonl · {entries.length} requests captured</div>
					{entries.map((e, i) => {
						const op = lerp(frame, entryAt(i), entryAt(i) + 8, 0, 1);
						return (
							<div key={i} style={{display: 'flex', gap: 12, height: 27, alignItems: 'center', opacity: op, transform: `translateX(${(1 - op) * 16}px)`, whiteSpace: 'nowrap', overflow: 'hidden'}}>
								<span style={{color: C.green, width: 42}}>{e.method}</span>
								<span style={{color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis'}}>{shortUrl(e.url).replace('books.toscrape.com', '')}</span>
								<span style={{color: C.dim}}>← {e.triggeredBy}</span>
							</div>
						);
					})}
				</div>
			</AbsoluteFill>
		</SceneFade>
	);
};
