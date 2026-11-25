#!/usr/bin/env bash
# DS Platform data-prod — pgbackrest backup wrapper (invoked by cron). DSO-100 §6.3.
#
# cron scrubs the environment, so the PGBACKREST_* S3 creds + cipher pass (from
# data.env, captured by entrypoint.sh at container start) are re-sourced here, then
# the backup runs as the `postgres` OS user (uid 999) so it can read the shared
# PGDATA volume and connect over the shared unix socket.
#
# Usage: backup.sh <full|incr> [offsite]
# `offsite` (#3670) backs up to each offsite repo the include enables
# (pgbackrest-offsite.sh) instead of repo1; one failing repo does not skip the next.
set -euo pipefail

TYPE="${1:?usage: backup.sh <full|incr> [offsite]}"
TARGET="${2:-repo1}"

# Re-load the env cron dropped (written by entrypoint.sh).
DS_PGBACKREST_ENV_FILE="${DS_PGBACKREST_ENV_FILE:-/etc/pgbackrest/pgbackrest.env}"
if [[ -f "$DS_PGBACKREST_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$DS_PGBACKREST_ENV_FILE"
  set +a
fi

if [[ $TARGET == offsite ]]; then
  include="${DS_PGBACKREST_OFFSITE_INCLUDE:-/etc/pgbackrest/conf.d/offsite.conf}"
  repos=()
  if [[ -f $include ]]; then
    mapfile -t repos < <(sed -n 's/^repo\([0-9]\)-type=.*/\1/p' "$include")
  fi
  if ((${#repos[@]} == 0)); then
    echo "[$(date -u +%FT%TZ)] no offsite repo is on; nothing to back up"
    exit 0
  fi
  rc=0
  for n in "${repos[@]}"; do
    echo "[$(date -u +%FT%TZ)] pgbackrest ${TYPE} backup to repo${n} starting"
    "${BASH_SOURCE[0]%/*}/gosu" postgres pgbackrest --stanza=ds --repo="$n" --type="${TYPE}" backup || rc=1
  done
  exit "$rc"
fi
[[ $TARGET == repo1 ]] || { echo "usage: backup.sh <full|incr> [offsite]" >&2; exit 2; }

echo "[$(date -u +%FT%TZ)] pgbackrest ${TYPE} backup starting"
exec "${BASH_SOURCE[0]%/*}/gosu" postgres pgbackrest --stanza=ds --type="${TYPE}" backup
