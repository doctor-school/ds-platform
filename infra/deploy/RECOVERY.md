# Recovery after host loss (#3662)

This runbook keeps the DS production configuration and the backup decryption keys
recoverable when ds-api-prod, ds-data-prod or both are lost. It covers four things:
what must survive (the manifest), how CI keeps the irreplaceable keys outside both
hosts in a bundle only the custodians can open (the recovery bundle), how the bundle is
proven to open the backups (the restore proof), and the full host-loss path.

**Who runs it.** Routine custody runs in CI with no person and no workstation:
Actions `recovery-custody.yml` over the prod read key, whose forced command allows only
fixed verbs (README → «SSH access model (#2984)»). People act in three places only: the
custodian ceremony (§2.1), each custodian's quarterly test decrypt (§2.2) and recovery
after host loss (§2.3, §4); the restore proof (§3) adds one digest comparison by a
custodian to an automated drill. The agent has no shell on prod; every on-host step of
the manual fallback (§3) and the host-loss path (§4) is run **by the owner** over the
`breakglass` key: ds-api-prod as `ssh breakglass@ds-api-prod`, ds-data-prod as
`ssh -J breakglass@ds-api-prod breakglass@192.168.0.10`. This runbook adds no key, no
sudo rule and no sshd change.

**Owner decision in force (2026-11-04).** Encrypted backups may be stored abroad on
the owner's risk. The binding condition is that the decryption keys are **never**
stored at the foreign provider, **never** in the same account as the ciphertext, and
**never** inside the bundle or bucket they unlock. Without the keys the ciphertext is
an unreadable block of files, not personal data.

**Nothing secret leaves custody.** No key value goes into chat, a GitHub Issue or PR,
Git, a CI log or a terminal transcript you share. Evidence is posted as fingerprints
(`sha256`), counts, labels and PASS/PARTIAL/FAIL, never values. This follows the OWASP
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
| Recorded data-prod image IDs + stanza identity                               | `/home/deploy/ds-platform-postgres-state.json` on ds-data-prod, key `images` (`tools/deploy/README.md`); lost with the box, so §3 records its `images` in the report                                | no                             |
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

### 1.4 Gaps (2026-11-11)

- **Bus factor open.** Both custody keys are the owner's; recovery does not yet survive
  the owner's unavailability. It closes when a second custodian (another person,
  another location) is added (§2.1 «Adding a custodian»), tracked in #3953.
- **No separate physical location.** Both identities are reachable from the owner's
  home: key 2 lives on the owner's home file server, not in a separate place (§2.1
  «Current custody»). The second custodian (#3953) closes it.
- **Fresh-host DR drill not run.** §4 (recreate both boxes and restore) has never
  been exercised end to end; it, backup verification, alerts and a quarterly drill
  are #3671.
- **One provider, no immutability.** The repository lives in one Timeweb S3 bucket
  with no Object Lock (#3669), and there is no second repository (`repo2` at a
  foreign provider, #3670) yet. The spec's backup topology is rewritten in #3672.
- **Restore proof runs on the source host.** The automated drill (§3) restores a
  throw-away copy on ds-data-prod itself; a restore onto a different host is the
  fresh-host drill above.
- **The copy needs egress for WAL replay.** A throw-away copy's `restore_command`
  (`pgbackrest archive-get`) reads the S3 repository, so under `--network none`
  recovery ends at the backup's consistency point (§3.2). This copy and the spec's
  rehearsal both run on Docker's default bridge; the rehearsal also refuses a copy
  that did not replay to the WAL switch of its `pgbackrest check` (#3648).

Owner-private evidence (named only, never copied here): `outputs/2026-11-04-local-backup/report.json`
and `outputs/2026-11-04-backup-implementation-plan/plan.json` (BBM workspace),
`Backups/bbm/2026-11-04T02-39-06Z`; BBMP-272
`plane.bbm.academy/bbm/projects/e550afb5-ec05-4973-8456-49a74379ba2f/issues/5bfd979a-c108-4e68-9081-77929989da9a`.

## 2. Recovery bundle

The bundle of a box is the set of its `/etc/ds-platform/*.env` files, encrypted with
[`age`](https://age-encryption.org) to every recipient in
`infra/deploy/recovery/custodians.txt`: at least **two custodians** in different
locations, each holding one offline identity. Either identity alone opens the bundle,
so recovery survives the unavailability of any one person (not yet: both current keys
are the owner's and reachable from the owner's home, §2.1 «Current custody»). It is deliberately **not**
encrypted to the `breakglass` SSH key: losing or rotating the access key must not lose
recovery, and one compromised key must not open both.

### Automated custody (CI)

Actions `recovery-custody.yml` uses the prod read key (`ds-read-entrypoint` on
ds-api-prod, the same key and forced command as `prod-observe.yml`) and runs two verbs
(spec `apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md`
§5 «Prod read verbs.»), both executed on the boxes by `infra/deploy/bin/ds-recovery`:

- **`recovery-bundle`, weekly.** Each prod box streams its own `/etc/ds-platform/*.env`
  from `tar` into `age`, encrypted to the custodians' **public** recipients. A member
  gate refuses a bundle without `api.env` and `zitadel.env` (ds-api-prod) or
  `data.env` (ds-data-prod). ds-data-prod stores each box's files in the pgBackRest
  bucket, apart from the pgBackRest repository, under:
  - `recovery-bundle/<box>/<stamp>.tar.age` — the ciphertext (`<box>` is `api-prod`
    or `data-prod`, `<stamp>` the UTC time `YYYYMMDDTHHMMSSZ`);
  - `recovery-bundle/<box>/<stamp>.manifest.json` — the manifest: `members`, the
    sha256 of the custodians file, `bundle.object` / `bundle.bytes` /
    `bundle.sha256` of the ciphertext, and keyed (HMAC) fingerprints of every key,
    never a value or a plain hash of one;
  - `recovery-bundle/<box>/latest.json` — a copy of the newest manifest, written only
    after its bundle object is stored at the manifest's size.
- **`recovery-check`, daily.** Each box compares its live fingerprints, its member
  list and the custodians file with its latest manifest and answers `MATCH`,
  `MISMATCH <what>`, `STALE <n>d` (older than 8 days) or `MISSING`. Any answer but
  `MATCH` on both boxes fails the job.

Nothing automated can decrypt a bundle: no box, no CI job and no agent holds an
identity. The log carries status lines only; the repository is public and no artifact
is uploaded. Nothing on the boxes deletes old bundles; a provider lifecycle rule on
the prefix is tracked in `DEBT.md`.

**A bucket failure.** A failed bucket call fails the verb with one fixed reason,
`ds-recovery: the upload to the bucket failed (<why>)` or
`ds-recovery: the bucket read failed (<why>)`, where `<why>` is either `HTTP <code>`,
the bucket's own answer, or `curl exit <n>`,
curl's own exit status when no answer came back (for example 6 = host name not
resolved, 7 = no connection, 28 = time-out, 35 or 60 = TLS; the full list:
<https://curl.se/docs/manpage.html#EXIT>). The reason carries only that number:
curl's own message may name the endpoint, so it is discarded.

**No recipient line.** While `custodians.txt` holds no recipient line at all (only
comments and blank lines), a scheduled run ends green without contacting the boxes and
leaves the notice «custodian ceremony pending (#3662)» in the log and the job summary;
a dispatched run reaches the boxes, which refuse with «#3662 custodian ceremony
pending», and fails. Once any recipient line is present, valid or not, every scheduled
run reaches the boxes, so a broken file after the ceremony (a typo, a plugin
recipient, a removed custodian leaving fewer than two) fails red there. The box gate's
rule: two distinct native recipients, nothing but comments besides them.

**After a change.** Any change to a file under `/etc/ds-platform/` on either box — a
rotation, a new key, a reissue from §1.3 — makes the next daily check report
`MISMATCH`. Dispatch `recovery-bundle`, then `recovery-check`, in the same session:

```bash
gh workflow run recovery-custody.yml --ref main -f verb=recovery-bundle
gh workflow run recovery-custody.yml --ref main -f verb=recovery-check
```

### 2.1 The custodian ceremony (the only human step of CI custody)

Runs once, and again only when a custodian changes or an identity is lost or exposed.

**Current custody (interim).** The first ceremony ran with two identities both held by
the owner: key 1 in the owner's password manager, key 2 as a passphrase-encrypted
identity file on the owner's home file server, reachable only on the home network and
not always powered on. `custodians.txt` records them as
`# role: owner — key 1 (password manager)` and
`# role: owner — key 2 (offline media, separate location)`; the key 2 label is
corrected together with the next `custodians.txt` change (#3953), because any edit
changes the file's sha256 and so needs a release plus `recovery-bundle` and
`recovery-check`, which a label alone does not justify. The box gate counts
distinct recipients only, so this satisfies it; the bus factor stays open until a
second custodian is added (below, #3953).

1. Each of the two custodians generates an `age` identity on their own offline
   machine. The identity is passphrase-encrypted before it touches disk, and its
   recipient is derived from it through a pipe only:

   ```bash
   set -o pipefail
   age-keygen | age -p -o <identity>.age
   age -d <identity>.age | age-keygen -y    # prints the public recipient age1…
   ```

   The custodian keeps `<identity>.age` and its passphrase apart (for example the file
   offline and the passphrase in their password manager) and a sealed paper copy of
   the identity in another place. The identity never touches a box, a repository, the
   provider's account or a chat.

2. Each custodian hands over only the public recipient (`age1…`, native X25519; the
   boxes carry no age plugin, so plugin recipients are refused).
3. A PR adds both recipients to `custodians.txt`, each under a `# role: <role>` line.
   Roles are recorded, never names.
4. After the merge and the next release (the boxes read `custodians.txt` from their
   deployed tree), dispatch `recovery-bundle` and then `recovery-check` (above). Each
   custodian test-decrypts the first bundle (§2.2) before the paper copy is sealed.

**Adding a custodian** (another person, another location; closes the bus factor;
tracked in #3953). The
new custodian runs step 1 on their own offline machine and hands over the recipient
(step 2). A PR adds it to `custodians.txt` under its own `# role: <role>` line (and,
if the new custodian replaces an owner key, removes that key's two lines; at least
two distinct recipients remain). After the merge and the next release, dispatch
`recovery-bundle` and then `recovery-check`; the new custodian test-decrypts the new
bundle (§2.2) and posts the status line on #3953. Bundles stored before the change
stay encrypted to the old recipients only.

### 2.2 Quarterly test decrypt (each custodian)

Every quarter, and once after the ceremony, each custodian fetches the latest bundle
of both boxes (§2.3, steps 1–2) and lists its members (§2.3, step 3) without
extracting anything. The result is posted on #3671 as status words only:
`custodian <role>: api-prod members <n> OK, data-prod members <n> OK`. A custodian
whose identity no longer opens the bundle reports `FAIL`, and the ceremony is rerun
for that custodian.

The owner's two interim keys (§2.1) are tested one at a time, each in Git Bash under
the rules of §2.3 «Shell», on the bundle fetched in §2.3 steps 1–2:

```bash
set -o pipefail
# Key 1 (password manager): paste the AGE-SECRET-KEY-1… line as the identity on
# stdin, then Ctrl-Z, Enter; the identity never touches disk.
age -d -i - "$BOX.tar.age" | tar -tf -
# Key 2 (home file server, on the home network): age asks for the identity file's passphrase.
age -d -i custodian-2.age "$BOX.tar.age" | tar -tf -
```

`age -i` accepts a passphrase-encrypted identity file and prompts for its passphrase
(age ≥ 1.1, README «Passphrase-protected key files»,
<https://github.com/FiloSottile/age#passphrase-protected-key-files>); `-i -` reads the
identity from standard input. Both lists must equal the manifest's `members`.

### 2.3 Recovery time: fetch and decrypt a bundle

After host loss the bundles are still in the bucket: they live there, not on a box.
Run in Git Bash on the custodian's workstation (Windows: `winget install
FiloSottile.age`); plaintext never lands on disk and only passes through pipes.

**Shell.** Every binary pipe runs in Git Bash, never in PowerShell 5.1: its pipes
re-encode the stream as text and corrupt `tar` and `age` data. `age -d` with a
passphrase identity reads the console directly, so it needs a real console: use Git
Bash inside Windows Terminal, or, in Git Bash's default mintty window, first start
`winpty bash` and run every block inside that shell. Each block starts with
`set -o pipefail`, so a failing left side of a pipe fails the whole command instead of
feeding `age` empty input.

**Bucket access** does not come from the bundle (the bundle holds `data.env`, which
holds the box's S3 keys): read the bucket with the provider account's own S3 keys
(`terraform output -raw …` from the owner-local tfstate, §1.1, or the provider
console). The bucket name and endpoint are `PGBACKREST_REPO1_S3_BUCKET` /
`PGBACKREST_REPO1_S3_ENDPOINT` of `data.env.example` / the Terraform outputs; that value
is `host`, `host:port` or `https://host[:port]`, and `<endpoint>` below is its
`host[:port]` alone.

1. **Fetch the latest manifest of the box** (any S3 client; the AWS CLI shown, the keys
   in its environment, never on the command line):

   ```bash
   set -o pipefail
   BOX=data-prod   # or api-prod
   S3="aws s3 --endpoint-url https://<endpoint> --region ru-1"
   $S3 cp "s3://<bucket>/recovery-bundle/$BOX/latest.json" "latest-$BOX.json"
   grep -E '"(object|bytes|sha256)"' "latest-$BOX.json"   # bundle.object and its size and hash
   sed -n '/"members": \[/,/\]/p' "latest-$BOX.json"     # members: the file names step 3 checks
   ```

2. **Fetch the bundle it names and verify it.** `bundle.object` is
   `recovery-bundle/<box>/<stamp>.tar.age`; its size and `sha256` must equal the
   manifest's `bundle.bytes` and `bundle.sha256` (the other `sha256` is the custodians
   file's):

   ```bash
   $S3 cp "s3://<bucket>/recovery-bundle/$BOX/<stamp>.tar.age" "$BOX.tar.age"
   wc -c < "$BOX.tar.age"; sha256sum "$BOX.tar.age"
   ```

   A mismatch: fetch the previous `<stamp>.manifest.json` / `<stamp>.tar.age` pair of
   that box and repeat.

3. **Decrypt offline and verify the member list** against the manifest's `members`
   printed in step 1 (names only, nothing is extracted):

   ```bash
   set -o pipefail
   age -d -i <identity>.age "$BOX.tar.age" | tar -tf -
   ```

   `api-prod` holds at least `api.env` and `zitadel.env` (and `api-sign-in.env`,
   `internal.env` once a release wrote them), `data-prod` holds `data.env`.

4. **Feed a file to the rebuilt box** (§4 step 2), straight from the pipe into a
   root-only file; the owner's `breakglass` session carries it:

   ```bash
   set -o pipefail
   age -d -i <identity>.age "$BOX.tar.age" | tar -xOf - data.env \
     | ssh -J breakglass@ds-api-prod breakglass@192.168.0.10 \
       'sudo install -d -m 700 /etc/ds-platform && sudo sh -c "umask 077; cat > /etc/ds-platform/data.env"'
   ```

   For ds-api-prod: `ssh breakglass@ds-api-prod` and each of its members in turn.

When done, delete the fetched ciphertext and manifests from the workstation; they open
nothing without an identity, but they are not kept outside the bucket.

## 3. Restore proof (ds-data-prod)

Proves that the bundle's `PGBACKREST_REPO1_CIPHER_PASS` opens the live repository by
completing a real restore into a throw-away cluster. An S3 listing or an object
checksum is not a proof. The run stays on ds-data-prod, so restored personal data
stays in RF and never reaches a workstation.

**Primary path: the automated drill plus the bundle-equals-live comparison.** The two
steps together are the restore proof with the bundle's passphrase; neither alone is.

1. **Automated isolated restore drill.** Actions `prod-observe.yml`, verb
   `rehearse-restore`, with the live 40-hex SHA (§1.1):

   ```bash
   gh workflow run prod-observe.yml --ref main -f verb=rehearse-restore -f sha=<live SHA>
   pnpm prod:read <run-id>
   ```

   It runs the #3648 throw-away restore mechanism on ds-data-prod
   (`infra/deploy/bin/rehearse-migration.py`): a restore of the latest backup onto a
   throw-away copy on Docker's default bridge, so archived WAL is replayed (§3.2
   «Network of the copy»). The harness forces a WAL segment with `check` and asserts
   that this segment was restored from the archive; no migration is applied, and the
   harness tears the copy down. The evidence is the report's `state` (`succeeded`),
   `backup.label` and `backup.stopAt` (the backup point), `recoveredTo` (the observed
   last replayed transaction time, `pg_last_xact_replay_timestamp()`, expected after
   `backup.stopAt`) and `headroom`; the harness's assertion is the replay of the
   segment its `check` forced. The drill reads the passphrase from the
   **live** `/etc/ds-platform/data.env`, so on its own it proves the live passphrase,
   not the bundle's.

2. **Bundle equals live (a custodian, the owner over breakglass).** On the day of the
   drill, with the daily `recovery-check` at `MATCH`, a custodian fetches and verifies
   the latest data-prod bundle (§2.3 steps 1–3) and compares two digests, bundle side
   against live side: of the whole `data.env` and of its
   `PGBACKREST_REPO1_CIPHER_PASS` value. Run in Git Bash under the rules of §2.3
   «Shell»; the digests stay in shell variables and only the verdict is printed. The
   bundle is decrypted twice, so the custodian supplies the identity (or its
   passphrase) twice:

   ```bash
   set -o pipefail
   P='s/^PGBACKREST_REPO1_CIPHER_PASS=//p'
   B_ENV=$(age -d -i <identity>.age data-prod.tar.age | tar -xOf - data.env | sha256sum) || echo "bundle FAIL"
   B_PASS=$(age -d -i <identity>.age data-prod.tar.age | tar -xOf - data.env | sed -n "$P" | sha256sum) || echo "bundle FAIL"
   LIVE=$(ssh -J breakglass@ds-api-prod breakglass@192.168.0.10 \
     "sudo sha256sum /etc/ds-platform/data.env; sudo sed -n '$P' /etc/ds-platform/data.env | sha256sum") || echo "live FAIL"
   L_ENV=$(printf '%s\n' "$LIVE" | sed -n '1s/ .*//p'); L_PASS=$(printf '%s\n' "$LIVE" | sed -n '2s/ .*//p')
   [ "${B_ENV%% *}" = "$L_ENV" ] && echo "data.env EQUAL" || echo "data.env DIFFERENT"
   [ "${B_PASS%% *}" = "$L_PASS" ] && echo "passphrase EQUAL" || echo "passphrase DIFFERENT"
   unset B_ENV B_PASS LIVE L_ENV L_PASS
   ```

   Both lines must read `EQUAL`. `DIFFERENT` means the bundle is stale or the live
   file changed: dispatch `recovery-bundle` and `recovery-check` (§2) and repeat. The
   result is posted as `EQUAL` / `DIFFERENT` only, never a digest, in the §3.5 report.

**Manual fallback (owner over breakglass, a custodian beside)**, when the drill cannot
run or its result has to be reproduced by hand. It feeds the restore the passphrase
taken from the CI-built bundle itself, so it needs no equality step. It reuses the
throw-away restore mechanics of the release-pipeline spec
(`apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md`,
«Headroom check» and «Restore target.») and the README «Rollback» restore command.
It never joins the prod compose project, never publishes a port and never archives
into the prod stanza; the prod cluster is only asked for the WAL switch of `check`.
Use the latest data-prod bundle while the daily `recovery-check` reports `MATCH`, so
its `data.env` equals the live one.

### 3.1 Stage the bundle's data.env on tmpfs

A custodian fetches and verifies the latest data-prod bundle (§2.3 steps 1–3) and
decrypts it with their identity. The passphrase comes **from the bundle**, not from
`/etc/ds-platform/data.env`:

```bash
set -o pipefail
age -d -i <identity>.age data-prod.tar.age | tar -xOf - data.env \
  | ssh -J breakglass@ds-api-prod breakglass@192.168.0.10 \
    'sudo install -d -m 700 /run/ds-recovery && sudo sh -c "umask 077; cat > /run/ds-recovery/restore.env"'
```

### 3.2 Restore (breakglass session on ds-data-prod)

```bash
ENVF=/run/ds-recovery/restore.env
CONF=/home/deploy/ds-platform/infra/deploy/compose/data-prod/pgbackrest/pgbackrest.conf
SCRATCH=/var/lib/ds-platform/recovery-proof/ds-recovery-$(date -u +%Y%m%dT%H%M%SZ)
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
`--network none`, `archive-get` cannot reach the
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
non-zero. FAIL, with the reason: `check` did not complete or printed no SEG, the
restore exited non-zero, the prod stanza's timeline or `.history` files changed or
could not be read after teardown (§3.4), or the teardown left anything behind.
Anything else short of PASS is PARTIAL with the reason.

### 3.4 Teardown (always, PASS or not)

```bash
sudo docker stop ds-recovery-pg               # --rm removes the container
sudo docker ps -a --filter 'name=^/?ds-recovery-'   # expect no rows
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

### 3.5 Report template (sanitised, posted to #3671)

```text
Restore proof — <YYYY-MM-DD HH:MM UTC> — ds-data-prod — manual fallback over breakglass
Passphrase source: data-prod recovery bundle <stamp> (custodian <role>); recovery-check MATCH on that day: <yes|no>
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
Verdict: PASS | PARTIAL (<reason>) | FAIL (<reason>)
```

The automated drill uses this template:

```text
Restore proof — <YYYY-MM-DD HH:MM UTC> — ds-data-prod — automated isolated restore (prod-observe.yml rehearse-restore)
Passphrase source: live data.env, proven equal to data-prod recovery bundle <stamp> (custodian <role>); recovery-check MATCH on that day: <yes|no>
Equality proof: sha256 of the whole data.env and of PGBACKREST_REPO1_CIPHER_PASS, bundle vs live: <EQUAL|DIFFERENT> / <EQUAL|DIFFERENT>
Backup point: label <backup.label>, stop <backup.stopAt>
WAL proof: the harness's forced check segment restored from the archive; recovered to <recoveredTo>
Checks: state <state>; headroom free <GiB> vs needed <GiB>
Teardown: by the harness (throw-away copy)
Limitations: <e.g. the copy ran on the source host; fresh-host drill not run>
Verdict: PASS | PARTIAL (<reason>) | FAIL (<reason>)
```

Add the Actions run URL under the report. A `DIFFERENT` equality line makes the
verdict FAIL whatever the drill reported.

No key value, row content or personal data goes into the report.

## 4. Full host-loss path

Each step is an existing section; this list only orders them.

1. **Recreate the boxes.** Terraform in `infra/deploy/terraform/` with the
   owner-local tfstate/tfvars (§1.1), then README → «Apply order» up to step 5
   (cloud-init, SSH access model, Docker Hub login, the tree).
2. **Secrets.** «Apply order» step 6, each file filled **from the recovery bundle**
   by a custodian (§2.3: fetch, verify, decrypt into a pipe to the new box). The four keys of §1.2 must be the old values; reissue only what §1.3 allows.
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
5. **Afterwards.** Dispatch `recovery-bundle`, then `recovery-check` (§2): a rebuilt
   box has a new fingerprint key, so its first check after the rebuild reports
   `MISMATCH fingerprint-key` until it has bundled once. Record the drill outcome
   on #3671.

Related: `infra/deploy/README.md` («Apply order», «Rollback»),
`infra/deploy/compose/data-prod/README.md` («Secrets»),
`infra/deploy/compose/data-prod/pgbackrest/pgbackrest.conf`.
