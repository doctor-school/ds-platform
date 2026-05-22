#!/usr/bin/env bash
# DS Platform — "TrueNAS Hybrid" recipe: pre-migration ZFS snapshot.
#
# Streamed to the TrueNAS box by tools/dev/run.mjs (`ssh ... bash -s`). The
# timestamp is generated here, on the Linux side, so the launcher stays free of
# host-shell date-substitution quirks (setup-design §9.2).
#
# The dev-postgres dataset lives on the "Daily SSD" pool — the space is part of
# the pool name and must stay quoted in every zfs argument (setup-design §5.3,
# DSP-155 implementation note).
set -euo pipefail

DESC="${1:?usage: snapshot.sh <description>}"
DATASET="${DEV_PG_DATASET:-Daily SSD/dev-postgres}"
NAME="${DESC}-$(date -u +%Y%m%dT%H%M%SZ)"

sudo zfs snapshot "${DATASET}@${NAME}"
echo "snapshot created: ${DATASET}@${NAME}"
