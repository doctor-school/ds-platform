#!/usr/bin/env bash
# DS Platform data-prod — the offsite WAL pusher (#4298), run by cron every minute.
#
# The archive_command (pgbackrest-archive.sh) spools each segment repo1 holds into
# /var/log/pgbackrest/offsite-spool/repoN for each offsite repo that is on. This pushes each
# spool to its repo, oldest first, with pgBackRest's synchronous archive-push under
# that repo's own config (pgbackrest-repo.sh), and deletes a segment only once its
# push succeeded. A failed push stops that repo's pass until the next minute; the
# other repo goes on. A repo that is down only grows its own spool, which the
# archive_command caps.
set -euo pipefail
dir=${BASH_SOURCE[0]%/*}
# cron scrubs the environment: re-load the PGBACKREST_* names entrypoint.sh froze
# (root-only file), then drop to `postgres`, which owns the spool.
DS_PGBACKREST_ENV_FILE="${DS_PGBACKREST_ENV_FILE:-/etc/pgbackrest/pgbackrest.env}"
if ((EUID == 0)); then
  if [[ -f $DS_PGBACKREST_ENV_FILE ]]; then
    set -a
    # shellcheck disable=SC1090
    . "$DS_PGBACKREST_ENV_FILE"
    set +a
  fi
  exec "$dir/gosu" postgres "${BASH_SOURCE[0]}" "$@"
fi
export LC_ALL=C
spool=${DS_OFFSITE_SPOOL:-/var/log/pgbackrest/offsite-spool}
# One pass at a time: a push to an unanswering repo can outlast the minute.
exec 9>"${TMPDIR:-/tmp}/wal-offsite-push.lock"
flock -n 9 || exit 0
shopt -s nullglob
for repo in "$spool"/repo[0-9]; do
  [[ -d $repo ]] || continue
  n=${repo##*/repo}
  pushed=0
  for seg in "$repo"/*; do
    [[ -f $seg ]] || continue
    if "$dir/pgbackrest-repo.sh" "$n" --log-level-console=warn --log-level-file=off archive-push "$seg"; then
      rm -f -- "$seg"
      pushed=$((pushed + 1))
    else
      left=("$repo"/*)
      echo "[$(date -u +%FT%TZ)] repo${n}: archive-push of ${seg##*/} failed; ${#left[@]} segment(s) wait in the spool"
      break
    fi
  done
  if ((pushed > 0)); then echo "[$(date -u +%FT%TZ)] repo${n}: pushed ${pushed} segment(s)"; fi
done
