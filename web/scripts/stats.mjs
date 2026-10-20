const key = process.env.CLIFY_WEB_ADMIN_KEY;
if (!key) throw new Error('CLIFY_WEB_ADMIN_KEY is required');
const base = process.env.CLIFY_BASE_URL || 'https://clify-dev.netlify.app';
const r = await fetch(`${base}/_stats?key=${encodeURIComponent(key)}`);
console.log(JSON.stringify(await r.json(),null,2));
if (!r.ok) process.exitCode=1;
