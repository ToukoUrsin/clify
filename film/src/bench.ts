import benchRaw from './data/bench.json';
import wallRaw from './data/wall.json';

// Real Claude Code benchmark (scripts/import-bench.mjs) and the verified-site wall (scripts/import-wall.mjs).

export type HeroEvent = {ms: number; kind: 'init' | 'text' | 'tool'; name?: string; input?: unknown; text?: string; endMs?: number; isError?: boolean; result?: string; resultChars?: number};
export type HeroRun = {
	dir: string;
	ok: boolean;
	why: string;
	answer: string;
	wallMs: number;
	turns: number;
	toolCalls: number;
	tokens: {input: number; output: number; cacheWrite: number; cacheRead: number; total: number};
	costUsd: number;
	models: string[];
	prompt: string;
	events: HeroEvent[];
	tokensOverTime: {ms: number; total: number}[];
	video: {src: string; firstFrameSec: number; frames: number; w: number; h: number; urls: {s: number; url: string}[]} | null;
};
export type Agg = {n: number; ok: number; rate: number; medianSec: number; meanSec: number; medianTokens: number; medianToolCalls: number; medianTurns: number; totalCostUsd: number; medianCostUsd: number};
export type Mode = 'browser-ui' | 'browser' | 'cli';
export type BRun = {task: string; site: string; mode: Mode; trial: number; tag: string; ok: boolean; why: string; wallMs: number; tokens: number; toolCalls: number; costUsd: number; answer: string};

export const bench = benchRaw as unknown as {
	generatedAt: string;
	tags: string[];
	model: string[];
	setup: Record<string, string>;
	nTasks: number;
	nSites: number;
	browser: Agg;
	browserUi: Agg;
	cli: Agg;
	perTask: {task: string; site: string; browser: Agg; browserUi: Agg; cli: Agg}[];
	runs: BRun[];
	heroes: Record<string, Partial<Record<Mode, HeroRun>>>;
	source: string;
};

export type WallSite = {site: string; title: string; host: string; category: string; commands: string[]; ms: number[]; img: string | null};
export const wall = wallRaw as unknown as {verifiedAt: string; checked: number; count: number; categories: Record<string, number>; sites: WallSite[]};

export const agg = (m: Mode) => (m === 'cli' ? bench.cli : m === 'browser' ? bench.browser : bench.browserUi);
export const MODE_LABEL: Record<Mode, string> = {
	'browser-ui': 'Browser, UI only',
	browser: 'Browser + page JS',
	cli: 'clify CLI',
};
export const MODE_SUB: Record<Mode, string> = {
	'browser-ui': 'Playwright MCP, no page JavaScript',
	browser: 'Playwright MCP, all tools',
	cli: 'Bash + clify',
};
export const ratio = (a: number, b: number) => (b ? a / b : 0);
export const fmtX = (x: number) => `${(Math.floor(x * 10) / 10).toFixed(1)}×`;
export const pct = (x: number) => `${Math.round(x * 100)}%`;
