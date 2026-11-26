#!/bin/sh
# DS Platform data-prod — turns the offsite pgBackRest repos on or off (#3670, #4298).
#
# An offsite repo never joins the repo1 config: PostgreSQL's archive_command and
# repo1's backups run under pgbackrest.conf, which configures repo1 alone, so an
# offsite outage cannot reach repo1 (pgbackrest-archive.sh). Each offsite repo N gets
# a config of its own instead, <out>/repoN/pgbackrest.conf: pgbackrest.conf without
# repo1 and without its async archiving (a sync push, one segment at a time, needs
# neither, and the sync push must not set archive-push-queue-max), plus the shared
# `#offsite: ` and repo N's own `#repoN: ` policy lines. pgbackrest-repo.sh runs
# pgBackRest under it. A repo is on only while the container env (data.env) holds all
# four of its names: a configured repo without its key, endpoint or pass fails every
# command, and pgBackRest drops env options whose repoN-type=s3 dependency is unmet.
# A repo that is on also gets its WAL spool <spool>/repoN, which the archive_command
# fills and wal-offsite-push.sh drains; a repo that is off loses its config, its
# spool and its gap marker. A release that ships before the names exist, or a
# rotation that adds them, leaves repo1 as it was; the rotation unit's
# check-and-restore covers the switch (repo-check.sh).
set -eu
conf=${1:-/etc/pgbackrest/pgbackrest.conf}
out=${2:-/etc/pgbackrest/offsite}
spool=${3:-/var/log/pgbackrest/offsite-spool}
for n in 2 3; do
  have=0
  for v in S3_KEY S3_KEY_SECRET S3_ENDPOINT CIPHER_PASS; do
    eval "val=\${PGBACKREST_REPO${n}_${v}:-}"
    if [ -n "$val" ]; then have=$((have + 1)); fi
  done
  if [ "$have" -ne 4 ]; then
    rm -rf -- "$spool/repo${n}" "$spool/repo${n}.gap" "$out/repo${n}"
    if [ "$have" -gt 0 ]; then
      echo "pgbackrest-offsite: repo${n} has ${have} of its 4 data.env names; left off" >&2
    fi
    continue
  fi
  if ! grep -q "^#repo${n}: " "$conf"; then
    echo "pgbackrest-offsite: $conf has no #repo${n}: policy" >&2
    exit 1
  fi
  mkdir -p "$out/repo${n}/conf.d"
  policy="$out/repo${n}/.policy.$$"
  sed -n -e 's/^#offsite: //p' -e "s/^#repo${n}: //p" "$conf" >"$policy"
  tmp="$out/repo${n}/pgbackrest.conf.tmp.$$"
  sed -e '/^repo1-/d' -e '/^archive-async=/d' -e '/^archive-push-queue-max=/d' \
    -e '/^spool-path=/d' -e '/^#/d' -e '/^$/d' "$conf" | sed "/^\[global\]\$/r $policy" >"$tmp"
  rm -f -- "$policy"
  chmod 0644 "$tmp"
  mv -f -- "$tmp" "$out/repo${n}/pgbackrest.conf"
  mkdir -p "$spool/repo${n}"
  echo "pgbackrest-offsite: repo${n} on" >&2
done
