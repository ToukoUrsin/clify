import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {ClaudeCode} from '../components/ClaudeCode';
import {Check, Spinner} from '../components/Glyphs';
import {Seq, Terminal} from '../components/Terminal';
import {SceneFade, Wordmark} from '../components/ui';
import {FFBadge, Stat, Struggle, heroRun, heroTask, statsAt} from '../scenes/Struggle';
import {C, MONO, SANS, clamp, ease, fmtTokens, lerp, pop, soft} from '../theme';
import {fx, k, plural, sub} from './data';

const FPS = 30;

// ---------- A: the agent fighting a website (real run, clicks + snapshots) ----------
export const A_FF = 6;
export const SceneStruggle: React.FC = () => (
	<Struggle
		ff={A_FF}
		typeAt={-38}
		kicker="Browser agent · clicks + page snapshots · real run"
		ccH={720}
		footY={936}
		foot={`One of 20 benchmark tasks: 10 pages to read · Claude Code (Opus 5.5) + Playwright MCP, no page JavaScript · ${sub.hero.browser.source.replace('/result.json', '')}`}
	/>
);

// ---------- B: the same task, the site as a CLI ----------
export const B_FF = 4;
export const SceneCli: React.FC = () => {
	const frame = useCurrentFrame();
	const b = sub.hero.browser;
	const h = sub.hero.cli;
	const c = heroRun('cli');
	const START = 10;
	const sToF = (s: number) => START + (s * FPS) / B_FF;
	const fToS = (f: number) => ((f - START) * B_FF) / FPS;
	const t = Math.min(c.wallMs / 1000, Math.max(0, fToS(frame)));
	const endF = sToF(c.wallMs / 1000);
	const done = frame >= endF;
	const {tools, tok} = statsAt(c, t);
	const p1 = pop(frame, endF + 4, 30, 13, 0.7);
	const p2 = pop(frame, endF + 12, 30, 13, 0.7);
	const p3 = soft(frame, endF + 22);
	return (
		<SceneFade inF={8}>
			<AbsoluteFill style={{fontFamily: SANS}}>
				<div style={{position: 'absolute', left: 60, top: 44}}>
					<div style={{fontSize: 20, fontWeight: 600, letterSpacing: 1.4, color: C.green, textTransform: 'uppercase'}}>Same agent · same question · real run</div>
					<div style={{fontSize: 52, fontWeight: 750, color: C.text, letterSpacing: -1.6, marginTop: 4}}>Now the website is a CLI.</div>
				</div>
				<FFBadge x={1590} y={58} ff={B_FF} />
				<div style={{position: 'absolute', left: 60, top: 196}}>
					<ClaudeCode run={c} width={1060} height={720} fontSize={16} title="claude — bash + clify (headless)" sToF={sToF} fToS={fToS} typeAt={-200} showPrompt={heroTask()} />
				</div>
				<div style={{position: 'absolute', left: 1180, top: 200, width: 690}}>
					<div style={{fontSize: 19, fontWeight: 650, color: C.green, letterSpacing: 1.2, textTransform: 'uppercase'}}>clify agent</div>
					<div style={{display: 'flex', gap: 26, marginTop: 8}}>
						<Stat label="seconds" value={t.toFixed(1)} color={done ? C.green : C.text} w={190} />
						<Stat label="tool calls" value={String(tools)} w={150} />
						<Stat label="tokens" value={fmtTokens(tok)} w={200} />
					</div>
					<div style={{marginTop: 34, fontSize: 19, fontWeight: 650, color: C.dim, letterSpacing: 1.2, textTransform: 'uppercase'}}>browser agent, same task</div>
					<div style={{display: 'flex', gap: 26, marginTop: 8, opacity: 0.8}}>
						<Stat label="seconds" value={(b.wallMs / 1000).toFixed(1)} w={190} />
						<Stat label="tool calls" value={String(b.toolCalls)} w={150} />
						<Stat label="tokens" value={k(b.tokens)} w={200} />
					</div>
					<div style={{marginTop: 50, height: 260}}>
						{done ? (
							<>
								<div style={{fontSize: 84, fontWeight: 800, color: C.green, letterSpacing: -3.5, lineHeight: 1.02, transform: `scale(${p1})`, transformOrigin: '0 50%'}}>
									{fx(b.wallMs / h.wallMs)} <span style={{color: C.text, fontWeight: 700, fontSize: 52, letterSpacing: -1.5}}>faster</span>
								</div>
								<div style={{fontSize: 84, fontWeight: 800, color: C.green, letterSpacing: -3.5, lineHeight: 1.02, marginTop: 6, transform: `scale(${p2})`, transformOrigin: '0 50%'}}>
									{fx(b.tokens / h.tokens)} <span style={{color: C.text, fontWeight: 700, fontSize: 52, letterSpacing: -1.5}}>fewer tokens</span>
								</div>
								<div style={{display: 'flex', alignItems: 'center', gap: 12, marginTop: 22, fontSize: 25, color: C.text, opacity: p3}}>
									<Check size={30} color={C.green} /> Both correct: <b>{h.answer}</b>
								</div>
							</>
						) : null}
					</div>
				</div>
				<div style={{position: 'absolute', left: 1180, top: 936, width: 690, fontSize: 18, color: C.dimmer, opacity: lerp(frame, 30, 50, 0, 1)}}>
					{sub.hero.cli.source.replace('/result.json', '')} vs {sub.hero.browser.source.replace('/result.json', '')}
				</div>
			</AbsoluteFill>
		</SceneFade>
	);
};

// ---------- G: the committed 20-task benchmark, a short secondary proof (headline ratios + median time per mode) ----------
export const SceneBench: React.FC = () => {
	const frame = useCurrentFrame();
	const B = sub.bench;
	const allOk = [B.browserUi, B.browser, B.cli].every((m) => m.ok === m.n);
	const modes: [string, typeof B.cli, boolean][] = [
		['browser agent, clicks + snapshots', B.browserUi, false],
		['browser agent + page JavaScript', B.browser, false],
		['clify agent', B.cli, true],
	];
	const maxSec = Math.max(...modes.map(([, m]) => m.medianSec));
	const BAR = 840;
	return (
		<SceneFade inF={8}>
			<AbsoluteFill style={{fontFamily: SANS}}>
				<div style={{position: 'absolute', left: 60, top: 44, opacity: soft(frame, 0)}}>
					<div style={{fontSize: 20, fontWeight: 600, letterSpacing: 1.4, color: C.dim, textTransform: 'uppercase'}}>
						Second proof · {B.nTasks} easy public read-only tasks · {B.nSites} sites · hand-written specs
					</div>
					<div style={{fontSize: 52, fontWeight: 750, color: C.text, letterSpacing: -1.6, marginTop: 4}}>Faster on {B.nTasks} easy public tasks too.</div>
				</div>
				<div style={{position: 'absolute', left: 60, right: 60, top: 210, display: 'flex', gap: 28}}>
					{[
						[fx(B.vsUi.faster), 'faster', 'median time'],
						[fx(B.vsUi.tokens), 'fewer tokens', 'median tokens'],
						[fx(B.vsUi.cheaper), 'cheaper', 'total cost'],
					].map(([big, small, det], i) => {
						const p = pop(frame, 8 + i * 5, 30, 15, 0.8);
						return (
							<div key={small} style={{flex: 1, padding: '24px 34px', borderRadius: 20, background: 'rgba(61,214,140,0.06)', border: `1px solid ${C.green}44`, transform: `scale(${0.94 + 0.06 * p})`, opacity: Math.min(1, p * 1.4)}}>
								<div style={{display: 'flex', alignItems: 'baseline', gap: 14}}>
									<span style={{fontSize: 104, fontWeight: 800, color: C.green, letterSpacing: -4, lineHeight: 1}}>{big}</span>
									<span style={{fontSize: 36, color: C.text, fontWeight: 650}}>{small}</span>
								</div>
								<div style={{fontSize: 21, color: C.dim, marginTop: 10}}>vs clicks-only browser agent · {det}</div>
							</div>
						);
					})}
				</div>
				<div style={{position: 'absolute', left: 60, right: 60, top: 470, padding: '28px 34px', borderRadius: 20, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.line}`, opacity: soft(frame, 14)}}>
					<div style={{fontSize: 18, fontWeight: 600, letterSpacing: 1.2, color: C.dim, textTransform: 'uppercase'}}>median time per task · {B.cli.n} runs per mode</div>
					{modes.map(([label, m, hl], i) => {
						const g = interpolate(frame, [18 + i * 6, 48 + i * 6], [0, 1], {...clamp, easing: ease.out});
						return (
							<div key={label} style={{display: 'flex', alignItems: 'center', gap: 24, marginTop: 22}}>
								<div style={{width: 470, fontSize: 26, color: hl ? C.text : C.dim, fontWeight: hl ? 700 : 500}}>{label}</div>
								<div style={{width: BAR, height: 34, position: 'relative'}}>
									<div style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: (BAR * m.medianSec * g) / maxSec, borderRadius: '0 6px 6px 0', background: hl ? C.green : 'rgba(200,205,215,0.28)'}} />
								</div>
								<div style={{fontFamily: MONO, fontSize: 26, color: C.text, opacity: g, whiteSpace: 'nowrap'}}>
									{m.medianSec.toFixed(1)} s <span style={{color: C.dim, fontSize: 20}}>· {k(m.medianTokens)} tok · {m.ok}/{m.n}</span>
								</div>
							</div>
						);
					})}
					<div style={{fontSize: 22, color: C.text, marginTop: 24, opacity: soft(frame, 40)}}>
						{allOk ? `every mode ${B.cli.ok}/${B.cli.n} correct` : `clify ${B.cli.ok}/${B.cli.n} correct`} · {B.practice}
					</div>
				</div>
				<div style={{position: 'absolute', left: 60, top: 936, fontSize: 18, color: C.dimmer}}>
					{B.readme} · {B.source} · median time and tokens, total cost · Claude Code -p, {B.model.join(', ')} · every answer graded against the live site
				</div>
			</AbsoluteFill>
		</SceneFade>
	);
};

// ---------- G (v11 cut): the race's third lane, an agent with curl and the same saved sessions (race mode D) ----------
export const SceneCurl: React.FC = () => {
	const frame = useCurrentFrame();
	const U = sub.curl;
	const s = (t: number) => `${Math.round(t)} s`;
	const usd = (c: number) => `$${c.toFixed(2)}`;
	// README rounding (scripts/counts.mjs x1), so the screen says exactly what the README says
	const x1 = (r: number) => `${r.toFixed(1)}×`;
	const lanes: [string, string, {time: number; cost: number}, string, boolean][] = [
		['browser agent, clicks + screenshots', 'Playwright MCP', U.A, `round 5 mean, ${U.A.n} runs`, false],
		['agent + curl, same saved sessions', 'curl, jq, python3 · no clify, no browser', U.D, `${U.runs} runs`, false],
		['clify agent', 'Bash + CLIs generated by clify add', U.C, `the same ${U.runs} runs`, true],
	];
	const maxT = Math.max(...lanes.map(([, , m]) => m.time));
	const maxC = Math.max(...lanes.map(([, , m]) => m.cost));
	const TB = 500;
	const CB = 340;
	return (
		<SceneFade inF={8}>
			<AbsoluteFill style={{fontFamily: SANS}}>
				<div style={{position: 'absolute', left: 60, top: 44, opacity: soft(frame, 0)}}>
					<div style={{fontSize: 20, fontWeight: 600, letterSpacing: 1.4, color: C.dim, textTransform: 'uppercase'}}>
						Same race, a third lane · {U.tasks} jobs in signed-in dashboards · same model, prompt and accounts
					</div>
					<div style={{fontSize: 52, fontWeight: 750, color: C.text, letterSpacing: -1.6, marginTop: 4}}>Even vs an agent with curl and the same logins.</div>
				</div>
				<div style={{position: 'absolute', left: 60, right: 60, top: 196, padding: '28px 34px 36px', borderRadius: 20, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.line}`, opacity: soft(frame, 6)}}>
					<div style={{display: 'flex', alignItems: 'baseline', fontSize: 18, fontWeight: 600, letterSpacing: 1.2, color: C.dim, textTransform: 'uppercase'}}>
						<div style={{width: 564}}>mean per run · every lane {U.tasks}/{U.tasks} verified, every run</div>
						<div style={{width: TB + 16 + 120 + 40}}>time</div>
						<div>cost</div>
					</div>
					{lanes.map(([label, tools, m, runs, hl], i) => {
						const g = interpolate(frame, [14 + i * 6, 44 + i * 6], [0, 1], {...clamp, easing: ease.out});
						const bar = (w: number) => ({width: w, height: 44, borderRadius: '0 6px 6px 0', background: hl ? C.green : i === 1 ? 'rgba(200,205,215,0.46)' : 'rgba(200,205,215,0.26)'});
						return (
							<div key={label} style={{display: 'flex', alignItems: 'center', marginTop: 40}}>
								<div style={{width: 540, marginRight: 24}}>
									<div style={{fontSize: 29, color: hl ? C.text : '#C9CDD5', fontWeight: hl ? 700 : 550, whiteSpace: 'nowrap'}}>{label}</div>
									<div style={{fontSize: 20, color: C.dim, marginTop: 5, whiteSpace: 'nowrap'}}>
										{tools} · {U.tasks}/{U.tasks} · {runs}
									</div>
								</div>
								<div style={{width: TB, marginRight: 16}}>
									<div style={bar((TB * m.time * g) / maxT)} />
								</div>
								<div style={{width: 120, marginRight: 40, fontFamily: MONO, fontSize: 33, color: C.text, opacity: g}}>{s(m.time)}</div>
								<div style={{width: CB, marginRight: 16}}>
									<div style={bar((CB * m.cost * g) / maxC)} />
								</div>
								<div style={{fontFamily: MONO, fontSize: 33, color: C.text, opacity: g}}>{usd(m.cost)}</div>
							</div>
						);
					})}
				</div>
				<div style={{position: 'absolute', left: 60, right: 60, top: 690, padding: '28px 34px', borderRadius: 20, background: 'rgba(61,214,140,0.06)', border: `1px solid ${C.green}44`, opacity: soft(frame, 40), transform: `translateY(${(1 - soft(frame, 40)) * 10}px)`}}>
					<div style={{fontSize: 35, fontWeight: 650, color: C.text, letterSpacing: -0.6}}>curl re-discovers forms, CSRF and API paths every run; clify found and verified them once.</div>
					<div style={{fontSize: 23, color: C.dim, marginTop: 10}}>
						paired, the same {U.runs} runs: curl {x1(U.paired.time)} slower and {x1(U.paired.cost)} the cost of clify · most of the browser gap is the browser itself
					</div>
				</div>
				<div style={{position: 'absolute', left: 60, top: 936, fontSize: 18, color: C.dimmer}}>
					browser: round 5 mean of {U.A.n} runs · curl + saved sessions and clify: the same {U.runs} runs (race mode D) · {U.readme} · {U.source} · Claude Code, {sub.race.model}
				</div>
			</AbsoluteFill>
		</SceneFade>
	);
};

// ---------- C: title ----------
export const SceneTitle: React.FC = () => {
	const frame = useCurrentFrame();
	const s = pop(frame, 2, 30, 16, 0.8);
	return (
		<SceneFade inF={6} outF={10}>
			<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', fontFamily: SANS}}>
				<div style={{transform: `scale(${0.86 + 0.14 * s})`, opacity: Math.min(1, s * 1.5)}}>
					<Wordmark size={170} />
				</div>
				<div style={{marginTop: 34, fontSize: 52, fontWeight: 650, color: C.text, letterSpacing: -1.4, opacity: soft(frame, 14), transform: `translateY(${(1 - soft(frame, 14)) * 12}px)`}}>
					turns websites into CLIs and MCP tools for agents.
				</div>
			</AbsoluteFill>
		</SceneFade>
	);
};

// ---------- D: clify add <url> (automatic, real log) ----------
const shortUrl = (u: string) => u.replace(/^https?:\/\//, '').replace(/^www\./, '');
type AddLine = {t: number; text: string; icon: 'open' | 'act' | 'stop' | 'done'; kind?: 'ok' | 'warn' | 'dim'};
const addLines = (): AddLine[] => {
	const out: AddLine[] = [];
	let held = 0;
	for (const l of sub.add.lines) {
		const x = l.text.trim();
		if (x.startsWith('🔭')) out.push({t: l.t, text: `exploring ${shortUrl(x.split(' ').pop()!)}`, icon: 'open'});
		else if (x.startsWith('→ done')) continue;
		else if (x.startsWith('→')) {
			const m = x.match(/^→ (\w+) (.*)$/);
			if (!m) continue;
			let intent = '';
			try {
				const j = JSON.parse(m[2]);
				intent = j.intent || j.direction || j.option || '';
			} catch {}
			out.push({t: l.t, text: `${m[1].padEnd(6)} ${intent}`, icon: 'act'});
		} else if (x.startsWith('⛔')) {
			if (++held > 2) continue;
			out.push({t: l.t, text: `held, never sent: ${x.replace('⛔ held write ', '').replace(/https:\/\//, '').slice(0, 60)}`, icon: 'stop'});
		} else if (x.startsWith('🚫')) out.push({t: l.t, text: x.replace('🚫 ', '').replace(/https:\/\/www\./, ''), icon: 'stop'});
		else if (x.startsWith('📼')) out.push({t: l.t, text: x.replace('📼 ', ''), icon: 'done'});
		else if (x.startsWith('🧠')) out.push({t: l.t, text: x.replace('🧠 ', ''), icon: 'open'});
		else if (x.startsWith('🔎')) out.push({t: l.t, text: 'verify: calling every command live', icon: 'open'});
		else if (x.startsWith('✓')) out.push({t: l.t, text: x.replace('✓ ', '✓ '), icon: 'done', kind: 'ok'});
		else if (x.startsWith('✗')) out.push({t: l.t, text: `✗ ${x.slice(2).split(':')[0]}: ${x.includes('403') ? 'HTTP 403' : 'empty'}`, icon: 'stop', kind: 'warn'});
		else if (x.startsWith('🗑')) out.push({t: l.t, text: `dropped ${x.slice(2).split(':')[0].trim()} (failed the live check)`, icon: 'stop', kind: 'dim'});
	}
	return out;
};
export const ADD_STEP = 3; // frames per log line
export const SceneAdd: React.FC = () => {
	const frame = useCurrentFrame();
	const A = sub.add;
	const CS = sub.coldStart;
	const L = addLines();
	const seq = new Seq(8).cmd(`clify add ${A.url}`, 2.2, 8);
	const t0 = seq.t;
	L.forEach((l, i) => seq.at(t0 + i * ADD_STEP).out(l.text, 'log', 1, {icon: l.icon}));
	const endLog = t0 + L.length * ADD_STEP;
	// the installed CLI, run live afterwards (real output)
	const out = JSON.parse(A.run.stdout);
	const runAt = endLog + 26;
	seq.at(runAt).cmd(A.run.cmd, 2.4, 0).wait(Math.round((A.run.ms / 1000) * FPS));
	const jl = JSON.stringify({ok: out.ok, status: out.status, count: out.count, data: out.data.map((d: {title: string}) => ({title: d.title}))}, null, 2).split('\n');
	seq.json(jl, 0.5);
	seq.out(`exit ${A.run.exit} · ${A.run.ms} ms`, 'meta');
	// real clock: map the current log line back to its timestamp
	const idx = Math.max(0, Math.min(L.length - 1, Math.floor((frame - t0) / ADD_STEP)));
	const realT = frame < t0 ? 0 : frame >= endLog ? A.seconds : L[idx].t;
	// distinct commands: the repair round re-checks some of them
	const verifiedSoFar = new Set(L.filter((l, i) => l.kind === 'ok' && t0 + i * ADD_STEP <= frame).map((l) => l.text.replace(/\s*\(.*$/, '').replace(/^[^a-z]*/, ''))).size;
	// drops count only once the replayed log has reached them
	const droppedSoFar = L.filter((l, i) => l.kind === 'dim' && t0 + i * ADD_STEP <= frame).length;
	const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
	const stats: [string, string][] = [
		[String(A.explored.steps), 'steps explored by the agent'],
		[String(A.explored.recorded), 'requests recorded'],
		[String(A.explored.heldWrites), 'writes held, never sent'],
	];
	return (
		<SceneFade>
			<AbsoluteFill style={{fontFamily: SANS}}>
				<div style={{position: 'absolute', left: 60, top: 44}}>
					<div style={{fontSize: 20, fontWeight: 600, letterSpacing: 1.4, color: C.dim, textTransform: 'uppercase'}}>Fully automatic · real run, overnight</div>
					<div style={{fontSize: 52, fontWeight: 750, color: C.text, letterSpacing: -1.6, marginTop: 4}}>
						<span style={{fontFamily: MONO, color: C.accent, fontSize: 48}}>clify add</span> a URL
					</div>
				</div>
				<div style={{position: 'absolute', left: 60, top: 190}}>
					<Terminal lines={seq.lines} width={1130} height={730} fontSize={17} title="clify add (headless Chrome + Claude)" prompt="~" />
				</div>
				<div style={{position: 'absolute', left: 1240, top: 196, width: 630}}>
					<div style={{display: 'flex', alignItems: 'baseline', gap: 14}}>
						<div style={{fontFamily: MONO, fontSize: 64, fontWeight: 700, color: C.text, letterSpacing: -2, fontVariantNumeric: 'tabular-nums'}}>{mm(realT)}</div>
						<div style={{fontSize: 20, color: C.dim}}>real time{frame > t0 && frame < endLog ? ', sped up' : ''}</div>
					</div>
					<div style={{marginTop: 26}}>
						{stats.map(([n, l], i) => {
							const show = frame >= t0 + (i === 2 ? 20 : i === 1 ? L.findIndex((x) => x.text.startsWith('recorded')) * ADD_STEP : 4);
							return (
								<div key={l} style={{display: 'flex', alignItems: 'baseline', gap: 14, height: 50, opacity: show ? 1 : 0.15}}>
									<span style={{fontFamily: MONO, fontSize: 40, fontWeight: 700, color: i === 2 ? C.amber : C.text, width: 90}}>{n}</span>
									<span style={{fontSize: 23, color: C.dim}}>{l}</span>
								</div>
							);
						})}
					</div>
					<div style={{marginTop: 18, padding: '18px 24px', borderRadius: 16, background: verifiedSoFar ? C.greenSoft : 'rgba(255,255,255,0.03)', border: `1px solid ${verifiedSoFar ? C.green + '55' : C.line}`}}>
						<div style={{display: 'flex', alignItems: 'center', gap: 16}}>
							<div style={{fontFamily: MONO, fontSize: 72, fontWeight: 800, color: C.green, letterSpacing: -2, width: 90}}>{verifiedSoFar}</div>
							<div style={{fontSize: 26, color: C.text, lineHeight: 1.25}}>
								{verifiedSoFar === 1 ? 'command' : 'commands'} verified live
								<div style={{fontSize: 19, color: C.dim, opacity: droppedSoFar ? 1 : 0}}>
									{plural(droppedSoFar, 'command')} dropped after failing the live check
								</div>
							</div>
						</div>
						<div style={{display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14}}>
							{A.commands.map((c, i) => {
								const at = t0 + L.findIndex((l) => l.kind === 'ok' && l.text.includes(c)) * ADD_STEP;
								const s = pop(frame, at, 30, 14, 0.6);
								return (
									<div key={c} style={{fontFamily: MONO, fontSize: 15, color: C.text, padding: '5px 9px', borderRadius: 7, background: 'rgba(10,12,16,0.6)', border: `1px solid ${C.green}44`, transform: `scale(${s})`, opacity: Math.min(1, s)}}>
										<span style={{color: C.green}}>✓</span> {c}
									</div>
								);
							})}
						</div>
					</div>
				</div>
				<div style={{position: 'absolute', left: 1240, top: 826, width: 630, padding: '12px 20px', borderRadius: 14, border: `1px solid ${C.accent}55`, background: C.accentSoft, opacity: soft(frame, runAt + 30), transform: `translateY(${(1 - soft(frame, runAt + 30)) * 14}px)`}}>
					<div style={{fontSize: 16, fontWeight: 650, color: C.accent, letterSpacing: 1, textTransform: 'uppercase'}}>Cold start, no human</div>
					<div style={{fontSize: 21, color: C.text, marginTop: 4, lineHeight: 1.3}}>
						A fresh agent cloned {CS.cloned}, ran <span style={{fontFamily: MONO}}>clify add {shortUrl(CS.url).replace(/\/$/, '')}</span> itself ({CS.verified}/{CS.generated} verified) and answered in {CS.totalSec} s.
					</div>
				</div>
				<div style={{position: 'absolute', left: 60, top: 936, fontSize: 18, color: C.dimmer}}>
					{A.log} · {A.source} · {A.run.source} · {CS.source}
				</div>
			</AbsoluteFill>
		</SceneFade>
	);
};
export const addDur = () => {
	const L = addLines();
	const typed = 8 + Math.ceil(`clify add ${sub.add.url}`.length / 2.2) + 8;
	const run = typed + L.length * ADD_STEP + 26 + Math.ceil(sub.add.run.cmd.length / 2.4) + Math.round((sub.add.run.ms / 1000) * FPS) + 20;
	return run + 105;
};

export {Spinner};
