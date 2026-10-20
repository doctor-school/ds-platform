#!/usr/bin/env bash
# install-node.sh — the pinned Node runtime of a box that runs the release driver
# (Issue #2985; tech spec
# apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md §5).
# The stage release driver runs `tools/staging/slot.mjs` on the box itself, which
# needs node and nothing else (slot.mjs and its imports use `node:` builtins only).
#
#   sudo bash install-node.sh [--dry-run]
#
# Downloads the official linux-x64 tarball of NODE_VERSION, refuses it unless its
# sha256 is NODE_SHA256 (the line of the release's SHASUMS256.txt), unpacks it into
# /usr/local/lib/nodejs/<version> and points /usr/local/bin/node at it. Idempotent:
# a box already on the pinned version changes nothing. A post-boot provisioning step
# (infra/deploy/README.md), never cloud-init runcmd: Timeweb hard-resets a box whose
# first boot runs long (infra/deploy/cloud-init/stage-1.yaml).
#
# NODE_ROOT (a path prefix, empty on a box) and NODE_DIST (the download origin) let
# the tests run it against a fixture tree with a local tarball; NODE_FIXTURE_SHA256
# replaces the pinned sha256 of such a fixture tarball, honoured only with a NODE_ROOT
# prefix, so it can never install an unpinned node into the box's /usr/local.
#
# Exit codes: 0 installed or already current · 1 a step failed (download, checksum) · 2 usage.
set -euo pipefail

# Node 24 LTS (`.nvmrc` 24; package.json engines ^24.15.0).
NODE_VERSION=v24.21.0
NODE_SHA256=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6

ROOT=${NODE_ROOT:-}
[[ -n $ROOT && -n ${NODE_FIXTURE_SHA256:-} ]] && NODE_SHA256=$NODE_FIXTURE_SHA256
DIST=${NODE_DIST:-https://nodejs.org/dist}
TARBALL=node-$NODE_VERSION-linux-x64.tar.xz
PREFIX=$ROOT/usr/local/lib/nodejs
DEST=$PREFIX/$NODE_VERSION
LINK=$ROOT/usr/local/bin/node

dry_run=0
case ${1:-} in
  "") ;;
  --dry-run) dry_run=1 ;;
  *) echo "usage: install-node.sh [--dry-run]" >&2; exit 2 ;;
esac

if [[ -x $DEST/bin/node && $(readlink "$LINK" 2>/dev/null || true) == "$DEST/bin/node" ]]; then
  echo "node $NODE_VERSION already installed at $DEST; nothing to change"
  exit 0
fi
if ((dry_run)); then
  echo "would install node $NODE_VERSION into $DEST and link $LINK"
  exit 0
fi

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
curl -fsSL --retry 3 -o "$work/$TARBALL" "$DIST/$NODE_VERSION/$TARBALL" ||
  { echo "install-node: download of $TARBALL failed" >&2; exit 1; }
printf '%s  %s\n' "$NODE_SHA256" "$work/$TARBALL" | sha256sum -c --status - ||
  { echo "install-node: $TARBALL does not match the pinned sha256; nothing installed" >&2; exit 1; }

mkdir -p "$work/unpacked" "$PREFIX" "$(dirname "$LINK")"
tar xJf "$work/$TARBALL" --strip-components=1 -C "$work/unpacked"
"$work/unpacked/bin/node" --version >/dev/null ||
  { echo "install-node: the unpacked node does not run; nothing installed" >&2; exit 1; }
rm -rf -- "$DEST"
mv "$work/unpacked" "$DEST"
ln -sfn "$DEST/bin/node" "$LINK"
echo "node $NODE_VERSION installed at $DEST; $LINK -> $DEST/bin/node"
