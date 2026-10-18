# `clify add` on 44 unseen sites (2026-10-18)

Run: `test/sites/run.sh test/sites/sites.txt 4` on a Linux box (headless Chrome, `nice -n 10`, 4 sites at a time), model `claude-opus-5-5`, `--account none` (no accounts created). None of these sites had a spec before; `test/real/` holds the only hand-written specs (books/quotes.toscrape, HN Algolia, Wikipedia, scrapethissite, httpbin), and none of those are in this list. Start pages were checked against robots.txt first (`test/sites/robots-check.ts`); 10 candidates were skipped because robots.txt disallows them.

Each row is one fully automatic run: explore → synthesize the spec from the recording → run every read command live with its example args → repair failures (up to 3 rounds) → drop what still fails → install. "verified" = read commands that returned real data in the final check. Writes are never sent during verification (preview only). Per-site summaries and the generated specs are in [sites/](sites/); one complete log is [crates-add.log](crates-add.log).

| site | name | generated | verified | writes | time | notes |
|---|---|---|---|---|---|---|
| https://archive.org/ | archive | 16 | 16 | 0 | 4m32s |  |
| https://arxiv.org/ | arxiv | 10 | 10 | 0 | 3m41s |  |
| https://catalog.data.gov/dataset | catalog-data | 9 | 9 | 0 | 3m31s |  |
| https://clinicaltrials.gov/ | clinicaltrials | 9 | 8 | 0 | 3m32s | dropped 1: get-study-version (The internal history endpoint returns 403 and the ) |
| https://crates.io/ | crates | 19 | 19 | 0 | 2m47s |  |
| https://data.europa.eu/en | data-europa | 11 | 10 | 0 | 4m07s | dropped 1: get-dataset-comments (The endpoint works but returns total 0 for the exa) |
| https://dev.to/ | dev | 15 | 15 | 0 | 3m06s |  |
| https://developer.mozilla.org/en-US/ | developer-mozilla | 5 | 4 | 0 | 2m07s | dropped 1: get-current-user (No session exists, so every user field is null and) |
| https://docs.python.org/3/ | docs-python | 8 | 8 | 0 | 2m11s |  |
| https://docs.rs/ | docs | 16 | 16 | 0 | 3m51s |  |
| https://earthquake.usgs.gov/earthquakes/map/ | earthquake-usgs | 11 | 11 | 0 | 2m24s |  |
| https://formulae.brew.sh/ | formulae-brew | 7 | 7 | 0 | 2m16s |  |
| https://hub.docker.com/ | hub-docker | 13 | 13 | 0 | 4m32s | bot-check at https://hub.docker.com/search?q=redis · bot-check at https://hub.docker.com/search?q=redis&type=image |
| https://huggingface.co/models | huggingface | 16 | 15 | 0 | 4m22s | dropped 1: semantic-search-spaces (Returned an empty array for a common query. The re) |
| https://images.nasa.gov/ | images-nasa | 8 | 8 | 0 | 2m24s |  |
| https://lichess.org/ | lichess | 13 | 11 | 0 | 4m55s | bot-check at https://lichess.org/ · bot-check at https://lichess.org/@/DrNykterstein · dropped 2: get-fide-player (HTTP 429: rate limited by the site; wait a minute ); get-top-players (the site answered with a bot check (HTTP 403); cli) |
| https://musicbrainz.org/ | musicbrainz | 19 | 18 | 0 | 6m04s | dropped 1: list-artist-release-groups (request failed: fetch failed) |
| https://news.ycombinator.com/ | news-ycombinator | 15 | 13 | 1 | 3m57s | dropped 1: list-user-favorites (empty list: the example args returned nothing or t) |
| https://openverse.org/ | openverse | 11 | 6 | 0 | 2m16s | bot-check at https://openverse.org/ · captcha · dropped 5: get-image (the site answered with a bot check (HTTP 404); cli); get-related-images (the site answered with a bot check (HTTP 404); cli) |
| https://packagist.org/ | packagist | 17 | 17 | 0 | 4m27s |  |
| https://pkg.go.dev/ | pkg-go | 11 | 11 | 0 | 3m37s |  |
| https://pubmed.ncbi.nlm.nih.gov/ | pubmed-ncbi | 4 | 4 | 0 | 2m56s |  |
| https://pypi.org/ | pypi | 9 | 9 | 0 | 2m21s | captcha |
| https://remoteok.com/ | remoteok | 7 | 5 | 0 | 3m07s | bot-check at https://www.toptal.com/ · dropped 2: list-company-jobs (The /company/{slug} page is a JS shell. It ships o); list-country-jobs (The /remote-jobs-in-{country} page is the same JS ) |
| https://rubygems.org/ | rubygems | 17 | 17 | 0 | 2m54s |  |
| https://ted.europa.eu/en/ | ted-europa | 0 | 0 | 0 | 0m28s | captcha |
| https://www.artic.edu/collection | artic | 14 | 12 | 0 | 3m50s | bot-check at https://www.artic.edu/collection?q=monet · captcha · dropped 2: get-related-artworks (The endpoint returns its data as an HTML fragment ); autocomplete (HTTP 403: this endpoint needs a login or the site ) |
| https://www.data.gov.uk/ | data-gov | 9 | 9 | 0 | 2m59s |  |
| https://www.federalregister.gov/ | federalregister | 13 | 13 | 0 | 2m13s | captcha at https://unblock.federalregister.gov/ |
| https://www.finna.fi/ | finna | 9 | 8 | 1 | 3m31s |  |
| https://www.gutenberg.org/ | gutenberg | 13 | 13 | 0 | 2m52s |  |
| https://www.hankintailmoitukset.fi/fi/ | hankintailmoitukset | 16 | 13 | 0 | 3m43s | dropped 3: get-legacy-notice (The example id 500000 returned 404. No real legacy); get-legacy-procurement (The example id 80000 returned 404. No real oldProc) |
| https://www.inaturalist.org/observations | inaturalist | 10 | 10 | 0 | 1m29s | bot-check at https://www.inaturalist.org/observations · bot-check at https://www.inaturalist.org/taxa/47851 |
| https://www.jsdelivr.com/ | jsdelivr | 17 | 17 | 0 | 2m53s |  |
| https://www.legislation.gov.uk/ | legislation | 2 | 2 | 0 | 0m46s | captcha |
| https://www.metmuseum.org/art/collection/search | metmuseum | 0 | 0 | 0 | 0m22s | bot-check at https://www.metmuseum.org/art/collection/search · bot-check at https://www.metmuseum.org/art/collection/search?q=sunflowers |
| https://www.nuget.org/ | nuget | 15 | 15 | 0 | 3m39s |  |
| https://www.openstreetmap.org/ | openstreetmap | 15 | 15 | 0 | 3m51s |  |
| https://www.rcsb.org/ | rcsb | 17 | 17 | 0 | 4m13s |  |
| https://www.theguardian.com/international | theguardian | 11 | 10 | 0 | 4m15s | dropped 1: list-tag-articles (The tag page .json?dcr response has no 'contents' ) |
| https://www.tvmaze.com/ | tvmaze | 25 | 25 | 0 | 3m02s |  |
| https://www.usaspending.gov/ | usaspending | 37 | 34 | 3 | 5m34s |  |
| https://www.weather.gov/ | weather | 11 | 11 | 0 | 2m57s |  |
| https://www.ycombinator.com/companies | ycombinator | 12 | 10 | 0 | 5m05s | dropped 2: search-companies (Algolia rejects the request with 'Invalid Applicat); list-company-facets (Uses the same invalid Algolia API key as search-co) |

44 sites; 41 (93%) with ≥3 verified commands; 514 verified commands total

Misses: legislation.gov.uk (AWS WAF challenge on every page), metmuseum.org and ted.europa.eu (bot checks / CAPTCHA). "bot-check"/"captcha" notes on other rows are pages clify reported and stayed away from while still covering the rest of the site.

A few specs include the search-only Algolia keys that the sites' own web apps send to every visitor (e.g. Homebrew, Packagist). They are not account credentials.

Not counted: an earlier full run of the same 44 sites with the previous code version (2026-10-18 06:24–07:00 UTC) gave 40/44 with ≥3 verified commands and 471 verified commands.
