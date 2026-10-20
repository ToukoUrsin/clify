import fs from 'node:fs';
const base = process.env.CLIFY_BASE_URL || 'https://clify-dev.netlify.app';
const key = process.env.CLIFY_INDEXNOW_KEY;
if (!key) throw new Error('CLIFY_INDEXNOW_KEY is required');
const urls = fs.readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8').match(/<loc>([^<]+)<\/loc>/g)?.map(x=>x.slice(5,-6)) ?? [];
const statuses=[];
for (let i=0;i<urls.length;i+=50) {
  const r = await fetch('https://api.indexnow.org/indexnow',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({host:new URL(base).hostname,key,keyLocation:`${base}/${key}`,urlList:urls.slice(i,i+50)})});
  statuses.push(r.status); if (!r.ok && r.status!==202) { console.error(await r.text()); process.exitCode=1; }
}
console.log(JSON.stringify({statuses,urls:urls.length}));
