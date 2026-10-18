#!/usr/bin/env node
// Dev helper: one HTTP request with a site's saved session. Prints status + body head, never the session.
// node race/accounts/probe.mjs <site> <METHOD> <url> [body] [-H name:value ...] [--auth-header name] [--n 1500]
import {sessions, cookieHeader} from './vault.mjs';
const [site, method, url, ...rest] = process.argv.slice(2);
const headers = {'user-agent': 'clify/0.1 (agent CLI generated from the site\'s own web app)', accept: 'application/json, text/html;q=0.9, */*;q=0.8'};
let body, n = 1500;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '-H') { const [k, ...v] = rest[++i].split(':'); headers[k.toLowerCase()] = v.join(':'); }
  else if (rest[i] === '--auth-header') { const k = rest[++i]; const s = sessions([site])[site]; if (s.session.headers[k]) headers[k] = s.session.headers[k]; }
  else if (rest[i] === '--n') n = Number(rest[++i]);
  else body = rest[i];
}
const s = sessions([site])[site]; if (!s) throw Error(`no session for ${site}`);
const ck = cookieHeader(s.session, url); if (ck) headers.cookie = ck;
if (body && !headers['content-type']) headers['content-type'] = body.trim().startsWith('{') ? 'application/json' : 'application/x-www-form-urlencoded';
const r = await fetch(url, {method, headers, body, redirect: 'manual'});
console.log(r.status, r.headers.get('content-type'), r.headers.get('location') || '');
console.log((await r.text()).slice(0, n));
