#!/usr/bin/env bash
# DS Platform data-prod — pgBackRest against ONE offsite repo (#4298):
#   pgbackrest-repo.sh <2|3> <pgbackrest options and command...>
# runs `pgbackrest --stanza=ds` under the config pgbackrest-offsite.sh derived for repo
# N alone (--config-path: its pgbackrest.conf and an empty conf.d), with every other
# repo's PGBACKREST_* env name removed, so the command can reach repo N only. The
# offsite pusher, the offsite backups, stanza-create/check of an offsite repo and a
# restore from it run through here.
set -euo pipefail
n=${1:?usage: pgbackrest-repo.sh <2|3> <pgbackrest options and command...>}
shift
[[ $n == 2 || $n == 3 ]] || { echo "pgbackrest-repo: repo${n} is not an offsite repo" >&2; exit 2; }
dir=${DS_PGBACKREST_OFFSITE_DIR:-/etc/pgbackrest/offsite}/repo$n
[[ -f $dir/pgbackrest.conf ]] || { echo "pgbackrest-repo: repo${n} is not on" >&2; exit 1; }
drop=()
for name in $(compgen -e); do
  if [[ $name == PGBACKREST_* && $name != PGBACKREST_REPO${n}_* ]]; then drop+=(-u "$name"); fi
done
exec env "${drop[@]}" pgbackrest --config-path="$dir" --stanza=ds "$@"
