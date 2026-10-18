# Proofs (live, 2026-10-18)

- [sites.md](sites.md): fully automatic `clify add` on 44 public sites never hand-specced: 41 (93%) with ≥3 live-verified commands, 514 verified in total. Generated specs and per-site summaries in [sites/](sites/); one full log in [crates-add.log](crates-add.log).
- [sites-blaxel.md](sites-blaxel.md): 116 more unseen sites, each explored by a Chrome in its own Blaxel sandbox (CDP) and re-verified inside that sandbox: 92 with ≥3 commands verified on Blaxel, 1,120 verified. Combined with sites.md: 133 of 160 sites, 1,634 verified commands. Specs and run records in [sites-blaxel/](sites-blaxel/).
- [wall.json](wall.json): one entry per verified site (133) for the film's wall: site, origin, category, commands, verified, `verifiedOn` (`blaxel` or `box`), an example command.
- [handoff.md](handoff.md): fresh `claude -p` agents, Bash limited to `clify`, solve 6/6 real tasks with the built-in CLIs.
- [cold-start.md](cold-start.md): a fresh agent in an empty directory clones the repo, installs clify, generates a CLI for an unseen site (MetaCPAN) and answers the question, with no human input.
- `npm test` (offline suites) and `test/real/run.sh` (29 live checks incl. the CAPTCHA stop) pass on this commit.
