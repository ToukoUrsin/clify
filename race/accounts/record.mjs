#!/usr/bin/env node
// Dev helper for writing race/specs: open a dashboard headless with a site's
// saved storage state and log the app's own XHR/fetch traffic.
// node race/accounts/record.mjs <site> <url> [steps.json] > log.jsonl
// steps: [{"goto":url}|{"click":"text or css"}|{"fill":"css","value":"x"}|{"press":"Enter"}|{"wait":ms}|{"shot":"file.png"}]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {storageState} from './vault.mjs';
const require = createRequire(path.join(os.homedir(), 'clify-dev/package.json'));
const {chromium} = require('playwright');
const [site, url, stepsFile] = process.argv.slice(2);
const steps = stepsFile ? JSON.parse(fs.readFileSync(stepsFile, 'utf8')) : [];
const SECRET = /^(cookie|authorization|x-csrf-token|x-xsrf-token|apikey|x-api-key)$/i;
const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
const ctx = await browser.newContext({storageState: storageState(site.split(',')), viewport: {width: 1280, height: 800}});
const page = await ctx.newPage();
page.on('response', async r => {
  const q = r.request(); if (!['xhr', 'fetch', 'document'].includes(q.resourceType())) return;
  if (/google|posthog|segment|sentry|stripe|intercom|hubspot|clarity|datadog|doubleclick|reddit|facebook|cookiehub|cookieyes|logrocket|noticeable|_next\/static/.test(q.url())) return;
  const h = Object.fromEntries(Object.entries(await q.allHeaders()).map(([k, v]) => [k, SECRET.test(k) ? `<${v.length}>` : v.slice(0, 120)]).filter(([k]) => !/^(sec-|accept|user-agent|referer|priority|:)/.test(k)));
  let body = ''; try { body = (await r.text()).slice(0, 700); } catch {}
  console.log(JSON.stringify({m: q.method(), u: q.url().slice(0, 300), s: r.status(), t: q.resourceType(), h, post: q.postData()?.slice(0, 500), body}));
});
await page.goto(url, {waitUntil: 'domcontentloaded'}).catch(e => console.error(String(e)));
await page.waitForTimeout(6000);
for (const s of steps) {
  try {
    if (s.goto) { await page.goto(s.goto, {waitUntil: 'domcontentloaded'}); await page.waitForTimeout(4000); }
    if (s.click) { const l = /^[.#\[]|^\w+[.#\[]/.test(s.click) ? page.locator(s.click) : page.getByText(s.click, {exact: false}); await l.first().click({timeout: 8000}); await page.waitForTimeout(2500); }
    if (s.fill) { await page.locator(s.fill).first().fill(s.value, {timeout: 8000}); }
    if (s.press) { await page.keyboard.press(s.press); await page.waitForTimeout(2500); }
    if (s.wait) await page.waitForTimeout(s.wait);
    if (s.shot) await page.screenshot({path: s.shot});
    console.error('step ok', JSON.stringify(s));
  } catch (e) { console.error('step failed', JSON.stringify(s), String(e).slice(0, 200)); }
}
console.error('final url', page.url());
await page.screenshot({path: `/tmp/rec-${site.split(',')[0]}.png`});
fs.writeFileSync(`/tmp/rec-${site.split(',')[0]}.txt`, (await page.innerText('body').catch(() => '')).slice(0, 5000));
await browser.close();
