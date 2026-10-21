# SF/U.S. expansion — 2026-10-21

`clify add` was run with the existing configured model access, in batches of eight, respecting each site's robots.txt and stopping at bot walls/CAPTCHAs. The 21 new shipped specs are:

- Events: `luma`, `eventbrite`, `funcheap`, `producthunt`
- Hiring: `workatastartup`, `ashby`, `greenhouse`, `lever`
- Transit and public services: `datasf`, `sfmta`, `transit511`, `bart`, `caltrain`, `sfpl`
- Listings, news and research: `craigslist`, `techcrunch`, `sfstandard`, `githubtrending`, `hfpapers`
- Markets: `polymarket`, `kalshi`

Product Hunt's HTML pages hit a bot check, but its public Atom feed produced one verified read command and is included with that limitation in the generated spec. The following candidates were left as misses and were not worked around:

- `redfin.com` — every explored page returned Redfin's “Are You a Robot?” rate-limit/bot page; CAPTCHA blocker.
- `apartments.com` — Akamai “Access Denied” bot block on the homepage and search page; CAPTCHA blocker.
- `sec.gov/edgar/search` — SEC automated-access rate threshold blocker on every explored page; CAPTCHA blocker.

The production directory is `https://clify-dev.netlify.app` (156 sites, 1,802 verified read commands). The blind-test run is in `~/work/general/clify-validation-2026-10-20/discovery/runs/20261021T114531Z`.
