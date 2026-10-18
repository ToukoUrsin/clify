import React from 'react';
import {AbsoluteFill, Freeze, Img, OffthreadVideo, staticFile, useCurrentFrame} from 'remotion';
import {Check} from '../components/Glyphs';
import {Seq, Terminal} from '../components/Terminal';
import {Pill, SceneFade} from '../components/ui';
import {C, MONO, SANS, lerp, pop, soft} from '../theme';
import {fx, k, maskPhone, sub} from './data';

const FPS = 30;

const Kicker: React.FC<{text: string; color?: string}> = ({text, color = C.dim}) => (
	<div style={{fontSize: 20, fontWeight: 600, letterSpacing: 1.4, color, textTransform: 'uppercase'}}>{text}</div>
);
const Head: React.FC<{kicker: string; title: React.ReactNode; kc?: string}> = ({kicker, title, kc}) => {
	const frame = useCurrentFrame();
	return (
		<div style={{position: 'absolute', left: 60, top: 44, fontFamily: SANS, opacity: soft(frame, 0)}}>
			<Kicker text={kicker} color={kc} />
			<div style={{fontSize: 52, fontWeight: 750, color: C.text, letterSpacing: -1.6, marginTop: 4}}>{title}</div>
		</div>
	);
};
const Foot: React.FC<{text: string; x?: number}> = ({text, x = 60}) => (
	<div style={{position: 'absolute', left: x, top: 936, fontFamily: SANS, fontSize: 18, color: C.dimmer}}>{text}</div>
);

// ---------- E: the agent gets its own identity and logs itself in ----------
const I_INTRO = 104;
const SIGN_STEP = 9;
const signLines = () =>
	sub.accounts.signupLog.lines
		.map((l) => {
			const x = l.text.trim();
			if (x.startsWith('📜 reading')) return {t: l.t, text: 'reading the terms of appwrite.io', icon: 'open' as const};
			if (x.startsWith('📜 terms')) return {t: l.t, text: 'terms: automated accounts allowed', icon: 'done' as const};
			if (x.startsWith('🌐')) return {t: l.t, text: 'signup as clify agent', icon: 'open' as const};
			if (x.startsWith('📭')) return {t: l.t, text: 'waiting for the verification email…', icon: 'act' as const};
			if (x.startsWith('📨')) return {t: l.t, text: x.replace('📨 inkbox: ', 'inbox: ').replace(' · link found', ' · link found'), icon: 'done' as const, mail: true};
			if (x.startsWith('🔑')) return {t: l.t, text: 'signed in · session saved to the encrypted vault', icon: 'done' as const, key: true};
			const m = x.match(/^→ (\w+) (.*)$/);
			if (!m || m[1] === 'wait' || m[1] === 'done') return null;
			let arg = '';
			try {
				const j = JSON.parse(m[2]);
				arg = j.text || j.intent || j.url?.replace(/^https:\/\//, '') || '';
			} catch {}
			return {t: l.t, text: `${m[1].padEnd(14)} ${arg}`, icon: 'act' as const};
		})
		.filter(Boolean) as {t: number; text: string; icon: 'open' | 'act' | 'done'; mail?: boolean; key?: boolean}[];

export const SceneIdentity: React.FC = () => {
	const frame = useCurrentFrame();
	const A = sub.accounts;
	const L = signLines();
	const S0 = I_INTRO + 20;
	const seq = new Seq(S0).cmd('clify signup appwrite --url https://appwrite.io', 2.4, 6);
	const t0 = seq.t;
	L.forEach((l, i) => seq.at(t0 + i * SIGN_STEP).out(l.text, 'log', 1, {icon: l.icon}));
	const mailAt = t0 + L.findIndex((l) => l.mail) * SIGN_STEP;
	const keyAt = t0 + L.findIndex((l) => l.key) * SIGN_STEP;
	const smsAt = keyAt + 40;
	const gridAt = smsAt + 86;
	const intro = Math.min(lerp(frame, 0, 8, 0, 1), lerp(frame, I_INTRO - 10, I_INTRO, 1, 0));
	const main = Math.min(lerp(frame, I_INTRO, I_INTRO + 12, 0, 1), lerp(frame, gridAt - 10, gridAt, 1, 0));
	const grid = lerp(frame, gridAt, gridAt + 12, 0, 1);
	const mail = pop(frame, mailAt, 30, 13, 0.7);
	const sms = pop(frame, smsAt, 30, 13, 0.7);
	const elapsed = L[Math.max(0, Math.min(L.length - 1, Math.floor((frame - t0) / SIGN_STEP)))].t;
	return (
		<SceneFade>
			<AbsoluteFill style={{fontFamily: SANS}}>
				{/* intro: YC's framing */}
				{intro > 0 ? (
					<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', opacity: intro}}>
						<div style={{fontSize: 30, color: C.dim, fontWeight: 500}}>“Find something that blocks an agent: signup, captcha…”</div>
						<div style={{fontSize: 100, fontWeight: 800, color: C.text, letterSpacing: -4, marginTop: 18}}>No agent had a login.</div>
					</AbsoluteFill>
				) : null}
				{main > 0 ? (
					<AbsoluteFill style={{opacity: main}}>
						<Head kicker="Its own identity · real signup, Oct 18" title="So clify gives the agent one." />
						{/* identity card */}
						<div style={{position: 'absolute', left: 60, top: 196, width: 560, padding: 30, borderRadius: 20, background: 'linear-gradient(160deg, rgba(124,140,255,0.16), rgba(15,17,23,0.9))', border: `1px solid ${C.accent}55`, boxShadow: '0 40px 100px rgba(0,0,0,0.5)'}}>
							<div style={{display: 'flex', alignItems: 'center', gap: 18}}>
								<div style={{width: 72, height: 72, borderRadius: 18, background: `linear-gradient(140deg, ${C.accent}, #4B5BDB)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 30, fontWeight: 700, color: '#fff'}}>&gt;_</div>
								<div>
									<div style={{fontSize: 34, fontWeight: 750, color: C.text}}>clify agent</div>
									<div style={{fontSize: 19, color: C.dim}}>one persistent identity</div>
								</div>
							</div>
							{[
								['email', A.identity.email, 'Inkbox'],
								['phone', maskPhone(A.identity.phone), 'Inkbox SMS'],
								['per-site mail', '<site>@…primitive.email', 'Primitive'],
								['secrets', 'AES-256-GCM vault', 'never shown to the model'],
							].map(([a, b, c]) => (
								<div key={a} style={{marginTop: 20}}>
									<div style={{fontSize: 16, color: C.dim, textTransform: 'uppercase', letterSpacing: 1}}>
										{a} · {c}
									</div>
									<div style={{fontFamily: MONO, fontSize: 21, color: C.text, marginTop: 3}}>{b}</div>
								</div>
							))}
						</div>
						{/* signup log */}
						<div style={{position: 'absolute', left: 660, top: 196}}>
							<Terminal lines={seq.lines} width={760} height={620} fontSize={17} title="clify signup (headless)" prompt="~" />
						</div>
						<div style={{position: 'absolute', left: 660, top: 846, display: 'flex', alignItems: 'baseline', gap: 12}}>
							<span style={{fontFamily: MONO, fontSize: 40, fontWeight: 700, color: frame >= keyAt ? C.green : C.text}}>{frame < t0 ? 0 : elapsed} s</span>
							<span style={{fontSize: 20, color: C.dim}}>from reading the terms to signed in (real time, sped up)</span>
						</div>
						{/* email arrives */}
						<div style={{position: 'absolute', left: 1450, top: 196, width: 420, transform: `translateY(${(1 - mail) * 30}px) scale(${0.9 + 0.1 * mail})`, opacity: Math.min(1, mail * 1.3)}}>
							<div style={{fontSize: 16, color: C.dim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8}}>agent's inbox</div>
							<div style={{padding: 20, borderRadius: 16, background: '#F4F5F8', color: '#14161B', boxShadow: '0 30px 80px rgba(0,0,0,0.5)'}}>
								<div style={{fontSize: 15, color: '#6B7080'}}>noreply@appwrite.io</div>
								<div style={{fontSize: 22, fontWeight: 700, marginTop: 4}}>Account Verification for Appwrite</div>
								<div style={{marginTop: 12, display: 'inline-block', padding: '7px 14px', borderRadius: 8, background: '#FD366E', color: '#fff', fontWeight: 650, fontSize: 17}}>Verify email</div>
								<div style={{marginTop: 10, fontSize: 15, color: '#2F8F5B', fontWeight: 600}}>✓ link opened by the agent</div>
							</div>
						</div>
						{/* SMS arrives */}
						<div style={{position: 'absolute', left: 1450, top: 470, width: 420, transform: `translateY(${(1 - sms) * 30}px) scale(${0.9 + 0.1 * sms})`, opacity: Math.min(1, sms * 1.3)}}>
							<div style={{fontSize: 16, color: C.dim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8}}>agent's phone · SMS phone check</div>
							<div style={{padding: '18px 20px', borderRadius: 22, borderBottomLeftRadius: 6, background: '#2C2F36', color: '#F2F3F5', fontSize: 23, boxShadow: '0 30px 80px rgba(0,0,0,0.5)'}}>
								<div style={{fontSize: 14, color: '#9AA0AA', marginBottom: 4}}>{A.sms.from}</div>
								{A.sms.text.replace(A.sms.code, '')}
								<b style={{color: C.green, fontFamily: MONO}}>{A.sms.code}</b>
							</div>
							<div style={{marginTop: 12, fontSize: 19, color: C.text}}>
								<span style={{color: C.green}}>✓</span> code read by <span style={{fontFamily: MONO}}>clify inbox --sms</span>, phone verified
							</div>
						</div>
						<Foot text={`${A.signupLog.source} · ${A.source} (Phone)`} />
					</AbsoluteFill>
				) : null}
				{grid > 0 ? (
					<AbsoluteFill style={{opacity: grid}}>
						<div style={{position: 'absolute', left: 120, top: 120}}>
							<div style={{fontSize: 120, fontWeight: 800, color: C.green, letterSpacing: -5, lineHeight: 1}}>{Math.round(lerp(frame, gridAt + 4, gridAt + 40, 0, A.signedIn))}</div>
							<div style={{fontSize: 44, fontWeight: 700, color: C.text, letterSpacing: -1.2, marginTop: 8}}>real accounts the agent made itself, {A.loggedIn === A.signedIn ? `all ${A.signedIn}` : A.loggedIn} logged in</div>
							<div style={{fontSize: 24, color: C.dim, marginTop: 10, width: 1680, lineHeight: 1.4}}>
								{A.verified} verified by email{A.noVerification.length ? ` (${A.noVerification.map((x) => x[0].toUpperCase() + x.slice(1)).join(', ')} asked for none)` : ''} · sessions keep working over plain HTTP, browser closed
								<br />
								{A.stopped} other sites stopped it, {A.captchaStops} of them with a CAPTCHA or bot check
							</div>
						</div>
						<div style={{position: 'absolute', left: 120, top: 440, width: 1700, display: 'flex', flexWrap: 'wrap', gap: 18}}>
							{A.sites.map((s, i) => {
								const p = pop(frame, gridAt + 8 + i * 2.2, 30, 14, 0.6);
								return (
									<div key={s} style={{display: 'flex', alignItems: 'center', gap: 10, padding: '18px 26px', borderRadius: 14, background: 'rgba(61,214,140,0.08)', border: `1px solid ${C.green}44`, fontFamily: MONO, fontSize: 34, color: C.text, transform: `scale(${p})`, opacity: Math.min(1, p)}}>
										<Check size={32} color={C.green} />
										{s}
									</div>
								);
							})}
						</div>
						<Foot text={`${A.source}: ${A.signedIn} signed in (${A.verified} email-verified), ${A.stopped} stopped · Claude Opus 5.5, headless Chrome`} x={120} />
					</AbsoluteFill>
				) : null}
			</AbsoluteFill>
		</SceneFade>
	);
};
export const identityDur = () => {
	const L = signLines();
	const t0 = I_INTRO + 20 + Math.ceil('clify signup appwrite --url https://appwrite.io'.length / 2.4) + 6;
	const keyAt = t0 + L.findIndex((l) => l.key) * SIGN_STEP;
	return keyAt + 40 + 86 + 158;
};

// ---------- F: the race (live footage; swap film/race.json and re-render) ----------
// headline = ratio of means and paired per-run mean over all generated-spec runs (scripts/counts.mjs, as the README states them);
// the cards are the replayed run's own numbers, labelled as such
const x1 = (r: number) => `${r.toFixed(1)}×`;
export const SceneRace: React.FC<{dur: number}> = ({dur}) => {
	const frame = useCurrentFrame();
	const R = sub.race;
	const G = R.gen;
	const endAt = Math.round((((R.clifyDoneSec ?? R.playFromSec + 20) - R.playFromSec) * FPS) / R.playbackRate);
	const card = pop(frame, endAt, 30, 15, 0.8);
	const card2 = pop(frame, endAt + 14, 30, 15, 0.8);
	const b = R.browser;
	const c = R.clify;
	// the footage freezes on the clify agent's finish and dims under the results
	const dim = lerp(frame, endAt - 2, endAt + 12, 0, 0.74);
	const row = (label: string, r: typeof b, color: string, sub2: string) =>
		r ? (
			<div style={{flex: 1, padding: '16px 24px', borderRadius: 16, background: 'rgba(8,9,12,0.94)', border: `1px solid ${color}55`}}>
				<div style={{display: 'flex', alignItems: 'baseline', gap: 12}}>
					<div style={{fontSize: 24, fontWeight: 720, color}}>{label}</div>
					<div style={{fontSize: 17, color: C.dim}}>{sub2}</div>
				</div>
				<div style={{display: 'flex', gap: 34, marginTop: 8, fontFamily: MONO}}>
					{[
						[`${r.success}/${r.tasks}`, 'verified'],
						[`${(r.elapsedMs / 1000).toFixed(1)} s`, 'time'],
						[`$${r.costUsd.toFixed(2)}`, 'cost'],
						[String(r.toolCalls), 'tool calls'],
						[`${Math.round(r.peakRamMB).toLocaleString('en-US')} MB`, 'peak RAM'],
					].map(([v, l]) => (
						<div key={l}>
							<div style={{fontSize: 32, fontWeight: 700, color: C.text}}>{v}</div>
							<div style={{fontFamily: SANS, fontSize: 15, color: C.dim}}>{l}</div>
						</div>
					))}
				</div>
			</div>
		) : null;
	return (
		<SceneFade>
			<AbsoluteFill style={{fontFamily: SANS}}>
				<div style={{position: 'absolute', left: 60, top: 40, display: 'flex', alignItems: 'center', gap: 16}}>
					<div style={{fontSize: 44, fontWeight: 750, color: C.text, letterSpacing: -1.3}}>Same jobs, now with clify</div>
					<Pill color={C.green}>{G.specs.replace('/', ' of ')} CLIs generated by clify add</Pill>
					<Pill color={C.dim}>{R.speedNote}</Pill>
				</div>
				<div style={{position: 'absolute', left: 238, top: 112, width: 1444, height: 812, borderRadius: 16, overflow: 'hidden', border: `1px solid ${C.line2}`, boxShadow: '0 50px 120px rgba(0,0,0,0.6)'}}>
					<div style={{width: 1920, height: 1080, transform: `scale(${1444 / 1920})`, transformOrigin: '0 0'}}>
						<Freeze frame={endAt} active={frame >= endAt}>
								<OffthreadVideo src={staticFile('sub/race.mp4')} startFrom={Math.round(R.playFromSec * FPS)} playbackRate={R.playbackRate} muted style={{width: 1920, height: 1080, filter: `blur(${(dim / 0.74) * 3}px)`}} />
							</Freeze>
					</div>
					<AbsoluteFill style={{background: `rgba(5,6,9,${dim})`}} />
				</div>
				{frame >= endAt ? (
					<div style={{position: 'absolute', left: 238, width: 1444, top: 190, display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `scale(${0.92 + 0.08 * card})`, opacity: Math.min(1, card * 1.3)}}>
						<div style={{fontSize: 20, fontWeight: 650, letterSpacing: 1.4, color: C.dim, textTransform: 'uppercase', padding: '4px 14px', borderRadius: 8, background: 'rgba(8,9,12,0.9)'}}>
							all {G.runs} runs · every racer {b?.tasks}/{b?.tasks} verified
						</div>
						<div style={{display: 'flex', gap: 28, marginTop: 14}}>
							{[
								[x1(G.means.time), 'faster by mean time', `${Math.round(G.timeA)} s vs ${Math.round(G.timeC)} s · paired per-run mean ${x1(G.paired.time)}`],
								[x1(G.means.cost), 'cheaper by mean cost', `$${G.costA.toFixed(2)} vs $${G.costC.toFixed(2)} · paired ${x1(G.paired.cost)}`],
							].map(([big, small, det]) => (
								<div key={small} style={{padding: '16px 30px', borderRadius: 18, background: 'rgba(8,9,12,0.95)', border: `1px solid ${C.green}66`, boxShadow: '0 30px 80px rgba(0,0,0,0.5)'}}>
									<div style={{display: 'flex', alignItems: 'baseline', gap: 14}}>
										<span style={{fontSize: 84, fontWeight: 800, color: C.green, letterSpacing: -3}}>{big}</span>
										<span style={{fontSize: 28, color: C.text, fontWeight: 650}}>{small}</span>
									</div>
									<div style={{fontFamily: MONO, fontSize: 19, color: C.dim, marginTop: 2}}>{det}</div>
								</div>
							))}
						</div>
					</div>
				) : null}
				{frame >= endAt ? (
					<div style={{position: 'absolute', left: 238, width: 1444, top: 560, transform: `translateY(${(1 - card2) * 40}px)`, opacity: Math.min(1, card2 * 1.3)}}>
						<div style={{fontSize: 17, color: C.dim, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8}}>the run on screen ({R.runId})</div>
						<div style={{display: 'flex', gap: 20}}>
							{row(R.browserLabel ?? 'browser agent', b, C.text, R.browserSub ?? 'Playwright MCP')}
							{row(R.clifyLabel ?? 'clify agent', c, C.green, R.clifySub ?? 'site CLIs in the shell')}
						</div>
					</div>
				) : null}
				<Foot text={`${R.readme} · ${R.summary} · ${R.video} · svix hand-written (its robots.txt forbids exploring)`} />
			</AbsoluteFill>
		</SceneFade>
	);
};

// ---------- H: blocked by a CAPTCHA → ask its human → continue ----------
export const SceneAsk: React.FC = () => {
	const frame = useCurrentFrame();
	const A = sub.ask;
	const stop = pop(frame, 16, 30, 12, 0.7);
	const mail = pop(frame, 44, 30, 14, 0.8);
	const reply = pop(frame, 128, 30, 13, 0.7);
	const cont = soft(frame, 176);
	const hhmmss = (iso: string) => iso.slice(11, 19);
	return (
		<SceneFade>
			<AbsoluteFill style={{fontFamily: SANS}}>
				<Head kicker="Blocked? It asks · real run, Oct 18" title="It never solves a CAPTCHA. It asks." kc={C.amber} />
				{/* the blocked page */}
				<div style={{position: 'absolute', left: 60, top: 196, width: 760, borderRadius: 14, overflow: 'hidden', border: `1px solid ${C.line2}`, background: '#fff', boxShadow: '0 40px 100px rgba(0,0,0,0.5)'}}>
					<div style={{height: 40, background: '#1A1C22', display: 'flex', alignItems: 'center', padding: '0 14px', gap: 8}}>
						{['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
							<div key={c} style={{width: 11, height: 11, borderRadius: 6, background: c}} />
						))}
						<div style={{marginLeft: 10, fontFamily: MONO, fontSize: 14, color: '#C9CDD6'}}>tally.so/signup</div>
					</div>
					<div style={{height: 660, overflow: 'hidden', position: 'relative'}}>
						<Img src={staticFile(A.shot)} style={{width: 1200, marginLeft: -220, marginTop: -170}} />
						<div style={{position: 'absolute', left: 150, top: 520, transform: `scale(${stop}) rotate(-3deg)`, opacity: Math.min(1, stop), padding: '12px 20px', borderRadius: 10, border: `3px solid ${C.amber}`, background: '#1A1408EE', fontFamily: MONO, color: C.amber, fontSize: 26, fontWeight: 700, whiteSpace: 'nowrap'}}>
							■ CAPTCHA detected · stop
						</div>
					</div>
				</div>
				{/* the email thread */}
				<div style={{position: 'absolute', left: 860, top: 196, width: 1000, transform: `translateY(${(1 - mail) * 30}px)`, opacity: Math.min(1, mail * 1.3)}}>
					<div style={{padding: '22px 26px', borderRadius: 16, background: '#F4F5F8', color: '#14161B', boxShadow: '0 30px 80px rgba(0,0,0,0.5)'}}>
						<div style={{display: 'flex', justifyContent: 'space-between', fontSize: 16, color: '#6B7080'}}>
							<span>
								<b style={{color: '#14161B'}}>clify</b> &lt;{A.from}&gt; → its human
							</span>
							<span>{hhmmss(A.sentAt)} UTC</span>
						</div>
						<div style={{fontSize: 28, fontWeight: 700, marginTop: 6, lineHeight: 1.2}}>{A.subject}</div>
						<div style={{fontSize: 20, color: '#3A3F4B', marginTop: 10}}>{A.question}</div>
						<div style={{display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap'}}>
							{A.options.map((o) => (
								<div key={o.key} style={{fontFamily: MONO, fontSize: 16, padding: '6px 12px', borderRadius: 8, border: '1px solid #C9CDD6', background: '#fff'}}>
									{o.key}
								</div>
							))}
							<div style={{fontSize: 16, padding: '6px 12px', borderRadius: 8, background: '#E6E8EE', color: '#3A3F4B'}}>📎 screenshot.jpg</div>
						</div>
					</div>
					<div style={{marginTop: 18, marginLeft: 220, padding: '18px 24px', borderRadius: 16, background: '#E8F7EF', color: '#14161B', transform: `translateY(${(1 - reply) * 24}px) scale(${0.92 + 0.08 * reply})`, transformOrigin: '100% 0', opacity: Math.min(1, reply * 1.3), boxShadow: '0 30px 80px rgba(0,0,0,0.45)'}}>
						<div style={{display: 'flex', justifyContent: 'space-between', fontSize: 16, color: '#4B6B58'}}>
							<span>Re: from the asked address</span>
							<span>{hhmmss(A.answer.receivedAt)} UTC</span>
						</div>
						<div style={{fontSize: 40, fontWeight: 750, marginTop: 4, fontFamily: MONO}}>{A.answer.decision}</div>
						<div style={{fontSize: 16, color: '#2F8F5B', fontWeight: 600, marginTop: 4}}>{A.answer.verified ? '✓ sender verified (DMARC) · only the asked address counts' : ''}</div>
					</div>
					<div style={{marginTop: 22, display: 'flex', alignItems: 'center', gap: 14, fontSize: 26, color: C.text, opacity: cont}}>
						<Check size={30} color={C.green} /> skipped tally, moved on to its next task
					</div>
				</div>
				<div style={{position: 'absolute', left: 860, top: 760, display: 'flex', gap: 12, opacity: soft(frame, 200)}}>
					<Pill color={C.text} size={19}>
						cc / forward: another agent can answer instead
					</Pill>
					<Pill color={C.text} size={19}>
						writes wait for an emailed “approve”
					</Pill>
				</div>
				<Foot text={`${A.proof} · ${A.source} · the human here is a test mailbox (Inkbox); clify mails from Primitive`} />
			</AbsoluteFill>
		</SceneFade>
	);
};

export {fx, k};

// ---------- R0: hook — the browser agent at work in a real dashboard (real speed) ----------
export const SceneRaceHook: React.FC<{dur: number}> = ({dur}) => {
	const frame = useCurrentFrame();
	const R = sub.race;
	// left racer lane of the dashboard: x 25-950, y 95-660 of the 1920x1080 recording
	const CX = 25;
	const CY = 95;
	const CW = 945;
	const CH = 565;
	const sc = 1.32;
	const W = CW * 1.32;
	const H = CH * 1.32;
	return (
		<SceneFade inF={6}>
			<AbsoluteFill style={{fontFamily: SANS}}>
				<div style={{position: 'absolute', left: 60, top: 40, opacity: soft(frame, 0)}}>
					<Kicker text={`${R.browserLabel} · real run, real speed`} />
					<div style={{fontSize: 48, fontWeight: 750, color: C.text, letterSpacing: -1.4, marginTop: 4}}>An agent doing real work in a web dashboard.</div>
				</div>
				<div style={{position: 'absolute', left: 60, top: 170, width: W, height: H, borderRadius: 16, overflow: 'hidden', border: `1px solid ${C.line2}`, boxShadow: '0 50px 120px rgba(0,0,0,0.6)', background: '#0B0F17'}}>
					<div style={{position: 'absolute', left: -CX * sc, top: -CY * sc, width: 1920, height: 1080, transform: `scale(${sc})`, transformOrigin: '0 0'}}>
						<OffthreadVideo src={staticFile('sub/race-realtime.mp4')} startFrom={Math.round((R.hookFromSec ?? 0) * FPS)} muted style={{width: 1920, height: 1080}} />
					</div>
				</div>
				<div style={{position: 'absolute', left: 60 + W + 40, top: 180, width: 1920 - (60 + W + 40) - 60}}>
					<div style={{fontSize: 18, color: C.dim, textTransform: 'uppercase', letterSpacing: 1.2}}>its jobs, signed in</div>
					{(R.jobs ?? []).map((j, i) => (
						<div key={j.id} style={{marginTop: 16, opacity: soft(frame, 8 + i * 5), transform: `translateX(${(1 - soft(frame, 8 + i * 5)) * 12}px)`}}>
							<div style={{fontFamily: MONO, fontSize: 22, color: C.text, fontWeight: 700}}>{j.label.toLowerCase()}</div>
							<div style={{fontSize: 17, color: C.dim}}>{j.kind}</div>
						</div>
					))}
				</div>
				<Foot text={`${R.realtime ?? ''} from ${R.hookFromSec ?? 0} s · the run replayed below (${R.model ?? ''})`} />
			</AbsoluteFill>
		</SceneFade>
	);
};
