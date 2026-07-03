#!/usr/bin/env bash
# DS Platform data-prod — pgbackrest sidecar entrypoint (DSO-100 spec §6.3).
#
# 1. Persist the PGBACKREST_* env (cron scrubs env — backup.sh re-sources this).
# 2. Wait for Postgres, then create the stanza (idempotent) — the one-time repo init.
# 3. Run cron in the foreground (PID 1) so the container stays up and the schedule
#    (crontab: daily full 02:30 MSK + incr /6h) fires.
set -euo pipefail

# 1. Freeze the pgbackrest-relevant env for cron jobs (see backup.sh).
mkdir -p /etc/pgbackrest
# Only PGBACKREST_* + TZ — never dump the whole env into a file.
{ env | grep -E '^(PGBACKREST_|TZ)=' || true; } > /etc/pgbackrest/pgbackrest.env
chmod 0600 /etc/pgbackrest/pgbackrest.env

# 2. Wait for Postgres to accept connections over the shared socket, then ensure the
#    stanza exists. `stanza-create` is idempotent (a second run is a no-op); `check`
#    confirms archive_command + the repo are wired. Runs as `postgres` (uid 999).
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

# 3. Hand PID 1 to cron (foreground). Env for the daemon itself is irrelevant; jobs
#    re-source /etc/pgbackrest/pgbackrest.env via backup.sh.
echo "starting cron (schedule: daily full 02:30 MSK, incr /6h)"
exec cron -f
