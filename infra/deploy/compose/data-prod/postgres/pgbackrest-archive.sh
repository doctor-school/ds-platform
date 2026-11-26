#!/bin/sh
# DS Platform data-prod — PostgreSQL's archive_command (#4298):
#   archive_command = '/usr/local/bin/pgbackrest-archive.sh %p'
#
# Only repo1's push decides the exit: pgbackrest.conf configures repo1 alone in this
# container, so no offsite repo is ever on the archive path. pgBackRest 2.60's
# multi-repo push stops pushing to every repo after one repo fails
# (pgbackrest/pgbackrest#2926), and even its fix keeps the healthy repo at most one
# batch ahead of the failed one, so an offsite outage would stall repo1's PITR.
#
# After repo1 holds the segment, it is copied into the spool of each offsite repo the
# sidecar turned on (<spool>/repoN, made by pgbackrest-offsite.sh); the sidecar's
# wal-offsite-push.sh pushes it to that repo and deletes it. That copy is best effort:
# a failure is logged and archiving still succeeds. Each spool keeps at most
# DS_OFFSITE_SPOOL_MAX segments (default 512, 8 GiB at 16 MiB): past it the oldest is
# dropped and named in <spool>/repoN.gap, and that repo's PITR then restarts from its
# next backup (infra/deploy/RECOVERY.md §1.4).
#
# <spool> is /var/log/pgbackrest/offsite-spool: the pgbackrest_log volume is the one
# volume both containers already mount read-write, and the PostgreSQL guard admits
# only the inspected mount topology (tools/deploy/postgres-guard.mjs), so a volume of
# its own would refuse the ordinary release that ships this.
#
# The name holds "pgbackrest": pgBackRest's check and backup refuse an archive_command
# without it.
pgbackrest --stanza=ds archive-push "$1" || exit $?

export LC_ALL=C
spool=${DS_OFFSITE_SPOOL:-/var/log/pgbackrest/offsite-spool}
max=${DS_OFFSITE_SPOOL_MAX:-512}
name=${1##*/}
for dir in "$spool"/repo[0-9]; do
  [ -d "$dir" ] || continue
  repo=${dir##*/}
  if ! { cp -T -- "$1" "$dir/.$name.tmp" && mv -fT -- "$dir/.$name.tmp" "$dir/$name"; } 2>/dev/null; then
    rm -f -- "$dir/.$name.tmp" 2>/dev/null
    echo "pgbackrest-archive: $name not spooled for $repo (repo1 has it)" >&2
    continue
  fi
  count=$(ls -- "$dir" | wc -l)
  while [ "$count" -gt "$max" ]; do
    oldest=$(ls -- "$dir" | head -n 1)
    rm -f -- "$dir/$oldest"
    echo "$(date -u +%FT%TZ) dropped $oldest" >>"$spool/$repo.gap"
    echo "pgbackrest-archive: $repo spool is over $max segments; dropped $oldest ($repo PITR restarts at its next backup)" >&2
    count=$((count - 1))
  done
done
exit 0
