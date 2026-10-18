# clify demo (about 2 minutes)

Run from the `clify/` directory on a machine with Chrome or Playwright's Chromium (`npx playwright install chromium`). Headless; nothing opens on screen.

1. **Record a real site.** A headless browser clicks through Books to Scrape and the recorder captures the request behind each click.
   `bin/clify record https://books.toscrape.com/ --name books --script test/real/books.script.json`
2. **The agent reads the help once.** `bin/clify books` prints commands, params, allowed values and examples as JSON.
3. **Agent calls instead of a browser.**
   `bin/clify books list-category --category mystery_3 --limit 3 --fields title,price`
   `bin/clify hnsearch search --query playwright --limit 3 --fields title,points`
4. **Writes are safe by default.** A dry-run shows the exact request and sends nothing; `--yes` sends it.
   `bin/clify httpbinform place-order --custname demo --size large`
   `bin/clify httpbinform place-order --custname demo --size large --yes`
5. **Recording never sends writes.** `grep POST ~/clify-home/sites/httpbinform/recording.jsonl` shows the form submit as `"held":true`.
6. **CAPTCHAs stop the flow.** `bin/clify record https://www.google.com/recaptcha/api2/demo --name cap --script /tmp/cap.json` reports `captcha at …` and exits 1 without touching the check.
7. **Same thing over MCP.** `bin/clify mcp` serves one tool per command (`books__get-book`, `httpbinform__place-order` with `confirm`, …).
8. **Authorized login path.** With an existing account's credentials supplied in the process environment, `bin/clify login <site>` uses `fill_login`, submits the login form, verifies common signed-in evidence, and stores a mode-0600 site-scoped session. CAPTCHA or bot checks stop the flow.
9. **Proof another agent can use it.** `test/real/agent-handoff.md`: a Codex agent solved 7 real tasks using only the CLI help.

One-line proof of everything: `test/real/run.sh` (29 live checks).
