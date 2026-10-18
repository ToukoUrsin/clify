# clify accounts: one agent identity, its own logins

clify gives the agent a persistent identity and lets it get signed in to websites by itself:

1. **Reuse** a saved session. If the access token is about to expire, clify replays the web app's own refresh request first.
2. **Log in** with credentials from the vault: yours, or ones the agent created. TOTP, emailed codes or links, and SMS codes are handled.
3. **Sign up** with the agent identity when no account exists. clify reads the site's terms first, then verifies the email address and saves the credentials and session.

After that, calls go straight to the site's API with the saved cookies and tokens. No browser is needed.

## Identity

| What | Where |
|---|---|
| Name | `clify agent` |
| Email | Inkbox mailbox `clify-agent-b3d326@inkboxmail.com` |
| Per-site email | `<site>@fine-vale.primitive.email` (Primitive catch-all, used when a site rejects the main address) |
| Phone (SMS) | Inkbox number `+1 209 ••• 1736` |

Provider API keys, site passwords, 2FA secrets and session tokens all live in the encrypted vault (`$CLIFY_HOME/vault.enc`, AES-256-GCM). The key comes from `CLIFY_VAULT_KEY`, the OS keychain, or `vault.key` (0600). Commands only report which secrets exist, never their values.

## Commands

```bash
clify identity init                  # import INKBOX_API_KEY / PRIMITIVE_API_KEY into the vault, find inbox + phone
clify identity                       # show the identity (no secrets)
clify signup <site> --url URL        # terms check → signup → email/SMS verification → session saved
clify login <site> --user --url URL  # your own account: CLIFY_USERNAME/CLIFY_PASSWORD, --username-cmd/--password-cmd CMD, or hidden prompt; CLIFY_TOTP / --totp for 2FA
clify login <site>                   # log in again with the vault's credentials
clify whoami <site>                  # ensure a working session, print the account's own profile JSON
clify <site> me                      # the same profile, as a normal generated CLI command
clify session <site> [check|refresh]
clify verify <site>                  # open a confirmation link that arrived late
clify logout <site>                  # drop the session, keep credentials
clify vault list | show <site> | rm <site>
clify inbox [--sms] [--wait N] [--since 2h] [--full]   # mail/SMS to the agent, with extracted codes/links
```

From code, call `ensureAccount({ name, url, mode })` (src/accounts.ts). It returns `{ ok, loggedIn, storageState, blockers }`.

## Rules (enforced in code)

- **Terms first.** Before a signup, clify fetches the site's terms and robots.txt, and Claude reads them looking for an explicit ban on automated or bot accounts, on non-human account holders, or on automated access in general. If it finds one, clify stops and reports `terms: …`. If it can't find any terms, it also stops (`terms-not-found`).
- **CAPTCHA = stop.** clify checks every page for reCAPTCHA, hCaptcha, Turnstile, Arkose and "verify you are human" pages. If one appears, the flow ends with `captcha at <url>`. clify never interacts with these checks, solves them or works around them, and that includes invisible ones.
- **No evasion.** Stock headless Chrome only: no stealth plugins, UA spoofing, proxies or token injection.
- **No real-identity social networks.** LinkedIn, X, Facebook, Instagram and similar sites are refused before anything else happens.
- **The model never sees secrets.** It types `{{password}}` and `{{totp}}`, which are substituted locally. Page text sent to the model is scrubbed of the password.
- **Honest identity.** Signups use the name "clify agent". Optional fields stay empty, marketing opt-ins stay unticked, and clify never enters payment details.

## Sessions

`saveSession` stores:

- cookies for the site's own domain
- auth headers the app sent (`authorization`, CSRF headers)
- tokens the SPA keeps in `localStorage` or `sessionStorage` (JWTs, Supabase/Auth0-style JSON blobs)
- the app's token-refresh request, with the refresh token templated out
- a probe: a same-site GET whose reply shows the account's email or username

`checkSession` replays the probe over plain HTTP. `refreshSession` replays the refresh request and swaps in the new access token.

## Tests

- `test/accounts/local-auth.sh`: a local site with password + TOTP login, an SPA holding an 8-second JWT in localStorage, and a refresh endpoint. It checks the TOTP login, that no password is stored in plain text, probe detection, expiry detection, refresh without a browser, `ensureAccount` refreshing instead of logging in again, and re-login with TOTP from the vault.
- `test/accounts/batch.sh sites.txt N`: real signups, N in parallel. Results go to `~/acct-runs/batch/<site>.json`.
- `test/accounts/screen.ts`: pre-screens candidate sites (terms check, plus whether the signup page has a CAPTCHA). It submits nothing.

## Ask a human

When clify hits something only a person can do (a CAPTCHA, a payment wall, a phone check it can't pass, an ambiguous choice, a write that needs approval), it doesn't try to get around it. It emails its human from its own address (`clify@fine-vale.primitive.email`, Primitive) or texts from its own number (Inkbox), waits, and continues from the reply in the same thread.

```bash
clify ask "<question>" [--to you@example.com] [--attach shot.png] [--wait 30m] [--via email|sms]
          [--options skip,approve,...] [--cc other-agent@...] [--delegate agent@... --delegate-after 10m]
clify ask resume <id> [--wait 30m]          # keep waiting on an earlier ask (state in $CLIFY_HOME/asks)
clify ask list | show <id>
clify ask --set-human you@example.com       # who clify asks by default
clify forward <id|thread_id> --to agent@... [--wait 30m]   # delegation: that agent's reply answers the ask
clify approve <site> <command> [--param v ...] [--to ...]  # a write: email the exact request, send only on "approve"
clify signup <site> --url URL --ask-human [--to ...]       # CAPTCHA/blocker → ask: skip, use my account, or retry once
clify login <site> --ask-human ...
```

- **The thread is the context.** The first message carries the site, page, what clify was doing, what stopped it, the exact options and a screenshot. The reply comes back as JSON: `{decision, answer, answeredBy, verified, thread_id, ...}`.
- **Only the asked address counts**, and only when the reply passed DMARC (aligned SPF or DKIM). Replies from anyone else are listed under `ignored` and never parsed. A delegate (forward) is added to the accepted list; a cc'd agent is not, unless `--accept-cc`.
- **Replies become a fixed decision** (an option key such as `skip`, `approve`, `deny`, `use-my-account`, `retry`; a number picks an option; a code becomes `code`) or free text for the calling agent. A reply never becomes a command.
- **cc loops in another agent** on the same thread; **forward hands it over**: the forward carries the whole thread and the attachments. With `--delegate`, an unanswered ask is forwarded after `--delegate-after`, and the human gets a short note in their thread saying how it was resolved.
- **SMS** (`--via sms`): Inkbox sends, and only texts from the exact number asked count (SMS has no sender authentication). Built but not live-tested yet (no test texts were sent to a real person's phone).
- clify still never solves a CAPTCHA. The human may clear it themselves elsewhere, tell clify to skip, or sign in with their own login.

Proofs (live, 2026-10-18): `test/ask/1-signup-skip.md` (tally.so signup CAPTCHA → ask with screenshot → "skip" → moves on), `test/ask/2-write-approve.md` (httpbin write → a stranger's "approve" ignored → the human's verified "approve" → sent, HTTP 200), `test/ask/3-agent-handoff.md` (asks the human, cc's the Inkbox agent, forwards after 60 s, the peer agent approves by policy, write sent, the human gets the resolution in their thread). Re-run with `test/ask/run-*.sh`; `test/ask/inkbox-agent.ts` plays the human or the peer agent.
