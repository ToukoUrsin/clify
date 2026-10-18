import captureRaw from './data/capture.json';
import evidenceRaw from './data/evidence.json';
import shotsRaw from './data/shots.json';

// Everything on screen that is a fact comes from these three generated files:
//   capture.json   exact stdout/exit/wall-time of real clify runs (capture/capture-cli.mjs)
//   shots.json     headless screenshots + click targets (capture/capture-browser.mjs)
//   evidence.json  the repo's verified logs (scripts/import-evidence.mjs)

type Step = {cmd: string; exit: number; ms: number; stdout: string; stderr: string; recording?: RecEntry[]};
export type RecEntry = {method: string; url: string; resourceType: string; held?: boolean; triggeredBy: string; status: number};
type ShotStep = {file: string; url: string; intent: string; action?: string; target?: {x: number; y: number; width: number; height: number}; after?: boolean};

export const capture = captureRaw as unknown as {capturedAt: string; steps: Record<string, Step>};
export const shots = shotsRaw as unknown as {viewport: [number, number]; flows: Record<string, {url: string; steps: ShotStep[]; nonGet: {method: string; url: string}[]}>};
export const evidence = evidenceRaw as unknown as {
	files: Record<string, {repoPath: string; sha256: string}>;
	live: {checks: {ok: boolean; name: string}[]; passed: number; failed: number; ran: string};
	bench: {
		task: string;
		site: string;
		trials: number;
		clify: {trials: number; passed: number; successRate: number; p50Ms: number; p95Ms: number; avgActions: number};
		directBrowser: {trials: number; passed: number; successRate: number; p50Ms: number; p95Ms: number; avgActions: number};
	};
	handoff: {tasks: {n: number; title: string}[]; answers: string[]; solved: number | null};
};

export const step = (id: string) => {
	const s = capture.steps[id];
	if (!s) throw new Error(`capture step missing: ${id}`);
	return s;
};

export const stdoutLines = (id: string) => step(id).stdout.replace(/\s+$/, '').split('\n');

// Recorder stderr: "\x1b[2mHH:MM:SS\x1b[0m <icon> text" -> {t (s since first line), icon, text}
export type LogLine = {t: number; icon: 'open' | 'act' | 'stop' | 'done'; text: string};
export const logLines = (id: string): LogLine[] => {
	const raw = step(id).stderr.replace(/\x1b\[[0-9;]*m/g, '');
	const rows = raw.split('\n').filter((l) => /^\d\d:\d\d:\d\d /.test(l));
	const sec = (l: string) => {
		const [h, m, s] = l.slice(0, 8).split(':').map(Number);
		return h * 3600 + m * 60 + s;
	};
	const t0 = rows.length ? sec(rows[0]) : 0;
	return rows.map((l) => {
		let text = l.slice(9).trim();
		let icon: LogLine['icon'] = 'act';
		if (text.startsWith('🌐')) icon = 'open';
		else if (text.startsWith('⛔')) icon = 'stop';
		else if (text.startsWith('📼')) icon = 'done';
		text = text.replace(/^(🌐|⛔|📼|→)\s*/u, '');
		return {t: sec(l) - t0, icon, text};
	});
};

// Hide query strings (HN's web app embeds a public search key in its URLs).
export const shortUrl = (u: string) => {
	try {
		const x = new URL(u);
		return x.host.replace(/^www\./, '') + x.pathname + (x.search && !/api-key/i.test(x.search) ? x.search : x.search ? '?…' : '');
	} catch {
		return u;
	}
};

export const B = evidence.bench;
export const p50Ratio = B.directBrowser.p50Ms / B.clify.p50Ms;
export const fmtRatio = (x: number) => `${(Math.floor(x * 10) / 10).toFixed(1)}×`;
