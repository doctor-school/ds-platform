#!/usr/bin/env bash
# DS Platform data-prod — pgbackrest backup wrapper (invoked by cron). DSO-100 §6.3.
#
# cron scrubs the environment, so the PGBACKREST_* S3 creds + cipher pass (from
# data.env, captured by entrypoint.sh at container start) are re-sourced here, then
# the backup runs as the `postgres` OS user (uid 999) so it can read the shared
# PGDATA volume and connect over the shared unix socket.
#
# Usage: backup.sh <full|incr>
set -euo pipefail

TYPE="${1:?usage: backup.sh <full|incr>}"

# Re-load the env cron dropped (written by entrypoint.sh).
if [[ -f /etc/pgbackrest/pgbackrest.env ]]; then
  set -a
  # shellcheck disable=SC1091
  . /etc/pgbackrest/pgbackrest.env
  set +a
fi

echo "[$(date -u +%FT%TZ)] pgbackrest ${TYPE} backup starting"
exec gosu postgres pgbackrest --stanza=ds --type="${TYPE}" backup
