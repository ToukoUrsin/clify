import React from 'react';
import {AbsoluteFill, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Check} from '../components/Glyphs';
import {Seq, Terminal} from '../components/Terminal';
import {Pill, SceneFade, Wordmark} from '../components/ui';
import {C, MONO, SANS, clamp, ease, lerp, pop, soft} from '../theme';
import {plural, sub} from './data';
import endCfg from '../../end.json';

const FPS = 30;

// ---------- I: the hosted MCP server on Manufact: Claude Code's run large (its transcript), the other three clients as chips ----------
const fmtN = (n: number) => n.toLocaleString('en-US');
// 2,538 -> "2.5k" (floor, so the screen never overstates)
const k1 = (n: number) => `${Math.floor(n / 100) / 10}k`;
export const SceneMcp: React.FC<{dur: number}> = ({dur}) => {
	const frame = useCurrentFrame();
	const M = sub.mcp;
	const CC = M.claudeCode;
	const seq = new Seq(10);
	seq.out(`> ${CC.task[0]}`, 'dim').out(`  ${CC.task[1]}`, 'dim').wait(14);
	// a space after each comma so long JSON wraps between fields, not mid-value
	const sp = (j: string) => j.replace(/,(?=["{…])/g, ', ');
	CC.calls.forEach((c) => {
		seq.out(`clify · ${c.tool} ${sp(c.args)}`, 'log', 1, {icon: 'done'}).wait(12);
		seq.out(`└ ${sp(c.result)}`, 'json').wait(24);
	});
	seq.out('', 'blank').out(CC.answer, 'plain', 4);
	const others = M.clients.filter((c) => c.id !== 'claude');
	const tk = soft(frame, 150);
	return (
		<SceneFade>
			<AbsoluteFill style={{fontFamily: SANS}}>
				<div style={{position: 'absolute', left: 60, top: 36, opacity: soft(frame, 0)}}>
					<div style={{fontSize: 20, fontWeight: 600, letterSpacing: 1.4, color: C.dim, textTransform: 'uppercase'}}>
						Hosted MCP server on Manufact · {M.hosted.sites} sites · {fmtN(M.hosted.commands)} commands · {M.clients.length} clients · real runs
					</div>
					<div style={{fontSize: 46, fontWeight: 750, color: C.text, letterSpacing: -1.5, marginTop: 2}}>
						{M.tools.core.tools} core tools (+{M.tools.deployed.tools - M.tools.core.tools} shortcuts) · {k1(M.tools.deployed.tokens)} tokens for the whole tool list
					</div>
				</div>
				<div style={{position: 'absolute', right: 60, top: 26, opacity: soft(frame, 6)}}>
					<Pill color={C.accent} bg={C.accentSoft} size={20}>
						{M.url.replace('https://', '')}
					</Pill>
				</div>
				<div style={{position: 'absolute', left: 60, top: 150}}>
					<Terminal lines={seq.lines} width={1320} height={770} fontSize={20} title={`Claude Code → clify MCP · ${M.clients.find((c) => c.id === 'claude')?.model} · ${CC.calls.length} tool calls · ${CC.sec} s · transcript of the real run`} prompt="" idlePrompt={false} />
				</div>
				<div style={{position: 'absolute', left: 1410, top: 150, width: 450}}>
					<div style={{fontSize: 18, fontWeight: 600, letterSpacing: 1.2, color: C.dim, textTransform: 'uppercase', opacity: soft(frame, 20)}}>same server, same task</div>
					{others.map((cl, i) => {
						const p = pop(frame, 40 + i * 12, 30, 15, 0.7);
						return (
							<div key={cl.id} style={{display: 'flex', gap: 16, alignItems: 'center', marginTop: 14, padding: 12, borderRadius: 14, background: 'rgba(8,9,12,0.9)', border: `1px solid ${C.green}55`, transform: `translateX(${(1 - p) * 24}px)`, opacity: Math.min(1, p * 1.3)}}>
								<div style={{width: 144, height: 81, flexShrink: 0, borderRadius: 8, overflow: 'hidden', border: `1px solid ${C.line2}`}}>
									<OffthreadVideo src={staticFile(`sub/mcp-${cl.id}.mp4`)} startFrom={30} playbackRate={1.6} muted style={{width: 144, height: 81}} />
								</div>
								<div style={{minWidth: 0}}>
									<div style={{display: 'flex', alignItems: 'center', gap: 8}}>
										<Check size={20} color={C.green} />
										<span style={{fontSize: 23, fontWeight: 700, color: C.text}}>{cl.title}</span>
									</div>
									<div style={{fontFamily: MONO, fontSize: 15, color: C.dim, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{cl.model}</div>
									<div style={{fontSize: 16, color: C.green, marginTop: 4, lineHeight: 1.3}}>
										serde 1.0.229
										<br />
										SF overnight 58°F, Mostly Clear
									</div>
								</div>
							</div>
						);
					})}
					<div style={{marginTop: 22, padding: '18px 22px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.line2}`, opacity: tk, transform: `translateY(${(1 - tk) * 14}px)`}}>
						<div style={{fontSize: 16, fontWeight: 600, letterSpacing: 1.1, color: C.dim, textTransform: 'uppercase'}}>the whole tool list</div>
						<div style={{fontFamily: MONO, fontSize: 38, fontWeight: 700, color: C.green, marginTop: 4}}>{fmtN(M.tools.deployed.tokens)} tokens</div>
						<div style={{fontSize: 18, color: C.text}}>
							{M.tools.deployed.tools} tools: {M.tools.core.tools} core + {M.tools.deployed.tools - M.tools.core.tools} shortcuts
						</div>
						<div style={{fontSize: 18, color: C.dim, marginTop: 8}}>
							one tool per command would be <span style={{fontFamily: MONO, color: C.text}}>{fmtN(M.tools.perCommand.tokens)}</span> tokens
						</div>
					</div>
				</div>
				<div style={{position: 'absolute', left: 60, top: 936, fontSize: 18, color: C.dimmer}}>
					{CC.source} · mcp/demo/out/*.mp4, transcript-*.md · results trimmed (…) · tool list: {M.tools.deployed.tools} tools {fmtN(M.tools.deployed.tokens)} tokens ({M.tools.core.tools} core {fmtN(M.tools.core.tokens)}), mcp/demo/tool-tokens.json
				</div>
			</AbsoluteFill>
		</SceneFade>
	);
};

// ---------- I2: the always-on email agent on its own InstaBox (agent/proofs/video) ----------
export const SceneAgent: React.FC<{dur: number}> = ({dur}) => {
	const frame = useCurrentFrame();
	const A = sub.agent;
	const z = interpolate(frame, [0, dur], [1.0, 1.08], {...clamp, easing: ease.inOut});
	const tag = pop(frame, 30, 30, 15, 0.8);
	return (
		<SceneFade>
			<AbsoluteFill style={{fontFamily: SANS}}>
				<div style={{position: 'absolute', left: 60, top: 36, opacity: soft(frame, 0)}}>
					<div style={{fontSize: 20, fontWeight: 600, letterSpacing: 1.4, color: C.dim, textTransform: 'uppercase'}}>InstaBox · always-on agent with its own computer · real jobs</div>
					<div style={{fontSize: 48, fontWeight: 750, color: C.text, letterSpacing: -1.5, marginTop: 2}}>Email it a job. It works on its own box.</div>
				</div>
				<div style={{position: 'absolute', left: 160, top: 160, width: 1600, height: 790, borderRadius: 16, overflow: 'hidden', border: `1px solid ${C.line2}`, boxShadow: '0 50px 120px rgba(0,0,0,0.6)'}}>
					<div style={{width: 1920, height: 1080, transform: `scale(${(1600 / 1920) * z})`, transformOrigin: '50% 10%'}}>
						<OffthreadVideo src={staticFile('sub/agent.mp4')} startFrom={Math.round(16.5 * FPS)} playbackRate={1.25} muted style={{width: 1920, height: 1080}} />
					</div>
				</div>
				<div style={{position: 'absolute', left: 0, right: 0, top: 690, display: 'flex', justifyContent: 'center', transform: `translateY(${(1 - tag) * 30}px)`, opacity: Math.min(1, tag * 1.3)}}>
					<div style={{padding: '22px 36px', borderRadius: 18, background: 'rgba(8,9,12,0.95)', border: `1px solid ${C.accent}77`, boxShadow: '0 30px 90px rgba(0,0,0,0.6)', textAlign: 'center'}}>
						<div style={{fontSize: 22, color: C.dim}}>anyone can send it a job</div>
						<div style={{fontFamily: MONO, fontSize: 44, fontWeight: 700, color: C.text, marginTop: 4}}>{A.address}</div>
						<div style={{fontSize: 18, color: C.dim, marginTop: 6}}>public tier: read-only public sites, {A.jobsPerDay} jobs a day · survives a full InstaBox stop / start</div>
					</div>
				</div>
				<div style={{position: 'absolute', left: 60, top: 1040, fontSize: 16, color: C.dimmer}}>{A.video} · {A.proof} · agent/proofs/instabox.md</div>
			</AbsoluteFill>
		</SceneFade>
	);
};

// ---------- I3: the sweep on Blaxel, one sandbox per site, clify check inside it ----------
export const SceneBlaxel: React.FC<{dur: number}> = ({dur}) => {
	const frame = useCurrentFrame();
	const B = sub.blaxel;
	const COLS = 12;
	const TWb = 136;
	const THb = 52;
	const G2 = 8;
	const rows = Math.ceil(B.rows.length / COLS);
	const gw = COLS * TWb + (COLS - 1) * G2;
	// sandboxes run 6 at a time: light them in waves of 6
	const at = (i: number) => 10 + Math.floor(i / 6) * 5.2;
	const ok = B.rows.filter((r, i) => r.ok && frame >= at(i) + 6).length;
	const cmds = B.rows.reduce((a, r, i) => a + (frame >= at(i) + 6 ? r.checked : 0), 0);
	const z = interpolate(frame, [0, dur], [1.08, 1], {...clamp, easing: ease.out});
	return (
		<SceneFade>
			<AbsoluteFill style={{fontFamily: SANS}}>
				<div style={{position: 'absolute', left: 60, top: 36, opacity: soft(frame, 0)}}>
					<div style={{fontSize: 20, fontWeight: 600, letterSpacing: 1.4, color: C.dim, textTransform: 'uppercase'}}>Blaxel · one sandbox per site · clify check runs inside it</div>
					<div style={{fontSize: 48, fontWeight: 750, color: C.text, letterSpacing: -1.5, marginTop: 2}}>{B.sites} more sites, {B.sites} sandboxes.</div>
				</div>
				<div style={{position: 'absolute', right: 60, top: 40, textAlign: 'right'}}>
					<div style={{fontFamily: MONO, fontSize: 56, fontWeight: 800, color: C.green, letterSpacing: -2}}>{ok}</div>
					<div style={{fontSize: 18, color: C.dim}}>{ok === 1 ? 'site' : 'sites'} verified · {cmds === 1 ? plural(1, 'command') : `${fmtN(cmds)} commands`}</div>
				</div>
				<div style={{position: 'absolute', left: (1920 - gw) / 2, top: 180, width: gw, height: rows * (THb + G2), transform: `scale(${z})`, transformOrigin: '50% 0'}}>
					{B.rows.map((r, i) => {
						const p = pop(frame, at(i), 30, 15, 0.6);
						const lit = frame >= at(i) + 6;
						const col = !lit ? C.line2 : r.ok ? C.green : C.amber;
						return (
							<div key={r.sandbox} style={{position: 'absolute', left: (i % COLS) * (TWb + G2), top: Math.floor(i / COLS) * (THb + G2), width: TWb, height: THb, borderRadius: 7, background: lit ? (r.ok ? 'rgba(61,214,140,0.08)' : 'rgba(255,184,77,0.06)') : 'rgba(255,255,255,0.03)', border: `1px solid ${col}88`, padding: '6px 8px', boxSizing: 'border-box', opacity: Math.max(0.25, Math.min(1, p)), transform: `scale(${0.9 + 0.1 * Math.min(1, p)})`}}>
								<div style={{fontFamily: MONO, fontSize: 12, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{r.site === '?' ? r.sandbox.replace('clify-', '') : r.site}</div>
								<div style={{fontFamily: MONO, fontSize: 11, color: col, marginTop: 3}}>{!lit ? 'starting…' : r.ok ? `✓ check ${r.checked}/${r.of}` : r.blocked ? '■ bot wall: stopped' : `${r.checked}/${r.of} · miss`}</div>
							</div>
						);
					})}
				</div>
				<div style={{position: 'absolute', left: 60, top: 936, fontSize: 18, color: C.dimmer}}>
					{B.source}: {B.ok} of {B.sites} sites with ≥3 commands verified in their sandbox, {fmtN(B.verified)} commands · misses listed with reasons, bot walls never bypassed
				</div>
			</AbsoluteFill>
		</SceneFade>
	);
};

// ---------- J: the wall ----------
// host names wrap only after a dot or hyphen, never mid-word; long labels shrink so their longest part fits the tile
const hostBreaks = (h: string) => h.replace(/([.-])/g, '$1\u200B');
const hostSize = (h: string) => Math.min(8.5, 90 / (0.6 * Math.max(...h.split(/(?<=[.-])/).map((x) => x.length))));
const TW = 106;
const TH = 66;
const GAP = 8;
export const SceneWall: React.FC<{dur: number}> = ({dur}) => {
	const frame = useCurrentFrame();
	const Wd = sub.wall;
	// columns that leave the fullest last row
	const COLS = [15, 16, 17].sort((a, b) => ((Wd.tiles.length % b || b) / b) - ((Wd.tiles.length % a || a) / a))[0];
	// the first 12 tiles fill the close-up (rows 0-2, cols 0-3); the rest flow around them
	const tiles = (() => {
		const t = Wd.tiles;
		const grid: (typeof t)[number][] = [];
		const head = t.slice(0, 12);
		const rest = t.slice(12);
		for (let i = 0, h = 0, r = 0; grid.length < t.length; i++) {
			const inClose = Math.floor(i / COLS) < 3 && i % COLS < 4;
			grid.push(inClose ? head[h++] : rest[r++]);
		}
		return grid;
	})();
	const closeIdx = (i: number) => (Math.floor(i / COLS) < 3 && i % COLS < 4 ? Math.floor(i / COLS) * 4 + (i % COLS) : -1);
	const rows = Math.ceil(tiles.length / COLS);
	const gw = COLS * TW + (COLS - 1) * GAP;
	const gh = rows * TH + (rows - 1) * GAP;
	// camera: close-up on the first 4×3 tiles, then pull back to all of them
	const z0 = 1640 / (4 * TW + 3 * GAP);
	const zEnd = Math.min(1780 / gw, 740 / gh);
	const zt = interpolate(frame, [70, 190], [0, 1], {...clamp, easing: ease.inOut});
	const z = Math.exp(Math.log(z0) * (1 - zt) + Math.log(zEnd) * zt);
	// move the focus in step with 1/z so the pull-back reads as one straight camera move
	const u = (1 / z - 1 / z0) / (1 / zEnd - 1 / z0);
	const fxp = interpolate(u, [0, 1], [(4 * TW + 3 * GAP) / 2, gw / 2]);
	const fyp = interpolate(u, [0, 1], [(3 * TH + 2 * GAP) / 2, gh / 2]);
	const cx = 960;
	const cy = interpolate(u, [0, 1], [575, 510]);
	// in the close-up only its 12 tiles are on screen (no tiles cut by the frame edge); the rest fade in as the camera pulls back
	const restOp = interpolate(zt, [0.04, 0.3], [0, 1], clamp);
	const checkAt = (i: number) => {
		const c = i % COLS;
		const r = Math.floor(i / COLS);
		return closeIdx(i) >= 0 ? 22 + closeIdx(i) * 4 : 108 + (c + r) * 2.2;
	};
	const shown = tiles.filter((_, i) => frame >= checkAt(i) + 4).length;
	const counter = soft(frame, 150);
	return (
		<SceneFade>
			<AbsoluteFill style={{fontFamily: SANS, overflow: 'hidden'}}>
				<div style={{position: 'absolute', left: cx - fxp * z, top: cy - fyp * z, width: gw, height: gh, transform: `scale(${z})`, transformOrigin: '0 0'}}>
					{tiles.map((t, i) => {
						const c = i % COLS;
						const r = Math.floor(i / COLS);
						const lastRow = r === rows - 1 ? (COLS - (tiles.length - r * COLS)) * ((TW + GAP) / 2) : 0;
						const ck = pop(frame, checkAt(i), 30, 14, 0.6);
						const lit = frame >= checkAt(i);
						return (
							<div key={t.name + i} style={{position: 'absolute', left: c * (TW + GAP) + lastRow, top: r * (TH + GAP), width: TW, height: TH, opacity: closeIdx(i) >= 0 ? 1 : restOp, borderRadius: 5, overflow: 'hidden', background: t.img ? '#fff' : '#12151C', border: `0.6px solid ${lit ? C.green + 'AA' : C.line2}`, boxShadow: lit ? `0 0 6px ${C.green}33` : undefined}}>
								{t.img ? <Img src={staticFile(t.img)} style={{width: '100%', height: '100%', objectFit: 'cover', opacity: lit ? 1 : 0.55}} /> : null}
								{!t.img ? (
									<div style={{position: 'absolute', inset: 0, padding: '7px 8px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between'}}>
										<div style={{fontFamily: MONO, fontSize: hostSize(t.host), color: C.text, lineHeight: 1.15, maxHeight: 3 * 1.15 * hostSize(t.host), overflow: 'hidden'}}>{hostBreaks(t.host)}</div>
										<div style={{fontFamily: MONO, fontSize: 6.5, color: C.accent}}>clify add{t.on === 'blaxel' ? ' · Blaxel' : ''}</div>
									</div>
								) : null}
								<div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: 15, background: 'rgba(8,9,12,0.86)', display: 'flex', alignItems: 'center', padding: '0 5px', gap: 3, fontFamily: MONO, fontSize: 7, color: C.text}}>
									<div style={{transform: `scale(${ck})`, display: 'flex'}}>
										<Check size={9} color={C.green} stroke={4} />
									</div>
									<span style={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0}}>{t.img ? `${t.host.replace(/^api\./, '')} · ${t.n}` : `${t.n} verified`}</span>
								</div>
							</div>
						);
					})}
				</div>
				{/* gradient + counter */}
				<AbsoluteFill style={{background: `radial-gradient(ellipse 760px 330px at 50% 42%, rgba(7,8,11,${0.9 * counter}), rgba(7,8,11,${0.35 * counter}) 70%, transparent)`}} />
				<div style={{position: 'absolute', left: 0, right: 0, top: 320, textAlign: 'center', opacity: counter, transform: `scale(${0.94 + 0.06 * counter})`}}>
					<div style={{fontSize: 190, fontWeight: 850, color: C.green, letterSpacing: -8, lineHeight: 1, fontVariantNumeric: 'tabular-nums'}}>{Math.max(12, shown)}</div>
					<div style={{fontSize: 46, fontWeight: 700, color: C.text, letterSpacing: -1.2, marginTop: 6}}>websites → agent CLIs, every command run live</div>
				</div>
				<div style={{position: 'absolute', left: 0, right: 0, top: 60, textAlign: 'center', opacity: Math.min(lerp(frame, 4, 16, 0, 1), lerp(frame, 150, 170, 1, 0))}}>
					<div style={{display: 'inline-block', fontSize: 52, fontWeight: 750, color: C.text, letterSpacing: -1.6, padding: '8px 26px', borderRadius: 14, background: 'rgba(7,8,11,0.82)'}}>Most websites become tools: {Wd.distinctSites} of {Wd.attempted} so far.</div>
				</div>
				<div style={{position: 'absolute', left: 0, right: 0, top: 900, display: 'flex', justifyContent: 'center', gap: 14, opacity: soft(frame, 200)}}>
					<Pill color={C.text} bg="rgba(7,8,11,0.9)" size={20}>
						{Wd.distinctSites} of {Wd.attempted} sites with 3+ verified commands · {fmtN(Wd.verifiedAll)} verified commands
					</Pill>
					<Pill color={C.accent} bg="rgba(7,8,11,0.9)" size={20}>
						first sweep {sub.sweep.attempted} sites · second sweep {sub.blaxel.sites} sites in Blaxel sandboxes
					</Pill>
				</div>
				<div style={{position: 'absolute', left: 0, right: 0, top: 948, textAlign: 'center', fontSize: 16, color: C.dimmer, opacity: soft(frame, 200)}}>
					{Wd.source} (one tile per site with ≥3 live-verified commands) · clify/proofs/sites.md · {sub.blaxel.source}
				</div>
			</AbsoluteFill>
		</SceneFade>
	);
};

// ---------- K: end card ----------
export const SceneEnd: React.FC = () => {
	const frame = useCurrentFrame();
	const s = pop(frame, 4, 30, 16, 0.8);
	return (
		<SceneFade inF={10} outF={30}>
			<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', fontFamily: SANS, transform: `scale(${1 + frame * 0.00012})`}}>
				<div style={{transform: `scale(${0.86 + 0.14 * s})`, opacity: Math.min(1, s * 1.4)}}>
					<Wordmark size={170} />
				</div>
				<div style={{marginTop: 30, fontSize: 64, fontWeight: 750, color: C.text, letterSpacing: -2, opacity: soft(frame, 16)}}>The web, rebuilt for agents.</div>
				<div style={{marginTop: 40, display: 'flex', gap: 16, opacity: soft(frame, 34)}}>
					{['clify add <url>', 'clify <site> <command>', 'clify mcp'].map((x) => (
						<div key={x} style={{fontFamily: MONO, fontSize: 28, color: C.text, padding: '12px 20px', borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.line2}`}}>
							<span style={{color: C.accent, fontWeight: 700}}>$ </span>
							{x}
						</div>
					))}
				</div>
				<div style={{marginTop: 40, fontFamily: MONO, fontSize: 30, color: C.text, opacity: soft(frame, 50)}}>{endCfg.repo}</div>
				<div style={{position: 'absolute', bottom: 150, fontSize: 22, color: C.dim, opacity: soft(frame, 70)}}>{endCfg.credits}</div>
			</AbsoluteFill>
		</SceneFade>
	);
};
