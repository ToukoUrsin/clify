import React from 'react';
import {Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {C, MONO, SANS, clamp, ease} from '../theme';
import {Cursor} from './Glyphs';

export const PW = 1440;
export const PH = 900;
export type Shot = {src: string; url: string; at: number};
export type CursorKey = {at: number; x: number; y: number; click?: boolean};
export type ZoomKey = {at: number; s: number; x: number; y: number};

const interpKeys = <T extends {at: number}>(frame: number, keys: T[], get: (k: T) => number, dur = 18) => {
	if (!keys.length) return 0;
	let v = get(keys[0]);
	for (let i = 1; i < keys.length; i++) {
		const k = keys[i];
		const prev = get(keys[i - 1]);
		const d = (k as unknown as {dur?: number}).dur ?? dur;
		v = frame < k.at - d ? v : interpolate(frame, [k.at - d, k.at], [prev, get(k)], {...clamp, easing: ease.inOut});
		if (frame < k.at - d) break;
	}
	return v;
};

export const Browser: React.FC<{
	width: number;
	shots: Shot[];
	cursor?: CursorKey[];
	zoom?: ZoomKey[];
	label?: string;
	children?: React.ReactNode; // overlay in page px
	style?: React.CSSProperties;
}> = ({width, shots, cursor = [], zoom = [], label, children, style}) => {
	const frame = useCurrentFrame();
	const barH = 46;
	const k = width / PW;
	const viewH = PH * k;
	const cur = [...shots].reverse().find((s) => frame >= s.at) ?? shots[0];
	const curIdx = shots.indexOf(cur);

	const zs = zoom.length ? interpKeys(frame, zoom, (z) => z.s) : 1;
	const zx = zoom.length ? interpKeys(frame, zoom, (z) => z.x) : PW / 2;
	const zy = zoom.length ? interpKeys(frame, zoom, (z) => z.y) : PH / 2;
	// keep focus point centred, clamp to page edges
	const tx = Math.min(0, Math.max(PW - PW * zs, PW / 2 - zx * zs));
	const ty = Math.min(0, Math.max(PH - PH * zs, PH / 2 - zy * zs));

	const cx = interpKeys(frame, cursor, (c) => c.x, 20);
	const cy = interpKeys(frame, cursor, (c) => c.y, 20);
	const showCursor = cursor.length > 0 && frame >= cursor[0].at - 20;

	// loading line after each navigation
	const navAt = cur.at;
	const load = curIdx > 0 ? interpolate(frame, [navAt - 10, navAt + 4], [0, 1], clamp) : 1;
	const loadOp = curIdx > 0 ? interpolate(frame, [navAt + 4, navAt + 12], [1, 0], clamp) : 0;

	return (
		<div
			style={{
				width,
				borderRadius: 14,
				overflow: 'hidden',
				background: '#1A1C22',
				border: `1px solid ${C.line2}`,
				boxShadow: '0 50px 120px rgba(0,0,0,0.55)',
				position: 'relative',
				...style,
			}}
		>
			<div style={{height: barH, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 8, borderBottom: `1px solid ${C.line}`}}>
				{['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
					<div key={c} style={{width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.85}} />
				))}
				<div
					style={{
						marginLeft: 14,
						flex: 1,
						height: 28,
						borderRadius: 8,
						background: 'rgba(255,255,255,0.06)',
						display: 'flex',
						alignItems: 'center',
						padding: '0 12px',
						fontFamily: MONO,
						fontSize: 15,
						color: '#C9CDD6',
						overflow: 'hidden',
						whiteSpace: 'nowrap',
					}}
				>
					<svg width={12} height={14} viewBox="0 0 12 14" style={{marginRight: 9, opacity: 0.6}}>
						<rect x={1} y={6} width={10} height={7.5} rx={1.6} fill="#C9CDD6" />
						<path d="M3.2 6V4.3a2.8 2.8 0 015.6 0V6" stroke="#C9CDD6" strokeWidth={1.5} fill="none" />
					</svg>
					{cur.url.replace(/^https?:\/\//, '')}
				</div>
				{label ? (
					<div style={{fontFamily: SANS, fontSize: 13, fontWeight: 600, letterSpacing: 0.6, color: C.dim, padding: '4px 10px', border: `1px solid ${C.line2}`, borderRadius: 6, textTransform: 'uppercase'}}>{label}</div>
				) : null}
			</div>
			<div style={{position: 'absolute', top: barH - 2, left: 0, height: 2, width: `${load * 100}%`, background: C.accent, opacity: loadOp}} />
			<div style={{position: 'relative', width, height: viewH, overflow: 'hidden', background: '#fff'}}>
				<div style={{position: 'absolute', left: 0, top: 0, width: PW, height: PH, transformOrigin: '0 0', transform: `scale(${k}) translate(${tx}px, ${ty}px) scale(${zs})`}}>
					{shots.map((s, i) => {
						const next = shots[i + 1];
						const op = i === 0 ? 1 : interpolate(frame, [s.at, s.at + 4], [0, 1], clamp);
						if (frame < s.at - 1 && i > 0) return null;
						if (next && frame > next.at + 5) return null;
						return <Img key={s.src + i} src={staticFile(s.src)} style={{position: 'absolute', left: 0, top: 0, width: PW, height: PH, opacity: op}} />;
					})}
					{children}
					{showCursor ? (
						<>
							{cursor
								.filter((c) => c.click && frame >= c.at && frame < c.at + 22)
								.map((c) => {
									const p = (frame - c.at) / 22;
									return (
										<div
											key={c.at}
											style={{
												position: 'absolute',
												left: c.x - 40 * p - 6,
												top: c.y - 40 * p - 6,
												width: 12 + 80 * p,
												height: 12 + 80 * p,
												borderRadius: '50%',
												border: `3px solid ${C.accent}`,
												opacity: 1 - p,
											}}
										/>
									);
								})}
							<div style={{position: 'absolute', left: cx - 3, top: cy - 2, transform: `scale(${1 / Math.max(0.6, zs * 0.9)})`, transformOrigin: '3px 2px'}}>
								<Cursor size={30} />
							</div>
						</>
					) : null}
				</div>
			</div>
		</div>
	);
};
