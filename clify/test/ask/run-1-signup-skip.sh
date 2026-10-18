#!/usr/bin/env bash
# Proof 1: a signup hits a CAPTCHA → clify emails its human from its own
# address with a screenshot and the options → the human replies "skip" →
# clify moves on to the next task. The Inkbox mailbox plays the human.
source "$(dirname "$0")/lib.sh"
SITE=${SITE:-gitea}
URL=${URL:-https://gitea.com/user/sign_up}
log=$(mktemp)
echo "# Proof 1: blocked signup → ask → \"skip\" → clify moves on"
echo
echo "Run $(date -u +%FT%TZ) on $(hostname), headless Chrome. clify's address: clify@fine-vale.primitive.email (Primitive). The human is played by the Inkbox mailbox $HUMAN, which replies \"skip\" to the ask it receives."
nodets test/ask/inkbox-agent.ts reply --ask next --text "skip" --wait 900 > "$log" 2>&1 &
sleep 4
run "clify signs up on $SITE unattended, with --ask-human" clify signup "$SITE" --url "$URL" --ask-human --to "$HUMAN" --wait 15m --test
wait
side "Meanwhile, in the human's mailbox" "$log"
run "clify moves on: the next task on its list (an account it already has) runs" whoami_brief updown
