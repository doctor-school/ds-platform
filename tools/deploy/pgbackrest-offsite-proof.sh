#!/usr/bin/env bash
# tools/deploy/pgbackrest-offsite-proof.sh — the acceptance proof of #4298, run by
# .github/workflows/pgbackrest-offsite-proof.yml on a GitHub-hosted runner.
#
# It raises the committed data-prod compose project (both images built from their
# committed Dockerfiles, so pgBackRest is the pinned 2.60.0 build, with the real
# entrypoints, cron schedule and scripts) against two MinIO processes on the runner:
# :9000 holds repo1, :9001 holds the offsite repo2. data.env turns repo2 on exactly as
# on the box (its four names). Then, in order:
#   1. repo2 goes dark — first SIGSTOP (a dead relay: TCP accepted, nothing answers),
#      then killed (connection refused) — while PostgreSQL archives 20 segments:
#      every segment must reach repo1, the archiver must report no failure and no
#      `.ready` may stay behind; the repo2 spool holds them.
#   2. spool overflow: 10 more segments past the spool cap (DS_OFFSITE_SPOOL_MAX=24)
#      drop the oldest, record the gap marker, and archiving still never fails.
#   3. repo2 comes back: the sidecar's pusher drains the spool into repo2, which then
#      holds every spooled segment and none of the dropped ones.
#   4. `backup.sh full offsite 2` (archive-check=y) succeeds and clears the gap marker;
#      a PITR restore from repo2 ALONE (a config and env that know only repo2) reaches
#      a row committed before the target time and not the one committed after it.
#   5. control: the same cluster switched to pgBackRest's native multi-repo archiving
#      (repo1 + repo2 in one archive-push, async) with repo2 down stalls repo1 — the
#      regression pgbackrest/pgbackrest#2926 — so the harness can see the hazard.
#
# Needs: docker with compose, curl, openssl, jq, sudo (data.env lives at the absolute
# /etc/ds-platform/data.env the committed compose names), and MINIO_BIN.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
DATA=$ROOT/infra/deploy/compose/data-prod
MINIO_BIN=${MINIO_BIN:?set MINIO_BIN to a minio server binary}
WORK=${PROOF_WORK:-${RUNNER_TEMP:-/tmp}/pgbackrest-offsite-proof}
DATA_ENV=/etc/ds-platform/data.env
SPOOL_MAX=24
rm -rf "$WORK"
mkdir -p "$WORK/certs" "$WORK/m1" "$WORK/m2"

KEY=proofkey$(openssl rand -hex 4)
SECRET=$(openssl rand -hex 16)
export MINIO_ROOT_USER=$KEY MINIO_ROOT_PASSWORD=$SECRET MINIO_SITE_REGION=ap-southeast-2

log() { printf '[%s] %s\n' "$(date -u +%T)" "$*"; }
OVERRIDE=$WORK/override.yml
dc() { docker compose -f "$DATA/compose.yml" -f "$OVERRIDE" "$@"; }
psql_() { dc exec -T postgres psql -v ON_ERROR_STOP=1 -U ds -d ds_prod -Atq "$@"; }

diagnose() {
  set +e
  echo "--- pg_stat_archiver"
  psql_ -c "select archived_count, failed_count, last_archived_wal, last_failed_wal from pg_stat_archiver"
  echo "--- .ready backlog: $(ready_count)"
  echo "--- repo2 spool: $(spool_count)"
  dc exec -T pgbackrest sh -c 'ls -la /var/log/pgbackrest/offsite-spool 2>&1; cat /var/log/pgbackrest/offsite-spool/*.gap 2>/dev/null'
  echo "--- postgres log (tail)"
  dc logs --no-color --tail 60 postgres
  echo "--- pgbackrest sidecar log (tail)"
  dc logs --no-color --tail 60 pgbackrest
  dc exec -T pgbackrest sh -c 'tail -n 60 /var/log/pgbackrest/offsite-push.log /var/log/pgbackrest/cron.log 2>/dev/null'
  dc exec -T postgres sh -c 'tail -n 40 /var/log/pgbackrest/ds-archive-push-async.log 2>/dev/null'
}
fail() {
  echo "::error::$*"
  diagnose
  exit 1
}

# --- MinIO: repo1 on :9000, repo2 on :9001, one self-signed cert for the name `minio`
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=minio \
  -addext subjectAltName=DNS:minio -keyout "$WORK/certs/private.key" \
  -out "$WORK/certs/public.crt" 2>/dev/null
start_minio() { # <dir> <port> → prints pid
  "$MINIO_BIN" --quiet server "$WORK/$1" --address ":$2" --console-address 127.0.0.1:0 \
    --certs-dir "$WORK/certs" >"$WORK/$1.log" 2>&1 &
  local pid=$!
  for _ in $(seq 1 60); do
    if curl -ksf --max-time 1 "https://127.0.0.1:$2/minio/health/live" >/dev/null; then
      echo "$pid"
      return 0
    fi
    sleep 1
  done
  echo "MinIO on :$2 did not come up" >&2
  cat "$WORK/$1.log" >&2
  return 1
}
stop_minio() { # <pid>: a MinIO this script started; returns once it is gone
  kill -CONT "$1" 2>/dev/null || true
  kill "$1" 2>/dev/null || true
  for _ in $(seq 1 100); do kill -0 "$1" 2>/dev/null || return 0; sleep 0.2; done
  kill -KILL "$1" 2>/dev/null || true
}
M1=$(start_minio m1 9000)
M2=$(start_minio m2 9001)
mkbucket() { curl -ksf --aws-sigv4 "aws:amz:ap-southeast-2:s3" -u "$KEY:$SECRET" -X PUT "https://127.0.0.1:$1/$2" >/dev/null; }
mkbucket 9000 ds-repo1
# The committed repo2 policy names its bucket and region (pgbackrest.conf `#repo2:`).
mkbucket 9001 bbm-ds-pgbackrest

cleanup() {
  set +e
  dc down -v --remove-orphans >/dev/null 2>&1
  docker volume rm -f proof_restore >/dev/null 2>&1
  # only the MinIO processes this script started
  for pid in "$M1" "${M2:-}"; do [[ -n $pid ]] && stop_minio "$pid"; done
}
trap cleanup EXIT

# --- data.env as the box holds it: repo1 + all four names of repo2 -------------------
REPO2_ENV="PGBACKREST_REPO2_S3_KEY=$KEY
PGBACKREST_REPO2_S3_KEY_SECRET=$SECRET
PGBACKREST_REPO2_S3_ENDPOINT=minio
PGBACKREST_REPO2_CIPHER_PASS=$(openssl rand -hex 32)
PGBACKREST_REPO2_STORAGE_PORT=9001
PGBACKREST_REPO2_STORAGE_VERIFY_TLS=n"
sudo mkdir -p "${DATA_ENV%/*}"
sudo tee "$DATA_ENV" >/dev/null <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 16)
PGBACKREST_REPO1_S3_BUCKET=ds-repo1
PGBACKREST_REPO1_S3_ENDPOINT=minio
PGBACKREST_REPO1_S3_REGION=ap-southeast-2
PGBACKREST_REPO1_S3_KEY=$KEY
PGBACKREST_REPO1_S3_KEY_SECRET=$SECRET
PGBACKREST_REPO1_CIPHER_PASS=$(openssl rand -hex 32)
PGBACKREST_REPO1_STORAGE_PORT=9000
PGBACKREST_REPO1_STORAGE_VERIFY_TLS=n
$REPO2_ENV
DS_OFFSITE_SPOOL_MAX=$SPOOL_MAX
EOF
printf '%s\n' "$REPO2_ENV" >"$WORK/repo2.env"
cat >"$OVERRIDE" <<'EOF'
services:
  postgres:
    extra_hosts: ["minio:host-gateway"]
  pgbackrest:
    extra_hosts: ["minio:host-gateway"]
EOF
export VPC_IP=127.0.0.1

log "building and starting the committed data-prod project"
dc build --quiet postgres pgbackrest
dc up -d postgres pgbackrest

# --- helpers ---------------------------------------------------------------------------
ready_count() {
  dc exec -T postgres sh -c 'ls /var/lib/postgresql/data/pg_wal/archive_status' | grep -c '\.ready$' || true
}
spool_count() {
  dc exec -T pgbackrest sh -c 'ls /var/log/pgbackrest/offsite-spool/repo2 2>/dev/null' | grep -c . || true
}
repo1_ls() { dc exec -T pgbackrest gosu postgres pgbackrest --stanza=ds --repo=1 repo-ls --recurse archive/ds; }
repo2_ls() { dc exec -T -u postgres pgbackrest /usr/local/bin/pgbackrest-repo.sh 2 repo-ls --recurse archive/ds; }
missing_in() { # <listing file> <segment>... → prints the segments absent from the listing
  local list=$1 seg
  shift
  for seg; do grep -q "/$seg-" "$list" || echo "$seg"; done
}
wait_for() { # <seconds> <description> <command...>
  local secs=$1 what=$2
  shift 2
  for _ in $(seq 1 "$secs"); do
    if "$@"; then return 0; fi
    sleep 1
  done
  fail "timed out after ${secs}s: $what"
}
SEGS=()
generate() { # <n> → appends the switched segment names to SEGS
  local i seg
  for i in $(seq 1 "$1"); do
    psql_ -c "insert into proof(v) values ($i)" >/dev/null
    seg=$(psql_ -c "select pg_walfile_name(pg_switch_wal())")
    SEGS+=("$seg")
  done
}
all_in_repo1() {
  repo1_ls >"$WORK/repo1.ls" 2>/dev/null || return 1
  [[ -z $(missing_in "$WORK/repo1.ls" "${SEGS[@]}") ]]
}

log "waiting for the sidecar entrypoint (stanza-create, check) and an empty archive backlog"
sidecar_up() { dc logs pgbackrest 2>&1 | grep -q 'starting cron'; }
no_ready() { [[ $(ready_count) == 0 ]]; }
spool_empty() { [[ $(spool_count) == 0 ]]; }
wait_for 240 "sidecar reached cron" sidecar_up
psql_ -c "create table proof(v int)" -c "create table proof_marker(v text)"
wait_for 240 "init WAL archived" no_ready
wait_for 240 "repo2 spool drained before the outage" spool_empty
psql_ -c "select pg_stat_reset_shared('archiver')" >/dev/null

# --- 1. repo2 dark: dead relay, then refused -------------------------------------------
log "1. repo2 SIGSTOPped (dead relay): 10 segments"
kill -STOP "$M2"
generate 10
log "1. repo2 killed (connection refused): 10 more segments"
stop_minio "$M2"
M2=
generate 10
log "1. waiting for all ${#SEGS[@]} segments in repo1"
for _ in $(seq 1 120); do all_in_repo1 && break; sleep 1; done
missing=$(missing_in "$WORK/repo1.ls" "${SEGS[@]}")
[[ -z $missing ]] || fail "repo1 is missing $(wc -w <<<"$missing") of ${#SEGS[@]} segments while repo2 is down: $(tr '\n' ' ' <<<"$missing")"
log "1. repo1 holds all ${#SEGS[@]}"
failed=$(psql_ -c "select failed_count from pg_stat_archiver")
[[ $failed == 0 ]] || fail "archive_command failed $failed times while repo2 was down"
wait_for 30 "no .ready backlog" no_ready
[[ $(spool_count) -ge ${#SEGS[@]} ]] || fail "repo2 spool holds $(spool_count), expected ${#SEGS[@]}"
log "1. archiver failures 0, no .ready backlog, repo2 spool $(spool_count)"

# --- 2. spool overflow -------------------------------------------------------------------
log "2. 10 more segments past the spool cap $SPOOL_MAX"
generate 10
for _ in $(seq 1 60); do all_in_repo1 && break; sleep 1; done
[[ -z $(missing_in "$WORK/repo1.ls" "${SEGS[@]}") ]] || fail "repo1 lost segments on spool overflow"
[[ $(psql_ -c "select failed_count from pg_stat_archiver") == 0 ]] || fail "archive_command failed on spool overflow"
spooled=$(spool_count)
[[ $spooled == "$SPOOL_MAX" ]] || fail "repo2 spool holds $spooled after overflow, expected the cap $SPOOL_MAX"
# archive_timeout or a checkpoint may add a segment of its own: read the spool itself.
dc exec -T pgbackrest sh -c 'ls /var/log/pgbackrest/offsite-spool/repo2' >"$WORK/spool.ls"
DROPPED=() KEPT=()
for seg in "${SEGS[@]}"; do
  if grep -qx "$seg" "$WORK/spool.ls"; then KEPT+=("$seg"); else DROPPED+=("$seg"); fi
done
((${#DROPPED[@]} >= ${#SEGS[@]} - SPOOL_MAX)) || fail "only ${#DROPPED[@]} segments left the spool past its cap"
[[ ${DROPPED[-1]} < ${KEPT[0]} ]] || fail "the spool dropped a newer segment than one it kept"
gap=$(dc exec -T pgbackrest cat /var/log/pgbackrest/offsite-spool/repo2.gap) || fail "no gap marker after overflow"
for seg in "${DROPPED[@]}"; do grep -q "dropped $seg" <<<"$gap" || fail "gap marker does not name dropped $seg"; done
log "2. spool at the cap, ${#DROPPED[@]} oldest dropped and recorded"

# --- 3. repo2 back: the pusher drains --------------------------------------------------
log "3. repo2 back; waiting for the pusher to drain the spool"
M2=$(start_minio m2 9001)
for _ in $(seq 1 240); do [[ $(spool_count) == 0 ]] && break; sleep 1; done
[[ $(spool_count) == 0 ]] || fail "the spool did not drain after repo2 came back"
repo2_ls >"$WORK/repo2.ls"
missing=$(missing_in "$WORK/repo2.ls" "${KEPT[@]}")
[[ -z $missing ]] || fail "repo2 is missing spooled segments: $missing"
for seg in "${DROPPED[@]}"; do grep -q "/$seg-" "$WORK/repo2.ls" && fail "dropped $seg is in repo2"; done
log "3. repo2 holds all ${#KEPT[@]} spooled segments, none of the ${#DROPPED[@]} dropped"

# --- 4. offsite backup + PITR from repo2 alone ----------------------------------------
log "4. full backup to repo2 (archive-check=y)"
dc exec -T pgbackrest /usr/local/bin/backup.sh full offsite 2 || fail "backup.sh full offsite 2 failed"
dc exec -T pgbackrest test ! -e /var/log/pgbackrest/offsite-spool/repo2.gap || fail "the gap marker survived a successful repo2 backup"
psql_ -c "insert into proof_marker values ('before-target')"
sleep 2
target=$(psql_ -c "select to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00'")
sleep 2
psql_ -c "insert into proof_marker values ('after-target')"
last=$(psql_ -c "select pg_walfile_name(pg_switch_wal())")
for _ in $(seq 1 240); do
  repo2_ls >"$WORK/repo2.ls" 2>/dev/null && grep -q "/$last-" "$WORK/repo2.ls" && break
  sleep 1
done
grep -q "/$last-" "$WORK/repo2.ls" || fail "segment $last did not reach repo2"
dc cp pgbackrest:/etc/pgbackrest/offsite/repo2/pgbackrest.conf "$WORK/repo2.conf"
grep -q '^repo1-' "$WORK/repo2.conf" && fail "the repo2 config knows repo1"
log "4. restoring to $target from repo2 alone"
docker volume create proof_restore >/dev/null
restored=$(docker run --rm --add-host minio:host-gateway \
  -v proof_restore:/var/lib/postgresql/data \
  -v "$WORK/repo2.conf:/etc/pgbackrest/pgbackrest.conf:ro" \
  --env-file "$WORK/repo2.env" -e TARGET="$target" \
  --entrypoint bash ds-pgbackrest:local -c '
    set -euo pipefail
    chown postgres:postgres /var/lib/postgresql/data
    chmod 0700 /var/lib/postgresql/data
    gosu postgres pgbackrest --stanza=ds --log-level-console=warn restore \
      --type=time --target="$TARGET" --target-action=promote >&2
    gosu postgres pg_ctl -D /var/lib/postgresql/data -w -t 300 -l /tmp/pg.log \
      -o "-c archive_mode=off -c listen_addresses= -c unix_socket_directories=/tmp" start >&2 ||
      { cat /tmp/pg.log >&2; exit 1; }
    for _ in $(seq 1 120); do
      [ "$(gosu postgres psql -h /tmp -U ds -d ds_prod -Atc "select pg_is_in_recovery()")" = f ] && break
      sleep 1
    done
    gosu postgres psql -h /tmp -U ds -d ds_prod -Atc "select coalesce(string_agg(v, \",\" order by v), \"\") from proof_marker"
  ') || fail "the PITR restore from repo2 failed"
[[ $restored == before-target ]] || fail "restored proof_marker is '$restored', expected 'before-target'"
log "4. PITR from repo2 alone: proof_marker = $restored"

# --- 5. control: native multi-repo archiving stalls repo1 (#2926) ---------------------
log "5. control: native repo1+repo2 async archive-push with repo2 down"
dc exec -T -u postgres postgres sh -c \
  "mkdir -p /tmp/native && { echo '[global]'; sed -n 's/^#repo2: //p' /etc/pgbackrest/pgbackrest.conf; } > /tmp/native/offsite.conf"
psql_ -c "alter system set archive_command = 'pgbackrest --stanza=ds --config-include-path=/tmp/native archive-push %p'" \
  -c "select pg_reload_conf()" >/dev/null
stop_minio "$M2"
M2=
sleep 5
SEGS=()
generate 20
sleep 120
repo1_ls >"$WORK/repo1.ls"
missing=$(missing_in "$WORK/repo1.ls" "${SEGS[@]}" | wc -l)
log "5. native multi-repo: repo1 is missing $missing of ${#SEGS[@]} segments after 120 s"
((missing > 0)) || fail "control: native multi-repo archiving did not stall repo1 — the harness no longer sees #2926 (a pgBackRest bump that fixes it? revisit this control)"
log "PASS"
