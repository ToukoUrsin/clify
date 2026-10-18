#!/usr/bin/env bash
# Run on the agent's computer (an InstaBox sandbox) from the repo copy at
# /data/workspace/clify-agent. Installs deps, site specs, the two agent services and the status page.
# Vaults come separately (vault-export.mts | vault-import.mts), never through here.
set -euo pipefail
root=/data/workspace/clify-agent
cd "$root/clify" && npm ci --no-audit --no-fund >/dev/null
ln -sfn ../clify/node_modules "$root/agent/node_modules"
install_spec() { mkdir -p "$1/sites/$2" && cp "$3" "$1/sites/$2/spec.json"; }
for home in /data/home/.clify-agent /data/home/.clify-peer; do
  for f in "$root"/clify/test/real/{books,quotes,hnsearch,wikipedia,scrapethis}.spec.json; do
    install_spec "$home" "$(jq -r .name "$f")" "$f"
  done
done
for f in "$root"/agent/sites/*.spec.json; do install_spec /data/home/.clify-agent "$(jq -r .name "$f")" "$f"; done
install_spec /data/home/.clify-peer books "$root/agent/sites/books.spec.json"
mkdir -p /data/home/.config/clify-agent
for r in main peer; do
  [ -f /data/home/.config/clify-agent/$r.env ] || cp "$root/agent/deploy/$r.env.example" /data/home/.config/clify-agent/$r.env
done
# The public status page and the Inkbox tunnel that gives it the identity's address.
(cd "$root/agent/status" && npm ci --no-audit --no-fund >/dev/null)
mkdir -p -m 700 /data/home/.clify-tunnel
sudo cp "$root"/agent/deploy/{clify-agent@,clify-agent-status,clify-agent-tunnel}.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable clify-agent@main clify-agent@peer clify-agent-status clify-agent-tunnel
sudo systemctl restart clify-agent@main clify-agent@peer clify-agent-status clify-agent-tunnel
systemctl --no-pager status clify-agent@main clify-agent@peer clify-agent-status clify-agent-tunnel | grep -E "●|Active"
