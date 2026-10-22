#!/usr/bin/env bash
# harden-ssh.sh — converge an existing box to the ssh access model of tech spec
# apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md §4,
# §8 step (c) (Issue #2984). A new box reaches the same end state from its
# cloud-init file (infra/deploy/cloud-init/*.yaml); this script is the one-off
# converge for the boxes that already run. Idempotent: a second run changes nothing.
#
#   sudo harden-ssh.sh --role prod|stage|data --breakglass-pubkey <file>
#                      [--ci-pubkey <file>]... [--dry-run]
#
# It converges:
#   - /etc/ssh/sshd_config.d/10-ds-hardening.conf (the drop-in below);
#   - every active `PermitRootLogin` other than `no` in /etc/ssh/sshd_config
#     commented out (sshd takes the first value it reads; the effective set is
#     proven with `sshd -T` afterwards);
#   - user `breakglass` (bash, group sudo, its own NOPASSWD sudoers file checked
#     with `visudo -cf`, authorized_keys = the break-glass key);
#   - /root/.ssh/authorized_keys emptied, only once breakglass is verified in place;
#   - each CI key in deploy's authorized_keys behind the forced command
#     /usr/local/bin/ds-deploy-entrypoint — `sudo -n /usr/local/bin/ds-deploy-entrypoint`
#     on prod (matched by key body; on stage and data every other line, the operator
#     key above all, stays byte-identical; a key already on an unrestricted deploy
#     line is refused);
#   - prod only, once breakglass is verified in place: /etc/sudoers.d/90-ds-deploy
#     (deploy may run the entrypoint as root, nothing else; `visudo -cf`), deploy's
#     rules in other sudoers.d files removed, deploy out of groups sudo and docker,
#     and every deploy key line not behind the prod forced command removed;
#   - /etc/ds-platform/box-role = the role;
#   - fail2ban and unattended-upgrades enabled and running.
# `sshd -t` runs BEFORE `systemctl reload ssh`; on failure the sshd files are
# restored and nothing is reloaded.
#
# HARDEN_ROOT (a path prefix, empty on a box) lets the tests run it against a
# fixture tree with sshd / systemctl / visudo / useradd / chown stubbed on PATH.
#
# Exit codes: 0 converged · 1 a step failed (sshd -t, sshd -T, visudo) · 2 usage.
set -euo pipefail

ROOT=${HARDEN_ROOT:-}
PATH=$PATH:/usr/sbin:/sbin

SSHD_CONFIG=$ROOT/etc/ssh/sshd_config
DROPIN=$ROOT/etc/ssh/sshd_config.d/10-ds-hardening.conf
ROOT_KEYS=$ROOT/root/.ssh/authorized_keys
DEPLOY_KEYS=$ROOT/home/deploy/.ssh/authorized_keys
BREAKGLASS_HOME=$ROOT/home/breakglass
BREAKGLASS_SUDOERS=$ROOT/etc/sudoers.d/91-ds-breakglass
BOX_ROLE_FILE=$ROOT/etc/ds-platform/box-role
PASSWD=$ROOT/etc/passwd
GROUP=$ROOT/etc/group
SUDOERS_D=$ROOT/etc/sudoers.d
DEPLOY_SUDOERS=$SUDOERS_D/90-ds-deploy

# The forced command of a CI key. On prod the entrypoint runs as root through the
# one sudo right deploy holds there (DEPLOY_SUDOERS_CONTENT below); on stage and data
# deploy keeps its sudo and the entrypoint elevates per call.
ENTRYPOINT=/usr/local/bin/ds-deploy-entrypoint
KEY_RESTRICTIONS=no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding
# Any CI line, either role's form: what the operator-key refusal below tells apart
# from an unrestricted line.
RESTRICTED_RE='^command="(sudo -n )?/usr/local/bin/ds-deploy-entrypoint",'
PROD_CI_RE='^command="sudo -n /usr/local/bin/ds-deploy-entrypoint",'

# Prod only (spec §4 «sudo on prod»): deploy may run the entrypoint as root with no
# argument, and sudo keeps SSH_ORIGINAL_COMMAND (the request) through its env reset.
# infra/deploy/cloud-init/api-prod.yaml writes the same bytes; the tests pin them.
DEPLOY_SUDOERS_CONTENT='Defaults!/usr/local/bin/ds-deploy-entrypoint env_keep += "SSH_ORIGINAL_COMMAND"
deploy ALL=(root) NOPASSWD: /usr/local/bin/ds-deploy-entrypoint ""
'
PUBKEY_RE='^(ssh-ed25519|sk-ssh-ed25519@openssh\.com|ecdsa-sha2-nistp(256|384|521)|ssh-rsa) [A-Za-z0-9+/]+=* ?[^[:cntrl:]]*$'

# The drop-in. infra/deploy/cloud-init/{api-prod,data-prod,stage-1}.yaml write the
# same bytes; tools/deploy/harden-ssh.test.mjs pins them equal.
# BEGIN DS-HARDENING-DROPIN
DROPIN_CONTENT='# ds-platform ssh hardening (Issue #2984; release-pipeline spec §4).
# Sorted before 50-cloud-init.conf and read before the main sshd_config:
# sshd takes the first value it reads for each keyword.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
MaxStartups 10:30:60
PermitUserEnvironment no
'
# END DS-HARDENING-DROPIN

say() { printf 'harden-ssh: %s\n' "$*"; }
usage() { printf 'harden-ssh: %s\n' "$*" >&2; exit 2; }
fail() { printf 'harden-ssh: %s\n' "$*" >&2; exit 1; }

role= breakglass_file= dry_run=0
ci_files=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --role) role=${2-}; shift 2 || usage "--role needs a value" ;;
    --breakglass-pubkey) breakglass_file=${2-}; shift 2 || usage "--breakglass-pubkey needs a file" ;;
    --ci-pubkey) ci_files+=("${2-}"); shift 2 || usage "--ci-pubkey needs a file" ;;
    --dry-run) dry_run=1; shift ;;
    *) usage "unknown argument: $1" ;;
  esac
done
[[ $role =~ ^(prod|stage|data)$ ]] || usage "--role must be prod, stage or data"
[[ -n $breakglass_file ]] || usage "--breakglass-pubkey <file> is required"
[[ -n $ROOT || $dry_run == 1 || $EUID -eq 0 ]] || usage "run as root (sudo)"
if [[ $role == prod ]]; then
  CI_KEY_OPTIONS="command=\"sudo -n $ENTRYPOINT\",$KEY_RESTRICTIONS"
else
  CI_KEY_OPTIONS="command=\"$ENTRYPOINT\",$KEY_RESTRICTIONS"
fi

# One public key, no options, from a one-line file.
read_pubkey() {
  local file=$1 key
  [[ -f $file ]] || usage "no such key file: $file"
  [[ $(grep -c . "$file") == 1 ]] || usage "$file must hold exactly one key line"
  key=$(grep . "$file" | tr -d '\r')
  [[ $key =~ $PUBKEY_RE ]] || usage "$file is not a bare public key line"
  printf '%s' "$key"
}
key_body() { local f; read -r _ f _ <<<"$1"; printf '%s' "$f"; }

breakglass_key=$(read_pubkey "$breakglass_file")
ci_keys=()
for f in ${ci_files[@]+"${ci_files[@]}"}; do
  k=$(read_pubkey "$f")
  [[ $(key_body "$k") != "$(key_body "$breakglass_key")" ]] ||
    usage "$f is the break-glass key; a CI key must be a distinct key"
  ci_keys+=("$k")
  # A CI key already on an unrestricted deploy line is the operator key passed by
  # mistake: putting it behind the forced command would lock the operator out.
  if [[ -f $DEPLOY_KEYS ]] && grep -F -- " $(key_body "$k")" "$DEPLOY_KEYS" |
    grep -Eqv "$RESTRICTED_RE"; then
    usage "$f is already an unrestricted key of deploy (the operator key?); a CI key must be a new key"
  fi
done

changed=0 sshd_changed=0
backups=()

note() {
  changed=1
  if [[ $dry_run == 1 ]]; then say "would $*"; else say "$*"; fi
}

# Write `content` to `path` when it differs; in place when the file exists (keeps
# its owner and mode), else created with `mode`. Returns 0 when it changed.
converge_file() {
  local path=$1 mode=$2 content=$3
  if [[ -f $path ]] && [[ $(cat "$path"; printf x) == "${content}x" ]]; then return 1; fi
  note "write $path"
  [[ $dry_run == 1 ]] && return 0
  mkdir -p "$(dirname "$path")"
  if [[ -f $path ]]; then
    printf '%s' "$content" >"$path"
  else
    (umask 077 && printf '%s' "$content" >"$path")
    chmod "$mode" "$path"
  fi
  return 0
}

# A sudoers.d file: checked with `visudo -cf` before it is in place, then renamed in
# (sudo skips a name with a dot, so the `.ds-harden.new` file is never read).
install_sudoers() {
  local path=$1 content=$2 what=$3 tmp
  tmp=$(mktemp)
  printf '%s' "$content" >"$tmp"
  visudo -cf "$tmp" >/dev/null || { rm -f "$tmp"; fail "visudo rejected $what"; }
  mkdir -p "$(dirname "$path")"
  cp "$tmp" "$path.ds-harden.new" && rm -f "$tmp"
  chmod 0440 "$path.ds-harden.new"
  mv -f "$path.ds-harden.new" "$path"
}

breakglass_ready() {
  grep -q '^breakglass:' "$PASSWD" &&
    [[ $(cat "$BREAKGLASS_HOME/.ssh/authorized_keys" 2>/dev/null) == "$breakglass_key" ]] &&
    [[ $(cat "$BREAKGLASS_SUDOERS" 2>/dev/null; printf x) == "${sudoers_line}x" ]]
}

backup_sshd_file() {
  local path=$1
  [[ $dry_run == 1 ]] && return 0
  if [[ -f $path ]]; then cp -p "$path" "$path.ds-harden.bak"; backups+=("$path"); else backups+=("$path!absent"); fi
}
restore_sshd_files() {
  local entry path
  for entry in ${backups[@]+"${backups[@]}"}; do
    path=${entry%!absent}
    if [[ $entry == *'!absent' ]]; then rm -f "$path"; else mv -f "$path.ds-harden.bak" "$path"; fi
  done
}
drop_backups() {
  local entry
  for entry in ${backups[@]+"${backups[@]}"}; do
    [[ $entry == *'!absent' ]] || rm -f "$entry.ds-harden.bak"
  done
}

# --- sshd: the drop-in, then the main file's PermitRootLogin ----------------------
if ! { [[ -f $DROPIN ]] && [[ $(cat "$DROPIN"; printf x) == "${DROPIN_CONTENT}x" ]]; }; then
  backup_sshd_file "$DROPIN"
  converge_file "$DROPIN" 0644 "$DROPIN_CONTENT" && sshd_changed=1
fi

ROOTLOGIN_RE='^[[:space:]]*[Pp][Ee][Rr][Mm][Ii][Tt][Rr][Oo][Oo][Tt][Ll][Oo][Gg][Ii][Nn][[:space:]]+'
if [[ -f $SSHD_CONFIG ]] && grep -E "$ROOTLOGIN_RE" "$SSHD_CONFIG" | grep -Eqv "${ROOTLOGIN_RE}no[[:space:]]*\$"; then
  note "comment out PermitRootLogin in $SSHD_CONFIG (the drop-in sets it)"
  if [[ $dry_run == 0 ]]; then
    backup_sshd_file "$SSHD_CONFIG"
    sed -E -i "/${ROOTLOGIN_RE}no[[:space:]]*\$/! s/(${ROOTLOGIN_RE}.*)\$/# \\1  # ds-platform: set by sshd_config.d\\/10-ds-hardening.conf/" "$SSHD_CONFIG"
  fi
  sshd_changed=1
fi

# --- breakglass user ----------------------------------------------------------------
if ! grep -q '^breakglass:' "$PASSWD" 2>/dev/null; then
  note "create user breakglass (bash, group sudo)"
  [[ $dry_run == 1 ]] || useradd ${ROOT:+--prefix "$ROOT"} -m -s /bin/bash -G sudo breakglass
fi
sudoers_line='breakglass ALL=(ALL) NOPASSWD:ALL
'
if ! { [[ -f $BREAKGLASS_SUDOERS ]] && [[ $(cat "$BREAKGLASS_SUDOERS"; printf x) == "${sudoers_line}x" ]]; }; then
  note "write $BREAKGLASS_SUDOERS"
  [[ $dry_run == 1 ]] || install_sudoers "$BREAKGLASS_SUDOERS" "$sudoers_line" "the breakglass sudoers file"
fi
if converge_file "$BREAKGLASS_HOME/.ssh/authorized_keys" 0600 "$breakglass_key"$'\n' && [[ $dry_run == 0 ]]; then
  chmod 0700 "$BREAKGLASS_HOME/.ssh"
  chown -R breakglass:breakglass "$BREAKGLASS_HOME/.ssh"
fi

# --- root keys: only once break-glass is proven in place ------------------------------
if [[ -s $ROOT_KEYS ]]; then
  note "empty $ROOT_KEYS"
  if [[ $dry_run == 0 ]]; then
    breakglass_ready || fail "breakglass is not in place; root's keys were left as they are"
    : >"$ROOT_KEYS"
  fi
fi

# --- CI keys on deploy ----------------------------------------------------------------
for key in ${ci_keys[@]+"${ci_keys[@]}"}; do
  body=$(key_body "$key")
  want="$CI_KEY_OPTIONS $key"
  [[ -f $DEPLOY_KEYS ]] || fail "$DEPLOY_KEYS is missing: the deploy user must exist first"
  if [[ $(grep -cF -- " $body" "$DEPLOY_KEYS" || true) == 1 ]] && grep -qxF -- "$want" "$DEPLOY_KEYS"; then
    continue
  fi
  note "add CI key ${body:0:16}… to $DEPLOY_KEYS behind the forced command"
  if [[ $dry_run == 0 ]]; then
    # Same-directory temp file carrying the original owner and mode, then a rename:
    # a full disk mid-write never truncates deploy's keys.
    rest=$(grep -vF -- " $body" "$DEPLOY_KEYS" || true)
    cp -p "$DEPLOY_KEYS" "$DEPLOY_KEYS.ds-harden.new"
    { [[ -z $rest ]] || printf '%s\n' "$rest"; printf '%s\n' "$want"; } >"$DEPLOY_KEYS.ds-harden.new"
    mv -f "$DEPLOY_KEYS.ds-harden.new" "$DEPLOY_KEYS"
  fi
done

# --- prod: deploy holds the entrypoint and nothing else (spec §4 «sudo on prod») ----
# Its one sudo right is written first, then every other right goes: the rules other
# sudoers.d files give it (cloud-init's 90-cloud-init-users), groups sudo and docker
# (docker is root-equivalent; the Actions path runs as root and needs neither), and
# every key line not behind the prod forced command — the operator key above all.
# The operator path on prod is breakglass, so nothing of deploy's goes before
# breakglass is proven in place.
if [[ $role == prod ]]; then
  if ! { [[ -f $DEPLOY_SUDOERS ]] && [[ $(cat "$DEPLOY_SUDOERS"; printf x) == "${DEPLOY_SUDOERS_CONTENT}x" ]]; }; then
    note "write $DEPLOY_SUDOERS"
    [[ $dry_run == 1 ]] || install_sudoers "$DEPLOY_SUDOERS" "$DEPLOY_SUDOERS_CONTENT" "the deploy sudoers file"
  fi
  [[ $dry_run == 1 ]] || breakglass_ready ||
    fail "breakglass is not in place; deploy's sudo rights and keys were left as they are"
  for f in "$SUDOERS_D"/*; do
    [[ -f $f && $f != "$DEPLOY_SUDOERS" && $f != "$BREAKGLASS_SUDOERS" && ${f##*/} != *.* ]] || continue
    grep -Eq '^[[:space:]]*deploy[[:space:]]' "$f" || continue
    note "remove deploy's rule from $f"
    if [[ $dry_run == 0 ]]; then
      rest=$(grep -Ev '^[[:space:]]*deploy[[:space:]]' "$f" || true)
      install_sudoers "$f" "${rest:+$rest$'\n'}" "$f without deploy's rule"
    fi
  done
  for g in sudo docker; do
    if grep -Eq "^$g:[^:]*:[^:]*:(.*,)?deploy(,.*)?\$" "$GROUP" 2>/dev/null; then
      note "remove deploy from group $g"
      [[ $dry_run == 1 ]] || gpasswd ${ROOT:+--root "$ROOT"} -d deploy "$g" >/dev/null
    fi
  done
  if [[ -f $DEPLOY_KEYS ]] && grep -Ev '^[[:space:]]*(#|$)' "$DEPLOY_KEYS" | grep -Eqv "$PROD_CI_RE"; then
    note "remove every deploy key not behind the prod forced command from $DEPLOY_KEYS"
    if [[ $dry_run == 0 ]]; then
      rest=$(grep -E "$PROD_CI_RE" "$DEPLOY_KEYS" || true)
      cp -p "$DEPLOY_KEYS" "$DEPLOY_KEYS.ds-harden.new"
      { [[ -z $rest ]] || printf '%s\n' "$rest"; } >"$DEPLOY_KEYS.ds-harden.new"
      mv -f "$DEPLOY_KEYS.ds-harden.new" "$DEPLOY_KEYS"
    fi
  fi
fi

# --- box role -------------------------------------------------------------------------
converge_file "$BOX_ROLE_FILE" 0644 "$role"$'\n' || true

# --- fail2ban, unattended-upgrades ----------------------------------------------------
for unit in fail2ban unattended-upgrades; do
  if ! systemctl is-enabled --quiet "$unit" || ! systemctl is-active --quiet "$unit"; then
    note "enable --now $unit"
    [[ $dry_run == 1 ]] || systemctl enable --now "$unit"
  fi
done

# --- prove, then reload -------------------------------------------------------------
if [[ $dry_run == 1 ]]; then
  [[ $changed == 1 ]] || say "nothing to change"
  exit 0
fi
if ! sshd -t -f "$SSHD_CONFIG"; then
  restore_sshd_files
  fail "sshd -t rejected the config; sshd files restored, ssh NOT reloaded"
fi
effective=$(sshd -T -f "$SSHD_CONFIG" -C user=deploy,host=localhost,addr=127.0.0.1) || effective=
for want in 'permitrootlogin no' 'passwordauthentication no' 'kbdinteractiveauthentication no' \
  'maxstartups 10:30:60' 'permituserenvironment no'; do
  if ! grep -qxF "$want" <<<"$effective"; then
    restore_sshd_files
    fail "sshd -T does not show '$want'; sshd files restored, ssh NOT reloaded"
  fi
done
drop_backups
if [[ $sshd_changed == 1 ]]; then
  systemctl reload ssh
  say "ssh reloaded"
fi
[[ $changed == 1 ]] || say "nothing to change"
