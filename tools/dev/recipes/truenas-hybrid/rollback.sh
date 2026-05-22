#!/usr/bin/env bash
# DS Platform — "TrueNAS Hybrid" recipe: roll the dev database back to a ZFS
# snapshot.
#
# Streamed to the TrueNAS box by tools/dev/run.mjs (`ssh ... bash -s`). The
# launcher stops the postgres container before this runs and starts it again
# afterwards (setup-design §5.5) — this script only touches ZFS.
#
# The argument may be a bare snapshot name (`pre-mig-auto-20260518T091230Z`) or
# a fully-qualified `dataset@snapshot`. `-r` discards any newer snapshots so the
# rollback is not blocked by intervening pre-migration snapshots.
set -euo pipefail

NAME="${1:?usage: rollback.sh <snapshot-name>}"
DATASET="${DEV_PG_DATASET:-Daily SSD/dev-postgres}"

case "$NAME" in
  *@*) TARGET="$NAME" ;;
  *)   TARGET="${DATASET}@${NAME}" ;;
esac

sudo zfs rollback -r "${TARGET}"
echo "rolled back to: ${TARGET}"
