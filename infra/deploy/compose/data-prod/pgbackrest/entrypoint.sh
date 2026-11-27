#!/usr/bin/env bash
# DS Platform data-prod — pgbackrest sidecar entrypoint (DSO-100 spec §6.3).
#
# 1. Persist the PGBACKREST_* env (cron scrubs env — backup.sh re-sources this).
# 1b. Derive each offsite repo's config and WAL spool from this container's env
#     (#3670, #4298, pgbackrest-offsite.sh).
# 2. Wait for Postgres, then create the stanza (idempotent) — the one-time repo init.
# 3. Run cron in the foreground (PID 1) so the container stays up and the schedule
#    (crontab: daily full 02:30 MSK + incr /6h, the offsite pusher every minute) fires.
set -euo pipefail

# 1. Freeze the pgbackrest-relevant env for cron jobs (see backup.sh).
DS_PGBACKREST_ENV_FILE="${DS_PGBACKREST_ENV_FILE:-/etc/pgbackrest/pgbackrest.env}"
mkdir -p "$(dirname "$DS_PGBACKREST_ENV_FILE")"
# Only PGBACKREST_* + TZ — never dump the whole env into a file.
{ env | grep -E '^(PGBACKREST_[A-Za-z0-9_]+|TZ)=' || true; } > "$DS_PGBACKREST_ENV_FILE"
chmod 0600 "$DS_PGBACKREST_ENV_FILE"

# 1b. As `postgres`, which owns the configs and the spool volume.
gosu postgres "${BASH_SOURCE[0]%/*}/pgbackrest-offsite.sh"

# 2. Wait for Postgres to accept connections over the shared socket, then ensure the
#    stanza exists on repo1 and on each offsite repo that is on: `stanza-create` is a
#    no-op on a repo that holds a valid stanza, so a newly enabled offsite repo gets
#    its stanza on the first start that has it. `check` confirms archive_command +
#    repo1 are wired. An offsite repo is checked by repo-check.sh instead: its check
#    waits for the pusher, which cron runs only after this. Runs as `postgres` (uid 999).
echo "waiting for postgres socket…"
for _ in $(seq 1 60); do
  if gosu postgres pg_isready -h /var/run/postgresql -U ds -d ds_prod >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

gosu postgres pgbackrest --stanza=ds stanza-create || \
  echo "stanza-create returned non-zero (already exists / will retry on first backup)"
gosu postgres pgbackrest --stanza=ds check || \
  echo "pgbackrest check failed — verify S3 creds + archive_command on the box (build-verify gate)"
for n in 2 3; do
  if [[ -f ${DS_PGBACKREST_OFFSITE_DIR:-/etc/pgbackrest/offsite}/repo$n/pgbackrest.conf ]]; then
    gosu postgres "${BASH_SOURCE[0]%/*}/pgbackrest-repo.sh" "$n" stanza-create ||
      echo "repo${n} stanza-create returned non-zero (unreachable? its WAL stays spooled)"
  fi
done

# 3. Hand PID 1 to cron (foreground). Env for the daemon itself is irrelevant; jobs
#    re-source /etc/pgbackrest/pgbackrest.env via backup.sh.
echo "starting cron (schedule: daily full 02:30 MSK, incr /6h, offsite WAL pusher /1m)"
exec cron -f
