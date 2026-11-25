#!/usr/bin/env bash
# DS Platform data-prod — the data-secret rotation unit's verdict (#3670): runs as
# `postgres` via `docker compose exec`. It re-derives the offsite include from this
# container's env (so the verdict never races the entrypoint), creates the stanza on
# any repo that has none yet (stanza-create is per repo and a no-op on a valid one),
# then checks every configured repo. Non-zero → the unit restores the previous data.env.
set -euo pipefail
"${BASH_SOURCE[0]%/*}/pgbackrest-offsite.sh"
pgbackrest --stanza=ds stanza-create
exec pgbackrest --stanza=ds check
