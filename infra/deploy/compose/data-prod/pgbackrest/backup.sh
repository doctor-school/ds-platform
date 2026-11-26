#!/usr/bin/env bash
# DS Platform data-prod — pgbackrest backup wrapper (invoked by cron). DSO-100 §6.3.
#
# cron scrubs the environment, so the PGBACKREST_* S3 creds + cipher pass (from
# data.env, captured by entrypoint.sh at container start) are re-sourced here, then
# the backup runs as the `postgres` OS user (uid 999) so it can read the shared
# PGDATA volume and connect over the shared unix socket.
#
# Usage: backup.sh <full|incr> [offsite [<repo>...]]
# `offsite` (#3670) backs up to each offsite repo pgbackrest-offsite.sh turned on, or
# only the named ones, instead of repo1, each under its own repo-only config
# (pgbackrest-repo.sh, #4298) with archive-check: the backup's WAL reaches that repo
# through the offsite spool and pusher. One failing repo does not skip the next. A
# successful backup clears the repo's spool gap marker (pgbackrest-archive.sh) if no
# segment was dropped after it started: PITR on that repo works again from it.
# repo1's own backup and each offsite one take only their own repo's backup lock, so
# they never collide.
set -euo pipefail

TYPE="${1:?usage: backup.sh <full|incr> [offsite [<repo>...]]}"
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
  offsite="${DS_PGBACKREST_OFFSITE_DIR:-/etc/pgbackrest/offsite}"
  spool="${DS_OFFSITE_SPOOL:-/var/log/pgbackrest/offsite-spool}"
  repos=()
  for n in 2 3; do
    if [[ -f $offsite/repo$n/pgbackrest.conf ]]; then repos+=("$n"); fi
  done
  # Named repos (the rotation unit's first full of a repo it turned on): those only.
  if (($# > 2)); then
    for n in "${@:3}"; do
      [[ " ${repos[*]} " == *" $n "* ]] || { echo "backup.sh: repo${n} is not on" >&2; exit 1; }
    done
    repos=("${@:3}")
  fi
  if ((${#repos[@]} == 0)); then
    echo "[$(date -u +%FT%TZ)] no offsite repo is on; nothing to back up"
    exit 0
  fi
  rc=0
  for n in "${repos[@]}"; do
    echo "[$(date -u +%FT%TZ)] pgbackrest ${TYPE} backup to repo${n} starting"
    started=$(mktemp)
    if "${BASH_SOURCE[0]%/*}/gosu" postgres "${BASH_SOURCE[0]%/*}/pgbackrest-repo.sh" "$n" --type="${TYPE}" backup; then
      find "$spool" -maxdepth 1 -name "repo$n.gap" ! -newer "$started" -delete 2>/dev/null || true
    else
      rc=1
    fi
    rm -f -- "$started"
  done
  exit "$rc"
fi
[[ $TARGET == repo1 ]] || { echo "usage: backup.sh <full|incr> [offsite [<repo>...]]" >&2; exit 2; }

echo "[$(date -u +%FT%TZ)] pgbackrest ${TYPE} backup starting"
# --repo=1: the lock is per stanza and repo (src/command/lock.c cmdLockFileName), and a
# backup without --repo takes every repo's, so it would collide with an offsite backup.
exec "${BASH_SOURCE[0]%/*}/gosu" postgres pgbackrest --stanza=ds --repo=1 --type="${TYPE}" backup
