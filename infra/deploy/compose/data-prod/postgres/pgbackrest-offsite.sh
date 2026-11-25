#!/bin/sh
# DS Platform data-prod — turns the offsite pgBackRest repos on or off (#3670).
#
# A repo pgBackRest finds a repoN-type / -path / -cipher-type for is a configured repo,
# and a configured repo without its key, endpoint or pass fails archive-push and
# check. So the offsite policy is committed in pgbackrest.conf as `#repoN: ` lines,
# and this copies repo N's lines into the include pgBackRest appends from conf.d only
# when the container env (data.env) holds all four of its names. A release that ships
# before the names exist, or a rotation that adds them, leaves repo1 as it was; the
# rotation unit's check-and-restore covers the switch. A partial set is left off:
# pgBackRest drops env options whose repoN-type=s3 dependency is unmet.
# Byte-equal copies in ../postgres and ../pgbackrest (pgbackrest-offsite.test.mjs).
set -eu
conf=${1:-/etc/pgbackrest/pgbackrest.conf}
out=${2:-/etc/pgbackrest/conf.d/offsite.conf}
body=
for n in 2 3; do
  have=0
  for v in S3_KEY S3_KEY_SECRET S3_ENDPOINT CIPHER_PASS; do
    eval "val=\${PGBACKREST_REPO${n}_${v}:-}"
    if [ -n "$val" ]; then have=$((have + 1)); fi
  done
  if [ "$have" -eq 4 ]; then
    lines=$(sed -n "s/^#repo${n}: //p" "$conf")
    if [ -z "$lines" ]; then
      echo "pgbackrest-offsite: $conf has no #repo${n}: policy" >&2
      exit 1
    fi
    body="$body$lines
"
    echo "pgbackrest-offsite: repo${n} on" >&2
  elif [ "$have" -gt 0 ]; then
    echo "pgbackrest-offsite: repo${n} has ${have} of its 4 data.env names; left off" >&2
  fi
done
if [ -z "$body" ]; then
  rm -f -- "$out"
  exit 0
fi
tmp="$out.tmp.$$"
printf '[global]\n%s' "$body" >"$tmp"
chmod 0644 "$tmp"
mv -f -- "$tmp" "$out"
