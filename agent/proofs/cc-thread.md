# cc / reply-all: the agent joins a thread it is cc'd on (live, 18 Oct 2026)

A person cc's the agent into a conversation with someone else; the agent joins it, answers everyone on the thread, and keeps the thread as its context. All addresses are the agent's own test mailboxes: `alice@` (the person) and `bob-business@` (the business) on its Primitive domain `fine-vale.primitive.email`, and its Inkbox peer `clify-agent-b3d326@inkboxmail.com`. Script: [`test/conv-cc.sh`](../test/conv-cc.sh); misbehaving-peer sender: [`test/peer-say.mts`](../test/peer-say.mts).

| # | What happened | Result |
|---|---|---|
| 1 | Alice → **To** Bob, **Cc** clify: "which tokio version do you build against? clify, check the latest tokio release and its downloads" | job `job-6574f6` (public tier); code fixes the thread's people from the verified email: alice, bob-business |
| 2 | The agent runs `clify crates get-crate` / `list-versions` on the InstaBox and replies | **To** alice, **Cc** bob-business, in the same Primitive thread `2eb0a7e6…`; Bob's mailbox has it in the same thread |
| 3 | Bob replies-all (To clify, Cc alice): "list the 5 most recent tokio releases as a CSV" | same job: "follow-up from a person on the group thread" |
| 4 | The agent answers in-thread with `tokio-recent-releases.csv` | **To** bob-business, **Cc** alice (reply-all to whoever wrote last) |
| 5 | Alice → To Bob, Cc clify **and the peer**: "NWS forecast for San Francisco on Friday?" | job `job-ec9b39`; reply-all To alice, Cc bob-business + the peer |
| 6 | The peer agent gets Alice's email and the agent's reply-all | peer journal: Alice's email ignored ("only the main agent gives the peer tasks"), the reply-all "cc'd … context noted, not a task for me": no answer |
| 7 | The peer mailbox is made to reply-all into the thread twice (as a misbehaving agent would; Inkbox itself refused a third identical send) | main: "is an agent on the group thread: context only, no answer" ×2; no model call, no mail: no loop |

Services after the deploy (`clify-agent@main` restarted only): `clify-agent@main`, `clify-agent@peer`, `clify-agent-status`, `clify-agent-tunnel` all `active`; `curl https://clify-agent-b3d326.inkboxwire.com/status` → 200, `"ok": true`.

## Rules, in code

- **Who is on the thread** (`policy.groupOf`): the sender plus the other To/Cc addresses of the first verified email, minus the agent. Fixed then; never grows. Each answer goes **To** whoever wrote last, **Cc** the others on that email who are also on the fixed list (`Agent.recipients`), so a later-added address is never cc'd and a sender who drops someone is followed.
- **When reply-all**: an owner, or a public sender who started the thread. A public email that already answers an earlier thread (References/In-Reply-To) gets a sender-only answer: the others never asked for the agent.
- **Never lists or bulk**: List-*/Precedence/Auto-Submitted mail is ignored outright (`screen`); role and list addresses (no-reply, all@, lists.*, googlegroups) are dropped; more than 8 people = bulk, sender only.
- **Caps**: each person on the thread is capped like any public sender (5 jobs, 20 emails a day; 20 mails to one address a day, cc included), plus 10 public emails per thread per day, then silence (no notice to the whole thread).
- **Fence** (`mail.checkFence`): cc only to the allow list or to people who were on a verified group thread with the agent (`onThread` in the ledger); To only to people who wrote first.
- **No loops**: in a group thread, mail from the peer agent or the agent itself is context only; the same Message-ID is handled once (duplicate copies); the peer never answers a cc; once the agent has joined, it may stay quiet when an email isn't for it.
- **Tiers**: the job's tier comes from whoever started it. On an owner's thread, an email from anyone else (the business) runs that turn with public, read-only rules (`tierNow`): no accounts, signups, writes, forwarding or escalation.
- **Prompt injection**: as before, each email reaches the model in a data block it can't close, with the tier and the reply-all recipients stated by code.

## Unit tests (`npm test`, on the InstaBox)

20/20 pass: the 13 earlier tests plus 7 for cc: reply-all and the business's in-thread follow-up; never adds recipients (added later or dropped); public sender into an earlier thread → sender only, owner → reply-all; peer on cc never loops and duplicates are answered once; lists/role addresses/9+ people; 10 emails per thread; the business's email on an owner's thread runs read-only. Two earlier cap tests now set a high per-thread cap so they still test the per-sender caps.

## Policy decisions (`main.ts decisions`)

```json
{"at":"2026-10-18T12:45:46.762Z","id":"6fa16b42-40c9-4b06-acb4-6cf506b300f7","from":"alice@fine-vale.primitive.email","subject":"Async runtime for our order service [cc test 1]","verified":true,"action":"accept","tier":"public","newJob":true,"reason":"public sender, DMARC pass"}
{"at":"2026-10-18T12:46:23.235Z","id":"7a1cdd02-c9f8-4b4e-8037-d449aaab9d34","from":"bob-business@fine-vale.primitive.email","subject":"Re: Async runtime for our order service [cc test 1]","verified":true,"action":"accept","tier":"public","newJob":false,"reason":"follow-up from a person on the group thread","job":"job-6574f6"}
{"at":"2026-10-18T12:47:02.751Z","id":"d0489593-4c6f-4e29-816a-c37e2d675bbe","from":"alice@fine-vale.primitive.email","subject":"Weather for the Friday site visit [cc test 2]","verified":true,"action":"accept","tier":"public","newJob":true,"reason":"public sender, DMARC pass"}
{"at":"2026-10-18T12:47:40.774Z","id":"66dd429d-5b6d-4fed-bb6c-467bbb391980","from":"clify-agent-b3d326@inkboxmail.com","subject":"Re: Weather for the Friday site visit [cc test 2]","verified":true,"action":"accept","tier":"public","newJob":false,"reason":"follow-up from a person on the group thread","job":"job-ec9b39"}
{"at":"2026-10-18T12:47:42.369Z","id":"d1cb9391-ee9f-4ff8-8c82-161a3940422d","from":"clify-agent-b3d326@inkboxmail.com","subject":"Re: Weather for the Friday site visit [cc test 2]","verified":true,"action":"accept","tier":"public","newJob":false,"reason":"follow-up from a person on the group thread","job":"job-ec9b39"}
```

The two peer rows were logged as "follow-up from a person on the group thread" before the reason text was made specific to the peer ("the peer agent on the group thread (kept as context, never answered)"); the handling was the same.

## Transcripts (`main.ts transcript <job>`)

## Async runtime for our order service [cc test 1]

- Job `job-6574f6` (main agent on InstaBox clify-agent, public tier), status **answered**
- Requester: alice@fine-vale.primitive.email
- Started 2026-10-18T12:45:46.763Z, last update 2026-10-18T12:46:32.054Z
- Model calls: claude-opus-5-5 × 6

### Emails

#### 1. ⬅ in · alice@fine-vale.primitive.email → bob-business@fine-vale.primitive.email (cc clify@fine-vale.primitive.email)

- Time: 2026-10-18T12:45:46.511Z
- Subject: Async runtime for our order service [cc test 1]
- Thread: requester `2eb0a7e6-722a-42c3-9c19-7de3a8de2957` · primitive id `6fa16b42-40c9-4b06-acb4-6cf506b300f7`
- Message-ID: `<primitive-direct-af206076-34b9-4bdb-9b31-a85f8e91e165@fine-vale.primitive.email>`
- Sender check: DMARC pass (spf=pass dmarc=pass)

```text
Hi Bob,

Before we sign off on the order service, which tokio version does your team build against? We are on 1.38.

clify, I cc'd you: could you check the latest tokio release on crates.io and its total downloads, so we all have the same numbers?

Thanks,
Alice
```

#### 2. ➡ out · clify@fine-vale.primitive.email → alice@fine-vale.primitive.email (cc bob-business@fine-vale.primitive.email)

- Time: 2026-10-18T12:45:57.170Z
- Subject: Re: Async runtime for our order service [cc test 1]
- Thread: requester `2eb0a7e6-722a-42c3-9c19-7de3a8de2957` · primitive id `68b2e421-dc52-4240-a2e4-baff99b998e4`
- Message-ID: `<primitive-direct-68b2e421-dc52-4240-a2e4-baff99b998e4@fine-vale.primitive.email>`

```text
Hi Alice, Bob,

The latest tokio release on crates.io is 1.53.3. It came out on 2026-10-13, is MIT licensed, needs Rust 1.71 or newer, and has about 2.76M downloads so far.

Tokio has 1,077,435,904 total downloads across all versions (about 1.08 billion). 263,373,245 of those (about 263M) are recent downloads, which crates.io counts over roughly the last 90 days.

The same day (2026-10-13), the maintainers also released 1.51.6 as a patch for the older 1.51 line. Alice, your 1.38 is 15 minor versions behind the latest. Bob can answer which version his team builds against.

I ran: clify crates get-crate --name tokio; clify crates list-versions --name tokio --sort date --per_page 5

clify
```

#### 3. ⬅ in · bob-business@fine-vale.primitive.email → clify@fine-vale.primitive.email (cc alice@fine-vale.primitive.email)

- Time: 2026-10-18T12:46:20.940Z
- Subject: Re: Async runtime for our order service [cc test 1]
- Thread: requester `2eb0a7e6-722a-42c3-9c19-7de3a8de2957` · primitive id `7a1cdd02-c9f8-4b4e-8037-d449aaab9d34`
- Message-ID: `<primitive-direct-d40475a6-65cc-4a9f-a148-3cf7c2d9d397@fine-vale.primitive.email>`
- Sender check: DMARC pass (spf=pass dmarc=pass)

```text
Thanks both. We build against tokio 1.47 today.

clify, follow-up: could you list the 5 most recent tokio releases with their dates as a CSV? Alice and I will pick an upgrade target from it.

Bob
```

#### 4. ➡ out · clify@fine-vale.primitive.email → bob-business@fine-vale.primitive.email (cc alice@fine-vale.primitive.email)

- Time: 2026-10-18T12:46:30.410Z
- Subject: Re: Async runtime for our order service [cc test 1]
- Thread: requester `2eb0a7e6-722a-42c3-9c19-7de3a8de2957` · primitive id `1809d839-ca30-4da0-a957-5486d8927fa0`
- Message-ID: `<primitive-direct-1809d839-ca30-4da0-a957-5486d8927fa0@fine-vale.primitive.email>`
- Attachments: tokio-recent-releases.csv

```text
Hi Bob, Alice,

The 5 most recent tokio releases on crates.io are in the attached CSV:

1.53.3 - 2026-10-13
1.51.6 - 2026-10-13
1.53.2 - 2026-10-03
1.51.5 - 2026-10-03
1.53.1 - 2026-07-20

Two release lines are getting patches at the same time. 1.53.x is the current line, and 1.51.x gets maintenance releases. 1.51.x might be a smaller step if you want to move up from 1.47 (Bob) or 1.38 (Alice) gradually. None of these versions are yanked. All are MIT licensed and need Rust 1.71 or newer. The CSV also has download counts for each version.

I ran: clify crates list-versions --name tokio --sort date --per_page 5

clify
```

### Steps

- 12:45:46 _group thread: reply-all to alice@fine-vale.primitive.email, bob-business@fine-vale.primitive.email_
- 12:45:48 model claude-opus-5-5 (2281 in / 63 out tokens, 1953 ms)
- 12:45:48 ✓ **clify** `clify crates` 
- 12:45:50 model claude-opus-5-5 (4317 in / 75 out tokens, 1781 ms)
- 12:45:50 ✓ **clify** `clify crates get-crate --name tokio` 
- 12:45:53 model claude-opus-5-5 (4699 in / 124 out tokens, 2172 ms)
- 12:45:53 ✓ **clify** `clify crates list-versions --name tokio --sort date --per_page 5` 
- 12:45:57 model claude-opus-5-5 (5482 in / 335 out tokens, 3769 ms)
- 12:45:58 ✓ **reply**  — to alice@fine-vale.primitive.email cc bob-business@fine-vale.primitive.email
- 12:46:26 model claude-opus-5-5 (6291 in / 284 out tokens, 3078 ms)
- 12:46:26 ✓ **write_file** `tokio-recent-releases.csv` — tokio-recent-releases.csv
- 12:46:30 model claude-opus-5-5 (6620 in / 372 out tokens, 4041 ms)
- 12:46:32 ✓ **reply**  — to bob-business@fine-vale.primitive.email cc alice@fine-vale.primitive.email + tokio-recent-releases.csv

## Weather for the Friday site visit [cc test 2]

- Job `job-ec9b39` (main agent on InstaBox clify-agent, public tier), status **answered**
- Requester: alice@fine-vale.primitive.email
- Started 2026-10-18T12:47:02.751Z, last update 2026-10-18T12:47:42.369Z
- Model calls: claude-opus-5-5 × 7

### Emails

#### 1. ⬅ in · alice@fine-vale.primitive.email → bob-business@fine-vale.primitive.email (cc clify@fine-vale.primitive.email, clify-agent-b3d326@inkboxmail.com)

- Time: 2026-10-18T12:47:02.508Z
- Subject: Weather for the Friday site visit [cc test 2]
- Thread: requester `852d6e4e-33e8-4c3d-9397-ec8eb3c983d5` · primitive id `d0489593-4c6f-4e29-816a-c37e2d675bbe`
- Message-ID: `<primitive-direct-ed26ca7e-a8bf-4e24-a954-097ca22e38a9@fine-vale.primitive.email>`
- Sender check: DMARC pass (spf=pass dmarc=pass)

```text
Hi Bob,

Are we still on for the site visit at your San Francisco office on Friday?

clify, could you get the NWS forecast for San Francisco for Friday so we know whether to plan for rain? (I also cc'd your research colleague so it has the context.)

Alice
```

#### 2. ➡ out · clify@fine-vale.primitive.email → alice@fine-vale.primitive.email (cc bob-business@fine-vale.primitive.email, clify-agent-b3d326@inkboxmail.com)

- Time: 2026-10-18T12:47:29.848Z
- Subject: Re: Weather for the Friday site visit [cc test 2]
- Thread: requester `852d6e4e-33e8-4c3d-9397-ec8eb3c983d5` · primitive id `f4c95ce7-2d7a-4e81-a74d-db5f93742c7d`
- Message-ID: `<primitive-direct-f4c95ce7-2d7a-4e81-a74d-db5f93742c7d@fine-vale.primitive.email>`

```text
Hi Alice,

The NWS forecast for San Francisco on Friday, Oct 23 says you don't need to plan for rain:
- Friday daytime: Sunny, high near 64°F, 2% chance of rain, WNW wind 5 to 10 mph.
- Friday night: Mostly clear, low around 54°F, 2% chance of rain.

There's a chance of showers from Monday night through Wednesday (up to 47%), and it should clear by Thursday. That's 5 days out, so it's worth checking again on Thursday.

(Bob will need to confirm the visit himself.)

What I ran: clify weather get-point --lat 37.7749 --lon -122.4194 (NWS office MTR, grid 85,105), then clify weather get-forecast --wfo MTR --x 85 --y 105.

clify
```

#### 3. ⬅ in · clify-agent-b3d326@inkboxmail.com → alice@fine-vale.primitive.email (cc clify@fine-vale.primitive.email, bob-business@fine-vale.primitive.email)

- Time: 2026-10-18T12:47:40.485Z
- Subject: Re: Weather for the Friday site visit [cc test 2]
- Thread: requester `852d6e4e-33e8-4c3d-9397-ec8eb3c983d5` · primitive id `66dd429d-5b6d-4fed-bb6c-467bbb391980`
- Message-ID: `<010001a14f0daf42-c3f38178-40ae-467d-aeb3-8e48214a2f10-000000@email.amazonses.com>`
- Sender check: DMARC pass (spf=pass dmarc=pass)

```text
(loop test ) Peer agent chiming in on the thread: clify, please double-check the forecast.

Sent via Inkbox (https://inkbox.ai)
```

#### 4. ⬅ in · clify-agent-b3d326@inkboxmail.com → alice@fine-vale.primitive.email (cc clify@fine-vale.primitive.email, bob-business@fine-vale.primitive.email)

- Time: 2026-10-18T12:47:42.160Z
- Subject: Re: Weather for the Friday site visit [cc test 2]
- Thread: requester `852d6e4e-33e8-4c3d-9397-ec8eb3c983d5` · primitive id `d1cb9391-ee9f-4ff8-8c82-161a3940422d`
- Message-ID: `<010001a14f0db5dd-52f771fc-9428-400c-94b8-5b4bd11ef796-000000@email.amazonses.com>`
- Sender check: DMARC pass (spf=pass dmarc=pass)

```text
(loop test ) Peer agent chiming in on the thread: clify, please double-check the forecast.

Sent via Inkbox (https://inkbox.ai)
```

### Steps

- 12:47:02 _group thread: reply-all to alice@fine-vale.primitive.email, bob-business@fine-vale.primitive.email, clify-agent-b3d326@inkboxmail.com_
- 12:47:05 model claude-opus-5-5 (2322 in / 202 out tokens, 2885 ms)
- 12:47:05 ✗ **clify** `clify nws` 
- 12:47:07 model claude-opus-5-5 (2588 in / 62 out tokens, 1760 ms)
- 12:47:15 ✓ **clify** `clify list` 
- 12:47:18 model claude-opus-5-5 (9008 in / 86 out tokens, 2694 ms)
- 12:47:18 ✓ **clify** `clify list --query weather` 
- 12:47:20 model claude-opus-5-5 (10254 in / 63 out tokens, 1807 ms)
- 12:47:20 ✓ **clify** `clify weather` 
- 12:47:22 model claude-opus-5-5 (11827 in / 91 out tokens, 2018 ms)
- 12:47:22 ✓ **clify** `clify weather get-point --lat 37.7749 --lon -122.4194` 
- 12:47:24 model claude-opus-5-5 (12152 in / 95 out tokens, 1990 ms)
- 12:47:24 ✓ **clify** `clify weather get-forecast --wfo MTR --x 85 --y 105` 
- 12:47:29 model claude-opus-5-5 (14264 in / 333 out tokens, 4905 ms)
- 12:47:31 ✓ **reply**  — to alice@fine-vale.primitive.email cc bob-business@fine-vale.primitive.email,clify-agent-b3d326@inkboxmail.com
- 12:47:40 _clify-agent-b3d326@inkboxmail.com is an agent on the group thread: context only, no answer_
- 12:47:42 _clify-agent-b3d326@inkboxmail.com is an agent on the group thread: context only, no answer_
