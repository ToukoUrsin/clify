# `clify add` on 116 more sites, browsers and verification on Blaxel (2026-10-18)

Run: `node test/blaxel/run.mjs` over [sites.txt](../test/blaxel/sites.txt) (86 sites) and [sites-wave2.txt](../test/blaxel/sites-wave2.txt) (30) on a Linux build machine, at most 6 sites (sandboxes) at a time, `clify add` under `nice -n 10`, model `claude-opus-5-5`. For every site:

1. A fresh Blaxel sandbox (`blaxel/playwright-chromium`, 4 GB, us-pdx-1) starts stock headless Chrome (no stealth flags, default user agent) and `test/blaxel/cdp-proxy.mjs`, which serves its DevTools endpoint on port 9300. clify reaches it through the sandbox API's authenticated port route (`wss://<sandbox>/port/9300/`). The first sites of the run used a private, token-protected preview URL instead, until the workspace hit its 20-preview quota.
2. `clify add <url> --account none` runs on the box (the model calls go to Claude Opus 5.5 from there) with `CLIFY_CDP_URL` pointing at that sandbox: every page the explorer opens loads in the sandbox's Chrome, and the recorder and write guard work over CDP.
3. The generated spec is copied into the same sandbox with clify (`test/blaxel/bundle.sh`) and `clify check <site>` runs there: every read command's example, live, with no model calls. **verified on Blaxel** counts the read commands that returned real data in that run; commands that failed there are moved to `dropped` in the shipped spec.
4. The sandbox is deleted.

Start pages were checked against robots.txt first (`test/sites/robots-check.ts`); 12 of 128 candidates were skipped because robots.txt disallows them ([test/blaxel/candidates.txt](../test/blaxel/candidates.txt)). No accounts were created, no writes were sent, and CAPTCHAs/bot checks were reported and left alone. Per-site specs and run records: [sites-blaxel/](sites-blaxel/).

Sites whose `clify add` hit one of two clify bugs this run surfaced (a malformed form body aborted saving the recording; `clify check` crashed on a command whose output was undefined; both fixed in this commit), or whose sandbox Chrome crashed, were run once more; the table keeps the better attempt. svt.se's Blaxel check was re-run in a fresh sandbox after the `check` fix (`test/blaxel/recheck.mjs`).

A few specs include public keys that the sites' own web pages send to every visitor (search-only Algolia/Typesense keys, the api.data.gov keys embedded in fec.gov, eia.gov and nps.gov pages). They are not account credentials.

| site | category | name | generated | verified at add | verified on Blaxel | time | sandbox | notes |
|---|---|---|---|---|---|---|---|---|
| https://collection.sciencemuseumgroup.org.uk/ | culture | collection-sciencemuseumgroup | 3 | 3 | 3/3 | 1m48s | `clify-collection-sciencemuseumgroup-org-uk` | captcha |
| https://collections.vam.ac.uk/ | culture | collections-vam | 12 | 12 | 12/12 | 4m48s | `clify-collections-vam-ac-uk` |  |
| https://digitalnz.org/ | culture | digitalnz | 0 | 0 | 0/0 | 0m31s | `clify-digitalnz-org` | captcha |
| https://digitaltmuseum.no/ | culture | digitaltmuseum | 0 | 0 | 0/0 | 0m24s | `clify-digitaltmuseum-no` | bot-check at https://digitaltmuseum.no/ · bot-check at https://digitaltmuseum.no/owners |
| https://dp.la/ | culture | dp | 0 | 0 | 0/0 | 0m16s | `clify-dp-la` | captcha |
| https://open.smk.dk/ | culture | open-smk | 9 | 9 | 9/9 | 5m18s | `clify-open-smk-dk` |  |
| https://openlibrary.org/ | culture | openlibrary | 7 | 5 | 0/5 | 2m39s | `clify-openlibrary-org` | captcha · dropped 2 at add · failed on Blaxel: list-languages (request failed: fetch failed); list-browse-genres (request failed: fetch failed) |
| https://trove.nla.gov.au/ | culture | trove-nla | 0 | 0 | 0/0 | 0m23s | `clify-trove-nla-gov-au` | captcha |
| https://www.biodiversitylibrary.org/ | culture | biodiversitylibrary | 0 | 0 | 0/0 | 0m31s | `clify-www-biodiversitylibrary-org` | bot-check at https://www.biodiversitylibrary.org/ · bot-check at https://www.biodiversitylibrary.org/browse/collections |
| https://www.clevelandart.org/art/collection/search | culture | clevelandart | 6 | 5 | 5/5 | 4m50s | `clify-www-clevelandart-org-art-collection-sea` | dropped 1 at add |
| https://www.loc.gov/ | culture | loc | 5 | 5 | 5/5 | 1m00s | `clify-www-loc-gov` | bot-check at https://www.loc.gov/photos/?q=abraham+lincoln · bot-check at https://www.loc.gov/collections/ |
| https://www.rijksmuseum.nl/en/collection | culture | rijksmuseum | 10 | 10 | 10/10 | 4m01s | `clify-www-rijksmuseum-nl-en-collection` |  |
| https://www.si.edu/search | culture | si | 0 | 0 | 0/0 | 0m24s | `clify-www-si-edu-search` | bot-check at https://www.si.edu/search · bot-check at https://www.si.edu/collections |
| https://artifacthub.io/ | dev | artifacthub | 14 | 14 | 14/14 | 4m08s | `clify-artifacthub-io` |  |
| https://bundlephobia.com/ | dev | bundlephobia | 9 | 7 | 7/7 | 2m43s | `clify-bundlephobia-com` | dropped 2 at add |
| https://caniuse.com/ | dev | caniuse | 8 | 8 | 8/8 | 2m34s | `clify-caniuse-com` |  |
| https://central.sonatype.com/ | dev | central-sonatype | 8 | 8 | 8/8 | 3m03s | `clify-central-sonatype-com` |  |
| https://cocoapods.org/ | dev | cocoapods | 4 | 4 | 4/4 | 1m49s | `clify-cocoapods-org` |  |
| https://ctan.org/ | dev | ctan | 21 | 20 | 20/20 | 5m07s | `clify-ctan-org` | dropped 1 at add |
| https://devdocs.io/ | dev | devdocs | 6 | 6 | 6/6 | 2m13s | `clify-devdocs-io` |  |
| https://endoflife.date/ | dev | endoflife | 14 | 14 | 14/14 | 2m33s | `clify-endoflife-date` |  |
| https://hackage.haskell.org/ | dev | hackage-haskell | 14 | 14 | 14/14 | 5m12s | `clify-hackage-haskell-org` |  |
| https://hex.pm/ | dev | hex | 9 | 9 | 9/9 | 3m51s | `clify-hex-pm` |  |
| https://jsr.io/ | dev | jsr | 16 | 15 | 15/15 | 5m27s | `clify-jsr-io` | dropped 1 at add |
| https://opam.ocaml.org/packages/ | dev | opam-ocaml | 7 | 7 | 7/7 | 2m01s | `clify-opam-ocaml-org-packages` |  |
| https://open-vsx.org/ | dev | open-vsx | 11 | 11 | 11/11 | 3m10s | `clify-open-vsx-org` |  |
| https://pub.dev/ | dev | pub | 17 | 17 | 17/17 | 3m57s | `clify-pub-dev` |  |
| https://registry.terraform.io/ | dev | registry-terraform | 21 | 21 | 21/21 | 5m03s | `clify-registry-terraform-io` |  |
| https://swiftpackageindex.com/ | dev | swiftpackageindex | 15 | 15 | 15/15 | 3m23s | `clify-swiftpackageindex-com` |  |
| https://cordis.europa.eu/ | gov-eu | cordis-europa | 11 | 10 | 10/10 | 5m09s | `clify-cordis-europa-eu` | dropped 1 at add |
| https://data.ecb.europa.eu/ | gov-eu | ecb-europa | 8 | 5 | 5/5 | 5m47s | `clify-data-ecb-europa-eu` | dropped 3 at add |
| https://data.police.uk/ | gov-eu | data-police | 23 | 22 | 22/22 | 4m00s | `clify-data-police-uk` |  |
| https://ec.europa.eu/eurostat/databrowser/ | gov-eu | ec-europa | 13 | 13 | 13/13 | 4m01s | `clify-ec-europa-eu-eurostat-databrowser` |  |
| https://eur-lex.europa.eu/ | gov-eu | eur-lex-europa | 4 | 3 | 0/3 | 3m34s | `clify-eur-lex-europa-eu` | captcha · dropped 1 at add · failed on Blaxel: suggest-search-terms (response was not JSON (content-type text/html; cha); search-documents (empty list: the example args returned nothing or t) |
| https://find-and-update.company-information.service.gov.uk/ | gov-eu | company-information-service | 18 | 18 | 18/18 | 5m58s | `clify-find-and-update-company-information-ser` |  |
| https://www.ons.gov.uk/ | gov-eu | ons | 15 | 15 | 15/15 | 6m29s | `clify-www-ons-gov-uk` |  |
| https://avoindata.prh.fi/ | gov-nordic | avoindata-prh | 11 | 11 | 11/11 | 4m05s | `clify-avoindata-prh-fi` |  |
| https://data.norge.no/ | gov-nordic | data-norge | 12 | 10 | 10/10 | 6m00s | `clify-data-norge-no` | dropped 2 at add |
| https://digi.kansalliskirjasto.fi/ | gov-nordic | digi-kansalliskirjasto | 20 | 19 | 19/19 | 6m23s | `clify-digi-kansalliskirjasto-fi` | dropped 1 at add |
| https://pxdata.stat.fi/ | gov-nordic | pxdata-stat | 7 | 7 | 7/7 | 3m19s | `clify-pxdata-stat-fi` |  |
| https://www.dataportal.se/ | gov-nordic | dataportal | 16 | 16 | 16/16 | 6m28s | `clify-www-dataportal-se` |  |
| https://www.digitraffic.fi/ | gov-nordic | digitraffic | 23 | 23 | 23/23 | 4m46s | `clify-www-digitraffic-fi` |  |
| https://www.eduskunta.fi/ | gov-nordic | eduskunta | 0 | 0 | 0/0 | 0m17s | `clify-www-eduskunta-fi` | captcha |
| https://www.finlex.fi/ | gov-nordic | finlex | 10 | 7 | 7/7 | 4m18s | `clify-www-finlex-fi` | dropped 3 at add |
| https://www.riksdagen.se/ | gov-nordic | riksdagen | 12 | 12 | 12/12 | 7m08s | `clify-www-riksdagen-se` |  |
| https://www.ssb.no/ | gov-nordic | ssb | 11 | 11 | 11/11 | 4m26s | `clify-www-ssb-no` |  |
| https://www.statistikdatabasen.scb.se/ | gov-nordic | ? | 0 | 0 | 0/0 | 1m06s | `clify-www-statistikdatabasen-scb-se` | page.waitForTimeout: Target page, context or browser has been closed |
| https://data.cdc.gov/ | gov-us | data-cdc | 10 | 10 | 10/10 | 4m13s | `clify-data-cdc-gov` |  |
| https://data.cityofnewyork.us/ | gov-us | data-cityofnewyork | 9 | 8 | 8/8 | 3m43s | `clify-data-cityofnewyork-us` | dropped 1 at add |
| https://fred.stlouisfed.org/ | gov-us | fred-stlouisfed | 13 | 13 | 13/13 | 4m47s | `clify-fred-stlouisfed-org` |  |
| https://tidesandcurrents.noaa.gov/ | gov-us | tidesandcurrents-noaa | 20 | 20 | 20/20 | 4m55s | `clify-tidesandcurrents-noaa-gov` |  |
| https://vpic.nhtsa.dot.gov/ | gov-us | nhtsa-dot | 13 | 13 | 13/13 | 4m47s | `clify-vpic-nhtsa-dot-gov` |  |
| https://waterdata.usgs.gov/ | gov-us | waterdata-usgs | 18 | 17 | 17/17 | 5m50s | `clify-waterdata-usgs-gov` |  |
| https://www.eia.gov/ | gov-us | eia | 17 | 14 | 14/14 | 9m21s | `clify-www-eia-gov` | dropped 2 at add |
| https://www.fec.gov/data/ | gov-us | fec | 25 | 23 | 14/23 | 8m32s | `clify-www-fec-gov-data` | captcha at https://www.fec.gov/data/ · captcha at https://www.fec.gov/data/search/?search=Ossoff · dropped 1 at add · failed on Blaxel: list-receipts (HTTP 429: rate limited by the site; wait a minute ); list-disbursements (HTTP 429: rate limited by the site; wait a minute ) |
| https://www.govinfo.gov/ | gov-us | govinfo | 20 | 20 | 20/20 | 4m56s | `clify-www-govinfo-gov` |  |
| https://www.grants.gov/ | gov-us | grants | 8 | 6 | 6/6 | 4m04s | `clify-www-grants-gov` |  |
| https://www.nps.gov/ | gov-us | nps | 20 | 20 | 20/20 | 5m59s | `clify-www-nps-gov` |  |
| https://arbeidsplassen.nav.no/ | jobs-market | arbeidsplassen-nav | 5 | 5 | 5/5 | 3m53s | `clify-arbeidsplassen-nav-no` |  |
| https://arbetsformedlingen.se/platsbanken/ | jobs-market | arbetsformedlingen | 6 | 6 | 6/6 | 4m39s | `clify-arbetsformedlingen-se-platsbanken` |  |
| https://himalayas.app/jobs | jobs-market | himalayas | 0 | 0 | 0/0 | 0m26s | `clify-himalayas-app-jobs` | bot-check at https://himalayas.app/jobs · bot-check at https://himalayas.app/api |
| https://remotive.com/ | jobs-market | remotive | 4 | 2 | 2/2 | 5m12s | `clify-remotive-com` | dropped 2 at add |
| https://tyomarkkinatori.fi/ | jobs-market | tyomarkkinatori | 12 | 12 | 12/12 | 4m34s | `clify-tyomarkkinatori-fi` |  |
| https://weworkremotely.com/ | jobs-market | weworkremotely | 2 | 2 | 2/2 | 1m14s | `clify-weworkremotely-com` | bot-check at https://weworkremotely.com/ · bot-check at https://weworkremotely.com/remote-jobs/search?term=python |
| https://world.openfoodfacts.org/ | jobs-market | world-openfoodfacts | 8 | 7 | 7/7 | 2m09s | `clify-world-openfoodfacts-org` | dropped 1 at add |
| https://www.arbeitnow.com/ | jobs-market | arbeitnow | 5 | 5 | 5/5 | 3m16s | `clify-www-arbeitnow-com` |  |
| https://www.printables.com/ | jobs-market | printables | 0 | 0 | 0/0 | 0m24s | `clify-www-printables-com` | bot-check at https://www.printables.com/ · bot-check at https://www.printables.com/search/models?q=phone%20stand |
| https://www.usajobs.gov/ | jobs-market | usajobs | 8 | 6 | 6/6 | 8m12s | `clify-www-usajobs-gov` | bot-check at https://usajobshelp.opm.gov/hc/en-us/articles/53059807800979-What-a · dropped 2 at add |
| https://aviationweather.gov/ | maps-weather | aviationweather | 9 | 9 | 9/9 | 4m03s | `clify-aviationweather-gov` |  |
| https://citybik.es/ | maps-weather | citybik | 4 | 4 | 4/4 | 1m24s | `clify-citybik-es` |  |
| https://nominatim.openstreetmap.org/ui/search.html | maps-weather | nominatim-openstreetmap | 5 | 5 | 5/5 | 2m05s | `clify-nominatim-openstreetmap-org-ui-search-h` |  |
| https://open-meteo.com/ | maps-weather | open-meteo | 16 | 16 | 16/16 | 5m06s | `clify-open-meteo-com` |  |
| https://sunrise-sunset.org/ | maps-weather | sunrise-sunset | 8 | 8 | 8/8 | 3m55s | `clify-sunrise-sunset-org` |  |
| https://www.airnow.gov/ | maps-weather | airnow | 16 | 16 | 16/16 | 3m31s | `clify-www-airnow-gov` |  |
| https://www.geonames.org/ | maps-weather | geonames | 20 | 19 | 19/19 | 4m12s | `clify-www-geonames-org` | dropped 1 at add |
| https://www.ndbc.noaa.gov/ | maps-weather | ndbc-noaa | 6 | 6 | 6/6 | 1m48s | `clify-www-ndbc-noaa-gov` |  |
| https://www.smhi.se/ | maps-weather | smhi | 16 | 16 | 16/16 | 4m41s | `clify-www-smhi-se` |  |
| https://www.swpc.noaa.gov/ | maps-weather | swpc-noaa | 10 | 10 | 10/10 | 3m10s | `clify-www-swpc-noaa-gov` |  |
| https://www.yr.no/ | maps-weather | yr | 25 | 24 | 24/24 | 4m30s | `clify-www-yr-no` | dropped 1 at add |
| https://apnews.com/ | news | apnews | 0 | 0 | 0/0 | 0m22s | `clify-apnews-com` | bot-check at https://apnews.com/ · bot-check at https://apnews.com/hub/politics |
| https://arstechnica.com/ | news | arstechnica | 8 | 8 | 8/8 | 5m33s | `clify-arstechnica-com` |  |
| https://slashdot.org/ | news | slashdot | 15 | 13 | 13/13 | 5m46s | `clify-slashdot-org` | bot-check at https://news.slashdot.org/comments.pl?sid=24125078&cid=66377906 |
| https://www.abc.net.au/news | news | abc | 9 | 9 | 9/9 | 5m14s | `clify-www-abc-net-au-news` |  |
| https://www.bbc.com/news | news | bbc | 15 | 15 | 15/15 | 5m05s | `clify-www-bbc-com-news` |  |
| https://www.cbc.ca/news | news | cbc | 0 | 0 | 0/0 | 0m22s | `clify-www-cbc-ca-news` | nothing was recorded |
| https://www.npr.org/ | news | ? | 0 | 0 | 0/0 | 3m57s | `clify-www-npr-org` | page.waitForTimeout: Page crashed |
| https://www.nrk.no/ | news | nrk | 14 | 14 | 14/14 | 4m56s | `clify-www-nrk-no` |  |
| https://www.rnz.co.nz/news | news | rnz | 16 | 15 | 15/15 | 3m46s | `clify-www-rnz-co-nz-news` | dropped 1 at add |
| https://www.svt.se/ | news | svt | 7 | 7 | 6/7 | 3m59s | `clify-www-svt-se` | failed on Blaxel: list-tag-articles (resultPath "data.page.feed.items" matched nothing) |
| https://www.tagesschau.de/ | news | tagesschau | 8 | 8 | 8/8 | 4m34s | `clify-www-tagesschau-de` |  |
| https://yle.fi/news | news | yle | 7 | 7 | 7/7 | 3m59s | `clify-yle-fi-news` |  |
| https://dblp.org/ | science | dblp | 6 | 0 | 0/0 | 1m09s | `clify-dblp-org` | captcha · dropped 6 at add |
| https://doaj.org/ | science | doaj | 10 | 10 | 10/10 | 3m23s | `clify-doaj-org` | bot-check at https://doaj.org/ · bot-check at https://doaj.org/toc/2538-4449 |
| https://exoplanetarchive.ipac.caltech.edu/ | science | ipac-caltech | 11 | 11 | 11/11 | 3m45s | `clify-exoplanetarchive-ipac-caltech-edu` | bot-check at https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=select+pl_ |
| https://inspirehep.net/ | science | inspirehep | 21 | 21 | 20/21 | 6m34s | `clify-inspirehep-net` | failed on Blaxel: list-author-publications (request failed: The operation was aborted due to t) |
| https://openalex.org/ | science | openalex | 0 | 0 | 0/0 | 0m38s | `clify-openalex-org` | captcha |
| https://pubchem.ncbi.nlm.nih.gov/ | science | pubchem-ncbi | 19 | 19 | 19/19 | 5m03s | `clify-pubchem-ncbi-nlm-nih-gov` |  |
| https://ror.org/ | science | ror | 4 | 4 | 4/4 | 1m54s | `clify-ror-org` | bot-check at https://ror.org/ · bot-check at https://ror.org/search?query=oxford |
| https://search.crossref.org/ | science | search-crossref | 0 | 0 | 0/0 | 0m28s | `clify-search-crossref-org` |  |
| https://www.ebi.ac.uk/ | science | ebi | 11 | 11 | 11/11 | 4m14s | `clify-www-ebi-ac-uk` |  |
| https://www.ensembl.org/ | science | ensembl | 25 | 24 | 24/24 | 4m35s | `clify-www-ensembl-org` | dropped 1 at add |
| https://www.semanticscholar.org/ | science | semanticscholar | 10 | 8 | 4/8 | 3m44s | `clify-www-semanticscholar-org` | captcha · dropped 2 at add · failed on Blaxel: get-paper-references (HTTP 429: rate limited by the site; wait a minute ); get-paper-recommendations (HTTP 429: rate limited by the site; wait a minute ) |
| https://www.uniprot.org/ | science | uniprot | 24 | 18 | 18/18 | 6m46s | `clify-www-uniprot-org` | dropped 6 at add |
| https://www.wikidata.org/ | science | wikidata | 8 | 7 | 7/7 | 3m37s | `clify-www-wikidata-org` |  |
| https://zenodo.org/ | science | zenodo | 12 | 12 | 12/12 | 5m13s | `clify-zenodo-org` |  |
| https://anilist.co/ | sports-ent | anilist | 15 | 15 | 15/15 | 5m06s | `clify-anilist-co` |  |
| https://kitsu.app/ | sports-ent | kitsu | 0 | 0 | 0/0 | 0m23s | `clify-kitsu-app` | bot-check at https://kitsu.app/ · bot-check at https://kitsu.app/anime?text=naruto |
| https://ratings.fide.com/ | sports-ent | ? | 0 | 0 | 0/0 | 1m16s | `clify-ratings-fide-com` | page.waitForTimeout: Target page, context or browser has been closed |
| https://www.nhl.com/stats/ | sports-ent | nhl | 27 | 27 | 27/27 | 6m42s | `clify-www-nhl-com-stats` |  |
| https://www.openligadb.de/ | sports-ent | openligadb | 16 | 16 | 16/16 | 3m35s | `clify-www-openligadb-de` |  |
| https://www.radio-browser.info/ | sports-ent | radio-browser | 13 | 12 | 12/12 | 4m22s | `clify-www-radio-browser-info` | dropped 1 at add |
| https://www.setlist.fm/ | sports-ent | setlist | 15 | 0 | 0/0 | 2m16s | `clify-www-setlist-fm` | captcha · dropped 15 at add |
| https://www.speedrun.com/ | sports-ent | speedrun | 0 | 0 | 0/0 | 0m21s | `clify-www-speedrun-com` | bot-check at https://www.speedrun.com/ · bot-check at https://www.speedrun.com/games |
| https://www.themoviedb.org/ | sports-ent | themoviedb | 17 | 17 | 17/17 | 5m57s | `clify-www-themoviedb-org` |  |
| https://www.thesportsdb.com/ | sports-ent | thesportsdb | 18 | 18 | 18/18 | 4m58s | `clify-www-thesportsdb-com` |  |
| https://www.worldcubeassociation.org/ | sports-ent | worldcubeassociation | 15 | 14 | 14/14 | 4m22s | `clify-www-worldcubeassociation-org` | dropped 1 at add |

**This run:** 116 sites; 92 (79%) with ≥3 commands verified on Blaxel; 1120 commands verified on Blaxel; median 4m26s per successful site (sandbox start, exploration, synthesis, repair, Blaxel check).

Misses (24): 18 behind bot checks or CAPTCHAs (reported, never bypassed), the rest are crashes of the sandbox browser, sites that answered nothing usable, or endpoints that refused the Blaxel sandbox's network (openlibrary.org: connection refused from the sandbox) — see notes.

**Combined with the earlier run** ([sites.md](sites.md), 44 sites, browser and checks on the box): 160 sites, **133 with ≥3 verified commands**, 1634 verified commands. The wall for the film is [wall.json](wall.json) (133 sites, `verifiedOn` says where the check ran).

