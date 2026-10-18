import React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {C, MONO, SANS, clamp, ease, lerp, soft} from '../theme';

export const Backdrop: React.FC<{tint?: string; glowX?: number; glowY?: number}> = ({tint = C.accent, glowX = 30, glowY = 20}) => {
	const frame = useCurrentFrame();
	const drift = Math.sin(frame / 90) * 4;
	return (
		<AbsoluteFill style={{background: C.bg, overflow: 'hidden'}}>
			<AbsoluteFill
				style={{
					background: `radial-gradient(1100px 700px at ${glowX + drift}% ${glowY}%, ${tint}22, transparent 70%), radial-gradient(900px 600px at ${85 - drift}% 90%, #3DD68C0d, transparent 70%)`,
				}}
			/>
			<AbsoluteFill
				style={{
					backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
					backgroundSize: '80px 80px',
					maskImage: 'radial-gradient(ellipse at 50% 40%, black 30%, transparent 75%)',
					WebkitMaskImage: 'radial-gradient(ellipse at 50% 40%, black 30%, transparent 75%)',
				}}
			/>
		</AbsoluteFill>
	);
};

export const Grain: React.FC = () => {
	const frame = useCurrentFrame();
	const ox = (frame * 137) % 512;
	const oy = (frame * 251) % 512;
	return (
		<AbsoluteFill style={{pointerEvents: 'none', mixBlendMode: 'overlay', opacity: 0.07}}>
			<AbsoluteFill style={{backgroundImage: `url(${staticFile('fx/noise.png')})`, backgroundPosition: `${ox}px ${oy}px`}} />
		</AbsoluteFill>
	);
};

export const Vignette: React.FC = () => (
	<AbsoluteFill style={{pointerEvents: 'none', background: 'radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%)'}} />
);

// Scene envelope: fade/blur in and out at the scene edges.
export const SceneFade: React.FC<{children: React.ReactNode; inF?: number; outF?: number}> = ({children, inF = 12, outF = 12}) => {
	const frame = useCurrentFrame();
	const {durationInFrames} = useVideoConfig();
	const a = interpolate(frame, [0, inF], [0, 1], clamp);
	const b = interpolate(frame, [durationInFrames - outF, durationInFrames], [1, 0], clamp);
	const op = Math.min(a, b);
	const blur = (1 - op) * 10;
	const sc = interpolate(frame, [durationInFrames - outF, durationInFrames], [1, 1.02], clamp);
	return <AbsoluteFill style={{opacity: op, filter: blur > 0.2 ? `blur(${blur}px)` : undefined, transform: `scale(${sc})`}}>{children}</AbsoluteFill>;
};

export const Chapter: React.FC<{n: string; title: string; sub?: string; at?: number; x?: number; y?: number; width?: number}> = ({n, title, sub, at = 4, x = 120, y = 92, width = 1680}) => {
	const frame = useCurrentFrame();
	const s = soft(frame, at);
	const s2 = soft(frame, at + 6);
	return (
		<div style={{position: 'absolute', left: x, top: y, width, fontFamily: SANS}}>
			<div style={{display: 'flex', alignItems: 'center', gap: 16, opacity: s, transform: `translateY(${(1 - s) * 14}px)`}}>
				<div style={{fontFamily: MONO, fontSize: 18, color: C.accent, fontWeight: 700, letterSpacing: 1, padding: '5px 10px', border: `1px solid ${C.accent}55`, borderRadius: 6, background: C.accentSoft}}>{n}</div>
				<div style={{fontSize: 46, fontWeight: 700, color: C.text, letterSpacing: -1.2}}>{title}</div>
			</div>
			{sub ? <div style={{marginTop: 12, fontSize: 25, color: C.dim, fontWeight: 450, opacity: s2, transform: `translateY(${(1 - s2) * 10}px)`, letterSpacing: -0.2}}>{sub}</div> : null}
		</div>
	);
};

// Bottom caption for muted viewing.
export const Caption: React.FC<{text: string; at: number; until?: number; y?: number}> = ({text, at, until = 99999, y = 990}) => {
	const frame = useCurrentFrame();
	const op = Math.min(lerp(frame, at, at + 10, 0, 1), lerp(frame, until - 8, until, 1, 0));
	if (op <= 0) return null;
	return (
		<div style={{position: 'absolute', left: 0, right: 0, top: y, display: 'flex', justifyContent: 'center', opacity: op, transform: `translateY(${(1 - op) * 8}px)`}}>
			<div style={{fontFamily: SANS, fontSize: 27, fontWeight: 500, color: '#DADDE3', padding: '10px 22px', borderRadius: 10, background: 'rgba(8,9,12,0.72)', border: `1px solid ${C.line}`, letterSpacing: -0.2}}>{text}</div>
		</div>
	);
};

export const Pill: React.FC<{children: React.ReactNode; color?: string; bg?: string; size?: number; style?: React.CSSProperties}> = ({children, color = C.text, bg = 'rgba(255,255,255,0.06)', size = 18, style}) => (
	<div style={{display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: MONO, fontSize: size, color, background: bg, border: `1px solid ${color}44`, borderRadius: 8, padding: '6px 12px', whiteSpace: 'nowrap', ...style}}>{children}</div>
);

export const SiteThumb: React.FC<{src: string; w: number; style?: React.CSSProperties}> = ({src, w, style}) => (
	<div style={{width: w, height: (w * 900) / 1440, borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.line2}`, ...style}}>
		<Img src={staticFile(src)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
	</div>
);

export const Wordmark: React.FC<{size?: number; color?: string}> = ({size = 120, color = C.text}) => (
	<div style={{display: 'flex', alignItems: 'center', gap: size * 0.18, fontFamily: SANS, fontWeight: 750, fontSize: size, letterSpacing: -size * 0.045, color}}>
		<div
			style={{
				width: size * 0.78,
				height: size * 0.78,
				borderRadius: size * 0.2,
				background: `linear-gradient(140deg, ${C.accent}, #4B5BDB)`,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				boxShadow: `0 ${size * 0.1}px ${size * 0.4}px ${C.accent}55, inset 0 1px 0 rgba(255,255,255,0.35)`,
				fontFamily: MONO,
				fontSize: size * 0.4,
				fontWeight: 700,
				color: '#fff',
				letterSpacing: 0,
			}}
		>
			&gt;_
		</div>
		clify
	</div>
);

export const easeNum = (frame: number, at: number, dur: number, to: number) => interpolate(frame, [at, at + dur], [0, to], {...clamp, easing: ease.out});
