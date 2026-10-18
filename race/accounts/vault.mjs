// Read-only access to the clify agent vault (AES-256-GCM, same format as
// clify/src/vault.ts) plus a per-run copy that holds only saved sessions.
// Secrets stay in memory or in 0600 files under the run's own directory.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const AGENT_HOME = process.env.RACE_CLIFY_AGENT_HOME || path.join(os.homedir(), '.clify-agent');
const keyOf = home => process.env.CLIFY_VAULT_KEY && home === AGENT_HOME ? Buffer.from(process.env.CLIFY_VAULT_KEY, 'base64') : Buffer.from(fs.readFileSync(path.join(home, 'vault.key'), 'utf8').trim(), 'base64');

export function readVault(home = AGENT_HOME) {
  const box = JSON.parse(fs.readFileSync(path.join(home, 'vault.enc'), 'utf8'));
  const d = crypto.createDecipheriv('aes-256-gcm', keyOf(home), Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8'));
}

function writeVault(home, v) {
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(v), 'utf8'), c.final()]);
  fs.mkdirSync(home, {recursive: true});
  fs.writeFileSync(path.join(home, 'vault.key'), key.toString('base64') + '\n', {mode: 0o600});
  fs.writeFileSync(path.join(home, 'vault.enc'), JSON.stringify({v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64')}) + '\n', {mode: 0o600});
}

// Saved sessions for these sites: {name: {origin, session, storage}}. No passwords.
export function sessions(names) {
  const v = readVault(), out = {};
  for (const n of names) { const s = v.sites[n]; if (s?.session) out[n] = {origin: s.origin, session: s.session, storage: s.storage || null}; }
  return out;
}

// A clify home for one racer: a fresh vault (own key) with only the sessions.
export function writeRacerVault(home, names) {
  const sites = {}; for (const [n, s] of Object.entries(sessions(names))) sites[n] = {origin: s.origin, session: s.session};
  writeVault(home, {v: 1, sites});
  return Object.keys(sites);
}

// Merged Playwright storage state (cookies + localStorage) for the browser racer.
export function storageState(names) {
  const cookies = [], origins = new Map();
  for (const s of Object.values(sessions(names))) {
    for (const c of s.storage?.cookies || s.session.cookies.map(c => ({...c, httpOnly: false, secure: true, sameSite: 'Lax'}))) cookies.push(c);
    for (const o of s.storage?.origins || []) origins.set(o.origin, [...(origins.get(o.origin) || []), ...(o.localStorage || [])]);
  }
  return {cookies, origins: [...origins].map(([origin, localStorage]) => ({origin, localStorage}))};
}

// Cookie header for a URL from a saved session (same matching as clify's runtime).
export function cookieHeader(session, url) {
  const u = new URL(url), now = Date.now() / 1000;
  return session.cookies.filter(c => { const d = c.domain.replace(/^\./, ''); return (u.hostname === d || u.hostname.endsWith('.' + d)) && u.pathname.startsWith(c.path || '/') && (c.expires <= 0 || c.expires > now); }).map(c => `${c.name}=${c.value}`).join('; ');
}

// Mode D (agent + curl): the same saved sessions as plain files in one 0600 dir:
// cookies.txt (Netscape jar for `curl -b`), <site>.headers (`curl -H @file`) and
// <site>.localStorage.json (what the browser racer gets). The runner deletes the dir.
export function writeCurlSessions(dir, names) {
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  const jar = ['# Netscape HTTP Cookie File'], files = [];
  for (const [n, s] of Object.entries(sessions(names))) {
    for (const c of s.session.cookies || []) {
      const d = c.domain || new URL(s.origin).hostname;
      jar.push([`${c.httpOnly ? '#HttpOnly_' : ''}${d}`, d.startsWith('.') ? 'TRUE' : 'FALSE', c.path || '/', c.secure === false ? 'FALSE' : 'TRUE', c.expires > 0 ? Math.floor(c.expires) : 0, c.name, c.value].join('\t'));
    }
    const h = Object.entries(s.session.headers || {});
    if (h.length) { fs.writeFileSync(path.join(dir, `${n}.headers`), h.map(([k, v]) => `${k}: ${v}`).join('\n') + '\n', {mode: 0o600}); files.push(`${n}.headers`); }
    const ls = (s.storage?.origins || []).filter(o => o.localStorage?.length);
    if (ls.length) { fs.writeFileSync(path.join(dir, `${n}.localStorage.json`), JSON.stringify(ls, null, 1), {mode: 0o600}); files.push(`${n}.localStorage.json`); }
  }
  fs.writeFileSync(path.join(dir, 'cookies.txt'), jar.join('\n') + '\n', {mode: 0o600});
  return ['cookies.txt', ...files];
}

// Per-racer clify home: the race specs plus a vault with just their sessions.
export function installClifyHome(home, specDir) {
  const names = [];
  for (const f of fs.readdirSync(specDir).filter(f => f.endsWith('.spec.json'))) {
    const spec = JSON.parse(fs.readFileSync(path.join(specDir, f), 'utf8'));
    fs.mkdirSync(path.join(home, 'sites', spec.name), {recursive: true});
    fs.copyFileSync(path.join(specDir, f), path.join(home, 'sites', spec.name, 'spec.json'));
    names.push(spec.name);
  }
  return {sites: names, signedIn: fs.existsSync(path.join(AGENT_HOME, 'vault.enc')) ? writeRacerVault(home, names) : []};
}
