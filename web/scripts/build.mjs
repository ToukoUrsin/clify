import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..');
const repo = path.resolve(web, '..');
const pub = path.join(web, 'public');
const dataDir = path.join(web, 'data');
fs.mkdirSync(pub, { recursive: true }); fs.mkdirSync(dataDir, { recursive: true });
const generated = fs.readFileSync(path.join(repo, 'mcp/src/specs.generated.ts'), 'utf8');
const m = generated.match(/JSON\.parse\(([\s\S]*)\);\s*$/);
if (!m) throw new Error('could not read generated specs');
const specs = JSON.parse(Function(`return ${m[1]}`)());
fs.writeFileSync(path.join(dataDir, 'specs.json'), JSON.stringify(specs));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const attr = esc;
const base = 'https://clify-dev.netlify.app';
const hostOf = s => new URL(s.origin).hostname.replace(/^www\./, '');
const words = q => q.toLowerCase().split(/[^a-z0-9.+#-]+/).filter(x => x.length > 1);
const exampleArgs = c => {
  const out = {};
  for (const p of c.params ?? []) {
    const v = c.example?.[p.name] ?? p.example ?? (p.required && p.default === undefined ? p.enum?.[0] : undefined);
    if (v !== undefined) out[p.name] = v;
  }
  return out;
};
const commandUrl = (s, c) => {
  const args = exampleArgs(c);
  const qs = new URLSearchParams();
  for (const p of c.params ?? []) if (p.in === 'query' && args[p.name] !== undefined) qs.set(p.name, String(args[p.name]));
  const pathPart = `/${encodeURIComponent(s.name)}/${encodeURIComponent(c.name)}`;
  return `${base}${pathPart}${qs.toString() ? `?${qs}` : ''}`;
};
const signature = c => (c.params ?? []).map(p => `${p.name}${p.required && p.default === undefined ? '*' : ''}${p.type !== 'string' ? `:${p.type}` : ''}${p.default !== undefined ? `=${p.default}` : ''}`).join(' ');
const layout = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(title)} — JSON over curl for AI agents"><link rel="canonical" href="${base}"><style>body{font:16px/1.5 system-ui,sans-serif;max-width:980px;margin:2rem auto;padding:0 1rem;color:#17202a}code,pre{font-family:ui-monospace,monospace}pre{background:#f4f6f8;padding:1rem;overflow:auto}a{color:#0645ad}h1{line-height:1.15}li{margin:.7rem 0}.tag{color:#555}</style></head><body>${body}</body></html>`;
const intro = `Use the public JSON API with plain curl. No install, key, account, or browser is needed. Example: <code>curl '${base}/sites.json'</code>. Start with <a href="/search?q=weather">/search?q=weather</a>, then call <code>/${esc(specs[0]?.name ?? 'site')}/COMMAND</code>. Responses are one JSON object. The hosted <a href="https://bold-cloud-h4u6s.run.mcp-use.com/mcp">MCP</a> and <a href="https://github.com/ToukoUrsin/clify">GitHub repo</a> are also available.`;
const home = `<main><h1>clify — websites as JSON for AI agents</h1><p>${intro}</p><h2>Three curls to start</h2><pre>curl '${base}/sites.json'
curl '${base}/search?q=rust+crates'
curl '${base}/crates/get-crate?name=serde'</pre><p>Every endpoint is read-only; write commands return HTTP 405. Use <a href="/llms.txt">llms.txt</a> for agent instructions and <a href="/sitemap.xml">the sitemap</a> for all pages.</p><p>${specs.length} indexed sites, ${specs.reduce((n,s)=>n+s.commands.length,0)} verified commands.</p></main>`;
fs.writeFileSync(path.join(pub, 'index.html'), layout('clify — websites as JSON for AI agents', home));
const llms = `# clify\n\nPublic JSON-over-curl API for AI agents. No key or account. Base URL: ${base}\n\n## Usage\nGET ${base}/sites.json for the catalogue. GET ${base}/search?q=what+you+need to find a site. GET ${base}/<site>/<command>?<param>=<value> to run a verified read command. Responses are one JSON object. Unknown sites return 404 with didYouMean and a request URL. Write commands return 405. See ${base}/ for examples. Hosted MCP: https://bold-cloud-h4u6s.run.mcp-use.com/mcp. Source: https://github.com/ToukoUrsin/clify\n\n## Sites\n${specs.map(s=>`- ${s.name}: ${hostOf(s)} — ${(s.description||'').replace(/\s+/g,' ').split(/(?<=[.!?])\s+/)[0] || 'verified website commands'}`).join('\n')}\n`;
fs.writeFileSync(path.join(pub,'llms.txt'), llms);
fs.writeFileSync(path.join(pub,'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
const urls = [base+'/', base+'/llms.txt', base+'/sites.json', ...specs.map(s=>`${base}/${encodeURIComponent(s.name)}`)];
fs.writeFileSync(path.join(pub,'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u=>`<url><loc>${esc(u)}</loc></url>`).join('')}</urlset>`);
const commandInfoForBuild = c => ({command:c.name,summary:c.summary,params:(c.params??[]).map(p=>({name:p.name,type:p.type,...(p.required&&p.default===undefined?{required:true}:{}),...(p.description?{description:p.description}:{}),...(p.enum?{oneOf:p.enum}:{}),...(p.default!==undefined?{default:p.default}:{})})),...(c.mutates?{writes:true}:{})});
for (const s of specs) {
  const commandRows = s.commands.map(c => {
    const ex = commandUrl(s,c);
    const params = (c.params??[]).map(p=>`<code>${esc(p.name)}${p.required&&p.default===undefined?'*':''}</code>`).join(', ') || 'none';
    return `<section><h3 id="${attr(c.name)}"><code>${esc(c.name)}</code></h3><p>${esc(c.summary)} <span class="tag">Params: ${params}</span></p><pre>curl '${attr(ex)}'</pre></section>`;
  }).join('\n');
  const jsonld = { '@context':'https://schema.org', '@type':'TechArticle', name:`${s.name} API for agents`, description:s.description, url:`${base}/${encodeURIComponent(s.name)}` };
  const body = `<main><p><a href="/">← clify home</a> · <a href="/sites.json">catalogue</a></p><h1>${esc(s.name)} API for agents (unofficial) — JSON over curl | clify</h1><p>${esc(s.description)}</p><p>Host: <code>${esc(hostOf(s))}</code>. Call these verified read commands with plain curl; no install, key, or account. ${intro}</p><h2>Commands</h2>${commandRows}<script type="application/ld+json">${JSON.stringify(jsonld)}</script></main>`;
  fs.writeFileSync(path.join(pub, `${s.name}.html`), layout(`${s.name} API for agents (unofficial) — JSON over curl | clify`, body));
  fs.writeFileSync(path.join(pub, `${s.name}.json`), JSON.stringify({ok:true,site:s.name,host:hostOf(s),about:s.description,commands:s.commands.map(c=>({...commandInfoForBuild(c),exampleUrl:commandUrl(s,c)}))}));
}
// Keep a public IndexNow key file if supplied by the deploy environment.
if (process.env.CLIFY_INDEXNOW_KEY) fs.writeFileSync(path.join(pub, process.env.CLIFY_INDEXNOW_KEY), process.env.CLIFY_INDEXNOW_KEY+'\n');
await build({ entryPoints:[path.join(web,'src','api-entry.ts')], bundle:true, format:'esm', platform:'node', target:'node22', outfile:path.join(web,'functions','api.mjs'), external:['@netlify/blobs'], alias:{'node-html-parser':path.join(web,'node_modules/node-html-parser')} });
await build({ entryPoints:[path.join(repo,'clify/src/core.ts')], bundle:true, format:'esm', platform:'node', target:'node22', outfile:path.join(web,'functions','core.mjs'), alias:{'node-html-parser':path.join(web,'node_modules/node-html-parser')} });
console.log(`built ${specs.length} sites, ${specs.reduce((n,s)=>n+s.commands.length,0)} commands`);
