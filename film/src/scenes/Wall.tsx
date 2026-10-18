import React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {wall, type WallSite} from '../bench';
import {Check} from '../components/Glyphs';
import {SceneFade} from '../components/ui';
import {C, MONO, SANS, clamp, ease, lerp, soft} from '../theme';

const TW = 240;
const TH = 150;
const GAP = 14;
const N = wall.sites.length;
const COLS = Math.max(10, Math.ceil(Math.sqrt(N * (16 / 9) * (TH / TW))));
const ROWS = Math.ceil(N / COLS);
const GW = COLS * (TW + GAP) - GAP;
const GH = ROWS * (TH + GAP) - GAP;

// Place featured sites in the top-left 4x3 block first, then the 10x6 block, then the rest.
const placeSites = () => {
	const cells: {c: number; r: number}[] = [];
	for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells.push({c, r});
	const ring = (p: {c: number; r: number}) => (p.c < 4 && p.r < 3 ? 0 : p.c < 10 && p.r < 6 ? 1 : 2);
	cells.sort((a, b) => ring(a) - ring(b) || a.r + a.c - (b.r + b.c) || a.r - b.r);
	const withImg = wall.sites.filter((s) => s.img);
	const noImg = wall.sites.filter((s) => !s.img);
	return [...withImg, ...noImg].slice(0, cells.length).map((s, i) => ({s, ...cells[i], ring: ring(cells[i]), k: i}));
};
const PLACED = placeSites();

const Tile: React.FC<{s: WallSite; flipAt: number; pulseAt: number; x: number; y: number}> = ({s, flipAt, pulseAt, x, y}) => {
	const frame = useCurrentFrame();
	const p = interpolate(frame, [flipAt, flipAt + 14], [0, 1], {...clamp, easing: ease.inOut});
	const rot = p * 180;
	const front = rot < 90;
	const glow = Math.max(interpolate(frame, [flipAt + 10, flipAt + 18, flipAt + 40], [0, 1, 0.25], clamp), interpolate(frame, [pulseAt, pulseAt + 6, pulseAt + 26], [0.25, 1, 0.35], clamp));
	return (
		<div style={{position: 'absolute', left: x, top: y, width: TW, height: TH, perspective: 900}}>
			<div style={{position: 'absolute', inset: 0, transform: `rotateY(${rot}deg)`, transformStyle: 'preserve-3d'}}>
				{front ? (
					<div style={{position: 'absolute', inset: 0, borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.line2}`, background: '#1a1c22'}}>
						{s.img ? <Img src={staticFile(s.img)} style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top'}} /> : <div style={{padding: 14, fontFamily: SANS, fontSize: 20, color: C.dim}}>{s.host}</div>}
						<div style={{position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 10px 6px', background: 'linear-gradient(transparent, rgba(0,0,0,0.75))', fontFamily: SANS, fontSize: 13, fontWeight: 600, color: '#fff'}}>{s.host}</div>
					</div>
				) : (
					<div
						style={{
							position: 'absolute',
							inset: 0,
							transform: 'rotateY(180deg)',
							borderRadius: 10,
							overflow: 'hidden',
							border: `1px solid ${glow > 0.3 ? C.green + 'aa' : C.line2}`,
							boxShadow: glow > 0 ? `0 0 ${24 * glow}px ${C.green}55` : undefined,
							background: 'linear-gradient(180deg,#171c27,#0f1218)',
							padding: '11px 13px',
							fontFamily: MONO,
							fontSize: 13.5,
							lineHeight: 1.5,
							color: C.text,
						}}
					>
						<div style={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
							<span style={{color: C.accent, fontWeight: 700}}>$ </span>clify {s.site}
						</div>
						{s.commands.slice(0, 4).map((c) => (
							<div key={c} style={{color: '#C7CCD6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
								<span style={{display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: C.green, marginRight: 8, verticalAlign: 'middle'}} />
								{c}
							</div>
						))}
						<div style={{position: 'absolute', right: 10, bottom: 6, fontSize: 11.5, color: C.green, display: 'flex', alignItems: 'center', gap: 3}}>
							<Check size={13} color={C.green} stroke={3.5} />
							{Math.min(...s.ms)} ms
						</div>
					</div>
				)}
			</div>
		</div>
	);
};

export const Wall: React.FC = () => {
	const frame = useCurrentFrame();
	// camera: zoom on the 4x3 block, pull back to 10x6, then everything
	const fit = (cols: number, rows: number, pad = 0.9) => Math.min((1920 * pad) / (cols * (TW + GAP)), (1080 * 0.78) / (rows * (TH + GAP)));
	const s0 = fit(4, 3, 0.88);
	const s1 = fit(10, 6, 0.92);
	const s2 = Math.min((1920 * 0.94) / GW, (1080 * 0.74) / GH);
	const k1 = interpolate(frame, [150, 200], [0, 1], {...clamp, easing: ease.inOut});
	const k2 = interpolate(frame, [300, 360], [0, 1], {...clamp, easing: ease.inOut});
	const sc = s0 + (s1 - s0) * k1 + (s2 - s1) * k2;
	// focus point in grid space
	const fx = interpolate(k1 + k2, [0, 1, 2], [2 * (TW + GAP), 5 * (TW + GAP), GW / 2]);
	const fy = interpolate(k1 + k2, [0, 1, 2], [1.5 * (TH + GAP), 3 * (TH + GAP), GH / 2]);
	const cx = 960 - fx * sc;
	const cy = interpolate(k1 + k2, [0, 1, 2], [650, 640, 620]) - fy * sc;

	const flipAt = (p: (typeof PLACED)[number]) => (p.ring === 0 ? 30 + p.k * 7 : p.ring === 1 ? 205 + (p.c + p.r) * 5 : 360 + (p.c + p.r) * 4);
	const lastFlip = Math.max(...PLACED.map(flipAt));
	const pulseAt = (p: (typeof PLACED)[number]) => lastFlip + 24 + (p.c + p.r) * 2;
	const counter = Math.round(interpolate(frame, [20, lastFlip + 14], [0, N], {...clamp, easing: (t) => t}));
	const cats = Object.entries(wall.categories).sort((a, b) => b[1] - a[1]);
	const ci = Math.floor(Math.max(0, frame - 330) / 26) % cats.length;
	const head = soft(frame, 4);
	return (
		<SceneFade>
			<AbsoluteFill>
				<div style={{position: 'absolute', left: 0, top: 0, transform: `translate(${cx}px, ${cy}px) scale(${sc})`, transformOrigin: '0 0', width: GW, height: GH}}>
					{PLACED.map((p) => (
						<Tile key={p.s.site} s={p.s} flipAt={flipAt(p)} pulseAt={pulseAt(p)} x={p.c * (TW + GAP)} y={p.r * (TH + GAP)} />
					))}
				</div>
				<AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(7,8,11,0.96) 0%, rgba(7,8,11,0.85) 13%, transparent 22%, transparent 86%, rgba(7,8,11,0.9) 100%)'}} />
				<div style={{position: 'absolute', left: 120, top: 56, fontFamily: SANS, opacity: head}}>
					<div style={{display: 'flex', alignItems: 'baseline', gap: 20}}>
						<div style={{fontSize: 92, fontWeight: 750, color: C.text, letterSpacing: -3, fontVariantNumeric: 'tabular-nums', minWidth: 170}}>{counter}</div>
						<div style={{fontSize: 40, fontWeight: 650, color: C.text, letterSpacing: -1}}>sites, already CLIs</div>
					</div>
					<div style={{fontSize: 22, color: C.dim, marginTop: 0}}>
						Public websites and data APIs with pre-built clify specs, each re-run live today (read-only, robots.txt-checked): {wall.count} of {wall.checked} passed
					</div>
				</div>
				<div style={{position: 'absolute', right: 120, bottom: 52, fontFamily: MONO, fontSize: 22, color: C.dim, opacity: lerp(frame, 330, 345, 0, 1), textAlign: 'right'}}>
					<span style={{color: C.text}}>{cats[ci][0]}</span> · {cats[ci][1]} sites
				</div>
			</AbsoluteFill>
		</SceneFade>
	);
};
