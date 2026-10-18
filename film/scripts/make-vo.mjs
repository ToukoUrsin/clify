#!/usr/bin/env node
// Voice-over + music for the VO cut, via ElevenLabs on the existing plan (no upgrades).
// Line text is built from src/data/bench.json + wall.json so spoken numbers match the screen.
// Writes public/audio/vo-<n>.mp3, public/audio/music.mp3 and src/data/vo.json.
// Usage: ELEVENLABS_API_KEY=... node scripts/make-vo.mjs [--music] [--voice <id>]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const film = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error('ELEVENLABS_API_KEY missing');
const A = process.argv.slice(2);
const bench = JSON.parse(fs.readFileSync(path.join(film, 'src/data/bench.json'), 'utf8'));
const wall = JSON.parse(fs.readFileSync(path.join(film, 'src/data/wall.json'), 'utf8'));
const hero = bench.heroes['quotes-top-author'];
const ui = hero['browser-ui'];
const cli = hero.cli;

const words = (n) => {
	const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
	const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
	if (n < 20) return ones[n];
	if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '');
	if (n < 1000) return ones[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' and ' + words(n % 100) : '');
	return String(n);
};
// spoken multipliers never round up past what the screen shows
const times = (x) => {
	const f = Math.floor(x), r = x - f;
	if (r >= 0.75) return `nearly ${words(f + 1)} times`;
	return `${words(f)}${r >= 0.5 ? ' and a half' : ''} times`;
};
const timeFrac = (r) => (r < 0.5 ? 'in under half the time' : r < 0.6 ? 'in just over half the time' : `${Math.round((1 / r - 1) * 100)} percent faster`);
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const tools = (r) => r.events.filter((e) => e.kind === 'tool' && e.name !== 'ToolSearch').length;
const secs = (ms) => words(Math.round(ms / 1000));
const kTok = (n) => (n >= 100000 ? `${words(Math.round(n / 100000) * 100)} thousand` : `${words(Math.round(n / 1000))} thousand`);
const sp = bench.browserUi.medianSec / bench.cli.medianSec;
const tk = bench.browserUi.medianTokens / bench.cli.medianTokens;
const allOk = ['browserUi', 'browser', 'cli'].every((m) => bench[m].ok === bench[m].n);

// [scene, offset seconds into the scene, text]
const LINES = [
	['struggle', 1.2, 'This is how agents use websites today. Page by page: read, count, repeat.'],
	['struggle', 10.5, cap(`${secs(ui.wallMs)} seconds, ${words(tools(ui))} tool calls, about ${kTok(ui.tokens.total)} tokens. For one question.`)],
	['side', 0.3, 'Same task. Same model. This time, the website is a command.'],
	['side', 7.5, `Done in ${secs(cli.wallMs)} seconds. Same answer.`],
	['title', 0.4, 'clify turns websites into CLIs and MCP tools for agents.'],
	['record', 0.6, 'A headless browser clicks through the site, and clify records the request behind every click.'],
	['spec', 0.4, 'That becomes typed commands. One help page, and any agent knows the whole site.'],
	['wall', 0.8, `We've built ${words(wall.count)} of them, and re-checked every one live today.`],
	['race', 0.5, `Then we raced: ${words(bench.nTasks)} real tasks, three ways, every answer graded against the live site.`],
	['results', 0.4, `${allOk ? 'Same answers, ' : ''}${timeFrac(1 / sp)}, with ${times(tk)} fewer tokens.`],
	['writes', 0.5, 'Anything that changes data waits for a human to confirm.'],
	['captcha', 0.4, 'And if a site shows a CAPTCHA, clify stops. It never solves one.'],
	['outro', 0.5, 'clify. Give your agent the website as a CLI.'],
];

const voice = A.includes('--voice') ? A[A.indexOf('--voice') + 1] : 'nPczCjzI2devNBz1zQrb'; // "Brian" premade
const out = path.join(film, 'public/audio');
fs.mkdirSync(out, {recursive: true});
const lines = [];
for (let i = 0; i < LINES.length; i++) {
	const [scene, at, text] = LINES[i];
	const file = `audio/vo-${String(i).padStart(2, '0')}.mp3`;
	const meta = path.join(out, `vo-${String(i).padStart(2, '0')}.txt`);
	if (!fs.existsSync(path.join(film, 'public', file)) || fs.readFileSync(meta, 'utf8') !== text + voice) {
		const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
			method: 'POST',
			headers: {'xi-api-key': KEY, 'content-type': 'application/json'},
			body: JSON.stringify({text, model_id: 'eleven_multilingual_v2', voice_settings: {stability: 0.45, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true}}),
		});
		if (!r.ok) throw new Error(`TTS ${r.status}: ${(await r.text()).slice(0, 300)}`);
		fs.writeFileSync(path.join(film, 'public', file), Buffer.from(await r.arrayBuffer()));
		fs.writeFileSync(meta, text + voice);
		console.log(`vo ${i}: ${text}`);
	}
	lines.push({scene, at, text, file});
}

let music = null;
if (A.includes('--music')) {
	const f = path.join(out, 'music.mp3');
	if (!fs.existsSync(f)) {
		const r = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
			method: 'POST',
			headers: {'xi-api-key': KEY, 'content-type': 'application/json'},
			body: JSON.stringify({
				prompt: 'Minimal, confident tech product launch score. Warm analog synth pulse at 100 BPM, soft sub bass, crisp light percussion entering after 15 seconds, gradual build with a lift around 75 seconds, calm resolved ending. Instrumental, no vocals, modern, precise, understated.',
				music_length_ms: 132000,
				force_instrumental: true,
			}),
		});
		if (!r.ok) throw new Error(`music ${r.status}: ${(await r.text()).slice(0, 300)}`);
		fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
		console.log('music written');
	}
	music = 'audio/music.mp3';
}
// numbers the spoken lines were built from; check-real-data.mjs compares them with the current data
const basis = {uiMedianSec: bench.browserUi.medianSec, cliMedianSec: bench.cli.medianSec, uiMedianTokens: bench.browserUi.medianTokens, cliMedianTokens: bench.cli.medianTokens, nTasks: bench.nTasks, wallCount: wall.count, heroUiMs: ui.wallMs, heroCliMs: cli.wallMs, heroUiTools: tools(ui), heroUiTokens: ui.tokens.total};
fs.writeFileSync(path.join(film, 'src/data/vo.json'), JSON.stringify({voice, lines, music, basis}, null, 1));
console.log(`vo.json: ${lines.length} lines, music ${music}`);
