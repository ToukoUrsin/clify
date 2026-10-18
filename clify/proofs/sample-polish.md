# Regression sample: 10 of the 41 public sites with the polished synthesizer (2026-10-18)

Same runner as [sites.md](sites.md) (`test/sites/run.sh`, `--account none`, headless Chrome on the box, `nice -n 10`, 2 sites at a time, claude-opus-5-5), on the code that adds `src/polish.ts` (duplicate requests → aliases, account context, examples from verified calls) and the new synth rules (most useful first, one command per request, ≤4 notes). Public sites have no account, so no context is derived here; this checks that nothing regressed.

| site | generated | verified | verified before (sites.md) | dropped | time |
|---|---|---|---|---|---|
| https://arxiv.org/ | 10 | 8 | 10 | dropped 2: get-archive (The 'ul > li' selector matches the page's Browse n); get-rss (only 0 of 6 fields extracted (missing: title, guid) | 3m03s |
| https://crates.io/ | 20 | 20 | 19 | – | 2m54s |
| https://dev.to/ | 12 | 12 | 15 | – | 1m44s |
| https://docs.python.org/3/ | 12 | 12 | 8 | – | 3m09s |
| https://earthquake.usgs.gov/earthquakes/map/ | 9 | 9 | 11 | – | 2m22s |
| https://www.gutenberg.org/ | 16 | 16 | 13 | – | 3m21s |
| https://www.jsdelivr.com/ | 19 | 19 | 17 | – | 3m10s |
| https://www.nuget.org/ | 11 | 11 | 15 | – | 3m02s |
| https://www.tvmaze.com/ | 16 | 16 | 25 | – | 3m46s |
| https://www.weather.gov/ | 14 | 14 | 11 | – | 3m53s |

10 of 10 sites with ≥3 verified commands (before: 10 of 10). 137 verified commands (before: 144); 137 of 139 generated commands verified.

Every run explores the site afresh, so coverage varies between runs: the new tvmaze run did not open the cast, crew, AKA and image pages the earlier run recorded (25 → 16), nuget went 15 → 11 and dev.to 15 → 12, while docs.python (8 → 12), gutenberg (13 → 16) and weather (11 → 14) gained commands. arxiv dropped 2 commands that failed verification (an HTML selector, RSS fields; before: 0 dropped). No duplicate needed collapsing after verification. Specs and logs stay on the box (`~/race-gen5/sample10`).
