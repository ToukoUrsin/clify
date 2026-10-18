#!/usr/bin/env bash
# Proof 2: a write needs approval → clify emails the exact request to its
# human → a stranger replies "approve" in the thread first (ignored) → the
# human replies "approve" → clify sends the write. Target: httpbin.org (echo).
source "$(dirname "$0")/lib.sh"
mkdir -p "$CLIFY_HOME/sites/httpbinform" && cp test/real/httpbinform.spec.json "$CLIFY_HOME/sites/httpbinform/spec.json"
hlog=$(mktemp); ilog=$(mktemp)
echo "# Proof 2: write approval → \"approve\" → write sent"
echo
echo "Run $(date -u +%FT%TZ) on $(hostname). Target: httpbin.org/post (an echo service). The human is played by the Inkbox mailbox $HUMAN (replies \"approve\" after 20 s). A stranger, intruder@fine-vale.primitive.email, replies \"approve\" in the same thread first; clify must ignore it."
run "Without approval the write is only a dry run (nothing sent)" clify httpbinform place-order --custname "clify ask test" --size small --comments "sent after email approval"
nodets test/ask/inkbox-agent.ts reply --ask next --text "approve" --delay 20 --wait 600 > "$hlog" 2>&1 &
nodets test/ask/intruder.ts --text "approve" --wait 600 > "$ilog" 2>&1 &
sleep 4
run "clify asks its human, waits, and sends only on a verified approve" clify approve httpbinform place-order --custname "clify ask test" --size small --comments "sent after email approval" --to "$HUMAN" --wait 10m --test
wait
side "The stranger's attempt" "$ilog"
side "The human's mailbox" "$hlog"
