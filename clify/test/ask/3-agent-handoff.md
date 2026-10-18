# Proof 3: agent-to-agent handoff (cc + forward = delegation)

Run 2026-10-18T07:24:35Z on a Linux build machine. clify (clify@fine-vale.primitive.email, Primitive) asks Touko (<human>) and cc's its peer agent (clify-agent-b3d326@inkboxmail.com, Inkbox). Touko is asleep, so after 60 s clify forwards the thread to the peer. The peer agent runs a fixed policy (test/ask/inkbox-agent.ts peer): approve writes to httpbin.org, skip CAPTCHA sites, otherwise leave it to the human.

### clify asks Touko (cc: peer agent), delegates to the peer after 60 s, then sends the write

```console
$ clify-accounts approve httpbinform place-order --custname clify\ ask\ test\ \(delegated\) --size medium --comments approved\ by\ clify\'s\ peer\ agent --to <human> --cc clify-agent-b3d326@inkboxmail.com --delegate clify-agent-b3d326@inkboxmail.com --delegate-after 60s --wait 12m --test --note Test\ of\ clify\'s\ ask-a-human\ loop.\ No\ reply\ needed:\ if\ you\ don\'t\ answer\ within\ 60\ seconds\,\ clify\ forwards\ this\ thread\ to\ its\ peer\ agent\ \(cc\'d\)\,\ and\ that\ agent\ decides.
07:24:41   ✉️  ask sent from clify@fine-vale.primitive.email to <human> cc clify-agent-b3d326@inkboxmail.com: "[clify test, no reply needed] [clify] httpbinform: approve "place-order"? (it changes data)"
07:24:41   ⏳ waiting up to 12 min for <human> (ask ask-2751edb2)
07:25:41   ↪ no answer from <human> yet: delegating to clify-agent-b3d326@inkboxmail.com
07:25:43   ✉️  forward sent from clify@fine-vale.primitive.email to clify-agent-b3d326@inkboxmail.com: "Fwd: [clify test, no reply needed] [clify] httpbinform: approve "place-order"? (it changes data)"
07:25:49   💬 clify-agent-b3d326@inkboxmail.com answered: approve
07:25:51   ✉️  notice sent from clify@fine-vale.primitive.email to <human>: "Re: [clify test, no reply needed] [clify] httpbinform: approve "place-order"? (it changes data)"
{
  "ok": true,
  "approved": true,
  "sent": true,
  "decision": "approve",
  "answer": "approve\n\nPolicy: httpbin.org is an echo service used for tests, so this write is harmless. Approved on the human's behalf.",
  "answeredBy": "clify-agent-b3d326@inkboxmail.com",
  "ask": "ask-2751edb2",
  "thread_id": "47e67b57-853e-4b2a-b49b-d6fbde9f4325",
  "ignored": [],
  "preview": {
    "method": "POST",
    "url": "https://httpbin.org/post",
    "body": {
      "custname": "clify ask test (delegated)",
      "size": "medium",
      "comments": "approved by clify's peer agent"
    }
  },
  "status": 200,
  "data": {
    "comments": "approved by clify's peer agent",
    "custname": "clify ask test (delegated)",
    "size": "medium"
  }
}
(exit 0)
```

### The peer agent's mailbox (Inkbox)

```console
07:24:35 [inkbox clify-agent-b3d326@inkboxmail.com] peer agent online, watching for ask next…
07:24:44 [inkbox clify-agent-b3d326@inkboxmail.com] cc'd on "[clify test, no reply needed] [clify] httpbinform: approve "place-order"? (it changes data)" (to <human>, cc clify-agent-b3d326@inkboxmail.com): context noted; it's the human's call until clify forwards it to me
07:25:47 [inkbox clify-agent-b3d326@inkboxmail.com] delegated: "Fwd: [clify test, no reply needed] [clify] httpbinform: approve "place-order"? (it changes data)" (1372 chars of thread)
07:25:48 [inkbox clify-agent-b3d326@inkboxmail.com] replied in thread to clify@fine-vale.primitive.email: "approve\n\nPolicy: httpbin.org is an echo service used for tests, so this write is harmless. Approved on the human's behalf." (message ac78b144-19be-4e22-b2ad-6ca3f27c2c5f)
```

### The thread clify kept (every message it sent, who may answer, the answer)

```console
$ thread_summary ask-2751edb2
{
  "id": "ask-2751edb2",
  "to": "<human>",
  "cc": [
    "clify-agent-b3d326@inkboxmail.com"
  ],
  "acceptFrom": [
    "<human>",
    "clify-agent-b3d326@inkboxmail.com"
  ],
  "status": "answered",
  "delegated": {
    "to": "clify-agent-b3d326@inkboxmail.com",
    "at": "2026-10-18T07:25:43.440Z"
  },
  "answer": {
    "decision": "approve",
    "answer": "approve\n\nPolicy: httpbin.org is an echo service used for tests, so this write is harmless. Approved on the human's behalf.",
    "from": "clify-agent-b3d326@inkboxmail.com",
    "verified": true,
    "receivedAt": "2026-10-18T07:25:49.512Z",
    "emailId": "aef823cd-c882-4028-8539-3e004677d57a",
    "threadId": "47e67b57-853e-4b2a-b49b-d6fbde9f4325"
  },
  "ignored": [],
  "sent": [
    {
      "kind": "ask",
      "to": "<human>",
      "cc": [
        "clify-agent-b3d326@inkboxmail.com"
      ],
      "subject": "[clify test, no reply needed] [clify] httpbinform: approve \"place-order\"? (it changes data)",
      "threadId": "38b864fb-58f9-4984-9a62-99fb819070fe",
      "at": "2026-10-18T07:24:41.572Z"
    },
    {
      "kind": "forward",
      "to": "clify-agent-b3d326@inkboxmail.com",
      "cc": null,
      "subject": "Fwd: [clify test, no reply needed] [clify] httpbinform: approve \"place-order\"? (it changes data)",
      "threadId": "47e67b57-853e-4b2a-b49b-d6fbde9f4325",
      "at": "2026-10-18T07:25:43.440Z"
    },
    {
      "kind": "notice",
      "to": "<human>",
      "cc": null,
      "subject": "Re: [clify test, no reply needed] [clify] httpbinform: approve \"place-order\"? (it changes data)",
      "threadId": "38b864fb-58f9-4984-9a62-99fb819070fe",
      "at": "2026-10-18T07:25:51.895Z"
    }
  ]
}
(exit 0)
```
