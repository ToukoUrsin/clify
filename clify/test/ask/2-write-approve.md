# Proof 2: write approval → "approve" → write sent

Run 2026-10-18T07:20:29Z on a Linux build machine. Target: httpbin.org/post (an echo service). The human is played by the Inkbox mailbox clify-agent-b3d326@inkboxmail.com (replies "approve" after 20 s). A stranger, intruder@fine-vale.primitive.email, replies "approve" in the same thread first; clify must ignore it.

### Without approval the write is only a dry run (nothing sent)

```console
$ clify httpbinform place-order --custname clify\ ask\ test --size small --comments sent\ after\ email\ approval
{
  "ok": false,
  "status": 0,
  "url": "https://httpbin.org/post",
  "data": null,
  "needsConfirmation": true,
  "preview": {
    "method": "POST",
    "url": "https://httpbin.org/post",
    "body": {
      "custname": "clify ask test",
      "size": "small",
      "comments": "sent after email approval"
    }
  },
  "error": "\"place-order\" changes data on httpbin.org. Nothing was sent. Check the preview, then re-run with --yes to send it."
}
(exit 1)
```

### clify asks its human, waits, and sends only on a verified approve

```console
$ clify-accounts approve httpbinform place-order --custname clify\ ask\ test --size small --comments sent\ after\ email\ approval --to clify-agent-b3d326@inkboxmail.com --wait 10m --test
07:20:36   ✉️  ask sent from clify@fine-vale.primitive.email to clify-agent-b3d326@inkboxmail.com: "[clify test, no reply needed] [clify] httpbinform: approve "place-order"? (it changes data)"
07:20:36   ⏳ waiting up to 10 min for clify-agent-b3d326@inkboxmail.com (ask ask-546823f7)
07:21:00   💬 clify-agent-b3d326@inkboxmail.com answered: approve
{
  "ok": true,
  "approved": true,
  "sent": true,
  "decision": "approve",
  "answer": "approve",
  "answeredBy": "clify-agent-b3d326@inkboxmail.com",
  "ask": "ask-546823f7",
  "thread_id": "472af6ec-c32e-42d6-a5e3-37968b11e2f4",
  "ignored": [
    {
      "from": "intruder@fine-vale.primitive.email",
      "subject": "Re: [clify test, no reply needed] [clify] httpbinform: approve \"place-order\"? (it changes data)",
      "reason": "not an address this ask accepts answers from",
      "at": "2026-10-18T07:20:37.102Z"
    }
  ],
  "preview": {
    "method": "POST",
    "url": "https://httpbin.org/post",
    "body": {
      "custname": "clify ask test",
      "size": "small",
      "comments": "sent after email approval"
    }
  },
  "status": 200,
  "data": {
    "comments": "sent after email approval",
    "custname": "clify ask test",
    "size": "small"
  }
}
(exit 0)
```

### The stranger's attempt

```console
07:20:29 [intruder@fine-vale.primitive.email] waiting for clify's next ask…
07:20:37 [intruder@fine-vale.primitive.email] replied "approve" in the thread of ask-546823f7 (HTTP 200)
```

### The human's mailbox

```console
07:20:30 [inkbox clify-agent-b3d326@inkboxmail.com] waiting for clify's ask next…
07:20:39 [inkbox clify-agent-b3d326@inkboxmail.com] got "[clify test, no reply needed] [clify] httpbinform: approve "place-order"? (it changes data)" from clify@fine-vale.primitive.email
07:20:39 [inkbox clify-agent-b3d326@inkboxmail.com] reading it (replying in 20s)…
07:20:59 [inkbox clify-agent-b3d326@inkboxmail.com] replied in thread to clify@fine-vale.primitive.email: "approve" (message 84381ddd-fc95-47b0-95f2-3660ea810ecd)
```
