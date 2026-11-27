#!/usr/bin/env bash
# DS Platform data-prod — the data-secret rotation unit's verdict (#3670): runs as
# `postgres` via `docker compose exec`, as `repo-check.sh [<offsite repo>...]`, the
# offsite repos being those the rotation changes. It re-derives the container's
# offsite configs and spools from its env (so the verdict never races the
# entrypoint), then checks repo1 under its own config plus only the named repos, each
# under its repo-only config (pgbackrest-repo.sh, #4298), so a repo1 key rotation
# never fails on an offsite provider's outage. An offsite `check` waits for the
# switched segment to reach that repo through the spool and the pusher (cron, every
# minute; the `#offsite:` archive-timeout in pgbackrest.conf allows for it).
# stanza-create creates the stanza on a repo that has none and is a no-op on a valid
# one. Non-zero → the unit restores data.env.
set -euo pipefail
dir=${BASH_SOURCE[0]%/*}
offsite=${DS_PGBACKREST_OFFSITE_DIR:-/etc/pgbackrest/offsite}
"$dir/pgbackrest-offsite.sh" "${DS_PGBACKREST_CONF:-/etc/pgbackrest/pgbackrest.conf}" "$offsite" \
  "${DS_OFFSITE_SPOOL:-/var/log/pgbackrest/offsite-spool}"
for n in "$@"; do
  [[ -f $offsite/repo$n/pgbackrest.conf ]] ||
    { echo "repo-check: repo${n} is not on (its data.env names are incomplete)" >&2; exit 1; }
done
pgbackrest --stanza=ds stanza-create
pgbackrest --stanza=ds check
for n in "$@"; do
  "$dir/pgbackrest-repo.sh" "$n" stanza-create
  "$dir/pgbackrest-repo.sh" "$n" check
done
