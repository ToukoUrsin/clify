import React from 'react';
import {AbsoluteFill, Audio, Sequence, interpolate, staticFile} from 'remotion';
import vo from './data/vo.json';
import {Backdrop, Grain, Vignette} from './components/ui';
import {Captcha} from './scenes/Captcha';
import {Outro} from './scenes/Outro';
import {Race, raceDur} from './scenes/Race';
import {Record} from './scenes/Record';
import {Results} from './scenes/Results';
import {SideBySide, sideDur} from './scenes/SideBySide';
import {Spec} from './scenes/Spec';
import {Struggle, strugglesDur} from './scenes/Struggle';
import {Title} from './scenes/Title';
import {Wall} from './scenes/Wall';
import {Writes} from './scenes/Writes';

export const SCENES: {name: string; dur: number; C: React.FC}[] = [
	{name: 'struggle', dur: strugglesDur(), C: Struggle},
	{name: 'side', dur: sideDur(), C: SideBySide},
	{name: 'title', dur: 120, C: Title},
	{name: 'record', dur: 330, C: Record},
	{name: 'spec', dur: 240, C: Spec},
	{name: 'wall', dur: 570, C: Wall},
	{name: 'race', dur: raceDur(), C: Race},
	{name: 'results', dur: 300, C: Results},
	{name: 'writes', dur: 390, C: Writes},
	{name: 'captcha', dur: 250, C: Captcha},
	{name: 'outro', dur: 210, C: Outro},
];
export const TOTAL = SCENES.reduce((a, s) => a + s.dur, 0);

export const sceneStart = (name: string) => {
	let t = 0;
	for (const s of SCENES) {
		if (s.name === name) return t;
		t += s.dur;
	}
	throw new Error(`no scene ${name}`);
};

// VO lines placed by scene + offset; music ducks under speech.
const VO = (vo.lines as {scene: string; at: number; text: string; file: string}[]).map((l) => ({...l, from: Math.round(sceneStart(l.scene) + l.at * 30)}));
const VO_DUR = 6.5 * 30; // upper bound of a line, for ducking only
const musicVolume = (f: number) => {
	const near = VO.some((l) => f >= l.from - 8 && f <= l.from + VO_DUR);
	const base = near ? 0.16 : 0.32;
	const fadeIn = interpolate(f, [0, 45], [0, 1], {extrapolateRight: 'clamp'});
	const fadeOut = interpolate(f, [TOTAL - 90, TOTAL - 5], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	return base * fadeIn * fadeOut;
};

export const Main: React.FC<{only?: string; audio?: boolean}> = ({only, audio}) => {
	let t = 0;
	return (
		<AbsoluteFill>
			<Backdrop />
			{SCENES.map((s) => {
				const from = t;
				t += s.dur;
				if (only && only !== s.name) return null;
				return (
					<Sequence key={s.name} from={only ? 0 : from} durationInFrames={s.dur} name={s.name}>
						<s.C />
					</Sequence>
				);
			})}
			<Vignette />
			<Grain />
			{audio && !only ? (
				<>
					{vo.music ? <Audio src={staticFile(vo.music)} volume={musicVolume} /> : null}
					{VO.map((l) => (
						<Sequence key={l.file} from={l.from} durationInFrames={Math.round(VO_DUR + 30)} name={`vo:${l.text.slice(0, 24)}`}>
							<Audio src={staticFile(l.file)} volume={1} />
						</Sequence>
					))}
				</>
			) : null}
		</AbsoluteFill>
	);
};

// 15-20 s teaser: the race, then the wordmark.
const RACE = SCENES.find((s) => s.name === 'race')!;
export const TEASER_DUR = RACE.dur + 100;
export const Teaser: React.FC = () => (
	<AbsoluteFill>
		<Backdrop />
		<Sequence durationInFrames={RACE.dur}>
			<Race />
		</Sequence>
		<Sequence from={RACE.dur} durationInFrames={100}>
			<Outro />
		</Sequence>
		<Vignette />
		<Grain />
	</AbsoluteFill>
);
