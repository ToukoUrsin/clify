// Benchmark tasks: real user questions with concrete answers. Ground truth is computed live with
// clify right before each task runs (truth()), and graded by grade(): every expected value must
// appear in the agent's final ANSWER line (case/punctuation-insensitive; numbers as numbers).
const price = (s) => Number(String(s).replace(/[^0-9.]/g, ''));

export const TASKS = [
	{
		id: 'books-mystery-max',
		site: 'books',
		title: 'Books to Scrape',
		startUrl: 'https://books.toscrape.com/',
		prompt: 'On Books to Scrape (books.toscrape.com), which book in the Mystery category is the most expensive, and what is its price?',
		truth: async (c) => {
			const a = (await c('books', 'list-category', '--category', 'mystery_3')).data;
			const b = (await c('books', 'list-category-page', '--category', 'mystery_3', '--page', '2')).data;
			const top = [...a, ...b].sort((x, y) => price(y.price) - price(x.price))[0];
			return {expect: [top.title.replace(/\s*\(.*\)$/, ''), top.price.replace('£', '')], detail: {...top, n: a.length + b.length}};
		},
	},
	{
		id: 'books-travel-over-40',
		site: 'books',
		title: 'Books to Scrape',
		startUrl: 'https://books.toscrape.com/',
		prompt: 'On Books to Scrape (books.toscrape.com), how many books in the Travel category cost more than £40?',
		truth: async (c) => {
			const a = (await c('books', 'list-category', '--category', 'travel_2')).data;
			return {number: a.filter((x) => price(x.price) > 40).length, detail: {n: a.length}};
		},
	},
	{
		id: 'quotes-humor-author',
		site: 'quotes',
		title: 'Quotes to Scrape',
		startUrl: 'https://quotes.toscrape.com/',
		prompt: 'On Quotes to Scrape (quotes.toscrape.com), who wrote the first quote tagged "humor", and on what date was that author born?',
		truth: async (c) => {
			const q = (await c('quotes', 'by-tag', '--tag', 'humor')).data[0];
			const slug = q.authorUrl.split('/author/')[1].replace(/\/$/, '');
			const a = (await c('quotes', 'get-author', '--slug', slug)).data;
			return {expect: [q.author, a.born.replace(/,/g, '')], detail: {author: q.author, born: a.born}};
		},
	},
	{
		id: 'quotes-love-count',
		site: 'quotes',
		title: 'Quotes to Scrape',
		startUrl: 'https://quotes.toscrape.com/',
		prompt: 'On Quotes to Scrape (quotes.toscrape.com), how many quotes in total are tagged "love"? Count across all pages of that tag.',
		truth: async (c) => {
			let n = 0;
			for (let p = 1; p < 10; p++) {
				const r = await c('quotes', 'by-tag', '--tag', 'love', '--page', String(p));
				if (!r.ok || !r.data?.length) break;
				n += r.data.length;
				if (r.data.length < 10) break;
			}
			return {number: n};
		},
	},
	{
		id: 'scrapethis-oscar-2012',
		site: 'scrapethis',
		title: 'Scrape This Site',
		startUrl: 'https://www.scrapethissite.com/pages/',
		prompt: 'On Scrape This Site (scrapethissite.com), the "Oscar Winning Films: AJAX and Javascript" page lists films by year. Which film won Best Picture for 2012, and how many awards did it win?',
		truth: async (c) => {
			const f = (await c('scrapethis', 'oscar-films', '--year', '2012')).data.find((x) => x.best_picture);
			return {expect: [f.title.trim()], number: f.awards, detail: f};
		},
	},
	{
		id: 'scrapethis-hockey-detroit-1995',
		site: 'scrapethis',
		title: 'Scrape This Site',
		startUrl: 'https://www.scrapethissite.com/pages/',
		prompt: 'On Scrape This Site (scrapethissite.com), the "Hockey Teams: Forms, Searching and Pagination" page has team season stats. How many wins did the Detroit Red Wings have in 1995?',
		truth: async (c) => {
			const rows = (await c('scrapethis', 'search-teams', '--q', 'detroit', '--per_page', '100')).data;
			const r = rows.find((x) => String(x.year).trim() === '1995' && /detroit/i.test(x.name));
			return {number: Number(String(r.wins).trim()), detail: r};
		},
	},
	{
		id: 'webscraper-laptop-max',
		site: 'webscraper',
		title: 'Web Scraper test shop',
		startUrl: 'https://webscraper.io/test-sites/e-commerce/allinone',
		prompt: "On Web Scraper's test e-commerce site (webscraper.io/test-sites/e-commerce/allinone), which laptop is the most expensive, and what is its price?",
		truth: async (c) => {
			const a = (await c('webscraper', 'products', '--section', 'computers', '--category', 'laptops')).data;
			const top = a.sort((x, y) => price(y.price) - price(x.price))[0];
			return {expect: [top.title.replace(/\.\.\.$/, ''), top.price.replace('$', '')], detail: {...top, n: a.length}};
		},
	},
	{
		id: 'endoflife-ubuntu-2204',
		site: 'endoflife',
		title: 'endoflife.date',
		startUrl: 'https://endoflife.date/',
		prompt: 'On endoflife.date, when does standard support end for Ubuntu 22.04 LTS? Give the date as YYYY-MM-DD.',
		truth: async (c) => {
			const r = (await c('endoflife', 'release', '--product', 'ubuntu', '--cycle', '22.04')).data;
			return {expect: [r.eol], detail: r};
		},
	},
	{
		id: 'homebrew-ffmpeg',
		site: 'homebrew',
		title: 'Homebrew Formulae',
		startUrl: 'https://formulae.brew.sh/',
		prompt: 'On formulae.brew.sh, what is the current stable version of the ffmpeg formula, and what license is it under?',
		truth: async (c) => {
			const r = (await c('homebrew', 'get-formula', '--name', 'ffmpeg', '--fields', 'versions.stable,license')).data;
			return {expect: [r['versions.stable'], r.license], detail: r};
		},
	},
	{
		id: 'crates-tokio',
		site: 'crates',
		title: 'crates.io',
		startUrl: 'https://crates.io/',
		prompt: 'On crates.io, what is the newest stable version of the tokio crate, and what license is that version published under?',
		truth: async (c) => {
			const v = (await c('crates', 'get-crate', '--name', 'tokio', '--fields', 'max_stable_version')).data.max_stable_version;
			const l = (await c('crates', 'version', '--name', 'tokio', '--version', v, '--fields', 'license')).data.license;
			return {expect: [v, l], detail: {v, l}};
		},
	},
	{
		id: 'hex-phoenix',
		site: 'hex',
		title: 'Hex',
		startUrl: 'https://hex.pm/',
		prompt: 'On hex.pm, what is the latest stable version of the phoenix package, and which license does it list?',
		truth: async (c) => {
			const r = (await c('hex', 'get-package', '--name', 'phoenix', '--fields', 'latest_stable_version,meta.licenses')).data;
			return {expect: [r.latest_stable_version, ...r['meta.licenses']], detail: r};
		},
	},
	{
		id: 'debian-nginx-bookworm',
		site: 'debian',
		title: 'Debian Packages',
		startUrl: 'https://packages.debian.org/',
		prompt: 'On packages.debian.org, what version of the nginx package is in Debian bookworm?',
		truth: async (c) => {
			const h = (await c('debian', 'package', '--suite', 'bookworm', '--name', 'nginx')).data.heading;
			return {expect: [h.match(/\(([^ )]+)/)[1]], detail: {h}};
		},
	},
	{
		id: 'github-playwright-release',
		site: 'github',
		title: 'GitHub',
		startUrl: 'https://github.com/',
		prompt: 'On GitHub, what is the latest release of the microsoft/playwright repository (its tag), and on what date was it published? Give the date as YYYY-MM-DD.',
		truth: async (c) => {
			const r = (await c('github', 'latest-release', '--owner', 'microsoft', '--repo', 'playwright', '--fields', 'tag_name,published_at')).data;
			return {expect: [r.tag_name.replace(/^v/, ''), r.published_at.slice(0, 10)], detail: r};
		},
	},
	{
		id: 'nodejs-latest-lts',
		site: 'nodejs',
		title: 'Node.js',
		startUrl: 'https://nodejs.org/',
		prompt: 'On nodejs.org, what is the newest Node.js LTS release (exact version number), and what is that LTS line\'s codename?',
		truth: async (c) => {
			const rows = (await c('nodejs', 'releases', '--limit', '80', '--fields', 'version,lts')).data;
			const r = rows.find((x) => x.lts);
			return {expect: [r.version.replace(/^v/, ''), r.lts], detail: r};
		},
	},
];

// Harder, multi-page tasks (tag "hard"): the answer needs data from many pages.
export const HARD = [
	{
		id: 'quotes-top-author',
		site: 'quotes',
		title: 'Quotes to Scrape',
		startUrl: 'https://quotes.toscrape.com/',
		prompt: 'On Quotes to Scrape (quotes.toscrape.com), which author has the most quotes across the whole site (every page), and how many quotes do they have?',
		truth: async (c) => {
			const cnt = {};
			for (let p = 1; p <= 10; p++) for (const q of (await c('quotes', 'list-quotes', '--page', String(p))).data) cnt[q.author] = (cnt[q.author] || 0) + 1;
			const [a, n] = Object.entries(cnt).sort((x, y) => y[1] - x[1])[0];
			return {expect: [a], number: n, detail: cnt};
		},
	},
	{
		id: 'hockey-best-1990',
		site: 'scrapethis',
		title: 'Scrape This Site',
		startUrl: 'https://www.scrapethissite.com/pages/',
		prompt: 'On Scrape This Site (scrapethissite.com), the "Hockey Teams: Forms, Searching and Pagination" page lists team seasons. Which team won the most games in the 1990 season, and how many wins was that?',
		truth: async (c) => {
			const rows = [];
			for (let p = 1; p <= 8; p++) {
				const r = await c('scrapethis', 'search-teams', '--q', '', '--per_page', '100', '--page_num', String(p));
				if (!r.ok || !r.data?.length) break;
				rows.push(...r.data);
			}
			const y = rows.filter((x) => String(x.year).trim() === '1990').sort((a, b) => +b.wins - +a.wins)[0];
			return {expect: [y.name.trim()], number: +y.wins, detail: {...y, rows: rows.length}};
		},
	},
	{
		id: 'books-cheapest-first-5-pages',
		site: 'books',
		title: 'Books to Scrape',
		startUrl: 'https://books.toscrape.com/',
		prompt: 'On Books to Scrape (books.toscrape.com), look at the first 5 pages of the full catalogue (100 books). Which of those books is the cheapest, and what is its price?',
		truth: async (c) => {
			const rows = [];
			for (let p = 1; p <= 5; p++) rows.push(...(await c('books', 'list-books', '--page', String(p))).data);
			const top = rows.sort((a, b) => price(a.price) - price(b.price))[0];
			return {expect: [top.title.replace(/\s*\(.*\)$/, '').replace(/\.\.\.$/, ''), top.price.replace('£', '')], detail: {...top, n: rows.length}};
		},
	},
	{
		id: 'github-playwright-releases-2026',
		site: 'github',
		title: 'GitHub',
		startUrl: 'https://github.com/',
		prompt: 'On GitHub, look at the 20 most recent releases of the microsoft/playwright repository. How many of those 20 were published in 2026?',
		truth: async (c) => {
			const r = (await c('github', 'releases', '--owner', 'microsoft', '--repo', 'playwright', '--per_page', '20', '--fields', 'tag_name,published_at')).data;
			return {number: r.filter((x) => String(x.published_at).startsWith('2026')).length, detail: r};
		},
	},
	{
		id: 'ubuntu-lts-supported',
		site: 'endoflife',
		title: 'endoflife.date',
		startUrl: 'https://endoflife.date/',
		prompt: 'On endoflife.date, which Ubuntu LTS releases are still inside standard support as of 2026-10-17? List their version numbers.',
		truth: async (c) => {
			const r = (await c('endoflife', 'product', '--product', 'ubuntu', '--limit', '60')).data;
			const v = r.filter((x) => x.lts && String(x.eol) > '2026-10-17').map((x) => x.cycle);
			return {expect: v, detail: v};
		},
	},
	{
		id: 'crates-serde-vs-tokio',
		site: 'crates',
		title: 'crates.io',
		startUrl: 'https://crates.io/',
		prompt: 'On crates.io, which crate has more all-time downloads: serde or tokio? Answer with the crate name.',
		truth: async (c) => {
			const a = (await c('crates', 'get-crate', '--name', 'serde', '--fields', 'downloads')).data.downloads;
			const b = (await c('crates', 'get-crate', '--name', 'tokio', '--fields', 'downloads')).data.downloads;
			return {expect: [a > b ? 'serde' : 'tokio'], detail: {serde: a, tokio: b}};
		},
	},
];

const norm = (s) => String(s ?? '').replace(/(\d),(?=\d{3}\b)/g, '$1').toLowerCase().normalize('NFKC').replace(/[“”"'`]/g, '').replace(/[^\p{L}\p{N}.+-]+/gu, ' ').replace(/\s+/g, ' ').trim();

export const grade = (answer, truth) => {
	if (!answer) return {ok: false, why: 'no ANSWER line'};
	const a = norm(answer);
	const missing = (truth.expect ?? []).filter((v) => !a.includes(norm(v)));
	let numOk = true;
	if (truth.number !== undefined) {
		const nums = (answer.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/-?\d+(\.\d+)?/g) || []).map(Number);
		numOk = nums.includes(Number(truth.number));
	}
	const ok = missing.length === 0 && numOk;
	return {ok, why: ok ? 'all expected values present' : [missing.length ? `missing ${missing.join(', ')}` : '', numOk ? '' : `number ${truth.number} not found`].filter(Boolean).join('; ')};
};
