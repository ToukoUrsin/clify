#!/usr/bin/env bash
# Proof 3: agent-to-agent handoff. clify asks its human to approve a write and cc's
# its peer agent (Inkbox identity) on the thread. The human is asleep: after 60 s
# clify forwards the thread to the peer agent (delegation). The peer agent
# reads the forwarded thread, applies its policy and replies "approve"; clify
# sends the write and tells the human in their thread how it was resolved.
# Emails to the human: the ask and the resolution note, both marked as tests.
source "$(dirname "$0")/lib.sh"
ASKED=${ASKED:?set ASKED to the email address of the human to ask}
PEER=$HUMAN
mkdir -p "$CLIFY_HOME/sites/httpbinform" && cp test/real/httpbinform.spec.json "$CLIFY_HOME/sites/httpbinform/spec.json"
plog=$(mktemp)
echo "# Proof 3: agent-to-agent handoff (cc + forward = delegation)"
echo
echo "Run $(date -u +%FT%TZ) on $(hostname). clify (clify@fine-vale.primitive.email, Primitive) asks the human ($ASKED) and cc's its peer agent ($PEER, Inkbox). The human is asleep, so after 60 s clify forwards the thread to the peer. The peer agent runs a fixed policy (test/ask/inkbox-agent.ts peer): approve writes to httpbin.org, skip CAPTCHA sites, otherwise leave it to the human."
nodets test/ask/inkbox-agent.ts peer --ask next --wait 900 > "$plog" 2>&1 &
sleep 4
run "clify asks the human (cc: peer agent), delegates to the peer after 60 s, then sends the write" clify approve httpbinform place-order --custname "clify ask test (delegated)" --size medium --comments "approved by clify's peer agent" --to "$ASKED" --cc "$PEER" --delegate "$PEER" --delegate-after 60s --wait 12m --test --note "Test of clify's ask-a-human loop. No reply needed: if you don't answer within 60 seconds, clify forwards this thread to its peer agent (cc'd), and that agent decides."
wait
side "The peer agent's mailbox (Inkbox)" "$plog"
id=$(CLIFY_QUIET=1 clify ask list | python3 -c 'import json,sys; print(json.load(sys.stdin)["asks"][0]["id"])')
run "The thread clify kept (every message it sent, who may answer, the answer)" thread_summary "$id"
