---
title: "Academy partnership submissions operations"
description: "The retired Academy partnership file store: its remaining records and their import into the application queue."
lang: en
---

# Academy partnership submissions operations

This runbook covers the private JSON records the public Academy partnership
form wrote before it moved into the application queue (033 EARS-18: the form
posts to `POST /v1/public/applications/partnership`, and the portal writes no
file). Canon: [Feature 013 design](../specs/features/013-academy-home/013-design.md),
[033 design](../specs/features/033-author-application/033-design.md) and
ADR-0011. The **Tech Lead / System Architect** owns the production storage in
Phase 0.

## Storage contract

| Property       | Production value                                  |
| -------------- | ------------------------------------------------- |
| Writer         | none — retired; the records are read-only now     |
| Container path | `/var/lib/ds-platform/academy-submissions`        |
| Compose volume | `academy_partnership_submissions`                 |
| Directory mode | `0700`, owned by the non-root portal runtime user |
| Record mode    | `0600`                                            |
| Record name    | `<idempotency-key>.json`                          |

The volume stays mounted into `portal` only until the import below is verified
and the owner-gated removal (#4262) is done; no other service mounts it, and
there is no public read/list route.

## Metadata checks

Run these on `api-prod` from the directory containing the production Compose
file. They inspect metadata only and must not print record contents:

```bash
docker compose exec -T portal sh -lc \
  'd=/var/lib/ds-platform/academy-submissions && test -d "$d" && \
   test "$(stat -c %a "$d")" = 700 && test "$(stat -c %u "$d")" = "$(id -u)"'

docker inspect "$(docker compose ps -q portal)" \
  --format '{{range .Mounts}}{{println .Name .Destination}}{{end}}'
```

To count the records without reading them:

```bash
docker compose exec -T portal sh -lc \
  'find /var/lib/ds-platform/academy-submissions -maxdepth 1 -type f -name "*.json" | wc -l'
```

Never chmod the directory, mount the volume into another service, or delete a
file (a leftover `.tmp` included) before the import is verified.

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
2. Count the records (the count command above).
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
   data action: it waits for the owner's explicit «go», tracked on #4262.

## Retention, backup, and withdrawal

These files contain personal data and immutable consent evidence. The linked
privacy policy sets processing until withdrawal through `info@doctor.school`;
the feature introduces no different duration and no automated deletion.

This slice adds no outbound backup transport. Any provider snapshot or recovery
copy that includes the Docker volume must remain in the approved same-zone/RF
perimeter and inherit the same access and withdrawal handling under ADR-0011.
Do not export the volume to a workstation, analytics tool, messenger, or public
object store. A restore must preserve the directory owner/mode and file mode,
then pass the metadata checks above.

Withdrawal is a controlled destructive operation: verify the request and exact
record target without exposing unrelated payloads, confirm the live and backup
targets, obtain the required owner approval, and only then remove the scoped
record and its retained copies. There is intentionally no public lookup or
deletion endpoint in Feature 013.
