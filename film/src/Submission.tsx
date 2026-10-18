import React from 'react';
import {AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Backdrop, Grain} from './components/ui';
import {heroRun, strugglesDur} from './scenes/Struggle';
import {C, SANS, clamp} from './theme';
import {vo, type VoLine} from './sub/data';
import {A_FF, B_FF, SceneAdd, SceneBench, SceneCli, SceneCurl, SceneStruggle, SceneTitle, addDur} from './sub/Open';
import {SceneAsk, SceneIdentity, SceneRace, SceneRaceHook, identityDur} from './sub/Middle';
import {SceneAgent, SceneBlaxel, SceneEnd, SceneMcp, SceneWall} from './sub/End';

// 2-minute submission cut (1920×1080, 30 fps). Scene lengths in frames; the race slot is fixed so a new
// race file can be dropped in (film/race.json) and re-rendered without touching the timeline.
const FPS = 30;
const CURL_DUR = 160;
const cliDur = () => Math.round(10 + ((heroRun('cli').wallMs / 1000) * FPS) / B_FF + 116);
export const SCENES: {id: string; dur: number; C: React.FC<{dur: number}>}[] = [
	{id: 'hook', dur: 240, C: SceneRaceHook},
	{id: 'race', dur: 520, C: SceneRace},
	{id: 'bench', dur: 160, C: SceneBench},
	{id: 'title', dur: 125, C: SceneTitle},
	{id: 'add', dur: addDur(), C: SceneAdd},
	{id: 'identity', dur: identityDur(), C: SceneIdentity},
	{id: 'ask', dur: 320, C: SceneAsk},
	{id: 'mcp', dur: 345, C: SceneMcp},
	{id: 'agent', dur: 200, C: SceneAgent},
	{id: 'blaxel', dur: 200, C: SceneBlaxel},
	{id: 'wall', dur: 300, C: SceneWall},
	{id: 'end', dur: 225, C: SceneEnd},
];
// v11 (alternative cut): the same film with the bench beat replaced by the race's third lane (agent + curl, same sessions)
export type Cut = 'v10' | 'v11';
const CUT_SCENES: Record<Cut, typeof SCENES> = {
	v10: SCENES,
	v11: SCENES.map((s) => (s.id === 'bench' ? {id: 'curl', dur: CURL_DUR, C: SceneCurl} : s)),
};
export const sceneStarts = (cut: Cut = 'v10') => {
	let t = 0;
	return CUT_SCENES[cut].map((s) => {
		const o = {...s, from: t};
		t += s.dur;
		return o;
	});
};
export const subDur = (cut: Cut) => CUT_SCENES[cut].reduce((a, s) => a + s.dur, 0);
export const SUB_DUR = subDur('v10');
// the VO lines of a cut: those whose scene is in it
const cutLines = (cut: Cut) => vo.lines.filter((l) => CUT_SCENES[cut].some((s) => s.id === l.scene));
export const lineFrom = (l: VoLine, cut: Cut = 'v10') => {
	const s = sceneStarts(cut).find((x) => x.id === l.scene);
	if (!s) throw new Error(`no scene ${l.scene}`);
	return s.from + Math.round(l.at * FPS);
};

// Burned-in captions: the VO text, a few words at a time, timed by the TTS alignment.
const chunks = (l: VoLine) => {
	type W = (typeof l.words)[number];
	const out: {text: string; s: number; e: number}[] = [];
	const push = (ws: W[]) => ws.length && out.push({text: ws.map((w) => w.w).join(' '), s: ws[0].s, e: ws[ws.length - 1].e});
	const len = (ws: W[]) => ws.map((w) => w.w).join(' ').length;
	// split into sentences, then halve long ones at the comma (or word) nearest the middle, recursively
	const split = (ws: W[]) => {
		if (len(ws) <= 48 || ws.length < 4) return push(ws);
		let best = Math.floor(ws.length / 2);
		let bestScore = 1e9;
		for (let i = 2; i <= ws.length - 2; i++) {
			const score = Math.abs(len(ws.slice(0, i)) - len(ws.slice(i))) - (/[,:;]$/.test(ws[i - 1].w) ? 14 : 0);
			if (score < bestScore) {
				bestScore = score;
				best = i;
			}
		}
		split(ws.slice(0, best));
		split(ws.slice(best));
	};
	let cur: W[] = [];
	for (const w of l.words) {
		cur.push(w);
		if (/[.?!]$/.test(w.w)) {
			split(cur);
			cur = [];
		}
	}
	split(cur);
	return out;
};
// lines already on screen as a headline are not captioned twice
const onScreen = (t: string) => t.startsWith('Most websites become tools') || t === 'clify. The web, rebuilt for agents.';
const Captions: React.FC<{cut: Cut}> = ({cut}) => {
	const frame = useCurrentFrame();
	for (const l of cutLines(cut)) {
		if (onScreen(l.text)) continue;
		const from = lineFrom(l, cut);
		for (const c of chunks(l)) {
			const a = from + c.s * FPS - 2;
			const b = from + c.e * FPS + 8;
			if (frame >= a && frame < b) {
				const op = Math.min(interpolate(frame, [a, a + 4], [0, 1], clamp), interpolate(frame, [b - 4, b], [1, 0], clamp));
				return (
					<div style={{position: 'absolute', left: 0, right: 0, top: 982, display: 'flex', justifyContent: 'center', opacity: op}}>
						<div style={{fontFamily: SANS, fontSize: 34, fontWeight: 600, color: '#F2F4F7', padding: '10px 26px', borderRadius: 12, background: 'rgba(6,7,10,0.82)', border: `1px solid ${C.line}`, letterSpacing: -0.3}}>{c.text}</div>
					</div>
				);
			}
		}
	}
	return null;
};

// music ducks under the voice
const voiceOn = (f: number, cut: Cut) => cutLines(cut).some((l) => f >= lineFrom(l, cut) - 6 && f <= lineFrom(l, cut) + l.dur * FPS + 6);
const musicVol = (f: number, cut: Cut) => {
	const D = subDur(cut);
	const fade = interpolate(f, [0, 20], [0, 1], clamp) * interpolate(f, [D - 90, D - 4], [1, 0], clamp);
	return fade * (voiceOn(f, cut) ? 0.11 : 0.24);
};

export const Submission: React.FC<{audio?: boolean; captions?: boolean; cut?: Cut}> = ({audio = true, captions = true, cut = 'v10'}) => {
	const starts = sceneStarts(cut);
	return (
		<AbsoluteFill>
			<Backdrop />
			{starts.map((s) => (
				<Sequence key={s.id} from={s.from} durationInFrames={s.dur} name={s.id}>
					<s.C dur={s.dur} />
				</Sequence>
			))}
			<AbsoluteFill style={{pointerEvents: 'none', background: 'radial-gradient(ellipse at 50% 50%, transparent 65%, rgba(0,0,0,0.32) 100%)'}} />
			<Grain />
			{captions ? <Captions cut={cut} /> : null}
			{audio
				? cutLines(cut).map((l, i) => (
						<Sequence key={i} from={lineFrom(l, cut)} durationInFrames={Math.ceil(l.dur * FPS) + 4} name={`vo-${i}`}>
							<Audio src={staticFile(l.file)} volume={1} />
						</Sequence>
					))
				: null}
			{audio && vo.music ? <Audio src={staticFile(vo.music)} volume={(f) => musicVol(f, cut)} /> : null}
		</AbsoluteFill>
	);
};

// every VO line must end inside its scene and before the next line starts, in every cut
for (const cut of Object.keys(CUT_SCENES) as Cut[]) {
	const st = sceneStarts(cut);
	const ls = cutLines(cut).sort((a, b) => lineFrom(a, cut) - lineFrom(b, cut));
	ls.forEach((l, i) => {
		const s = st.find((x) => x.id === l.scene)!;
		const end = lineFrom(l, cut) + l.dur * FPS;
		if (end > s.from + s.dur - 4) throw new Error(`${cut}: VO "${l.text.slice(0, 40)}" ends ${Math.round(end - s.from - s.dur)} frames after scene ${l.scene}`);
		if (ls[i + 1] && end > lineFrom(ls[i + 1], cut) - 6) throw new Error(`${cut}: VO "${l.text.slice(0, 40)}" overlaps the next line`);
	});
}
if (typeof window !== 'undefined' && (window as unknown as {SCENE_TIMES?: boolean}).SCENE_TIMES !== false) console.log('SCENE_TIMES ' + JSON.stringify(sceneStarts().map((s) => [s.id, s.from, s.dur])));
