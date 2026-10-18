#!/usr/bin/env bash
# Proof 2: delegation. Leo asks for a two-part research job and says the
# agent may hand part of it to its colleague. The main agent forwards the
# thread to the peer agent (Inkbox), the peer works with clify and replies in
# the forwarded thread, and the main agent merges it into one answer to Leo.
set -euo pipefail
REQ=${REQ:-~/clify-agent-repo/req}
ME=leo@fine-vale.primitive.email
AGENT=clify@fine-vale.primitive.email
say() { printf '\n=== %s %s\n' "$(date -u +%H:%M:%S)" "$*"; }

say "Leo sends the job"
t=$($REQ send --as $ME --name "Leo (test requester)" --to $AGENT --subject "${SUBJECT:-Two research bits for my AI agents post}" \
  --text $'Hi,\n\nI\'m writing a blog post about AI agents. Could you get me two things:\n\n1. The 5 most-upvoted Hacker News stories from 2026 with "AI agents" in them, as a CSV (title, points, date, link).\n2. A two-sentence summary of the Wikipedia article on "Intelligent agent".\n\nIf your research colleague is free, hand them the Hacker News part so it goes faster.\n\nThanks!\nLeo')
echo "$t"; thread=$(jq -r .threadId <<<"$t")

say "waiting for the agent"
$REQ wait --as $ME --thread "$thread" --timeout 1500
say "done: thread $thread"
