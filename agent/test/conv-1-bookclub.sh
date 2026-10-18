#!/usr/bin/env bash
# Proof 1: a multi-turn job by email. Maya (a scripted test requester on the
# agent's own domain) asks for something ambiguous; the agent should ask which
# genre, continue from her answer with clify, reply with a CSV, then take a
# follow-up in the same thread (an updown check on its own account).
set -euo pipefail
# Primitive dedupes identical sends and threads by subject: give each run its own SUBJECT.
REQ=${REQ:-~/clify-agent-repo/req}
ME=maya@fine-vale.primitive.email
AGENT=clify@fine-vale.primitive.email
say() { printf '\n=== %s %s\n' "$(date -u +%H:%M:%S)" "$*"; }

say "Maya sends the job"
t=$($REQ send --as $ME --name "Maya (test requester)" --to $AGENT --subject "${SUBJECT:-Books for our book club: November pick}" \
  --text $'Hi!\n\nOur book club wants to try a new genre next month. Could you find some cheap books from one of the genres on books.toscrape.com and send me a spreadsheet?\n\nThanks,\nMaya')
echo "$t"; thread=$(jq -r .threadId <<<"$t")

say "waiting for the agent"
$REQ wait --as $ME --thread "$thread" --timeout 900

say "Maya answers"
$REQ reply --as $ME --thread "$thread" --text $'Let\'s do Mystery. The 5 cheapest, please, and include their star ratings.\n\nMaya'

say "waiting for the agent"
$REQ wait --as $ME --thread "$thread" --timeout 900

say "Maya follows up in the same thread"
$REQ reply --as $ME --thread "$thread" --text $'Perfect, thank you!\n\nOne more thing: could you put an uptime check on our club\'s site (it\'s https://example.org for now)? Hourly is plenty. Send me the status page link.\n\nMaya'

say "waiting for the agent"
$REQ wait --as $ME --thread "$thread" --timeout 900
say "done: thread $thread"
