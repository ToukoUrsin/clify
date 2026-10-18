import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {C, MONO, clamp, ease} from '../theme';

export type TLKind = 'cmd' | 'json' | 'log' | 'plain' | 'dim' | 'ok' | 'err' | 'warn' | 'meta' | 'blank';
export type TL = {at: number; text: string; kind: TLKind; dur?: number; icon?: 'open' | 'act' | 'stop' | 'done'; hl?: boolean};

// Builds terminal lines on a timeline. Commands are typed; output lands a few frames apart.
export class Seq {
	t: number;
	lines: TL[] = [];
	constructor(start: number) {
		this.t = start;
	}
	cmd(text: string, speed = 1.7, pause = 6) {
		const dur = Math.ceil(text.length / speed);
		this.lines.push({at: this.t, text, kind: 'cmd', dur});
		this.t += dur + pause;
		return this;
	}
	wait(frames: number) {
		this.t += frames;
		return this;
	}
	out(text: string | string[], kind: TLKind = 'plain', stagger = 1, extra: Partial<TL> = {}) {
		const arr = Array.isArray(text) ? text : [text];
		arr.forEach((l) => {
			this.lines.push({at: this.t, text: l, kind, ...extra});
			this.t += stagger;
		});
		return this;
	}
	json(lines: string[], stagger = 1) {
		return this.out(lines, 'json', stagger);
	}
	at(frame: number) {
		this.t = frame;
		return this;
	}
}

const JSON_RE = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\b\d+(?:\.\d+)?\b)|\b(true|false|null)\b/g;
const jsonSpans = (line: string, hl?: boolean): React.ReactNode[] => {
	const out: React.ReactNode[] = [];
	let last = 0;
	let m: RegExpExecArray | null;
	JSON_RE.lastIndex = 0;
	let k = 0;
	while ((m = JSON_RE.exec(line))) {
		if (m.index > last) out.push(<span key={k++} style={{color: '#8C93A0'}}>{line.slice(last, m.index)}</span>);
		if (m[1] && m[2]) {
			out.push(<span key={k++} style={{color: C.jsonKey}}>{m[1]}</span>);
			out.push(<span key={k++} style={{color: '#8C93A0'}}>{m[2]}</span>);
		} else if (m[1]) out.push(<span key={k++} style={{color: C.jsonStr}}>{m[1]}</span>);
		else if (m[3]) out.push(<span key={k++} style={{color: C.jsonNum}}>{m[3]}</span>);
		else if (m[4]) out.push(<span key={k++} style={{color: m[4] === 'true' ? (hl ? C.amber : C.jsonNum) : m[4] === 'false' ? C.red : '#8C93A0'}}>{m[4]}</span>);
		last = m.index + m[0].length;
	}
	if (last < line.length) out.push(<span key={k++} style={{color: '#8C93A0'}}>{line.slice(last)}</span>);
	return out;
};

const wrapText = (text: string, cols: number): string[] => {
	if (text.length <= cols) return [text];
	const indent = (text.match(/^\s*/) || [''])[0].length + 2;
	const res: string[] = [];
	let rest = text;
	let first = true;
	while (rest.length > 0) {
		const w = first ? cols : cols - indent;
		let cut = Math.min(rest.length, w);
		if (cut < rest.length) {
			const sp = rest.lastIndexOf(' ', cut);
			if (sp > w * 0.5) cut = sp + 1;
		}
		res.push((first ? '' : ' '.repeat(indent)) + rest.slice(0, cut));
		rest = rest.slice(cut);
		first = false;
	}
	return res;
};

const LogIcon: React.FC<{icon: TL['icon']; size: number}> = ({icon, size}) => {
	const color = icon === 'stop' ? C.amber : icon === 'done' ? C.green : icon === 'open' ? C.accent : C.dim;
	const ch = icon === 'open' ? '◆' : icon === 'stop' ? '■' : icon === 'done' ? '●' : '→';
	return <span style={{color, display: 'inline-block', width: size * 1.4, fontSize: icon === 'act' ? size : size * 0.75}}>{ch}</span>;
};

export const Terminal: React.FC<{
	lines: TL[];
	width: number;
	height: number;
	fontSize?: number;
	title?: string;
	prompt?: string;
	style?: React.CSSProperties;
	chrome?: boolean;
	idlePrompt?: boolean;
}> = ({lines, width, height, fontSize = 20, title = 'zsh — clify', prompt = '~/clify', style, chrome = true, idlePrompt = true}) => {
	const frame = useCurrentFrame();
	const lh = Math.round(fontSize * 1.5);
	const charW = fontSize * 0.6;
	const padX = 26;
	const titleH = chrome ? 40 : 0;
	const promptW = prompt.length + 3;
	const cols = Math.floor((width - padX * 2) / charW) - 1;
	const viewH = height - titleH - 36;

	type V = {key: string; line: TL; text: string; first: boolean; at: number; start: number};
	const vis: V[] = [];
	lines.forEach((l, i) => {
		const avail = l.kind === 'cmd' ? cols - promptW : l.kind === 'log' ? cols - 12 : cols;
		const parts = l.kind === 'blank' ? [''] : wrapText(l.text, avail);
		let start = 0;
		parts.forEach((p, j) => {
			const at = l.kind === 'cmd' ? l.at + Math.floor(((l.dur ?? 0) * start) / Math.max(1, l.text.length)) : l.at;
			vis.push({key: `${i}-${j}`, line: l, text: p, first: j === 0, at, start});
			start += j === 0 ? p.length : p.trimStart().length;
		});
	});

	let y = 0;
	const placed = vis.map((v) => {
		const g = interpolate(frame, [v.at, v.at + 4], [0, 1], {...clamp, easing: ease.out});
		const o = {v, y, g};
		y += lh * g;
		return o;
	});
	const scroll = Math.max(0, y - viewH);

	const cursorBlink = Math.floor(frame / 16) % 2 === 0;
	const started = lines.filter((l) => l.at <= frame);
	const lastStarted = started[started.length - 1];
	const lastCmdTyping = lastStarted && lastStarted.kind === 'cmd' ? lastStarted : undefined; // typing or waiting for output
	const anyVisible = placed.some((p) => p.g > 0);

	const renderLine = (v: V) => {
		const l = v.line;
		if (l.kind === 'cmd') {
			const typed = Math.max(0, Math.floor(((frame - l.at) / (l.dur ?? 1)) * l.text.length));
			const startIdx = v.start;
			const body = v.first ? v.text : v.text.trimStart();
			const shown = (v.first ? '' : ' '.repeat(v.text.length - body.length)) + body.slice(0, Math.max(0, typed - startIdx));
			const typing = frame < l.at + (l.dur ?? 0);
			const isTail = typed - startIdx <= body.length && typed - startIdx >= 0;
			return (
				<>
					{v.first ? (
						<>
							<span style={{color: C.dimmer}}>{prompt} </span>
							<span style={{color: C.accent, fontWeight: 700}}>$ </span>
						</>
					) : (
						<span>{' '.repeat(promptW)}</span>
					)}
					<span style={{color: C.text}}>{shown}</span>
					{typing && isTail ? <span style={{display: 'inline-block', width: charW * 0.9, height: lh * 0.72, background: C.text, verticalAlign: 'middle', marginLeft: 1}} /> : null}
				</>
			);
		}
		if (l.kind === 'json') return jsonSpans(v.text, l.hl);
		if (l.kind === 'log')
			return (
				<>
					{v.first ? <LogIcon icon={l.icon} size={fontSize} /> : <span style={{display: 'inline-block', width: fontSize * 1.4}} />}
					<span style={{color: l.icon === 'stop' ? C.amber : l.icon === 'done' ? C.text : '#B8BDC7'}}>{v.text}</span>
				</>
			);
		const color = {plain: C.text, dim: C.dim, ok: C.green, err: C.red, warn: C.amber, meta: C.dimmer, blank: C.text, cmd: C.text, json: C.text, log: C.text}[l.kind];
		return <span style={{color, fontWeight: l.kind === 'ok' || l.kind === 'err' || l.kind === 'warn' ? 600 : 400}}>{v.text}</span>;
	};

	return (
		<div
			style={{
				width,
				height,
				borderRadius: 16,
				background: 'linear-gradient(180deg, rgba(22,24,31,0.96), rgba(13,14,19,0.97))',
				border: `1px solid ${C.line2}`,
				boxShadow: '0 50px 120px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)',
				overflow: 'hidden',
				position: 'relative',
				fontFamily: MONO,
				fontSize,
				...style,
			}}
		>
			{chrome ? (
				<div style={{height: titleH, display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: `1px solid ${C.line}`}}>
					{['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
						<div key={c} style={{width: 12, height: 12, borderRadius: 6, background: c, marginRight: 8, opacity: 0.85}} />
					))}
					<div style={{flex: 1, textAlign: 'center', color: C.dimmer, fontSize: 14, marginRight: 60, fontFamily: MONO}}>{title}</div>
				</div>
			) : null}
			<div style={{position: 'absolute', top: titleH + 18, left: padX, right: padX, height: viewH, overflow: 'hidden'}}>
				<div style={{position: 'absolute', left: 0, right: 0, top: 0, transform: `translateY(${-scroll}px)`}}>
					{placed.map(({v, y: yy, g}) =>
						g <= 0 ? null : (
							<div key={v.key} style={{position: 'absolute', top: yy, left: 0, right: 0, height: lh, lineHeight: `${lh}px`, whiteSpace: 'pre', opacity: g}}>
								{renderLine(v)}
							</div>
						),
					)}
					{!lastCmdTyping && idlePrompt ? (
						<div style={{position: 'absolute', top: y, left: 0, height: lh, lineHeight: `${lh}px`, whiteSpace: 'pre', opacity: anyVisible || frame > 0 ? 1 : 0}}>
							<span style={{color: C.dimmer}}>{prompt} </span>
							<span style={{color: C.accent, fontWeight: 700}}>$ </span>
							<span style={{display: 'inline-block', width: charW * 0.9, height: lh * 0.72, background: cursorBlink ? C.text : 'transparent', verticalAlign: 'middle'}} />
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
};

// Pretty-print a compact JSON object to lines (for MCP results which arrive on one line).
export const prettyLines = (text: string, maxLen = 400): string[] => {
	try {
		return JSON.stringify(JSON.parse(text), null, 2).split('\n');
	} catch {
		return [text.slice(0, maxLen)];
	}
};
