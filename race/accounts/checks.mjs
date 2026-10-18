// Live truth, answer checks and cleanup for tasks/accounts.json. The checker
// reads the agent's own dashboards with the saved sessions from the clify
// vault (the same accounts both racers use) and deletes what a run created.
import {sessions, cookieHeader} from './vault.mjs';

const SITES = ['updown', 'healthchecks', 'svix', 'appwrite', 'hookdeck'];
const UA = 'race/0.3 (benchmark checker)';
let S = null;
const sess = site => (S ||= sessions(SITES))[site]?.session || (() => { throw Error(`no saved session for ${site}`); })();

// fetch, retried twice (2 s apart) on network errors (not HTTP errors): one blip at
// a host shouldn't fail the preflight. The last error names its cause code.
async function fetchRetry(url, opts = {}, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await fetch(url, {...opts, signal: AbortSignal.timeout(30000)}); } catch (e) {
      const code = e.cause?.code || e.cause?.message || e.name;
      if (i >= tries) throw Error(`${new URL(url).host}: ${e.message} (${code}, after ${tries} tries)`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function call(site, method, url, {json, form, headers = {}, as = 'json', auth = []} = {}) {
  const s = sess(site), h = {'user-agent': UA, accept: as === 'json' ? 'application/json' : 'text/html', ...headers};
  const ck = cookieHeader(s, url); if (ck) h.cookie = ck;
  for (const k of auth) if (s.headers[k]) h[k] = s.headers[k];
  let body;
  if (json) { body = JSON.stringify(json); h['content-type'] = 'application/json'; }
  if (form) { body = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
  const r = await fetchRetry(url, {method, headers: h, body, redirect: as === 'json' ? 'follow' : 'manual'});
  const text = await r.text();
  if (r.status >= 400) throw Error(`${site} ${method} ${new URL(url).pathname}: HTTP ${r.status} ${text.slice(0, 160)}`);
  return as === 'json' ? (text ? JSON.parse(text) : null) : text;
}

// --- per-site helpers ------------------------------------------------------
const HC_PROJECT = '0d103ac6-8389-4868-8f5f-944911961863';
const AW = {project: '6ad465aa0026dab1fac0', host: 'https://fra.cloud.appwrite.io/v1', db: '6ad471f2900e99d2b0e4'};
const awH = {'x-appwrite-project': AW.project, 'x-appwrite-mode': 'admin'};
const HD = {base: 'https://api.hookdeck.com/2026-09-01', team: 'tm_FW0ek6XKAZBc'};
const hdH = {'x-hookdeck-team-id': HD.team, origin: 'https://dashboard.hookdeck.com'};
const SVIX = 'https://dashboard.svix.com/api/eu/api/v1';
const attr = (s, name) => s.match(new RegExp(`${name}="([^"]*)"`))?.[1];

let updownKey = null;
async function updownChecks() {
  updownKey ||= (await call('updown', 'GET', 'https://updown.io/settings/edit', {as: 'html'})).match(/for="user_api_key"[\s\S]*?innerText = &quot;([^&]+)&quot;/)?.[1];
  if (!updownKey) throw Error('updown API key not found on the settings page');
  const r = await fetchRetry(`https://updown.io/api/checks?api-key=${updownKey}`, {headers: {'user-agent': UA}}); if (!r.ok) throw Error(`updown api ${r.status}`);
  return r.json();
}
async function hcRows() {
  const html = await call('healthchecks', 'GET', `https://healthchecks.io/projects/${HC_PROJECT}/checks/`, {as: 'html'});
  const csrf = html.match(/name="csrfmiddlewaretoken" value="([^"]+)"/)?.[1];
  const rows = [...html.matchAll(/<tr id="([0-9a-f-]{36})" class="checks-row"[\s\S]*?<\/tr>/g)].map(m => ({id: m[1], name: attr(m[0], 'data-name'), tags: attr(m[0], 'data-tags'), timeout: Number(attr(m[0], 'data-timeout')), grace: Number(attr(m[0], 'data-grace'))}));
  return {rows, csrf};
}
const svixApps = async () => (await call('svix', 'GET', `${SVIX}/app/?order=descending&limit=250`, {auth: ['authorization']})).data;
const awTables = async () => (await call('appwrite', 'GET', `${AW.host}/tablesdb/${AW.db}/tables?queries[]=${encodeURIComponent(JSON.stringify({method: 'limit', values: [100]}))}`, {headers: awH})).tables;
const hdList = async kind => (await call('hookdeck', 'GET', `${HD.base}/${kind}?limit=250`, {headers: hdH})).models;

async function forumTruth() {
  const r = await fetchRetry('https://forum.rclone.org/c/bug/7/l/latest.json?order=created', {headers: {'user-agent': UA}}).then(r => r.json());
  const top = r.topic_list.topics.filter(t => !t.pinned).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 3);
  for (const t of top) { const d = await fetchRetry(`https://forum.rclone.org/t/${t.id}.json`, {headers: {'user-agent': UA}}).then(r => r.json()); t.op = d.details.created_by.username; }
  return top.map(t => ({id: t.id, title: t.title, op: t.op, created: t.created_at}));
}

// --- truth / verify --------------------------------------------------------
export const norm = s => String(s).toLowerCase().replace(/[‘’`]/g, "'").replace(/[^a-z0-9]+/g, '');
const has = (text, s, n = 40) => norm(text).includes(norm(s).slice(0, n));
const nameOf = racerId => `race-${racerId}`;

export const TRUTH = {
  async updown() { return {checks: (await updownChecks()).length}; },
  async healthchecks() { return {checks: (await hcRows()).rows.length}; },
  async svix() { return {apps: (await svixApps()).length}; },
  async appwrite() { return {tables: (await awTables()).length}; },
  async hookdeck() { return {connections: (await hdList('connections')).length}; },
  async forum() { return {topics: await forumTruth()}; },
};

export const VERIFY = {
  async updown(_, {answer, racerId}) {
    const c = (await updownChecks()).find(c => c.alias === nameOf(racerId).toUpperCase() || c.alias === nameOf(racerId) || c.url.includes(nameOf(racerId)));
    if (!c) return {ok: false, detail: `no check for ${nameOf(racerId)}`};
    const fields = c.period === 300 && /^https:\/\/example\.com\//.test(c.url);
    const ok = fields && answer.includes(c.token);
    return {ok, detail: ok ? `check ${c.token} every 5 min` : !fields ? `check ${c.token} has period ${c.period}s, url ${c.url}` : `token ${c.token} not in answer`};
  },
  async healthchecks(_, {answer, racerId}) {
    const r = (await hcRows()).rows.find(r => r.name === nameOf(racerId));
    if (!r) return {ok: false, detail: `no check named ${nameOf(racerId)}`};
    const fields = r.timeout === 3600 && r.grace === 600 && /\brace\b/.test(r.tags || '');
    const ok = fields && answer.includes(r.id);
    return {ok, detail: ok ? `check ${r.id.slice(0, 8)}… 1 h / 10 min` : !fields ? `period ${r.timeout}s grace ${r.grace}s tags "${r.tags}"` : 'ping URL not in answer'};
  },
  async svix(_, {answer, racerId}) {
    const app = (await svixApps()).find(a => a.name === nameOf(racerId));
    if (!app) return {ok: false, detail: `no app named ${nameOf(racerId)}`};
    const eps = (await call('svix', 'GET', `${SVIX}/app/${app.id}/endpoint/`, {auth: ['authorization']})).data;
    const ep = eps.find(e => e.url.replace(/\/$/, '') === `https://example.com/hooks/${nameOf(racerId)}`);
    const ok = !!ep && answer.includes(app.id) && answer.includes(ep.id);
    return {ok, detail: ok ? `app + endpoint live` : !ep ? `endpoint missing (${eps.length} endpoints)` : 'ids not in answer'};
  },
  async appwrite(_, {answer, racerId}) {
    const t = (await awTables()).find(t => t.name === nameOf(racerId));
    if (!t) return {ok: false, detail: `no table named ${nameOf(racerId)}`};
    const col = (t.columns || []).find(c => c.key === 'email');
    const fields = col && col.type === 'string' && Number(col.size) === 255 && col.required === true;
    const ok = !!fields && answer.includes(t.$id);
    return {ok, detail: ok ? `table ${t.$id} with email column` : !fields ? `email column ${col ? `size ${col.size} required ${col.required}` : 'missing'}` : 'table id not in answer'};
  },
  async hookdeck(_, {answer, racerId}) {
    const c = (await hdList('connections')).find(c => c.source?.name === nameOf(racerId));
    if (!c) return {ok: false, detail: `no connection from source ${nameOf(racerId)}`};
    const fields = c.destination?.config?.url?.replace(/\/$/, '') === `https://example.com/${nameOf(racerId)}`;
    const ok = fields && answer.includes(c.source.url);
    return {ok, detail: ok ? `connection ${c.id} live` : !fields ? `destination ${c.destination?.config?.url}` : 'source URL not in answer'};
  },
  async forum(truth, {answer}) {
    const snaps = [truth.topics, await forumTruth().catch(() => truth.topics)];
    const okFor = topics => topics.every(t => has(answer, t.title, 30) && has(answer, t.op, 40));
    const ok = snaps.some(okFor);
    const miss = truth.topics.filter(t => !(has(answer, t.title, 30) && has(answer, t.op, 40))).map(t => t.title.slice(0, 24));
    return {ok, detail: ok ? '3 newest topics + posters' : `missing ${miss.join('; ')}`};
  },
};

// --- cleanup ---------------------------------------------------------------
// Deletes objects whose name starts with one of the prefixes (default: every
// race-* object). Returns what it removed; errors are collected, not thrown.
export async function cleanup(prefixes = ['race-']) {
  const hit = n => typeof n === 'string' && prefixes.some(p => n.toLowerCase().startsWith(p.toLowerCase()));
  const removed = [], errors = [];
  const step = async (label, fn) => { try { await fn(); } catch (e) { errors.push(`${label}: ${e.message}`); } };
  await step('updown', async () => { for (const c of await updownChecks()) if (hit(c.alias) || prefixes.some(p => c.url.includes(p))) {
    const r = await fetchRetry(`https://updown.io/api/checks/${c.token}?api-key=${updownKey}`, {method: 'DELETE', headers: {'user-agent': UA}}); if (r.status === 404) continue; // the API list lags a just-made delete
    if (!r.ok) throw Error(`delete ${c.token}: ${r.status}`); removed.push(`updown ${c.token}`); } });
  await step('healthchecks', async () => { const {rows, csrf} = await hcRows(); for (const r of rows) if (hit(r.name)) {
    await call('healthchecks', 'POST', `https://healthchecks.io/checks/${r.id}/remove/`, {form: {csrfmiddlewaretoken: csrf}, headers: {referer: 'https://healthchecks.io/', origin: 'https://healthchecks.io'}, as: 'html'}); removed.push(`healthchecks ${r.name}`); } });
  await step('svix', async () => { for (const a of await svixApps()) if (hit(a.name)) { await call('svix', 'DELETE', `${SVIX}/app/${a.id}/`, {auth: ['authorization']}); removed.push(`svix ${a.name}`); } });
  await step('appwrite', async () => { for (const t of await awTables()) if (hit(t.name)) { await call('appwrite', 'DELETE', `${AW.host}/tablesdb/${AW.db}/tables/${t.$id}`, {headers: awH}); removed.push(`appwrite ${t.name}`); } });
  await step('hookdeck', async () => {
    for (const c of await hdList('connections')) if (hit(c.name) || hit(c.source?.name) || hit(c.destination?.name)) { await call('hookdeck', 'DELETE', `${HD.base}/connections/${c.id}`, {headers: hdH}); removed.push(`hookdeck connection ${c.name || c.id}`); }
    for (const kind of ['sources', 'destinations']) for (const x of await hdList(kind)) if (hit(x.name)) { await call('hookdeck', 'DELETE', `${HD.base}/${kind}/${x.id}`, {headers: hdH}); removed.push(`hookdeck ${kind.slice(0, -1)} ${x.name}`); }
  });
  return {removed, errors};
}

// Fail fast before a race if a saved session no longer works.
export async function preflight() {
  const bad = [];
  for (const [site, f] of Object.entries(TRUTH)) try { await f(); } catch (e) { bad.push(`${site}: ${e.message}`); }
  return bad;
}
