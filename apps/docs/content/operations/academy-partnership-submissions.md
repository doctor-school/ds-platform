---
title: "Academy partnership submissions operations"
description: "Operating the portal-only private JSON volume used by the Academy partnership form."
lang: en
---

# Academy partnership submissions operations

This runbook covers the private JSON records created by the public Academy
partnership form. Canon: [Feature 013 design](../specs/features/013-academy-home/013-design.md)
and ADR-0011. The **Tech Lead / System Architect** owns the production storage in
Phase 0.

## Storage contract

| Property             | Production value                                  |
| -------------------- | ------------------------------------------------- |
| Writer               | `portal` only                                     |
| Environment variable | `ACADEMY_SUBMISSIONS_DIR`                         |
| Container path       | `/var/lib/ds-platform/academy-submissions`        |
| Compose volume       | `academy_partnership_submissions`                 |
| Directory mode       | `0700`, owned by the non-root portal runtime user |
| Record mode          | `0600`                                            |
| Record name          | `<idempotency-key>.json`                          |

The portal fails closed when the configured directory is missing, relative,
symlinked, owned by another user, or has wider permissions. A record is fsynced
to a private staging file and atomically linked into its final UUID destination;
a failed write must leave no partial JSON record. There is no public read/list
route and no other service mounts this volume.

## Post-deploy verification

Run these checks on `api-prod` from the directory containing the production
Compose file. They inspect metadata only and must not print record contents:

```bash
docker compose exec -T portal sh -lc \
  'test "$ACADEMY_SUBMISSIONS_DIR" = /var/lib/ds-platform/academy-submissions && \
   test -d "$ACADEMY_SUBMISSIONS_DIR" && \
   test "$(stat -c %a "$ACADEMY_SUBMISSIONS_DIR")" = 700 && \
   test "$(stat -c %u "$ACADEMY_SUBMISSIONS_DIR")" = "$(id -u)"'

docker inspect "$(docker compose ps -q portal)" \
  --format '{{range .Mounts}}{{println .Name .Destination}}{{end}}'
```

The mount listing must contain exactly the Academy volume at the configured
path for this feature. Confirm the Compose model does not attach that volume to
`api`, `admin`, or any other service before applying an infrastructure change.

For a non-PII liveness signal, count records without reading them:

```bash
docker compose exec -T portal sh -lc \
  'find "$ACADEMY_SUBMISSIONS_DIR" -maxdepth 1 -type f -name "*.json" | wc -l'
```

## Failure handling

- **Form reports the approved save error:** inspect portal logs for the generic
  persistence failure, then check mount presence, directory ownership/mode, and
  free space. Never log or paste a submitted payload while diagnosing.
- **Directory permissions differ:** stop and restore the image/volume ownership
  contract. Never use `chmod 777` or mount the volume into another service.
- **A `.tmp` file remains after an interrupted process:** do not delete it during
  the first investigation. Confirm no portal process is writing it, record its
  metadata, and take an approved same-zone recovery copy before any destructive
  cleanup.
- **Volume is unavailable or full:** the form remains fail-closed and must not
  show success. Restore the same named volume or capacity, then re-run the
  metadata checks above; exact client retries remain idempotent.

## Import into the application queue (033 EARS-19)

The partnership form moves into the 033 application queue
([033 design «Import of the interim records»](../specs/features/033-author-application/033-design.md)).
The api ships a one-off import of these records:
`node dist/applications/import-partnership-records.main.js <dir>` in the api
image, `pnpm --filter @ds/api applications:import-partnership <dir>` on a
workstation. It inserts one `partnership` application per valid record, keyed
by the record id (`legacy_record_id`), with its `acceptedAt` as the submission
time, its consent tag, status `new` and team notice `imported` (no team email;
the admin list shows no «Команда не уведомлена» mark). A record already
imported is left as it is, so a re-run is safe. It prints one JSON line
`{ imported, alreadyPresent, invalid: [file names] }` and never a record's
content.

Run order on production, each step only after the previous one is verified:

1. Release the portal whose form posts to `POST /v1/public/applications/partnership`
   — from then on no new file is written here.
2. Count the records (the liveness command above).
3. Run the import in a one-off api container with this volume mounted read-only.
   The records are `0700`/`0600` for the portal runtime user, so the container
   must run as that same uid (`--user "$(docker compose exec -T portal id -u)"`):

   ```bash
   docker compose run --rm --no-deps --user "<portal uid>"      -v academy_partnership_submissions:/import:ro api      node dist/applications/import-partnership-records.main.js /import
   ```

4. Check that `imported + alreadyPresent + invalid` equals the file count and
   that `invalid` is empty; an invalid name is investigated before going on,
   never deleted.
5. Removing the volume from Compose (and the volume itself) is an irreversible
   data action: it waits for the owner's explicit «go», recorded on #4032.

## Retention, backup, and withdrawal

These files contain personal data and immutable consent evidence. The linked
privacy policy sets processing until withdrawal through `info@doctor.school`;
the feature introduces no different duration and no automated deletion.

This slice adds no outbound backup transport. Any provider snapshot or recovery
copy that includes the Docker volume must remain in the approved same-zone/RF
perimeter and inherit the same access and withdrawal handling under ADR-0011.
Do not export the volume to a workstation, analytics tool, messenger, or public
object store. A restore must preserve the directory owner/mode and file mode,
then pass the post-deploy checks before portal traffic is considered healthy.

Withdrawal is a controlled destructive operation: verify the request and exact
record target without exposing unrelated payloads, confirm the live and backup
targets, obtain the required owner approval, and only then remove the scoped
record and its retained copies. There is intentionally no public lookup or
deletion endpoint in Feature 013.
