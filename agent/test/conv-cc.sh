#!/usr/bin/env bash
# Proof cc-thread: a person cc's the agent into a thread with a business.
# Alice writes to Bob (a test "business" mailbox) and cc's clify@; the agent
# answers both (reply-all). Bob replies-all with a follow-up; the agent answers
# in the same thread. Then a second thread with the peer agent on cc: the peer
# stays quiet, and peer mail in the thread (test/peer-say.mts, run on the
# InstaBox) is context only. All addresses are the agent's own test mailboxes.
set -euo pipefail
REQ=${REQ:-~/clify-agent-repo/req}
D=fine-vale.primitive.email
A=alice@$D B=bob-business@$D AGENT=clify@$D PEER=clify-agent-b3d326@inkboxmail.com
S1=${S1:-"Async runtime for our order service [cc test 1]"}
S2=${S2:-"Weather for the Friday site visit [cc test 2]"}
export REQ_STATE=${REQ_STATE:-/tmp/clify-cc-test}
say() { printf '\n=== %s %s\n' "$(date -u +%H:%M:%S)" "$*"; }

say "1. Alice → Bob, cc the agent"
t=$($REQ send --as $A --name "Alice (test requester)" --to $B --cc $AGENT --subject "$S1" \
  --text $'Hi Bob,\n\nBefore we sign off on the order service, which tokio version does your team build against? We are on 1.38.\n\nclify, I cc\'d you: could you check the latest tokio release on crates.io and its total downloads, so we all have the same numbers?\n\nThanks,\nAlice')
echo "$t"; thread=$(jq -r .threadId <<<"$t")
say "the agent's reply-all, in Bob's mailbox"
$REQ wait --as $B --subject "$S1" --from $AGENT --timeout 600
say "2. Bob replies-all with a follow-up"
$REQ reply --as $B --name "Bob (test business)" --thread "$thread" --to $AGENT --cc $A \
  --text $'Thanks both. We build against tokio 1.47 today.\n\nclify, follow-up: could you list the 5 most recent tokio releases with their dates as a CSV? Alice and I will pick an upgrade target from it.\n\nBob'
$REQ wait --as $A --thread "$thread" --from $AGENT --timeout 600

say "3. a thread with the peer agent on cc"
t=$($REQ send --as $A --name "Alice (test requester)" --to $B --cc $AGENT,$PEER --subject "$S2" \
  --text $'Hi Bob,\n\nAre we still on for the site visit at your San Francisco office on Friday?\n\nclify, could you get the NWS forecast for San Francisco for Friday so we know whether to plan for rain? (I also cc\'d your research colleague so it has the context.)\n\nAlice')
echo "$t"; thread=$(jq -r .threadId <<<"$t")
$REQ wait --as $A --thread "$thread" --from $AGENT --timeout 600
echo "next, on the InstaBox: CLIFY_HOME=/data/home/.clify-peer node --import ../clify/node_modules/tsx/dist/esm/index.mjs test/peer-say.mts \"Re: $S2\" <agent message-id> $A $AGENT,$B \"...\""
