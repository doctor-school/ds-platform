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
