#!/usr/bin/env bash
# DS Platform data-prod — the data-secret rotation unit's verdict (#3670): runs as
# `postgres` via `docker compose exec`, as `repo-check.sh [<offsite repo>...]`, the
# offsite repos being those the rotation changes. It re-derives the container's
# offsite include from its env (so the verdict never races the entrypoint), then
# checks repo1 plus only the named repos: a scratch include holds just their policy,
# so a repo1 key rotation never fails on an offsite provider's outage. pgBackRest
# 2.60.0 takes --repo for check and stanza-create only in its remote role
# (build/config.yaml, option `repo`); env names of a repo without its repoN-type are
# dropped (src/config/parse.c). stanza-create creates the stanza on a named repo that
# has none and is a no-op on a valid one. Non-zero → the unit restores data.env.
set -euo pipefail
dir=${BASH_SOURCE[0]%/*}
conf=${DS_PGBACKREST_CONF:-/etc/pgbackrest/pgbackrest.conf}
"$dir/pgbackrest-offsite.sh" "$conf" "${DS_PGBACKREST_OFFSITE_INCLUDE:-/etc/pgbackrest/conf.d/offsite.conf}"
scope=$(mktemp -d)
trap 'rm -rf -- "$scope"' EXIT
if (($#)); then
  "$dir/pgbackrest-offsite.sh" "$conf" "$scope/offsite.conf" "$*"
  for n in "$@"; do
    grep -q "^repo${n}-type=" "$scope/offsite.conf" 2>/dev/null ||
      { echo "repo-check: repo${n} is not on (its data.env names are incomplete)" >&2; exit 1; }
  done
fi
pgbackrest --stanza=ds --config-include-path="$scope" stanza-create
pgbackrest --stanza=ds --config-include-path="$scope" check
