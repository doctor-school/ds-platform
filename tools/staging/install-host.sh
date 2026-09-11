#!/usr/bin/env bash
# tools/staging/install-host.sh — lands the slot tooling on `stage-1` (Issue #2064
# part 2a, staging tech spec §3 «Host runtime» / §8 step 4).
#
# Runs AS ROOT ON THE BOX, from the directory `install.mjs` unpacked the payload
# into. It is the only thing that puts application code on the host outside a
# container, and it puts exactly four kinds of thing there: a pinned Node runtime,
# three `.mjs` scripts, the slot compose project, and four systemd units. No apt
# repository is added, no `pnpm` is installed, no workspace is checked out.
#
# IDEMPOTENT, and that is a testable claim rather than an aspiration: every step
# probes the desired end state first and prints exactly one line — `ensured <thing>`
# when it changed something, `already <thing>` when it did not. A second run on an
# unchanged payload therefore prints ONLY `already` lines and leaves every mtime
# under /opt/ds-platform, /opt/node and /etc/systemd/system/ds-slot* untouched.
#
# The probe-then-act shape is not decoration. `install` unconditionally rewrites a
# file (new mtime, new inode) even when the bytes are identical, `systemctl
# daemon-reload` is not free, and `systemctl enable --now` on an active unit is a
# no-op only by luck of the current systemd version. Each of those is preceded by
# the question it answers.

set -euo pipefail

# --- the pin -----------------------------------------------------------------
#
# Version AND checksum, both here, both changed together. To bump the runtime: edit
# these two constants, take the SHA-256 from https://nodejs.org/dist/v<X>/SHASUMS256.txt
# for the `linux-x64.tar.xz` line, and re-run `node tools/staging/install.mjs
# deploy@<box>`. The install swaps /opt/node and leaves the units alone.
NODE_VERSION="v24.21.0"
NODE_SHA256="fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6"
NODE_TARBALL="node-${NODE_VERSION}-linux-x64.tar.xz"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}"

NODE_PREFIX="/opt/node"
APP_DIR="/opt/ds-platform"
COMPOSE_DIR="${APP_DIR}/compose/slot"
UNIT_DIR="/etc/systemd/system"
STATE_DIR="/var/lib/ds-platform"
LOG_DIR="/var/log/ds-platform"
ETC_DIR="/etc/ds-platform"
STAGE_ENV="${ETC_DIR}/stage.env"
CADDY_INCLUDE_DIR="${ETC_DIR}/caddy"

PAYLOAD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STAGING_SRC="${PAYLOAD_ROOT}/tools/staging"
COMPOSE_SRC="${PAYLOAD_ROOT}/infra/deploy/compose/slot"
UNIT_SRC="${PAYLOAD_ROOT}/infra/deploy/systemd"

UNITS="ds-slot-deployer.service ds-slot-deployer.timer ds-slot-gc.service ds-slot-gc.timer"
TIMERS="ds-slot-deployer.timer ds-slot-gc.timer"

ensured() { echo "ensured $*"; }
already() { echo "already $*"; }
die() { echo "install-host: $*" >&2; exit 1; }

# --- refusals ----------------------------------------------------------------
#
# Both are STOPs, not warnings. A non-x86_64 host would silently get a Node binary
# it cannot execute, and a box without `stage.env` has no `STAGE_BASE_DOMAIN` and no
# `STAGE_GH_READ_TOKEN` — the units would install fine and then fail on every single
# tick, which looks like a bug in this tooling rather than a missing prerequisite.

[ "$(id -u)" -eq 0 ] || die "must run as root (install.mjs invokes it through sudo)"

arch="$(uname -m)"
[ "$arch" = "x86_64" ] || die "unsupported architecture: ${arch} — the Node pin is linux-x64"

[ -f "$STAGE_ENV" ] || die "${STAGE_ENV} is missing — provision the box env before installing the slot tooling"

for required in "$STAGING_SRC/slot.mjs" "$STAGING_SRC/golden-db.mjs" \
  "$STAGING_SRC/idp.mjs" "$STAGING_SRC/deployer.mjs" "$COMPOSE_SRC/compose.yml"; do
  [ -f "$required" ] || die "payload is incomplete: ${required} is missing"
done

# --- helpers -----------------------------------------------------------------

# Copies only when the bytes differ. Returns 0 when it changed something, so callers
# can accumulate «did anything change?» without re-comparing.
#
# Every mutating command carries its own `|| die`, and that is load-bearing rather
# than belt-and-braces: bash documents that «if a compound command or shell function
# executes in a context where -e is being ignored, none of the commands executed
# within the function body will be affected by the -e setting», and EVERY call site
# below is such a context (`copy_file ... || true`, `if copy_file ...; then`). Without
# the explicit die a failed `install` — read-only mount, ENOSPC, an immutable unit
# file — would fall through to `ensured`, the box would keep the OLD file, and the
# install would exit 0 while the transcript claimed success.
copy_file() {
  local src="$1" dst="$2" mode="$3" label="$4"
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    already "$label"
    return 1
  fi
  install -o root -g root -m "$mode" "$src" "$dst" ||
    die "failed to install ${dst} from ${src} (${label})"
  ensured "$label"
  return 0
}

ensure_dir() {
  local dir="$1" mode="$2"
  if [ -d "$dir" ] && [ "$(stat -c '%a %U' "$dir")" = "${mode#0} root" ]; then
    already "directory ${dir}"
    return
  fi
  install -d -o root -g root -m "$mode" "$dir" || die "failed to create directory ${dir}"
  ensured "directory ${dir} (${mode})"
}

ensure_symlink() {
  local target="$1" link="$2"
  if [ -L "$link" ] && [ "$(readlink "$link")" = "$target" ]; then
    already "symlink ${link}"
    return
  fi
  ln -sfn "$target" "$link" || die "failed to link ${link} -> ${target}"
  ensured "symlink ${link} -> ${target}"
}

# Writes a generated file only when its content differs — same contract as copy_file,
# for the two wrappers, which have no source file in the payload.
write_file() {
  local dst="$1" mode="$2" label="$3" content="$4"
  if [ -f "$dst" ] && [ "$(cat "$dst")" = "$content" ]; then
    already "$label"
    return 1
  fi
  local tmp
  tmp="$(mktemp)" || die "failed to allocate a temp file for ${dst}"
  # The RETURN trap covers the ORDINARY returns only: `die` leaves the function via
  # `exit`, and bash runs no RETURN trap on exit (verified on bash 5.3), so each die
  # path removes the temp file itself. Without both, a failed install left a
  # root-owned /tmp file behind on every retry (Mode (a) NIT, PR #2170).
  trap 'rm -f "$tmp"' RETURN
  printf '%s\n' "$content" > "$tmp" ||
    { rm -f "$tmp"; die "failed to stage the contents of ${dst}"; }
  # Same errexit caveat as `copy_file`: both call sites are `write_file ... || true`.
  install -o root -g root -m "$mode" "$tmp" "$dst" ||
    { rm -f "$tmp"; die "failed to install ${dst} (${label})"; }
  ensured "$label"
  return 0
}

# --- 1. the pinned Node runtime ----------------------------------------------

if [ -x "${NODE_PREFIX}/bin/node" ] && [ "$("${NODE_PREFIX}/bin/node" --version)" = "$NODE_VERSION" ]; then
  already "node ${NODE_VERSION} at ${NODE_PREFIX}"
else
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT
  curl -fsSL "$NODE_URL" -o "${tmpdir}/${NODE_TARBALL}"
  # Verified BEFORE it is unpacked: an unverified tarball is arbitrary code that
  # would then run as root on every timer tick.
  ( cd "$tmpdir" && printf '%s  %s\n' "$NODE_SHA256" "$NODE_TARBALL" | sha256sum -c - >/dev/null )
  rm -rf "${NODE_PREFIX}.new" "${NODE_PREFIX}.old"
  mkdir -p "${NODE_PREFIX}.new"
  tar -xJf "${tmpdir}/${NODE_TARBALL}" -C "${NODE_PREFIX}.new" --strip-components=1
  # Swap through a rename pair rather than unpacking over the live prefix: a tick
  # that fires mid-install keeps running the old, complete tree instead of a
  # half-written one.
  if [ -d "$NODE_PREFIX" ]; then mv "$NODE_PREFIX" "${NODE_PREFIX}.old"; fi
  mv "${NODE_PREFIX}.new" "$NODE_PREFIX"
  rm -rf "${NODE_PREFIX}.old"
  rm -rf "$tmpdir"
  trap - EXIT
  ensured "node ${NODE_VERSION} at ${NODE_PREFIX}"
fi

# `bin/node` ONLY. No npm, npx or corepack symlink: nothing on this host may install
# a package, and `command -v pnpm` staying empty is an acceptance criterion (§8).
ensure_symlink "${NODE_PREFIX}/bin/node" /usr/local/bin/node

# --- 2. directories -----------------------------------------------------------

ensure_dir "$APP_DIR" 0755
ensure_dir "${APP_DIR}/compose" 0755
ensure_dir "$COMPOSE_DIR" 0755
ensure_dir "$STATE_DIR" 0755
# 0750: the reset audit trail names humans and SHAs; it is not world-readable.
ensure_dir "$LOG_DIR" 0750

# --- 3. the scripts -----------------------------------------------------------

for script in slot.mjs golden-db.mjs idp.mjs deployer.mjs; do
  copy_file "${STAGING_SRC}/${script}" "${APP_DIR}/${script}" 0644 "script ${APP_DIR}/${script}" || true
done

# The whole compose project, `centrifugo/` included — `slot.mjs` drives
# `compose.yml` by absolute path and compose resolves its relative bind mounts
# against that file's directory, so a missing sibling is a runtime failure per slot.
while IFS= read -r -d '' src; do
  rel="${src#"${COMPOSE_SRC}"/}"
  dst="${COMPOSE_DIR}/${rel}"
  ensure_dir "$(dirname "$dst")" 0755 >/dev/null
  copy_file "$src" "$dst" 0644 "compose ${dst}" || true
done < <(find "$COMPOSE_SRC" -type f -print0)

# --- 4. the wrappers ----------------------------------------------------------
#
# ONE env-sourcing path on the box, and it is bash's. `stage.env` single-quotes the
# bcrypt hash (a `$2a` fragment is otherwise expanded away by the shell), which
# systemd's `EnvironmentFile=` parser reads as a literal quote — so the units never
# use `EnvironmentFile=`; they exec these wrappers, and a human runs the same
# wrapper by hand (`sudo ds-slot status`) and gets the identical environment.

wrapper_body() {
  local script="$1"
  cat <<WRAPPER
#!/usr/bin/env bash
# Generated by tools/staging/install-host.sh (#2064) — do not edit on the box.
set -euo pipefail
set -a
. ${STAGE_ENV}
set +a
exec ${NODE_PREFIX}/bin/node ${APP_DIR}/${script} "\$@"
WRAPPER
}

# 0750 root: the wrappers source a file only root can read, so a non-root caller
# would only get a confusing permission error from inside bash.
write_file /usr/local/bin/ds-slot 0750 "wrapper /usr/local/bin/ds-slot" "$(wrapper_body slot.mjs)" || true
write_file /usr/local/bin/ds-slot-deployer 0750 "wrapper /usr/local/bin/ds-slot-deployer" "$(wrapper_body deployer.mjs)" || true

# --- 5. the units -------------------------------------------------------------

units_changed=0
for unit in $UNITS; do
  if copy_file "${UNIT_SRC}/${unit}" "${UNIT_DIR}/${unit}" 0644 "unit ${UNIT_DIR}/${unit}"; then
    units_changed=1
  fi
done

if [ "$units_changed" -eq 1 ]; then
  systemctl daemon-reload
  ensured "systemd daemon-reload"
else
  already "systemd daemon-reload (no unit changed)"
fi

for timer in $TIMERS; do
  if [ "$(systemctl is-enabled "$timer" 2>/dev/null || true)" = "enabled" ] &&
    [ "$(systemctl is-active "$timer" 2>/dev/null || true)" = "active" ]; then
    already "timer ${timer}"
  else
    systemctl enable --now "$timer" >/dev/null
    ensured "timer ${timer}"
  fi
done

# A unit file that changed while its timer was already running is still the OLD unit
# in memory until it is restarted; `daemon-reload` alone does not re-arm a timer.
if [ "$units_changed" -eq 1 ]; then
  # shellcheck disable=SC2086 # $TIMERS is a deliberate word-split list of unit names
  systemctl restart $TIMERS
  ensured "timers restarted onto the new unit files"
fi

# --- 6. the Caddy includes ----------------------------------------------------
#
# Caddy refuses to start when either include is missing, and an empty registry
# renders comment-only files that parse fine. Rendered ONCE, on a box that has none:
# re-rendering on every install would fight the registry writes `slot up`/`down`
# make between installs.

# BOTH files are probed: Caddy refuses to start when either is missing, so keying the
# skip on `ask.caddy` alone left a box with a half-rendered include set converged in
# the installer's eyes and dead in Caddy's (Mode (a) NIT, PR #2170).
if [ -f "${CADDY_INCLUDE_DIR}/ask.caddy" ] && [ -f "${CADDY_INCLUDE_DIR}/slots.caddy" ]; then
  already "caddy includes in ${CADDY_INCLUDE_DIR}"
else
  /usr/local/bin/ds-slot render >/dev/null
  ensured "caddy includes in ${CADDY_INCLUDE_DIR}"
fi
