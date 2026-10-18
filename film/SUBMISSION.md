# clify — 2-minute submission film

Composition `Submission` (`src/Submission.tsx`, scenes in `src/sub/`), 1920×1080, 30 fps, 119.4 s.
Rendered in a Daytona sandbox (Linux, headless Chromium + ffmpeg); nothing rendered on a laptop.

- Final cut: `film/out/clify-submission-v10.mp4` — sha256 90ac26a4…9cc7, 33.1 MB, 119.5 s, 3,582 frames, H.264 1080p30 + AAC 48 kHz, −16.4 LUFS integrated, true peak −1.4 dBFS, LRA 3.5 LU, no black stretches.
- Voice: ElevenLabs "Brian" (`scripts/make-sub-vo.mjs`). Every spoken number is built from `src/data/sub.json`, which `scripts/import-sub.mjs` fills from `scripts/counts.mjs --print` (the same derivation that checks the README) and the proof files below. v10 re-synthesized only the one line that changed (accounts: “…made by the agent itself, all logged in.”).
- Music: the ElevenLabs Music bed generated for v7 (`public/audio/sub-music.mp3`, same paid plan), ducked under the voice.
- Captions: the voice-over text, burned in, timed by the TTS word alignment.

## v11: alternative cut (bench beat → the race's third lane)

`film/out/clify-submission-v11.mp4`, composition `SubmissionV11` — sha256 6150f9b9…6f37, 33.2 MB, 119.5 s, 3,582 frames, H.264 1080p30 + AAC 48 kHz, −16.3 LUFS integrated, true peak −1.3 dBFS, LRA 3.5 LU, no black stretches. Identical to v10 except 0:25.3–0:30.7 (same frames, same timing for every other scene, line and caption). `film/final.json` names the cut that ships (`"cut": "v10"` now); `scripts/export-public.sh` exports only that cut and its review pack and points the README links at it.

Why: on the 20 easy public read-only bench tasks an agent with plain curl beats clify (curl 7.5 s / $1.12 vs clify 9.0 s / $1.28; the model knows those APIs), so v10's “Faster on 20 easy public tasks too” (true, versus a browser) invites that rebuttal. v11 shows the comparison that holds: signed-in dashboards, curl handed the same saved sessions.

- Screen: kicker “Same race, a third lane · 6 jobs in signed-in dashboards · same model, prompt and accounts”; title “Even vs an agent with curl and the same logins.”; three lanes with a time bar and a cost bar each (mean per run, every lane 6/6 verified every run): browser agent, clicks + screenshots **288 s / $2.06** (round 5 mean, 5 runs) · agent + curl, same saved sessions **97 s / $0.52** (2 runs) · clify agent **66 s / $0.29** (the same 2 runs); caption “curl re-discovers forms, CSRF and API paths every run; clify found and verified them once.” and “paired, the same 2 runs: curl 1.5× slower and 1.8× the cost of clify · most of the browser gap is the browser itself”; footnote with the run counts and sources.
- Sources: D and clify → `scripts/counts.mjs` `curl.race` (= README “Versus an agent with curl”, snippet “race curl”; `race/results/curl-modes.json`, per-run `race/results/curl-<run>.summary.json`, `race/README.md` mode D); browser → `counts.mjs` `race.generated` `timeA` / `costA` (round 5, n=5, as in row 2 of the table below). `import-sub.mjs` writes them to `sub.json` `curl` and fails unless the README holds the counts snippet and every lane is 6/6. Ratios use the README's rounding (1.489 → 1.5×, 1.786 → 1.8×).
- VO (the only new line, ElevenLabs “Brian”, `sub-vo-17`, 4.32 s): “Even against curl with the same logins, it's one point five times faster.” (`say1(curl.paired.time)`, the README's paired 1.5×). The beat keeps v10's 160 frames, so every other scene, line and caption is at the same time as in v10.

- Review: three renders in Daytona sandboxes (`render-v11.sh`: typecheck + render + loudnorm + review pack + full-resolution frames of the beat), contact sheets and full frames read by eye after each. Render 1: dead space above the caption, the browser lane's sub-line wrapped, and the VO caption broke as “…curl and the same / logins, …” → panel and caption rebalanced, VO shortened (4.97 s → 4.32 s, beat back to 160 frames). Render 2: the browser label wrapped at the larger size → one line. Render 3 (final): every label and number on one line, numbers as in `counts.mjs --print` (`curl.race`: D 96.5 s / $0.516, C 65.5 s / $0.289, paired 1.489 / 1.786; `race.generated`: A 287.9 s / $2.059, n=5).

## Changes from v9 (judge round 4)

1. Accounts: the screen said “19 real accounts the agent made itself, verified and logged in”; 18 of the 19 were verified (Hookdeck asked for no verification), all 19 logged in. Now “19 real accounts the agent made itself, all 19 logged in · 18 verified by email (Hookdeck asked for none)”, counted by `import-sub.mjs` from the verification and logged-in columns of `clify/test/accounts/results.md`. VO: “Nineteen real accounts so far, made by the agent itself, all logged in.” The scene is 0.6 s longer for it.
2. Cold-start card: “cloned clify's public tree” → “cloned the public export”. `clify/proofs/cold-start.md` says the agent cloned a local bare-repo copy of the exported public tree because the GitHub repo is not public yet; `import-sub.mjs` reads that “What it cloned” line, and switches the card to “cloned clify from GitHub” once the proof is re-run against the published repo.
3. Bench (0:25–0:31): recomposed to fill the frame: heading top-left like every other scene, three cards (1.8× faster, 4.8× fewer tokens, 3.2× cheaper vs the clicks-only browser agent) and a bar row of median time per task for all three modes (16.1 s / 12.7 s / 9.0 s, with median tokens and 40/40 each).
4. MCP: one client large and readable: Claude Code's run, set from its transcript (`mcp/demo/transcript-claude-code.md`) at 20 px: the task, its 4 tool calls in order (`crates__get-crate` → `clify_sites` → `clify_run` get-point → `clify_run` get-forecast) with their arguments and trimmed results (marked …), then its answer. Codex CLI, the mcp-use agent and the mcp-use Inspector are labelled chips (small live clip, model, “serde 1.0.229 · SF 58°F, Mostly Clear”), plus a card “the whole tool list: 2,538 tokens · 7 tools: 3 core + 4 shortcuts · one tool per command would be 568,912 tokens”. Title kept: “3 core tools (+4 shortcuts) · 2.5k tokens for the whole tool list”.
5. Wall close-up: only the 12 close-up tiles are on screen (framed with margin, nothing cut by the frame edge); the other tiles fade in as the camera pulls back. Host names wrap only after a dot or hyphen (no “registry.terrafor / m.io”), long ones shrink to fit, the “clify add · Blaxel” line no longer sits under the label bar, and labels ellipsize instead of cutting.
6. Dates: “real signup, 18.10” / “real run, 18.10” → “Oct 18”.
7. Race: when the clify agent finishes, the footage freezes on that frame, dims and blurs slightly under the results cards, so its live counters no longer run beside the cards' numbers.
8. Kept from v9: race round 5 numbers and run, wall from `wall.json`, InstaBox + Blaxel beats, credits, end card `film/end.json` `repo`, masked phone, no private names, captions, −16 LUFS.

## Re-render

```sh
# 1. race: point film/race.json at the newest representative generated-spec run (summary + its footage);
#    import-sub.mjs refuses a run that is not in race/results/accounts-modes.json, and the headline
#    numbers always come from scripts/counts.mjs (so they follow the README)
node film/scripts/import-sub.mjs && film/scripts/stage-assets.sh
cd film
ELEVENLABS_API_KEY=... node scripts/make-sub-vo.mjs --music   # only changed lines are re-synthesized
# then, in a Linux sandbox (4 vCPU / 8 GiB; v10 used a Daytona sandbox):
npm ci && npx remotion browser ensure && ./render-v10.sh v11   # typecheck + render + review pack, -16 LUFS
```
The render throws if any voice line overruns its scene or overlaps the next one.

## Voice-over script (as synthesized)

| t | line |
|---|---|
| 0:00.3 | This is an agent doing real work in web dashboards. Click, screenshot, read, repeat. |
| 0:08.3 | Same agent, same jobs, same accounts. But this one gets each website as a CLI, five of six generated by clify itself. |
| 0:17.0 | Both finish all six. Over six runs, the CLI agent is three point three times faster, and seven point three times cheaper. |
| 0:25.6 | On twenty easy, public, read-only tasks, it's one point eight times faster too. |
| 0:30.8 | This is clify. It turns websites into CLIs for agents. |
| 0:35.2 | Give it a URL. An agent explores the site, records the requests behind what it clicks, and writes a command for each. |
| 0:42.1 | Every command is tested live, and a fresh agent can do all of this by itself. |
| 0:47.9 | What blocks agents? Signups. No agent had a login. |
| 0:51.4 | So clify gives the agent its own email and phone number. It reads the terms, signs itself up, opens the verification email, and saves the session. |
| 1:01.3 | Nineteen real accounts so far, made by the agent itself, all logged in. |
| 1:06.7 | When a site shows a CAPTCHA, clify never solves it. It emails its human, or another agent, and carries on from the reply. |
| 1:17.4 | The same tools run as one MCP server on Manufact: a hundred and thirty-five sites behind three core tools and four shortcuts. The whole tool list is two and a half thousand tokens. |
| 1:28.8 | It even lives on its own computer: an always-on email agent on InstaBox. Anyone can email it a job. |
| 1:35.4 | And it scales: a hundred and sixteen more sites, each explored and checked in its own Blaxel sandbox. |
| 1:42.3 | Most websites become tools: a hundred and thirty-three of a hundred and sixty so far. |
| 1:47.9 | Every command on them was checked live. |
| 1:52.5 | clify. The web, rebuilt for agents. |

## Every number on screen or spoken, with its source

| # | time | shot | numbers → source |
|---|---|---|---|
| 1 | 0:00–0:08 | Hook: the browser agent's lane of the race at real speed (healthchecks.io dashboard), its six jobs listed | live counters (time, tokens, cost, turns, RAM) are the recording's own → `race/artifacts/accounts-realtime.mp4` from 48 s; six jobs → `race/tasks/accounts.json` |
| 2 | 0:08–0:25 | Race replay (4× file from 12 s at 2.2×); once the clify agent finishes (0:17.1), the footage freezes on that frame, dims and the results land | pill “5 of 6 CLIs generated by clify add” / VO “five of six” → `counts.mjs` `race.generatedSpecs` (README “5 of 6 specs generated”); “all 6 runs · every racer 6/6 verified”, VO “both finish all six”, “over six runs” → `counts.mjs` `race.generated.runs` / `allVerified`; **3.3× faster by mean time, 288 s vs 87 s · paired per-run mean 3.5×**; **7.3× cheaper by mean cost, $2.06 vs $0.28 · paired 7.4×** (VO “three point three”, “seven point three”) → `counts.mjs` `race.generated` = README “Headline numbers” row 1 and `race/README.md` round 5; cards “the run on screen (2026-10-18T09-57-57-642Z)”: 6/6, 374.9 s vs 93.3 s, $2.08 vs $0.28, 90 vs 17 tool calls, 3,985 MB vs 399 MB → `race/results/generated-2026-10-18T09-57-57-642Z.summary.json`. The dashboard inside the footage shows that run's own live counters |
| 3 | 0:25–0:31 | Second proof: heading, three ratio cards, median time per task for the three modes | 20 tasks, 11 sites, 40 runs per mode, every mode 40/40 → `bench/results/summary-main+hard+ui+ui2.json`; 1.8× faster / 4.8× fewer tokens / 3.2× cheaper than clicks-only (median time, median tokens, total cost; VO “one point eight”) → `bench/README.md`, checked against the summary by `import-sub.mjs`; bars: median time per task 16.1 s (clicks + snapshots) / 12.7 s (browser + page JavaScript) / 9.0 s (clify), median tokens 79.4k / 50.4k / 16.5k → the same summary (`medianSec`, `medianTokens`); “hand-written specs”, “10 of the 20 tasks on 4 scraping-practice sites” → `bench/README.md` / `counts.mjs` snippet “bench practice” |
| 4 | 0:31–0:35 | clify wordmark | — |
| 5 | 0:35–0:48 | `clify add https://www.ycombinator.com/companies`: real log time-compressed, verify ✓ list, the installed CLI run live; cold-start card | 29 steps, 86 requests, 21 held writes, 10 commands verified, 2 dropped (shown only after the log's two drop lines), 5:04 → `clify/proofs/sites/ycombinator.add-report.json` + log `film/evidence/sweep/ycombinator-add.log`; run output, exit 0 and ms → `film/evidence/sweep/ycombinator-run.json`; cold start “cloned the public export, ran `clify add flathub.org` itself (8/8 verified) and answered in 177 s” → `clify/proofs/cold-start.md` (the agent cloned a local bare-repo copy of the exported public tree; to be re-run against GitHub once the repo is published) |
| 6 | 0:48–1:07 | “No agent had a login.” → identity card, appwrite signup log, verification email, SMS code → 19 account chips | signup seconds → `film/evidence/accounts/appwrite.log`; SMS code + sender → `clify/test/accounts/results.md`; “19 real accounts the agent made itself, all 19 logged in” (VO “Nineteen … all logged in”) → its “Signed in (19)” table, logged-in column yes on every row; “18 verified by email (Hookdeck asked for none)” → verification column (email-link / email-code on 18 rows, hookdeck “none required by site”); 46 stopped, 33 by CAPTCHA/bot check, site list → same file; identity → `clify/ACCOUNTS.md` (phone masked `+1 209 ••• 1736`); “real signup, Oct 18” → the file's date |
| 7 | 1:07–1:17 | tally.so signup page, CAPTCHA stop → clify's email (Primitive) → DMARC-verified “skip” → moves on | subject, options, UTC times → `film/evidence/ask/ask-35cb4902.json`; “real run, Oct 18” → the same record; transcript `clify/test/ask/1-signup-skip.md` |
| 8 | 1:17–1:29 | MCP on Manufact: Claude Code's run large (its transcript: task, 4 tool calls, answer); Codex CLI, mcp-use agent, mcp-use Inspector as chips with their clips; tool-list card | 135 sites, 1,619 commands → `counts.mjs` `hosted` (README “135 sites and 1,619 live-verified commands”); 4 clients → `mcp/demo/transcript-*.md`; Claude Code panel: tool calls, arguments, results (trimmed, marked …), answer serde 1.0.229 / Overnight 58°F Mostly Clear / Sunday 68°F Sunny, 4 tool calls, 9.4 s, model claude-opus-5-5 → `mcp/demo/transcript-claude-code.md`; chips “serde 1.0.229 · SF 58°F, Mostly Clear” and models → `transcript-codex.md`, `transcript-mcp-use.md`, `transcript-inspector.md` (`import-sub.mjs` checks each holds 1.0.229, 58 and Mostly Clear); “3 core tools (+4 shortcuts)”, “2.5k tokens for the whole tool list” (VO “two and a half thousand”), card 2,538 tokens, 7 tools, 568,912 with one tool per command, footnote 3 core 1,360 → `counts.mjs` `tokens` = `mcp/demo/tool-tokens.json`, `mcp/README.md`; clips → `mcp/demo/out/*.mp4` |
| 9 | 1:29–1:35 | InstaBox: the agent's own recording (book-club job thread + InstaBox journal), address card | `clify@fine-vale.primitive.email`, “read-only public sites, 5 jobs a day” → `agent/README.md`; stop/start → `agent/proofs/instabox.md`; footage `agent/proofs/video/clify-agent.mp4` from 16.5 s |
| 10 | 1:35–1:42 | Blaxel: 116 sandbox tiles light up six at a time (the sweep's concurrency); green = ≥3 commands verified by `clify check` inside the sandbox, amber = bot wall or miss | 116 sites, 92 verified, 1,120 commands, per-site `checked/of` and sandbox names → `clify/proofs/sites-blaxel.md` (table checked against `counts.mjs` `sweep.blaxel`) |
| 11 | 1:42–1:52 | Wall: close-up of 12 sites (only those on screen) → pull back to all 133, counter | “Most websites become tools: 133 of 160 so far” (VO “a hundred and thirty-three of a hundred and sixty”), 133 tiles with per-site verified counts → `clify/proofs/wall.json` (= `counts.mjs` `wall.sites`, `sweep.all`); “133 of 160 sites with 3+ verified commands · 1,634 verified commands” → `counts.mjs` `sweep.all` (README “What's proven”); “first sweep 44 sites · second sweep 116 sites in Blaxel sandboxes” → `clify/proofs/sites.md`, `sites-blaxel.md` |
| 12 | 1:52–1:59 | “The web, rebuilt for agents.”, three commands, repo, credits | repo → `film/end.json` |

## Review (v10)

- Two renders in Daytona sandboxes (`render-v10.sh`: typecheck + render + loudnorm + review pack + full-resolution frames of the changed beats). Contact sheets (a frame every 3 s) and the full frames read by eye after each.
- Render 1: all seven fixes in place. Still wrong: the accounts sub-line ran off the right edge, one bench card label wrapped, the MCP chips' answer wrapped mid-phrase, long JSON in the Claude Code panel broke mid-value, and the panel ended with a shell `$` prompt. Fixed: the sub-line is two lines inside the frame, card labels shortened, chip answers on two fixed lines, a space after each JSON comma so lines break between fields, no idle prompt.
- Render 2 (final): race results over a frozen, dimmed frame; bench fills the frame (heading, three cards, three bars); cold-start card “A fresh agent cloned the public export, ran clify add flathub.org itself (8/8 verified) and answered in 177 s.”; “19 real accounts the agent made itself, all 19 logged in · 18 verified by email (Hookdeck asked for none)”; “real signup, Oct 18”, “real run, Oct 18”; MCP: Claude Code's transcript readable at 1080p with the other three clients as chips; wall close-up shows 12 whole tiles, host names wrap at dots; “Most websites become tools: 133 of 160 so far.”
- Numbers checked against `node scripts/counts.mjs --print` (counts OK) and the files in the table above: race 3.3× / 288 s vs 87 s / paired 3.5×, 7.3× / $2.06 vs $0.28 / paired 7.4×, 6 runs, 6/6, 5 of 6; run on screen 374.9 s vs 93.3 s, $2.08 vs $0.28, 90 vs 17 tool calls, 3,985 MB vs 399 MB; bench 20 tasks / 11 sites / 40/40 every mode, 1.8× · 4.8× · 3.2×, 16.1 / 12.7 / 9.0 s, 79.4k / 50.4k / 16.5k tokens, 10 of 20 on 4 practice sites; `clify add` 29 / 86 / 21, 10 verified, 2 dropped, 5:04; cold start 8/8, 177 s; 19 accounts, 19 logged in, 18 email-verified, 46 stopped, 33 CAPTCHA/bot; MCP 135 sites, 1,619 commands, 4 clients, 4 tool calls, 9.4 s, serde 1.0.229, 58°F / 68°F, 3 core + 4 shortcuts, 2.5k (2,538) tokens, 1,360 core, 568,912 per-command; Blaxel 116 sites, 92 verified, 1,120 commands; wall 133 of 160, 1,634 verified commands, 44 + 116 sweeps.
- On screen: no machine names, no personal addresses; phone `+1 209 ••• 1736`; addresses shown are the agent's own and test requesters on the agent's domain.

## Earlier cuts

v1–v9 (Oct 17–18): v7 was race-led with the round 3 hand-written-spec race; v8 moved to the round 5 generated-spec race, wall.json-only wall, InstaBox + Blaxel beats; v9 fixed judge round 3 (`clify add` counter, blank wall tiles, MCP tool count, overclaims, shorter bench, new cold-start proof); judge round 4 then found the issues fixed in v10.
