import {loadFont as loadInter} from '@remotion/google-fonts/Inter';
import {loadFont as loadMono} from '@remotion/google-fonts/JetBrainsMono';
import {Easing, interpolate, spring} from 'remotion';

export const {fontFamily: SANS} = loadInter('normal', {
	weights: ['400', '500', '600', '700', '800'],
	subsets: ['latin'],
});
export const {fontFamily: MONO} = loadMono('normal', {
	weights: ['400', '500', '700'],
	subsets: ['latin'],
});

export const FPS = 30;
export const W = 1920;
export const H = 1080;

export const C = {
	bg: '#07080B',
	bg2: '#0C0E13',
	panel: '#0F1117',
	line: 'rgba(255,255,255,0.08)',
	line2: 'rgba(255,255,255,0.14)',
	text: '#EDEFF3',
	dim: '#8A909C',
	dimmer: '#5A606B',
	accent: '#7C8CFF',
	accentSoft: 'rgba(124,140,255,0.16)',
	green: '#3DD68C',
	greenSoft: 'rgba(61,214,140,0.16)',
	red: '#FF5F57',
	redSoft: 'rgba(255,95,87,0.16)',
	amber: '#F5B544',
	amberSoft: 'rgba(245,181,68,0.14)',
	jsonKey: '#A9B4FF',
	jsonStr: '#E9D8A6',
	jsonNum: '#7FD8C9',
	// Claude Code dark theme
	claude: '#D77757',
	ccGreen: '#4EBA65',
	ccRed: '#FF6B80',
	ccDim: '#999999',
	ccText: '#E6E6E6',
	ccTerm: '#141414',
};

export const ease = {
	out: Easing.bezier(0.16, 1, 0.3, 1),
	inOut: Easing.bezier(0.65, 0, 0.35, 1),
	in: Easing.bezier(0.7, 0, 0.84, 0),
};

export const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

export const lerp = (
	f: number,
	from: number,
	to: number,
	a: number,
	b: number,
	e: (t: number) => number = ease.out,
) => interpolate(f, [from, to], [a, b], {...clamp, easing: e});

export const pop = (frame: number, at: number, fps = FPS, damping = 14, mass = 0.6) =>
	spring({frame: frame - at, fps, config: {damping, mass, stiffness: 170}});

export const soft = (frame: number, at: number, fps = FPS) =>
	spring({frame: frame - at, fps, config: {damping: 200}, durationInFrames: 24});

export const fmtSec = (s: number) => {
	if (s < 60) return `${s.toFixed(1)}s`;
	const m = Math.floor(s / 60);
	const r = Math.floor(s % 60);
	return `${m}m ${String(r).padStart(2, '0')}s`;
};

export const fmtClock = (s: number) => {
	const m = Math.floor(s / 60);
	const r = Math.floor(s % 60);
	return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};

export const fmtTokens = (n: number) =>
	n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : `${Math.round(n)}`;
