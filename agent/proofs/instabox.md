# Proof: the agent runs on its own InstaBox, and survives a restart

All commands were run live on 18 Oct 2026 from the box that holds the InstaBox CLI login (a Linux build machine). Raw output, unedited except `+ ` trace lines.

- The sandbox `clify-agent` was created at 07:34 UTC from the `agent-browser` template (`instabox create --name clify-agent --template agent-browser --auto-suspend 0`; 4 vCPU, 8 GB, Debian 13, Chromium 154).
- Two systemd services run on it: `clify-agent@main` (Primitive, `clify@fine-vale.primitive.email`) and `clify-agent@peer` (Inkbox, `clify-agent-b3d326@inkboxmail.com`), each with its own clify vault under `/data/home` (`.clify-agent`, `.clify-peer`, key files made on the sandbox).
- The LLM bridge: `sandbox-end.mjs` listens on `127.0.0.1:18318` inside the sandbox; `clify-agent-bridge.service` on the box carries requests over `instabox ssh` stdio to the Claude pool. The bridge's model log counted **92 of 92 answers from `claude-opus-5-5`** up to the restart (no fallback).
- **Restart:** `instabox stop` then `instabox start` (a full VM stop: "A stop ends every process"). Afterwards `uptime` shows `up 0 min`, both services were started by systemd at boot, reloaded their 6 + 2 jobs from disk, and the bridge reconnected by itself 5 s after the sandbox came back. The next job ([proof 3](3-blocked.md)) was sent after the restart and handled by the restarted agent.
- Earlier the same morning the main service was also restarted in the middle of a job (08:01 UTC, during a deploy): on start it logged `resumed after a restart` and finished the job from its saved state (see `src/agent.ts`, `run()`).

## Before the restart (08:20:59 UTC)

```text
Sun Oct 18 08:20:59 UTC 2026
NAME         STATE    TEMPLATE       CREATED
clify-agent  Running  agent-browser  07:34
Name:        clify-agent
State:       Running
User:        ubuntu
Template:    agent-browser
Storage:     20 GB for home and the workspace (/data)
Timeout:     none
Auto-pause:  after 30m idle
Metadata:    app=clify-agent
Created:     Oct 18 2026 07:34
Full details: instabox get clify-agent --json
instabox-clify-agent
 08:20:59 up 47 min,  3 users,  load average: 0.02, 0.09, 0.06
active
active
   3897       16:16 45052 node /data/workspace/clify-agent/agent/bridge/sandbox-end.mjs
   6182       01:35 72364 /usr/local/bin/node --no-warnings --import /data/workspace/clify-agent/clify/node_modules/tsx/dist/esm/index.mjs src/main.ts serve
   6188       01:35 84024 /usr/local/bin/node --no-warnings --import /data/workspace/clify-agent/clify/node_modules/tsx/dist/esm/index.mjs src/main.ts serve
LISTEN 0      511        127.0.0.1:18318      0.0.0.0:*   
6
active
{"at":"2026-10-18T08:20:16.122Z","requested":"claude-opus-5-5","model":"claude-opus-5-5","status":200,"ms":3811,"stream":false}
{"at":"2026-10-18T08:20:25.988Z","requested":"claude-opus-5-5","model":"claude-opus-5-5","status":200,"ms":9859,"stream":false}
{"at":"2026-10-18T08:20:34.289Z","requested":"claude-opus-5-5","model":"claude-opus-5-5","status":200,"ms":8008,"stream":false}
     92 claude-opus-5-5
```

## Stop and start (08:21:05–08:21:10 UTC)

```text
Sun Oct 18 08:21:05 UTC 2026
Stopping clify-agent: queued
  succeeded
NAME         STATE    TEMPLATE       CREATED
clify-agent  Stopped  agent-browser  07:34
NAME         STATE    TEMPLATE       CREATED
clify-agent  Stopped  agent-browser  07:34
Sun Oct 18 08:21:07 UTC 2026
Starting clify-agent: queued
  running (booting)
  succeeded
NAME         STATE    TEMPLATE       CREATED
clify-agent  Running  agent-browser  07:34
NAME         STATE    TEMPLATE       CREATED
clify-agent  Running  agent-browser  07:34
Sun Oct 18 08:21:10 UTC 2026
```

## After the restart (08:21:16 UTC)

```text
Sun Oct 18 08:21:16 UTC 2026
instabox-clify-agent
 08:21:16 up 0 min,  2 users,  load average: 0.00, 0.00, 0.00
active
active
   1083       00:06 94232 /usr/local/bin/node --no-warnings --import /data/workspace/clify-agent/clify/node_modules/tsx/dist/esm/index.mjs src/main.ts serve
   1084       00:06 93636 /usr/local/bin/node --no-warnings --import /data/workspace/clify-agent/clify/node_modules/tsx/dist/esm/index.mjs src/main.ts serve
   1248       00:05 55380 node /data/workspace/clify-agent/agent/bridge/sandbox-end.mjs
LISTEN 0      511        127.0.0.1:18318      0.0.0.0:*   
Started clify-agent@main.service - clify email agent (main) on this InstaBox.
Started clify-agent@peer.service - clify email agent (peer) on this InstaBox.
08:21:10 main agent clify@fine-vale.primitive.email on InstaBox clify-agent: 6 job(s) on disk, model claude-opus-5-5
08:21:10 peer agent clify-agent-b3d326@inkboxmail.com on InstaBox clify-agent: 2 job(s) on disk, model claude-opus-5-5
2026-10-18T08:20:25.988Z 200 claude-opus-5-5 -> claude-opus-5-5 9859ms
2026-10-18T08:20:34.289Z 200 claude-opus-5-5 -> claude-opus-5-5 8008ms
Connection to api.instabox.sh closed by remote host.
2026-10-18T08:21:05.574Z bridge session ended (exit 255)
2026-10-18T08:21:07.795Z sandbox clify-agent is starting; waking it
clify-agent: running
2026-10-18T08:21:10.279Z connected to clify-agent (pid 1009719)
bridge: listening on 127.0.0.1:18318
```

## After 35 minutes idle (08:57–08:59 UTC)

The sandbox paused itself anyway at 08:57 (about 35 minutes after the last job). The bridge session dropped, the bridge reconnected at once, and that connection resumed the sandbox; a suspend keeps memory, so the services just continued (`up 37 min`, both `active`). A new job sent at 08:58:38 was answered at 08:58:59:

```text
Sun Oct 18 08:58:16 UTC 2026
{"state":"running"}
Connection to api.instabox.sh closed by remote host.
2026-10-18T08:57:07.294Z bridge session ended (exit 255)
2026-10-18T08:57:09.525Z sandbox clify-agent is suspending; waking it
instabox: error operation_conflict: machine has an active suspend operation (operation op_agqu4ou3qw2eeonxn44i7p3nmm) [request req_a7c3jgsswfg7a5t5rdzovg4o6i]
2026-10-18T08:57:09.751Z wake failed: Command failed: /home/ubuntu/.local/bin/instabox resume clify-agent
2026-10-18T08:57:09.753Z connected to clify-agent (pid 1172204)
bridge: listening on 127.0.0.1:18318
 08:58:17 up 37 min,  2 users,  load average: 0.53, 0.23, 0.09
active
active

job "Quick one after the pause: 3 inspirational quotes": sent 08:58:38.152Z, answered 08:58:59.936Z (clify quotes by-tag --tag inspirational --limit 3)
```

Mail that arrives while it is paused waits at Primitive; the agent's long-poll resumes from its saved cursor, so nothing is lost. After this run the bridge waits for a pause/start in progress to finish before resuming (the `operation_conflict` above).

## Known InstaBox quirk

`--auto-suspend 0` at create, and `instabox auto-suspend clify-agent 0` (also `0s`, `24h`, `45m`) are accepted by the CLI, but `instabox get` keeps reporting `Auto-pause: after 30m idle` (`autoSuspendAfterSeconds: 1800`), also with `npx instabox@latest`. To stay always on anyway, the box-end bridge checks the sandbox state every 2 minutes and resumes/starts it if it isn't running (its log line `sandbox clify-agent is starting; waking it` above is that check).
