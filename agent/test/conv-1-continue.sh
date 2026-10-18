#!/usr/bin/env bash
# Continues conv-1 from "waiting for the agent's question" for an existing thread
# (used once when the first run's requester missed the reply: see README).
set -euo pipefail
REQ=${REQ:-~/clify-agent-repo/req}
ME=maya@fine-vale.primitive.email
thread=$1
say() { printf '\n=== %s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
say "waiting for the agent"
$REQ wait --as $ME --thread "$thread" --timeout 900
say "Maya answers"
$REQ reply --as $ME --thread "$thread" --text $'Let\'s do Mystery. The 5 cheapest, please, and include their star ratings.\n\nMaya'
say "waiting for the agent"
$REQ wait --as $ME --thread "$thread" --timeout 900
say "Maya follows up in the same thread"
$REQ reply --as $ME --thread "$thread" --text $'Perfect, thank you!\n\nOne more thing: could you put an uptime check on our club\'s site (it\'s https://example.com for now)? Hourly is plenty. Send me the status page link.\n\nMaya'
say "waiting for the agent"
$REQ wait --as $ME --thread "$thread" --timeout 900
say "done: thread $thread"
