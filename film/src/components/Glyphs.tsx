import React from 'react';

// Claude Code glyphs drawn as SVG so they never depend on system font fallback.

export const Dot: React.FC<{color: string; size: number; opacity?: number}> = ({color, size, opacity = 1}) => (
	<span
		style={{
			display: 'inline-block',
			width: size * 0.62,
			height: size * 0.62,
			borderRadius: '50%',
			background: color,
			opacity,
			verticalAlign: 'middle',
			transform: 'translateY(-0.08em)',
		}}
	/>
);

// ⎿ — an L-shaped connector
export const Elbow: React.FC<{color: string; size: number}> = ({color, size}) => (
	<span
		style={{
			display: 'inline-block',
			width: size * 0.5,
			height: size * 0.62,
			borderLeft: `1.6px solid ${color}`,
			borderBottom: `1.6px solid ${color}`,
			verticalAlign: 'middle',
			transform: 'translateY(-0.32em)',
		}}
	/>
);

// Claude spinner: · ✢ ✳ ✶ ✻ ✽ — n-armed asterisks of growing size
const SPIN = [0, 4, 6, 8, 6, 12];
export const Spinner: React.FC<{frame: number; color: string; size: number}> = ({frame, color, size}) => {
	const seq = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1];
	const i = seq[Math.floor(frame / 3) % seq.length];
	const arms = SPIN[i];
	const r = 0.18 + i * 0.055;
	return (
		<svg width={size} height={size} viewBox="-1 -1 2 2" style={{verticalAlign: 'middle', transform: 'translateY(-0.08em)'}}>
			{arms === 0 ? (
				<circle r={0.14} fill={color} />
			) : (
				Array.from({length: arms}).map((_, k) => {
					const a = (k / arms) * Math.PI * 2;
					return (
						<line
							key={k}
							x1={0}
							y1={0}
							x2={Math.cos(a) * (r + 0.4)}
							y2={Math.sin(a) * (r + 0.4)}
							stroke={color}
							strokeWidth={0.2}
							strokeLinecap="round"
						/>
					);
				})
			)}
		</svg>
	);
};

export const Check: React.FC<{size: number; color: string; stroke?: number; progress?: number}> = ({
	size,
	color,
	stroke = 3,
	progress = 1,
}) => (
	<svg width={size} height={size} viewBox="0 0 24 24" fill="none">
		<path
			d="M5 12.5l4.5 4.5L19 7.5"
			stroke={color}
			strokeWidth={stroke}
			strokeLinecap="round"
			strokeLinejoin="round"
			pathLength={1}
			strokeDasharray={1}
			strokeDashoffset={1 - progress}
		/>
	</svg>
);

export const Cross: React.FC<{size: number; color: string; stroke?: number; progress?: number}> = ({
	size,
	color,
	stroke = 3,
	progress = 1,
}) => (
	<svg width={size} height={size} viewBox="0 0 24 24" fill="none">
		<path
			d="M7 7l10 10"
			stroke={color}
			strokeWidth={stroke}
			strokeLinecap="round"
			pathLength={1}
			strokeDasharray={1}
			strokeDashoffset={1 - Math.min(1, progress * 2)}
		/>
		<path
			d="M17 7L7 17"
			stroke={color}
			strokeWidth={stroke}
			strokeLinecap="round"
			pathLength={1}
			strokeDasharray={1}
			strokeDashoffset={1 - Math.max(0, progress * 2 - 1)}
		/>
	</svg>
);

export const Cursor: React.FC<{size?: number}> = ({size = 28}) => (
	<svg width={size} height={size * 1.25} viewBox="0 0 20 25" style={{filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))'}}>
		<path d="M2 1.5 L2 20 L7 15.5 L10.5 23 L13.5 21.6 L10.2 14.3 L17 14.3 Z" fill="#fff" stroke="#111" strokeWidth="1.3" strokeLinejoin="round" />
	</svg>
);

export const FastForward: React.FC<{size: number; color: string}> = ({size, color}) => (
	<svg width={size} height={size} viewBox="0 0 24 24">
		<path d="M3 5l9 7-9 7zM12 5l9 7-9 7z" fill={color} />
	</svg>
);
