# Recovery after host loss (#3662)

This runbook keeps the DS production configuration and the backup decryption keys
recoverable when ds-api-prod, ds-data-prod or both are lost. It covers four things:
what must survive (the manifest), how the owner keeps the irreplaceable keys outside
both hosts (the recovery bundle), how the owner proves that the bundle actually opens
the backups (the restore proof), and the full host-loss path.

**Who runs it.** The agent has no shell on prod. The CI keys are forced-command only
(README → «SSH access model (#2984)»). Every on-host step below is run **by the owner**
over the `breakglass` key: ds-api-prod as `ssh breakglass@ds-api-prod`, ds-data-prod
as `ssh -J breakglass@ds-api-prod breakglass@192.168.0.10`. This runbook adds no key,
no sudo rule and no sshd change.

**Owner decision in force (2026-11-04).** Encrypted backups may be stored abroad on
the owner's risk. The binding condition is that the decryption keys are **never**
stored at the foreign provider, **never** in the same account as the ciphertext, and
**never** inside the bundle or bucket they unlock. Without the keys the ciphertext is
an unreadable block of files, not personal data.

**Nothing secret leaves custody.** No key value goes into chat, a GitHub Issue or PR,
Git, a CI log or a terminal transcript you share. Evidence is posted as fingerprints
(`sha256`), counts, labels and PASS/PARTIAL, never values. This follows the OWASP
[Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
(backup and recovery of secrets, no secrets in logs) and the
[Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
(keys stored apart from the data they protect). No new VM, Vault or HSM is introduced.

## 1. Manifest (2026-11-04)

### 1.1 Configuration and version metadata

| Item                                                                         | Where it lives                                                                                                                                                                                      | Secret?                        |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Live release SHA                                                             | GitHub Deployments (environment `production`) and the `release-*` tag / GitHub Release                                                                                                              | no                             |
| Image manifest of that SHA                                                   | the recorded `images-<sha>.json` (`tools/deploy/README.md`)                                                                                                                                         | no                             |
| Recorded data-prod image IDs + stanza identity                               | `/home/deploy/ds-platform-postgres-state.json` on ds-data-prod, key `images` (`tools/deploy/README.md`); lost with the box, so §2 records its `images` in the report                                | no                             |
| Infrastructure as code                                                       | `infra/deploy/terraform/` (Git); `terraform.tfstate` / `*.tfvars` are owner-local and carry the S3 keys — the BBM collection holds a copy under `Backups/bbm/2026-11-04T02-39-06Z/` (owner-private) | **yes** (tfstate)              |
| First-boot hardening                                                         | `infra/deploy/cloud-init/` (Git)                                                                                                                                                                    | no                             |
| Compose, Caddy, Centrifugo, Postgres and pgBackRest config                   | `infra/deploy/compose/` (Git), incl. `compose/data-prod/pgbackrest/pgbackrest.conf` (`repo1-cipher-type=aes-256-cbc`)                                                                               | no                             |
| Compose `.env` on ds-api-prod (`DEPLOY_SHA`, public `SMARTCAPTCHA_SITE_KEY`) | `~/ds-platform/infra/deploy/compose/api-prod/.env`; `DEPLOY_SHA` is rewritten by every release, the site key is public in the SmartCaptcha console                                                  | no                             |
| Runtime secrets                                                              | `/etc/ds-platform/{api,zitadel}.env` (+ tool-written `api-sign-in.env`, `internal.env`) on ds-api-prod; `/etc/ds-platform/data.env` on ds-data-prod; templates `infra/deploy/*.env.example`         | **yes** → recovery bundle (§2) |

### 1.2 Irreplaceable keys

These bind data that already exists. A new value does not restore access; the old
value must be in custody.

| Key                            | File (host)                 | What breaks without the old value                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PGBACKREST_REPO1_CIPHER_PASS` | `data.env` (ds-data-prod)   | The whole pgBackRest repository (every backup and every archived WAL segment, AES-256-CBC per `compose/data-prod/pgbackrest/pgbackrest.conf`) is unreadable: no restore, no PITR. The passphrase cannot be changed after `stanza-create` ([pgBackRest configuration](https://pgbackrest.org/configuration.html), `repo-cipher-pass`). |
| `ZITADEL_MASTERKEY`            | `zitadel.env` (ds-api-prod) | Zitadel cannot decrypt the secrets it stores encrypted at rest in its tables of the restored database, so the restored IdP instance does not start usable; rebuilding it means a new instance and every account's sign-in identity lost.                                                                                              |
| `SIGN_IN_RECORD_KEY`           | `api.env` (ds-api-prod)     | The AES-256-GCM records of the sign-in host (ADR-0015 §4) in the restored database cannot be decrypted.                                                                                                                                                                                                                               |
| `AUDIT_IDENTIFIER_PEPPER`      | `api.env` (ds-api-prod)     | New audit-ledger identifiers no longer match the HMACs already in the ledger for the same subject; audit continuity across the restore is broken («keep stable»).                                                                                                                                                                     |

### 1.3 Replaceable credentials

Every other key in the three templates. Each has a reissue path; the bundle still
carries the current values so a restore does not have to reissue them.

| Key(s)                                                                                                                                                   | Reissue path                                                                                                                                                                                                                        | Side effect of reissue                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ds` DB password: `POSTGRES_PASSWORD` (data.env) = the one in `DATABASE_URL` (api.env) = `ZITADEL_DATABASE_POSTGRES_{USER,ADMIN}_PASSWORD` (zitadel.env) | The restored cluster keeps the old role password, so after a restore either use the bundle value or `ALTER ROLE ds PASSWORD …` inside the cluster and write the same new value into all three files (README → «Apply order» step 6) | api and Zitadel restart                                                                                                               |
| `PGBACKREST_REPO1_S3_{BUCKET,ENDPOINT,KEY,KEY_SECRET}` (data.env), uploads S3 keys                                                                       | `terraform output -raw …` (README → «Apply order» step 6, DD-6; `infra/deploy/terraform/outputs.tf`); `PGBACKREST_REPO1_S3_REGION` is the fixed `ru-1`                                                                              | none for data; the bucket name must stay the one holding the repo                                                                     |
| `IDP_SERVICE_TOKEN`                                                                                                                                      | a new PAT of the `ds-bootstrap` machine user (README → Zitadel init step)                                                                                                                                                           | none                                                                                                                                  |
| `IDP_CLIENT_ID` / `IDP_CLIENT_SECRET` / `IDP_PROJECT_ID`                                                                                                 | `idp/provision.sh` (README → init step)                                                                                                                                                                                             | in-flight OIDC logins restart                                                                                                         |
| `IDP_ACADEMY_CLIENT_KEY` / `IDP_DOCTOR_CLIENT_KEY` / `INTERNAL_API_TOKEN` (`api-sign-in.env`, `internal.env`)                                            | tool-written: the release's pre-swap IdP converge (`provision.sh` step 3.bis.2) re-mints them                                                                                                                                       | none beyond the release                                                                                                               |
| `IDP_WEBHOOK_SECRET`                                                                                                                                     | `openssl rand -hex 32` into api.env and the Zitadel Action                                                                                                                                                                          | mirror sync 401s until both match; the periodic sweep backstops it                                                                    |
| `LIFECYCLE_IMPACT_TOKEN_SECRET`                                                                                                                          | `openssl rand -hex 32`                                                                                                                                                                                                              | in-flight taxonomy preview tokens are invalid; operators re-confirm                                                                   |
| `CENTRIFUGO_API_KEY` + `CENTRIFUGO_HTTP_API_KEY`; `CENTRIFUGO_TOKEN_HMAC_SECRET` + `CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY`                             | `openssl rand -hex 32` each; each pair byte-equal                                                                                                                                                                                   | rotating the HMAC is a **deliberate session invalidation** of every live realtime connection token; clients reconnect with new tokens |
| `IDP_SMTP_REAL_PASSWORD`                                                                                                                                 | a new app password in the mail provider's console (`smtp-activation.md`)                                                                                                                                                            | mail stops until both api and Zitadel (`provision.sh`) have it                                                                        |
| `SMSAERO_EMAIL` / `SMSAERO_API_KEY`                                                                                                                      | the SMS Aero console                                                                                                                                                                                                                | none                                                                                                                                  |
| `SMARTCAPTCHA_SERVER_KEY`                                                                                                                                | the SmartCaptcha console (server half; the site half goes in the compose `.env`)                                                                                                                                                    | none                                                                                                                                  |
| `SENTRY_DSN`                                                                                                                                             | the GlitchTip project UI (README → «GlitchTip error monitoring»)                                                                                                                                                                    | none (optional; absent ⇒ no-op)                                                                                                       |

The remaining template entries (`REDIS_URL`, `IDP_ISSUER`, `IDP_REDIRECT_URI`,
origins, delivery modes, `CONGRESS_SIGNUP_*`, `SMSAERO_SIGN`, `CENTRIFUGO_URL`,
`BOT_PROTECTION_ENABLED`, `ZITADEL_DATABASE_POSTGRES_HOST`, …) are configuration,
not secrets; their values are in the templates or derive from the environment.

### 1.4 Gaps (2026-11-04)

- **Custody not yet populated.** The recovery bundle (§2) has not been built; until
  the owner runs §2, a loss of ds-data-prod loses `PGBACKREST_REPO1_CIPHER_PASS` and
  with it every backup.
- **Restore proof not yet run.** §3 has not been executed with a bundle-supplied
  passphrase. An S3 listing or object checksum is **not** accepted as proof: only a
  completed restore that recovers and promotes is.
- **Fresh-host DR drill not run.** §4 (recreate both boxes and restore) has never
  been exercised end to end; it, backup verification, alerts and a quarterly drill
  are #3671.
- **One provider, no immutability.** The repository lives in one Timeweb S3 bucket
  with no Object Lock (#3669), and there is no second repository (`repo2` at a
  foreign provider, #3670) yet. The spec's backup topology is rewritten in #3672.
- **Automation.** §3 is the manual, owner-run equivalent of the `rehearse-migration`
  throw-away restore that Issue #3648 automates on ds-data-prod.
- **`--network none` stops WAL replay.** The spec's throw-away copy runs
  `--network none`, but its `restore_command` (`pgbackrest archive-get`) needs the
  S3 repository, so recovery ends at the backup's consistency point (§3.2) — #3648.

Owner-private evidence (named only, never copied here): `outputs/2026-11-04-local-backup/report.json`
and `outputs/2026-11-04-backup-implementation-plan/plan.json` (BBM workspace),
`Backups/bbm/2026-11-04T02-39-06Z`; BBMP-272
`plane.bbm.academy/bbm/projects/e550afb5-ec05-4973-8456-49a74379ba2f/issues/5bfd979a-c108-4e68-9081-77929989da9a`.

## 2. Recovery bundle (owner-run)

The bundle is the set of `/etc/ds-platform/*.env` files of both hosts, encrypted with
[`age`](https://age-encryption.org) to **two independent recipients**:

- **Custody A** — an `age` identity kept in the owner's password manager.
- **Custody B** — a second identity on a sealed offline paper copy, held by a
  **second custodian** (default: the Product Lead) in a different physical location
  from A, so recovery survives the owner's unavailability. The owner may substitute
  another trusted custodian; record the custodian's role (never the value) on #3662.

It is deliberately **not** encrypted to the `breakglass` SSH key: losing or rotating
the access key must not lose recovery, and one compromised key must not open both.
Either identity alone opens the bundle.

**Workstation prerequisite.** `winget install FiloSottile.age` (provides `age` and
`age-keygen`); the commands below run in Git Bash. Plaintext secrets never land on
the workstation disk: they only pass through pipes.

**Shell.** Every binary pipe in §2–§3 runs in Git Bash, never in PowerShell 5.1: its
pipes re-encode the stream as text and corrupt `tar` and `age` data. `age -p`,
`age -d` with a passphrase identity and `age-keygen -y` read the console directly, so
they need a real console: use Git Bash inside Windows Terminal, or, in Git Bash's
default mintty window, first start `winpty bash` and run every block inside that
shell. Each block starts with `set -o pipefail`, so a failing left side of a pipe
fails the whole command instead of feeding `age` empty input. A native Windows
program ends console input on Ctrl-Z, Enter.

### 2.1 Generate the identities (once; again only if one is lost or exposed)

```bash
set -o pipefail
# Custody A: the identity is passphrase-encrypted before it touches disk.
age-keygen | age -p -o identity-A.age
# The recipient is derived from the identity itself, through a pipe only.
age -d identity-A.age | age-keygen -y > A.pub
# Store identity-A.age (attachment) and its passphrase in the password manager entry.

# Custody B: the identity goes to the terminal only; copy it by hand onto paper.
age-keygen
# Type the paper copy back in (Ctrl-Z, Enter): this both checks the transcription and
# derives the recipient. A typo yields an error or a recipient B's paper cannot open,
# which the test decrypt in §2.2 catches before the paper is sealed.
age-keygen -y > B.pub
# Clear the terminal scroll-back. Keep the paper unsealed until the §2.2 test decrypt.
```

`A.pub` / `B.pub` hold the public recipients (one `age1…` line each, no prefix). They
are not secret, but they are not committed either: keep them beside the bundle.

### 2.2 Build the bundle (after every rotation or new key)

One bundle per host, streamed straight from `tar` into `age`. `/etc/ds-platform` is
`0700 root`, so the `cd`, the glob and the `tar` all run inside one root shell on the
host; `set -e` there and `pipefail` here make any failure fail the pipe:

```bash
set -o pipefail
D=$(date -u +%Y-%m-%d)
TAR="sudo sh -c 'set -e; cd /etc/ds-platform && tar -cf - *.env'"
ssh breakglass@ds-api-prod "$TAR" \
  | age -R A.pub -R B.pub -o "ds-recovery-$D-api-prod.tar.age" \
  || { echo "FAIL api-prod bundle"; rm -f "ds-recovery-$D-api-prod.tar.age"; }
ssh -J breakglass@ds-api-prod breakglass@192.168.0.10 "$TAR" \
  | age -R A.pub -R B.pub -o "ds-recovery-$D-data-prod.tar.age" \
  || { echo "FAIL data-prod bundle"; rm -f "ds-recovery-$D-data-prod.tar.age"; }

# Hard gate: the member list (names, never values) must hold every expected file.
# Missing file, empty list or unreadable bundle = FAIL, and the bundle is discarded.
gate() { # <bundle> <expected member>...
  f=$1; shift
  list=$(age -d -i identity-A.age "$f" | tar -tf -) && [ -n "$list" ] \
    || { echo "FAIL $f: unreadable or empty"; rm -f "$f"; return 1; }
  for m in "$@"; do
    printf '%s\n' "$list" | grep -qx "$m" || { echo "FAIL $f: no $m"; rm -f "$f"; return 1; }
  done
  echo "OK $f"; printf '%s\n' "$list"
}
gate "ds-recovery-$D-api-prod.tar.age" api.env zitadel.env
gate "ds-recovery-$D-data-prod.tar.age" data.env
```

`api.env` and `zitadel.env` are required in the first (`api-sign-in.env` and
`internal.env` also appear once a release has written them), `data.env` in the second.
On any FAIL, fix the cause and rebuild; never keep a bundle that failed the gate.

**Test decrypt with B (when B is created, before sealing the paper).** Type B's paper
copy into `age` as the identity (Ctrl-Z, Enter); the plaintext only goes through the
pipe to `tar -tf -`, which prints names:

```bash
set -o pipefail
age -d -i - "ds-recovery-$D-data-prod.tar.age" | tar -tf -   # expect: data.env
```

The same member list as with A = custody B proven; seal the paper and hand it to the
second custodian. Anything else: B was mis-transcribed, so regenerate B (§2.1) and
rebuild both bundles.

### 2.3 Fingerprint-verify each irreplaceable key

Compare the `sha256` of a key's value read on the host with the same value taken from
the decrypted bundle. The keys are high-entropy, so the hash reveals nothing usable;
post only `match` / `mismatch`.

```bash
set -o pipefail
fp() { sed -n "s/^$1=//p" | tr -d '\r\n' | sha256sum | cut -c1-16; }
# host side
ssh -J breakglass@ds-api-prod breakglass@192.168.0.10 \
  "sudo sed -n 's/^PGBACKREST_REPO1_CIPHER_PASS=//p' /etc/ds-platform/data.env | tr -d '\r\n' | sha256sum | cut -c1-16"
# bundle side
age -d -i identity-A.age "ds-recovery-$D-data-prod.tar.age" | tar -xOf - data.env | fp PGBACKREST_REPO1_CIPHER_PASS
```

Repeat for `ZITADEL_MASTERKEY` (`zitadel.env`), `SIGN_IN_RECORD_KEY` and
`AUDIT_IDENTIFIER_PEPPER` (`api.env`) against ds-api-prod. All four must match.
Custody B is proven by the one-time test decrypt in §2.2; later bundles are encrypted
to the same `B.pub`.

### 2.4 Store the ciphertext

- At least **two** places, each independent of both prod hosts — for example an
  owner-held encrypted offline drive and a personal cloud drive.
- **Never** at the backup provider or in its account (no Timeweb S3, no future
  `repo2` bucket), never in the password-manager vault that holds identity A, never
  next to paper copy B: the ciphertext is never stored with an identity that opens it.
- Never in Git, a GitHub Issue/PR/artifact, chat or a CI log.
- Keep the previous bundle until the new one is verified (§2.3), then delete it.

**Rebuild trigger.** Any change to a file under `/etc/ds-platform/` on either host —
a rotation, a new key in a template, a reissue from §1.3 — is followed by §2.2–§2.4
in the same session.

## 3. Restore proof (owner-run, ds-data-prod)

Proves that the bundle's `PGBACKREST_REPO1_CIPHER_PASS` opens the live repository by
completing a real restore into a throw-away cluster. An S3 listing or an object
checksum is not a proof. The run stays on ds-data-prod, so restored personal data
stays in RF and never reaches the workstation. It reuses the throw-away restore
mechanics of the release-pipeline spec
(`apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md`,
«Headroom check» and «Restore target.») and the README «Rollback» restore command.
It never joins the prod compose project, never publishes a port and never archives
into the prod stanza; the prod cluster is only asked for the WAL switch of `check`.

### 3.1 Stage the bundle's data.env on tmpfs

From the workstation. The passphrase comes **from the bundle**, not from
`/etc/ds-platform/data.env`:

```bash
set -o pipefail
age -d -i identity-A.age "ds-recovery-$D-data-prod.tar.age" | tar -xOf - data.env \
  | ssh -J breakglass@ds-api-prod breakglass@192.168.0.10 \
    'sudo install -d -m 700 /run/ds-recovery && sudo sh -c "umask 077; cat > /run/ds-recovery/restore.env"'
```

### 3.2 Restore (breakglass session on ds-data-prod)

```bash
ENVF=/run/ds-recovery/restore.env
CONF=/home/deploy/ds-platform/infra/deploy/compose/data-prod/pgbackrest/pgbackrest.conf
SCRATCH=/var/lib/ds-platform/recovery-proof/$(date -u +%Y%m%dT%H%M%SZ)
# The recorded image IDs: the postgres and pgbackrest entries under `images`
# (read by eye; jq is not assumed on the host).
sudo cat /home/deploy/ds-platform-postgres-state.json
PG_IMAGE='<postgres image id from images>'
BR_IMAGE='<pgbackrest image id from images>'
# Exact volume names of the fixed compose project `ds-data-prod`, matched by label.
vol() { sudo docker volume ls -q --filter label=com.docker.compose.project=ds-data-prod \
  --filter "label=com.docker.compose.volume=$1"; }
PGDATA_VOL=$(vol pgdata); PGSOCK_VOL=$(vol pgsocket)
[ "$PGDATA_VOL" = ds-data-prod_pgdata ] && [ "$PGSOCK_VOL" = ds-data-prod_pgsocket ] \
  || echo "STOP: volumes are not exactly ds-data-prod_pgdata / ds-data-prod_pgsocket"
# The pgbackrest image's own entrypoint ignores its command (it runs stanza-create,
# check and then `exec cron -f`, a second backup scheduler). No container in this
# procedure may run that default entrypoint: every one-shot run overrides it and is --rm.
BR="sudo docker run --rm --memory 768m --memory-swap 768m --oom-score-adj 1000 --env-file $ENVF -v $CONF:/etc/pgbackrest/pgbackrest.conf:ro --user postgres --entrypoint pgbackrest"

# 1. Backup point: label, type, WAL range, database size (read with the bundle pass).
#    Note the timeline (first 8 hex digits of the archive max) and count the
#    timeline history files: both are compared again after teardown (§3.4).
$BR "$BR_IMAGE" --stanza=ds --log-level-file=off info
$BR "$BR_IMAGE" --stanza=ds --log-level-file=off repo-ls --recurse --filter='\.history$' archive/ds

# 2. Headroom: go on only if free >= 1.5 x the database size + 2 GiB
#    and MemAvailable >= 1 GiB (spec «Headroom check»)
sudo install -d -m 700 /var/lib/ds-platform/recovery-proof
df -h --output=avail /var/lib/ds-platform/recovery-proof
grep MemAvailable /proc/meminfo

# 3. check: forces a WAL switch (pg_switch_wal) on the live cluster and waits until
#    that segment is archived. Record the segment name it prints as SEG: it is newer
#    than the backup, so the copy can only reach it by replaying WAL from the archive.
$BR -v "$PGDATA_VOL":/var/lib/postgresql/data:ro -v "$PGSOCK_VOL":/var/run/postgresql \
  "$BR_IMAGE" --stanza=ds --log-level-file=off check 2>&1 | tee /dev/stderr \
  | grep -o 'WAL segment [0-9A-F]\{24\} successfully archived'
SEG='<the 24-hex segment from the line above>'

# 4. Restore into the scratch directory (uid 999 = postgres in both images)
sudo install -d -o 999 -g 999 -m 700 "$SCRATCH/pgdata"
$BR -v "$SCRATCH/pgdata":/var/lib/postgresql/data "$BR_IMAGE" \
  --stanza=ds --log-level-file=off --type=default --archive-mode=off restore

# 5. Start the isolated copy: socket only, no published port, never archives
sudo docker run -d --rm --name ds-recovery-pg \
  --memory 768m --memory-swap 768m --oom-score-adj 1000 \
  --env-file "$ENVF" -v "$CONF":/etc/pgbackrest/pgbackrest.conf:ro \
  -v "$SCRATCH/pgdata":/var/lib/postgresql/data \
  "$PG_IMAGE" postgres -c listen_addresses='' -c archive_mode=off \
  -c shared_buffers=128MB -c max_connections=10
```

**Network of the copy.** The copy replays archived WAL through the `restore_command`
that `pgbackrest restore` wrote (`pgbackrest archive-get` from the S3 repository),
which needs egress. The copy therefore runs on Docker's default bridge, not the
compose network, with no published port and `listen_addresses=''`. With
`--network none`, as the spec's rehearsal states, `archive-get` cannot reach the
repository and the recovery stops at the backup's own consistency point; record
that as PARTIAL.

### 3.3 Checks

```bash
PSQL="sudo docker exec ds-recovery-pg psql -U ds -d ds_prod -At"
sudo docker logs ds-recovery-pg 2>&1 | grep -E 'archive recovery complete|selected new timeline|ready to accept connections'
# WAL replay from the archive (and so WAL decryption): SEG from step 3 restored,
# and the LSN where redo ended.
sudo docker logs ds-recovery-pg 2>&1 | grep -F "restored log file \"$SEG\" from archive"
sudo docker logs ds-recovery-pg 2>&1 | grep -E 'redo done at [0-9A-F]+/[0-9A-F]+'
$PSQL -c 'select pg_is_in_recovery()'   # f = recovered and promoted
$PSQL -c 'select version()'
$PSQL -c 'select count(*), max(created_at) from drizzle.__drizzle_migrations'
$PSQL -c "select datname from pg_database where datname in ('ds_prod', 'zitadel')"
$PSQL -c '\dt'   # pick three core tables, then: select count(*) from <table>;  (counts only)
# Optional structural check on a small set; it writes only into the throw-away copy.
sudo docker exec ds-recovery-pg pg_amcheck -U ds -d ds_prod --install-missing -t 'drizzle.*'
```

PASS needs: restore exit 0; the log line `restored log file "<SEG>" from archive` for
the segment step 3 forced, which proves that WAL newer than the backup end was fetched
from the archive, decrypted and replayed (the recovery-complete line and
`pg_is_in_recovery()` = `f` alone also appear when `archive-get` fails and recovery
stops at the backup's own end); the recovery-complete log line; `pg_is_in_recovery()`
= `f`; the migration journal readable; both databases present and the three counts
non-zero. Anything less is PARTIAL with the reason.

### 3.4 Teardown (always, PASS or not)

```bash
sudo docker stop ds-recovery-pg               # --rm removes the container
sudo docker ps -a --filter name=ds-recovery   # expect no rows
sudo rm -rf "$SCRATCH"
```

Then confirm the copy left the prod stanza untouched, with the same `$BR` before the
env file is removed: the timeline (first 8 hex digits of the archive max) equals the
one noted in step 1, and the count of `.history` files is unchanged. A new timeline or
history file means the copy archived into the prod stanza: report it as a FAIL of the
procedure and open an Issue before the next run.

```bash
$BR "$BR_IMAGE" --stanza=ds --log-level-file=off info
$BR "$BR_IMAGE" --stanza=ds --log-level-file=off repo-ls --recurse --filter='\.history$' archive/ds
sudo rm -f /run/ds-recovery/restore.env && sudo rmdir /run/ds-recovery
```

### 3.5 Report template (sanitised, posted to #3662)

```text
Restore proof — <YYYY-MM-DD HH:MM UTC> — ds-data-prod — owner-run over breakglass
Passphrase source: recovery bundle <date> (custody A); key fingerprints matched: <n>/4
Backup point: label <…>, type <full|incr>, WAL range <start>–<stop>
Versions: pgBackRest <x.y>; PostgreSQL <x.y>
Images: postgres <sha256:first 12>, pgbackrest <sha256:first 12>; equal to state file `images`: <yes|no>
Headroom: free <GiB> vs needed <GiB>; MemAvailable <GiB>
WAL proof: check segment SEG <24 hex>; restored from archive <yes|no>; redo done at <LSN>
Checks: check <ok>; restore exit <0>; recovery complete <yes>; pg_is_in_recovery <f>;
  drizzle migrations <count> / <max created_at>; databases ds_prod + zitadel <yes>;
  counts <table>=<n>, <table>=<n>, <table>=<n>; pg_amcheck <ok|skipped>
Teardown: container gone, scratch removed, /run env removed: <yes>
Prod stanza after teardown: timeline <before>/<after> equal <yes>; .history files <before>/<after> equal <yes>
Limitations: <e.g. recovery to backup end only; fresh-host drill not run>
Verdict: PASS | PARTIAL (<reason>)
```

No key value, row content or personal data goes into the report.

## 4. Full host-loss path

Each step is an existing section; this list only orders them.

1. **Recreate the boxes.** Terraform in `infra/deploy/terraform/` with the
   owner-local tfstate/tfvars (§1.1), then README → «Apply order» up to step 5
   (cloud-init, SSH access model, Docker Hub login, the tree).
2. **Secrets.** «Apply order» step 6, each file filled **from the recovery bundle**
   (decrypt into a pipe to `sudo sh -c "umask 077; cat > /etc/ds-platform/<file>"`).
   The four keys of §1.2 must be the old values; reissue only what §1.3 allows.
3. **Data before the first postgres boot** (ds-data-prod lost). Build the data images
   («Apply order» step 7), then restore into the empty `pgdata` volume **before**
   `postgres` first starts: a first boot on an empty volume runs `initdb` and creates
   a new cluster the stanza does not match. `sudo docker compose create` makes the
   labelled volumes without starting anything; then run the README «Rollback» restore
   `docker run` (it overrides the sidecar entrypoint and needs no running postgres;
   skip its `compose stop`), then `sudo docker compose up -d` and
   `pgbackrest --stanza=ds info`. The release guard records a new
   `ds-platform-postgres-state.json` on its first successful run
   (`tools/deploy/README.md`).
4. **App.** The live SHA from §1.1 through `deploy-prod.yml` (README → «Release»),
   then README → «Verify-on-box». The `ds` role keeps its restored password (§1.3).
5. **Afterwards.** Rebuild the bundle (§2) if any value changed, and record the drill
   outcome on #3671.

Related: `infra/deploy/README.md` («Apply order», «Rollback»),
`infra/deploy/compose/data-prod/README.md` («Secrets»),
`infra/deploy/compose/data-prod/pgbackrest/pgbackrest.conf`.
