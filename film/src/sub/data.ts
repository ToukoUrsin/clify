import subRaw from '../data/sub.json';
import voRaw from '../data/subvo.json';

export type LogL = {t: number; text: string};
export type McpCall = {tool: string; args: string; result: string};
export type Racer = {elapsedMs: number; freshTokens: number; totalTokens: number; costUsd: number; peakRamMB: number; avgCpu: number; success: number; toolCalls: number; tasks: number};
type ModeAgg = {n: number; ok: number; medianSec: number; medianTokens: number; totalCostUsd: number};

export const sub = subRaw as unknown as {
	bench: {source: string; readme: string; nTasks: number; nSites: number; model: string[]; browserUi: ModeAgg; browser: ModeAgg; cli: ModeAgg; vsUi: {faster: number; tokens: number; cheaper: number}; vsJs: {faster: number; tokens: number; cheaper: number}; practice: string};
	hero: Record<'browser' | 'cli', {source: string; wallMs: number; toolCalls: number; tokens: number; answer: string}>;
	add: {source: string; log: string; url: string; site: string; seconds: number; explored: {steps: number; recorded: number; heldWrites: number}; verified: number; commands: string[]; dropped: {name: string; reason: string}[]; lines: LogL[]; run: {source: string; cmd: string; ms: number; exit: number; stdout: string}};
	sweep: {source: string; attempted: number; ok3: number; pct: number; verifiedCommands: number; sites: {site: string; host: string; verified: number}[]};
	coldStart: {source: string; url: string; addSec: number; generated: number; verified: number; totalSec: number; answer: string; cloned: string};
	wall: {source: string; distinctSites: number; verifiedOnWall: number; attempted: number; verifiedAll: number; snippet: string; tiles: {name: string; host: string; img: string | null; n: number; on: string}[]};
	blaxel: {source: string; sites: number; ok: number; verified: number; rows: {site: string; sandbox: string; checked: number; of: number; ok: boolean; blocked: boolean}[]};
	agent: {source: string; video: string; proof: string; address: string; jobsPerDay: number};
	accounts: {source: string; signedIn: number; stopped: number; sites: string[]; verified: number; noVerification: string[]; loggedIn: number; captchaStops: number; identity: {email: string; phone: string}; sms: {text: string; code: string; from: string}; signupLog: {source: string; lines: LogL[]}};
	ask: {source: string; proof: string; from: string; subject: string; question: string; options: {key: string; label: string}[]; blocker: string; sentAt: string; answer: {decision: string; from: string; verified: boolean; receivedAt: string}; shot: string};
	mcp: {source: string; url: string; task: string; hosted: {sites: number; commands: number}; tools: {deployed: {tools: number; tokens: number}; core: {tools: number; tokens: number}; perCommand: {tools: number; tokens: number}}; tokensSnippet: string; claudeCode: {source: string; task: string[]; calls: {tool: string; args: string; result: string}[]; sec: number; turns: number; costUsd: number; answer: string[]}; clients: {id: string; title: string; clip: string; transcript: string; model: string}[]};
	race: {label: string; video: string; readme?: string; realtime?: string; hookFromSec?: number; browserSub?: string; clifySub?: string; means?: {faster: number; fasterLo: number; fasterHi: number; cheaper: number; nA: number; nB: number; nC: number; runs: number; timeA: number; timeB: number; timeC: number}; jobs?: {id: string; label: string; kind: string}[]; summary?: string; speedNote: string; playFromSec: number; playbackRate: number; clifyDoneSec?: number; runId: string; gen: {runs: number; nA: number; nC: number; timeA: number; timeC: number; costA: number; costC: number; means: {time: number; cost: number; total: number; ram: number}; paired: {time: number; cost: number; total: number; ram: number}; specs: string; headline: string; detail: string}; model?: string; taskFile?: string; browserMode?: string; browserLabel?: string; clifyLabel?: string; browser?: Racer; clify?: Racer; config: string};
	curl: {source: string; readme: string; runs: number; tasks: number; A: {time: number; cost: number; n: number; ok: number}; D: {time: number; cost: number; ok: number}; C: {time: number; cost: number; ok: number}; paired: {time: number; cost: number}; snippet: string};
};

export type VoLine = {scene: string; at: number; text: string; file: string; dur: number; words: {w: string; s: number; e: number}[]};
export const vo = voRaw as unknown as {voice: string; music: string | null; lines: VoLine[]};

// multipliers are shown floor-rounded to 0.1 so the screen never overstates
export const fx = (x: number) => `${(Math.floor(x * 10 + 1e-9) / 10).toFixed(1)}×`;
export const k = (n: number) => (n >= 100000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
export const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
export const maskPhone = (p: string) => p.replace(/^(\+1 \d{3}) \d{3} (\d{4})$/, '$1 ••• $2');
// "1 command", "2 commands"
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
