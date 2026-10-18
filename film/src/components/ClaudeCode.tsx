import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import type {HeroRun} from '../bench';
import {C, MONO, clamp, ease, fmtTokens} from '../theme';
import {Dot, Elbow, Spinner} from './Glyphs';

// A faithful-enough Claude Code TUI driven by a real run's events.json.
// sToF maps run-seconds to local frames (t=0 = prompt submitted).

type Seg = {text: string; color?: string; bold?: boolean};
type Row = {at: number; prefix: 'dot' | 'elbow' | 'prompt' | 'none'; dotColor?: string; dotUntil?: number; dotFinal?: string; segs: Seg[]; indent: number; key: string};

const wrapRow = (row: Row, cols: number) => {
	const chars: {c: string; s: number}[] = [];
	row.segs.forEach((seg, si) => {
		for (const c of seg.text) chars.push({c, s: si});
	});
	const width = Math.max(10, cols - row.indent);
	const lines: {c: string; s: number}[][] = [];
	let i = 0;
	while (i < chars.length) {
		let end = Math.min(chars.length, i + width);
		if (end < chars.length) {
			let b = end;
			while (b > i + width * 0.5 && chars[b].c !== ' ') b--;
			if (chars[b].c === ' ') end = b + 1;
		}
		lines.push(chars.slice(i, end));
		i = end;
	}
	if (!lines.length) lines.push([]);
	return lines.map((ln, li) => {
		const spans: Seg[] = [];
		for (const ch of ln) {
			const seg = row.segs[ch.s];
			const last = spans[spans.length - 1];
			if (last && last.color === seg.color && last.bold === seg.bold) last.text += ch.c;
			else spans.push({text: ch.c, color: seg.color, bold: seg.bold});
		}
		return {row, spans, first: li === 0, key: `${row.key}-${li}`};
	});
};

const STATUS: Record<string, string> = {
	browser_navigate: 'Navigating',
	browser_snapshot: 'Reading the page',
	browser_click: 'Clicking',
	browser_type: 'Typing',
	browser_fill_form: 'Filling the form',
	browser_press_key: 'Pressing keys',
	browser_wait_for: 'Waiting',
	browser_evaluate: 'Running page script',
	browser_select_option: 'Selecting',
	browser_take_screenshot: 'Looking at the page',
	browser_find: 'Searching the page',
	Bash: 'Running',
};

const fmtArgs = (name: string, input: Record<string, unknown> = {}) => {
	if (name === 'Bash') return String(input.command ?? '');
	return Object.entries(input)
		.filter(([k]) => k !== 'description')
		.map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v.length > 90 ? v.slice(0, 90) + '…' : v) : JSON.stringify(v)}`)
		.join(', ');
};

const resultLines = (name: string, txt = '', max = 3): string[] => {
	const lines = txt.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() && !/^```/.test(l));
	if (!lines.length) return ['(no output)'];
	const keep = name === 'Bash' ? lines.slice(0, max) : lines.filter((l) => !/^### /.test(l)).slice(0, max);
	const rest = lines.length - keep.length;
	return rest > 0 ? [...keep, `… +${rest} lines (ctrl+o to expand)`] : keep;
};

export const ClaudeCode: React.FC<{
	run: HeroRun;
	width: number;
	height: number;
	fontSize?: number;
	title: string;
	sToF: (s: number) => number;
	fToS: (f: number) => number;
	typeAt?: number;
	showPrompt?: string;
}> = ({run, width, height, fontSize = 16, title, sToF, fToS, typeAt = 0, showPrompt}) => {
	const frame = useCurrentFrame();
	const fs = fontSize;
	const lh = Math.round(fs * 1.5);
	const charW = fs * 0.6;
	const padX = 20;
	const cols = Math.floor((width - padX * 2) / charW);
	const prompt = showPrompt ?? run.prompt.split('\n\nStart from')[0];
	const typeDur = Math.ceil(prompt.length / 4);
	const submit = typeAt + typeDur + 4;
	const endS = run.wallMs / 1000;
	const endF = sToF(endS);

	const rows: Row[] = [{at: submit, prefix: 'prompt', segs: [{text: prompt, color: C.ccDim}], indent: 2, key: 'prompt'}];
	const evs = run.events.filter((e) => e.kind === 'text' || (e.kind === 'tool' && e.name !== 'ToolSearch'));
	evs.forEach((e, i) => {
		const at = sToF(e.ms / 1000);
		rows.push({at, prefix: 'none', segs: [{text: ''}], indent: 0, key: `g${i}`});
		if (e.kind === 'text') {
			const t = (e.text ?? '').replace(/\*\*/g, '').split('\n').filter((l) => l.trim());
			t.slice(0, 6).forEach((l, k) => rows.push({at, prefix: k === 0 ? 'dot' : 'none', dotColor: C.ccText, segs: [{text: l, color: /^ANSWER:/.test(l) ? C.text : C.ccText, bold: /^ANSWER:/.test(l)}], indent: 2, key: `t${i}-${k}`}));
			return;
		}
		const raw = e.name ?? '';
		const mcp = raw.startsWith('mcp__playwright__');
		const short = raw.replace('mcp__playwright__', '');
		const name = mcp ? `playwright - ${short} (MCP)` : raw;
		const resAt = e.endMs ? sToF(e.endMs / 1000) : at + 10;
		rows.push({
			at,
			prefix: 'dot',
			dotColor: C.ccDim,
			dotUntil: resAt,
			dotFinal: e.isError ? C.ccRed : C.ccGreen,
			segs: [
				{text: name, color: C.ccText, bold: true},
				{text: `(${fmtArgs(short, e.input as Record<string, unknown>)})`, color: C.ccText},
			],
			indent: 2,
			key: `c${i}`,
		});
		resultLines(short, e.result, mcp ? 2 : 4).forEach((r, k) =>
			rows.push({at: resAt, prefix: k === 0 ? 'elbow' : 'none', segs: [{text: r, color: e.isError && k === 0 ? C.ccRed : C.ccDim}], indent: 5, key: `r${i}-${k}`}),
		);
	});
	const vlines = rows.flatMap((r) => wrapRow(r, cols));

	const titleH = 36;
	const inputH = lh + 18;
	const spinH = lh + 6;
	const footH = lh;
	const contentH = height - titleH - inputH - spinH - footH - 24;
	const headerH = lh * 3 + 18;
	let y = headerH;
	const placed = vlines.map((v) => {
		const g = interpolate(frame, [v.row.at, v.row.at + 4], [0, 1], {...clamp, easing: ease.out});
		const o = {v, y, g};
		y += lh * g;
		return o;
	});
	const scroll = Math.max(0, y - contentH);

	const running = frame >= submit && frame < endF;
	const cur = [...evs].reverse().find((e) => sToF(e.ms / 1000) <= frame);
	const word = cur?.kind === 'tool' ? STATUS[(cur.name ?? '').replace('mcp__playwright__', '')] ?? 'Working' : 'Thinking';
	const el = Math.max(0, fToS(frame));
	const tl = run.tokensOverTime;
	const tok = (() => {
		let v = 0;
		for (const p of tl) if (p.ms / 1000 <= el) v = p.total;
		return v;
	})();

	const typed = frame < typeAt ? '' : frame < submit ? prompt.slice(0, Math.floor((frame - typeAt) * 4)) : '';
	const caretOn = Math.floor(frame / 15) % 2 === 0 || (frame >= typeAt && frame < submit);

	return (
		<div style={{width, height, background: C.ccTerm, borderRadius: 14, border: `1px solid ${C.line2}`, overflow: 'hidden', position: 'relative', boxShadow: '0 40px 120px rgba(0,0,0,0.55)', fontFamily: MONO, fontSize: fs, color: C.ccText}}>
			<div style={{height: titleH, display: 'flex', alignItems: 'center', padding: '0 14px', borderBottom: `1px solid ${C.line}`, background: '#1B1B1D'}}>
				{['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
					<div key={c} style={{width: 11, height: 11, borderRadius: 6, background: c, marginRight: 7, opacity: 0.9}} />
				))}
				<div style={{flex: 1, textAlign: 'center', color: C.dim, fontSize: 13, marginRight: 50}}>{title}</div>
			</div>
			<div style={{position: 'absolute', top: titleH + 12, left: padX, right: padX, height: contentH, overflow: 'hidden'}}>
				<div style={{position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${-scroll}px)`}}>
					<div style={{border: `1px solid ${C.claude}`, borderRadius: 8, padding: '6px 12px', height: lh * 3, boxSizing: 'border-box', lineHeight: `${lh * 0.92}px`, width: Math.min(width - padX * 2, charW * 46)}}>
						<div>
							<span style={{color: C.claude}}>✻</span> Welcome to <b>Claude Code</b>!
						</div>
						<div style={{color: C.ccDim, fontSize: fs * 0.88}}>&nbsp;&nbsp;cwd: /bench/work · model: opus 5.5</div>
					</div>
					{placed.map(({v, y: yy, g}) =>
						g <= 0 ? null : (
							<div key={v.key} style={{position: 'absolute', top: yy, left: 0, right: 0, height: lh, lineHeight: `${lh}px`, whiteSpace: 'pre', opacity: g, paddingLeft: v.row.indent * charW}}>
								{v.first && v.row.prefix === 'dot' ? (
									<span style={{position: 'absolute', left: 0}}>
										<Dot
											color={v.row.dotUntil !== undefined && frame >= v.row.dotUntil ? v.row.dotFinal ?? C.ccText : v.row.dotColor ?? C.ccText}
											size={fs}
											opacity={v.row.dotUntil !== undefined && frame < v.row.dotUntil ? (Math.floor(frame / 8) % 2 ? 0.35 : 1) : 1}
										/>
									</span>
								) : null}
								{v.first && v.row.prefix === 'elbow' ? (
									<span style={{position: 'absolute', left: charW * 2}}>
										<Elbow color={C.ccDim} size={fs} />
									</span>
								) : null}
								{v.first && v.row.prefix === 'prompt' ? <span style={{position: 'absolute', left: 0, color: C.ccDim}}>&gt;</span> : null}
								{v.spans.map((s, k) => (
									<span key={k} style={{color: s.color, fontWeight: s.bold ? 700 : 400}}>
										{s.text}
									</span>
								))}
							</div>
						),
					)}
				</div>
			</div>
			<div style={{position: 'absolute', left: padX, right: padX, top: titleH + 12 + contentH + 4, height: spinH, lineHeight: `${lh}px`, whiteSpace: 'pre', overflow: 'hidden'}}>
				{running ? (
					<>
						<Spinner frame={frame} color={C.claude} size={fs} />
						<span style={{color: C.claude}}> {word}…</span>
						<span style={{color: C.ccDim}}> ({Math.floor(el)}s · ↓ {fmtTokens(tok)} tokens · esc to interrupt)</span>
					</>
				) : null}
			</div>
			<div style={{position: 'absolute', left: padX - 6, right: padX - 6, bottom: footH + 8, height: inputH, border: '1px solid #5A5A5A', borderRadius: 8, display: 'flex', alignItems: 'center', padding: '0 10px', whiteSpace: 'pre', overflow: 'hidden'}}>
				<span>&gt; </span>
				<span>{typed.length > cols - 6 ? '…' + typed.slice(typed.length - cols + 7) : typed}</span>
				<span style={{display: 'inline-block', width: charW, height: lh * 0.78, background: caretOn ? '#CFCFCF' : 'transparent', marginLeft: 1}} />
			</div>
			<div style={{position: 'absolute', left: padX, bottom: 5, height: footH, lineHeight: `${footH}px`, color: '#6B6B6B', fontSize: fs * 0.8}}>? for shortcuts</div>
		</div>
	);
};
