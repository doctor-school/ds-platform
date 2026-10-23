#!/usr/bin/env bash
# Parse-check every shipped Caddyfile with the exact Caddy image its sibling
# compose.yml pins (#3273). A Caddyfile Caddy cannot parse crash-loops the edge
# on the next deploy (prod outage 2026-10-23); `caddy validate` catches that
# before merge. Env placeholders (`{$VAR}`) get syntactically valid stand-ins —
# the check is about parsing and module provisioning, not the real values.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
shopt -s nullglob
files=("$root"/infra/deploy/compose/*/Caddyfile)
if [ "${#files[@]}" -eq 0 ]; then
  echo "no infra/deploy/compose/*/Caddyfile found" >&2
  exit 1
fi

fail=0
for caddyfile in "${files[@]}"; do
  dir="$(dirname "$caddyfile")"
  rel="${caddyfile#"$root"/}"
  image="$(grep -Eo 'image:[[:space:]]*caddy:[^[:space:]]+' "$dir/compose.yml" | head -n1 | sed -E 's/image:[[:space:]]*//')"
  if [ -z "$image" ]; then
    echo "RED — $rel: no 'image: caddy:<tag>' in $dir/compose.yml" >&2
    fail=1
    continue
  fi
  hash="$(docker run --rm "$image" caddy hash-password --plaintext ci-validate)"
  echo "== $rel ($image)"
  if docker run --rm \
    -e STAGE_BASE_DOMAIN=stage.example.test \
    -e STAGE_BASIC_AUTH_USER=ci \
    -e STAGE_BASIC_AUTH_HASH="$hash" \
    -e STAGE_GATE_TOKEN=ci-validate-token \
    -v "$caddyfile:/etc/caddy/Caddyfile:ro" \
    "$image" caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile; then
    echo "ok — $rel"
  else
    echo "RED — $rel does not validate" >&2
    fail=1
  fi
done
exit "$fail"
