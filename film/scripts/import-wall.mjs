#!/usr/bin/env node
// Wall data: every site whose pre-built clify CLI passed verify/verify-sites.mjs (live, read-only,
// robots-checked, >=1 data command; >=2 when the spec has 2+). Writes src/data/wall.json and
// public/wall/<site>.jpg thumbnails. Sites whose website showed a bot check are dropped.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const film = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(os.homedir(), 'clify-demo');
const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'verify/verified.json'), 'utf8'));
const DROP = {aviationweather: 'website showed a bot check during screenshot'};
const NO_IMG = new Set(['bigdatacloud-geo', 'open-elevation', 'tides-noaa']); // homepage screenshot was an HTTP error page

const CAT = {
	'Developer tools': 'crates debian docker homebrew hex nuget nodejs github python python-docs go-dev rfc iana mitre man7 mdn numpy pandas postgresql sqlite r-project ruby-lang tensorflow kubernetes vim w3 django flask tiobe endoflife stackexchange stackoverflow serverfault superuser askubuntu nvdapi',
	Communities: 'discourse discussgodot discussgohugo discusskde juliaforum pythonforum rustforum lemmyca lemmyml lemmyworld lemmyzip fosstodon hachyderm vivaldi_social devto hn hackernews',
	'Markets & finance': 'alternative blockchain coinbase coinlore gateio gemini huobi kraken kucoin okx mempool nbp frankfurter manifold',
	'Government & open data': 'census chicago nyc federalregister fda ukpolice eurostat worldbank statbank loc tides tides-noaa',
	'Science & space': 'crossref exoplanet jpl jpl-cad jpl-sbdb llspacedevs thespacedevs spaceflightnews open-notify nobel opentopodata open-elevation bigdatacloud-geo worldcities zippopotam restcountries timeapi ourairports',
	Sports: 'jolpica mlb nhl openligadb',
	'Media & culture': 'anilist tvmaze ghibli rickmorty scryfall cocktaildb themealdb opentdb jokes chucknorris adviceslip uselessfacts yesno dogapi randomdog randomuser dummyjson jsonplaceholder datamuse gutenberg',
	'Scraping sandboxes': 'books quotes scrapethis webscraper',
};
const catOf = {};
for (const [c, list] of Object.entries(CAT)) for (const s of list.split(' ')) catOf[s] = c;

const outDir = path.join(film, 'public/wall');
fs.mkdirSync(outDir, {recursive: true});
const sites = [];
for (const r of v.results.filter((x) => x.ok && !DROP[x.site])) {
	let meta = {};
	try {
		meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'sites', r.site, 'site.json'), 'utf8'));
	} catch {}
	const shot = path.join(ROOT, 'sites', r.site, 'shot.png');
	let img = null;
	if (fs.existsSync(shot) && !NO_IMG.has(r.site)) {
		const out = path.join(outDir, `${r.site}.jpg`);
		if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(shot).mtimeMs)
			execFileSync('nice', ['-n', '19', 'ffmpeg', '-loglevel', 'error', '-y', '-i', shot, '-vf', 'scale=480:300:flags=lanczos', '-q:v', '5', out]);
		img = `wall/${r.site}.jpg`;
	}
	let host = '';
	try {
		host = new URL(meta.url || r.origin).host.replace(/^www\./, '');
	} catch {}
	sites.push({
		site: r.site,
		title: meta.title || r.site,
		host,
		category: catOf[r.site] || 'Other',
		commands: r.commandsOk.map((c) => c.name),
		ms: r.commandsOk.map((c) => c.ms),
		img,
	});
}
const order = ['books', 'github', 'hn', 'crates', 'stackoverflow', 'endoflife', 'homebrew', 'nodejs', 'debian', 'hex', 'mdn', 'quotes', 'scrapethis', 'webscraper', 'python', 'docker'];
sites.sort((a, b) => {
	const ia = order.indexOf(a.site), ib = order.indexOf(b.site);
	return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || (a.img ? 0 : 1) - (b.img ? 0 : 1) || a.site.localeCompare(b.site);
});
const cats = {};
for (const s of sites) cats[s.category] = (cats[s.category] || 0) + 1;
const out = {verifiedAt: v.verifiedAt, checked: v.total, count: sites.length, dropped: DROP, categories: cats, sites};
fs.writeFileSync(path.join(film, 'src/data/wall.json'), JSON.stringify(out, null, 1));
console.log(`wall: ${sites.length} verified sites (of ${v.total} specs checked), ${sites.filter((s) => s.img).length} with screenshots`, cats);
