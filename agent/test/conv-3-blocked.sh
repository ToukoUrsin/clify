#!/usr/bin/env bash
# Proof 3: blocked. Sam asks the agent to sign up somewhere with its own
# identity. clify's signup reads the terms, then stops at the CAPTCHA (it never
# solves one); the agent emails its human (cc the peer agent) and tells Sam
# what it could find without an account.
set -euo pipefail
REQ=${REQ:-~/clify-agent-repo/req}
ME=sam@fine-vale.primitive.email
AGENT=clify@fine-vale.primitive.email
say() { printf '\n=== %s %s\n' "$(date -u +%H:%M:%S)" "$*"; }

say "Sam sends the job"
t=$($REQ send --as $ME --name "Sam (test requester)" --to $AGENT --subject "${SUBJECT:-Tally free plan?}" \
  --text $'Hey,\n\nCould you sign up for tally.so with your own identity and tell me what the free plan actually includes? I\'m deciding between form builders.\n\nSam')
echo "$t"; thread=$(jq -r .threadId <<<"$t")

say "waiting for the agent"
$REQ wait --as $ME --thread "$thread" --timeout 1500
say "done: thread $thread"
