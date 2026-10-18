// Live truth and answer checks for tasks/main.json. Truth is fetched from the
// sites themselves when the race starts; the admin room is checked against the
// live API after each racer finishes (and watched during the race).
const UA = {'user-agent': 'race/0.2 (benchmark checker)'};
const RBP = 'https://automationintesting.online';
const get = async (url, as = 'text') => { const r = await fetch(url, {headers: UA, signal: AbortSignal.timeout(30000)}); if (!r.ok) throw Error(`HTTP ${r.status} ${url}`); return as === 'json' ? r.json() : r.text(); };
const decode = s => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
// Loose comparison: lower case, curly quotes folded, only letters and digits kept.
export const norm = s => String(s).toLowerCase().replace(/[‘’`]/g, "'").replace(/[“”]/g, '"').replace(/\\"/g, '"').replace(/[^a-z0-9]+/g, '');
const numbers = text => new Set((String(text).replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(?:\.\d+)?/g) || []).map(Number));
const hasNumber = (text, n, tol = 0) => [...numbers(text)].some(x => Math.abs(x - n) <= tol);
const has = (text, s, n = 24) => norm(text).includes(norm(s).slice(0, n));

async function booksIn(slug) {
  const out = []; let url = `https://books.toscrape.com/catalogue/category/books/${slug}/index.html`;
  while (url) {
    const html = await get(url);
    for (const m of html.matchAll(/<h3><a href="[^"]*" title="([^"]*)">[\s\S]*?<p class="price_color">[^\d]*([\d.]+)<\/p>/g)) out.push({title: decode(m[1]), price: Number(m[2])});
    const next = html.match(/<li class="next"><a href="([^"]+)"/); url = next ? new URL(next[1], url).toString() : null;
  }
  return out;
}

export const TRUTH = {
  async books() {
    const all = [...await booksIn('mystery_3'), ...await booksIn('travel_2')].sort((a, b) => a.price - b.price);
    return {books: all.length, cheapest: all.slice(0, 5), cutoff: all[4].price, tied: all.filter(b => b.price === all[4].price)};
  },
  async quotes() {
    const quotes = [];
    for (let page = 1; page < 20; page++) {
      const html = await get(`https://quotes.toscrape.com/tag/love/page/${page}/`);
      const found = [...html.matchAll(/<small class="author" itemprop="author">([^<]+)<\/small>/g)].map(m => decode(m[1]));
      if (!found.length) break; quotes.push(...found);
    }
    const byAuthor = {}; for (const a of quotes) byAuthor[a] = (byAuthor[a] || 0) + 1;
    return {total: quotes.length, byAuthor};
  },
  async hn() {
    const out = {};
    for (const q of ['Rust', 'SQLite', 'Kubernetes']) {
      const u = `https://hn.algolia.com/api/v1/search?${new URLSearchParams({query: q, tags: 'story', numericFilters: 'created_at_i>=1735689600,created_at_i<1767225600', hitsPerPage: '1000'})}`;
      const hits = (await get(u, 'json')).hits;
      const pick = h => ({title: h.title, points: h.points, comments: h.num_comments, id: h.objectID});
      const max = hits.reduce((a, b) => ((b.points || 0) > (a.points || 0) ? b : a), hits[0]);
      out[q] = {top: pick(hits[0]), max: pick(max)};
    }
    return out;
  },
  async oscars() {
    const out = {};
    for (let y = 2010; y <= 2015; y++) {
      const films = await get(`https://www.scrapethissite.com/pages/ajax-javascript/?ajax=true&year=${y}`, 'json');
      const w = films.find(f => f.best_picture); out[y] = {title: w.title.trim(), nominations: w.nominations, awards: w.awards};
    }
    return out;
  },
  async pizza() {
    const html = await get('https://httpbin.org/forms/post');
    return {formOnline: /name="custname"/.test(html)};
  },
  async rooms() {
    const {rooms} = await get(`${RBP}/api/room`, 'json');
    return {roomsBefore: rooms.length};
  },
};

const roomOk = (room) => room && room.type === 'Family' && room.accessible === true && Number(room.roomPrice) === 321 && ['WiFi', 'Safe'].every(f => (room.features || []).includes(f));
export async function liveRooms() { return (await get(`${RBP}/api/room`, 'json')).rooms; }

// answer: the racer's own final answer for this task; tools: all tool output text.
export const VERIFY = {
  books(truth, {answer}) {
    const strict = truth.cheapest.filter(b => b.price < truth.cutoff);
    const missing = strict.filter(b => !(has(answer, b.title, 18) && hasNumber(answer, b.price)));
    const tiedHits = truth.tied.filter(b => has(answer, b.title, 18) && hasNumber(answer, b.price)).length;
    const ok = !missing.length && tiedHits >= 5 - strict.length;
    return {ok, detail: ok ? `5 cheapest of ${truth.books} correct` : `missing ${missing.map(b => b.title.slice(0, 30)).join('; ') || 'tied entries'}`};
  },
  quotes(truth, {answer}) {
    const authors = Object.keys(truth.byAuthor), missing = authors.filter(a => !has(answer, a, 40));
    const ok = hasNumber(answer, truth.total) && !missing.length;
    return {ok, detail: ok ? `${truth.total} quotes, ${authors.length} authors` : `expected ${truth.total} quotes; missing ${missing.join(', ') || 'total'}`};
  },
  hn(truth, {answer}) {
    const bad = Object.entries(truth).filter(([, t]) => ![t.top, t.max].some(s => has(answer, s.title, 22) && hasNumber(answer, s.points, Math.max(3, s.points * 0.03))));
    return {ok: !bad.length, detail: bad.length ? `wrong: ${bad.map(([q]) => q).join(', ')}` : '3 of 3 stories'};
  },
  oscars(truth, {answer}) {
    const bad = Object.entries(truth).filter(([, w]) => !(has(answer, w.title, 30) && hasNumber(answer, w.nominations)));
    return {ok: !bad.length, detail: bad.length ? `wrong: ${bad.map(([y]) => y).join(', ')}` : '6 of 6 years'};
  },
  pizza(truth, {tools}) {
    const t = tools.replace(/\\n/g, '\n').replace(/\\"/g, '"'); // tool output may be a JSON-escaped string
    const need = [/"custname":\s*"Race Bot"/, /"custtel":\s*"555-0100"/, /"size":\s*"large"/, /"delivery":\s*"19:45"/, /"topping":\s*\[\s*"(bacon|mushroom)",\s*"(bacon|mushroom)"\s*\]/, /"comments":\s*"ring twice"/];
    const miss = need.filter(r => !r.test(t));
    return {ok: truth.formOnline && !miss.length, detail: miss.length ? `echo missing ${miss.length} field(s)` : 'httpbin echoed the order'};
  },
  async rooms(truth, {racerId, seenRooms}) {
    const name = `RACE-${racerId}`;
    let room = (await liveRooms().catch(() => [])).find(r => r.roomName === name);
    room ||= seenRooms?.find(r => r.roomName === name);
    return {ok: roomOk(room), detail: room ? (roomOk(room) ? `room ${room.roomid} live` : 'room has wrong fields') : `${name} not found`, room: room || null};
  },
};

// Remove the rooms this run created (the demo also resets itself).
export async function deleteRooms(names) {
  const login = await fetch(`${RBP}/api/auth/login`, {method: 'POST', headers: {...UA, 'content-type': 'application/json'}, body: JSON.stringify({username: 'admin', password: 'password'})}).then(r => r.json());
  for (const r of await liveRooms()) if (names.includes(r.roomName)) await fetch(`${RBP}/api/room/${r.roomid}`, {method: 'DELETE', headers: {...UA, cookie: `token=${login.token}`}});
}
