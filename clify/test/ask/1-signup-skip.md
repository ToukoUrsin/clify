# Proof 1: blocked signup → ask → "skip" → clify moves on

Run 2026-10-18T07:26:40Z on a Linux build machine, headless Chrome. clify's address: clify@fine-vale.primitive.email (Primitive). The human is played by the Inkbox mailbox clify-agent-b3d326@inkboxmail.com, which replies "skip" to the ask it receives.

### clify signs up on tally unattended, with --ask-human

```console
$ clify-accounts signup tally --url https://tally.so/signup --ask-human --to clify-agent-b3d326@inkboxmail.com --wait 15m --test
07:26:44 📜 reading tally.so terms…
07:27:05 📜 terms: allowed — The provided Tally terms excerpt contains no explicit prohibition on automated account creation, bot or AI-agent use, or any requirement that accounts be held by a natural person, and robots.txt allows all; however, the excerpt is truncated, so sections such as '4. Use of the tool' and '5. License & Limitations' were not reviewed and could contain such a clause.
07:27:06 🌐 signup https://tally.so/signup as clify-agent-b3d326@inkboxmail.com
07:27:15   ✉️  ask sent from clify@fine-vale.primitive.email to clify-agent-b3d326@inkboxmail.com: "[clify test, no reply needed] [clify] tally: CAPTCHA / bot check while signing up. Skip, use your login, or retry?"
07:27:15   ⏳ waiting up to 15 min for clify-agent-b3d326@inkboxmail.com (ask ask-35cb4902)
07:27:20   💬 clify-agent-b3d326@inkboxmail.com answered: skip
{
  "ok": false,
  "site": "tally",
  "email": "clify-agent-b3d326@inkboxmail.com",
  "terms": {
    "allowed": true,
    "reason": "The provided Tally terms excerpt contains no explicit prohibition on automated account creation, bot or AI-agent use, or any requirement that accounts be held by a natural person, and robots.txt allows all; however, the excerpt is truncated, so sections such as '4. Use of the tool' and '5. License & Limitations' were not reviewed and could contain such a clause.",
    "checked": [
      "https://tally.so/help/terms-conditions",
      "https://tally.so/robots.txt"
    ]
  },
  "signedUp": false,
  "loggedIn": false,
  "verified": false,
  "verificationChannel": "none",
  "steps": 0,
  "blockers": [
    "captcha at https://tally.so/signup"
  ],
  "sessionWorksOverHttp": false,
  "human": {
    "ok": true,
    "id": "ask-35cb4902",
    "status": "answered",
    "via": "email",
    "to": "clify-agent-b3d326@inkboxmail.com",
    "cc": [],
    "thread_id": "3e196065-aa96-4444-bd31-e9940ac13a05",
    "decision": "skip",
    "answer": "skip",
    "answeredBy": "clify-agent-b3d326@inkboxmail.com",
    "verified": true,
    "ignored": [],
    "action": "skipped",
    "next": "skipped tally on clify-agent-b3d326@inkboxmail.com's answer; moving on"
  }
}
(exit 1)
```

### Meanwhile, in the human's mailbox

```console
07:26:40 [inkbox clify-agent-b3d326@inkboxmail.com] waiting for clify's ask next…
07:27:19 [inkbox clify-agent-b3d326@inkboxmail.com] got "[clify test, no reply needed] [clify] tally: CAPTCHA / bot check while signing up. Skip, use your login, or retry?" from clify@fine-vale.primitive.email with 1 attachment(s): tally-2026-10-18T07-27-13-966Z.jpg
07:27:20 [inkbox clify-agent-b3d326@inkboxmail.com] replied in thread to clify@fine-vale.primitive.email: "skip" (message 0f67a8eb-1258-4168-a577-cea6775e1383)
```

### clify moves on: the next task on its list (an account it already has) runs

```console
$ whoami_brief updown
{
  "ok": true,
  "site": "updown",
  "via": "saved-session",
  "account": {
    "email": "clify-agent-b3d326@inkboxmail.com",
    "username": "clifyagentba62c3",
    "createdBy": "agent"
  },
  "probe": "https://updown.io/settings/edit",
  "status": 200
}
(exit 0)
```
