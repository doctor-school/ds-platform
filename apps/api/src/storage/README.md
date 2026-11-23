# `storage` — object-storage port (program-PDF binary)

The api's single object-storage seam (007 program PDF; ADR-0003). The event
aggregate holds only a reference (`program_pdf_ref`); the bytes live in Timeweb
Object Storage (prod) / MinIO (the dev stand). The `ObjectStorage` port is the
boundary the S3 adapter and the in-memory fake implement, so the domain never
imports the AWS SDK directly.

Endpoint / bucket / credentials are **always** resolved from the env schema
(`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET_UPLOADS`, `S3_ACCESS_KEY`,
`S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE`) — never hardcoded (EARS-1 AC; AGENTS.md
§9). The real S3 adapter is bound only when the full config is present; otherwise
the in-memory fake is bound so `apps/api` boots on a dev stand without MinIO / in
a bare unit run (mirrors the IdP fake).

**The bucket is private; every public URL is signed (#842).** `urlFor()` issues
a short-lived SigV4 **presigned GET** (`SIGNED_URL_TTL_SECONDS`, 15 min) at
projection-read time — a plain unsigned object URL (`endpoint/bucket/key`) is
denied by the store with `AccessDenied`. The fake mirrors the same semantics
(an HMAC-signed URL; its `fetchUrl()` seam denies the unsigned shape with 403)
so dev/test can never green a URL shape prod would refuse — contract pinned by
`storage.contract.spec.ts` + `test/storage/signed-url.e2e-spec.ts`.

**Failures are readable; the store is probed (#2821).** The SDK reports a
message-less S3 error (a stale key's `403 InvalidAccessKeyId`) as
`"UnknownError"`, so the adapter rethrows every non-precondition `put`/`delete`
failure as `ObjectStorageError` whose message is
`describeStorageFailure(err)` — `<SDK error name> (HTTP <status>)`, original as
`cause`, never key material or a signed URL. `ObjectStorageReadiness` probes the
bound store at startup and every 60 s and feeds `checks.objectStorage` of
`GET /v1/ready` (002 EARS-3), logging a WARN with the reason on the transition
to down and a LOG on recovery.

**Every store call is bounded; only not-found reads as absent (#4211).** The
`S3Client` carries a connect bound (`S3_CONNECTION_TIMEOUT_MS`, 5 s), a
socket-**idle** bound (`S3_SOCKET_IDLE_TIMEOUT_MS`, 20 s — a large upload that
keeps transferring never trips it) and `S3_MAX_ATTEMPTS` = 2, so a store that
accepts and then stalls before answering rejects within ~50 s with an
`ObjectStorageError` (`TimeoutError`) instead of hanging the request. The idle
bound does **not** cover a response body read: the HTTP handler attaches a
`socketTimeout` of 6 s or more only after a 3 s deferral that arriving headers
cancel. `getBytes()` therefore carries its own total deadline over the request
and the body read (`S3_GET_BYTES_DEADLINE_MS`, 30 s, an `AbortSignal` on the
call) and rejects with `ObjectStorageError("getBytes timed out after … ms")`. `exists()` resolves `false` and
`getBytes()` `null` ONLY for a not-found answer (HTTP 404 / `NotFound` /
`NoSuchKey`); a timeout, 5xx, 403 or network failure rejects with
`ObjectStorageError`, because callers read `false` as an **acknowledged**
absence (the upload-locator reconcile clears the locator, media cleanup
acknowledges the deletion) — those callers already treat a rejection as
"retry on the next sweep". `urlFor()` signs locally and makes no network call.

## What's here

| Concern                                 | File                   |
| --------------------------------------- | ---------------------- |
| `@Global` module + real-vs-fake binding | `storage.module.ts`    |
| Port interface + DI token + error type  | `storage.types.ts`     |
| S3-compatible adapter (MinIO / Timeweb) | `storage.s3.ts`        |
| In-memory fake (dev/test fallback)      | `storage.fake.ts`      |
| Cached readiness probe (002 EARS-3)     | `storage-readiness.ts` |

## Exported symbols

- **`StorageModule`** (`storage.module.ts`) — `@Global()`; its factory binds
  `S3ObjectStorage` when the S3 env config is complete, else `FakeObjectStorage`;
  also provides `ObjectStorageReadiness`.
- **`OBJECT_STORAGE`** (`storage.types.ts`) — DI token for the `ObjectStorage`
  port.
- **`ObjectStorage`** (`storage.types.ts`) — the port: `put()`, `urlFor()`
  (async — presigned GET, `SIGNED_URL_TTL_SECONDS`), `exists()`, `getBytes()`,
  `delete()` (GC of a superseded program PDF, #627 — the caller owns the
  best-effort policy; deleting an absent key is not an error), `probe()`
  (bucket-level health check; resolves `{ ok: false, reason }`, never rejects).
- **`ObjectStorageError`** / **`describeStorageFailure`** (`storage.types.ts`) —
  the readable failure type the S3 adapter rethrows and the
  `<Name> (HTTP <status>)` formatter shared with the probe.
- **`ObjectStorageReadiness`** (`storage-readiness.ts`) — the cached probe:
  startup + `STORAGE_READINESS_INTERVAL_MS` (60 s) `SchedulerRegistry` interval,
  overlapping ticks skipped, 10 s probe timeout, transition-only WARN/LOG;
  `status()` is what `GET /v1/ready` reads.
- **`S3ObjectStorage`** (`storage.s3.ts`) — the AWS-SDK v3 adapter; presigned
  GET URLs via `@aws-sdk/s3-request-presigner` (path-style vs vhost is
  config-driven); `probe()` is a one-key `ListObjectsV2` (a bodiless
  `HeadBucket` 403 cannot carry the error code).
- **`FakeObjectStorage`** (`storage.fake.ts`) — in-memory implementation for the
  dev/test fallback; signed-URL semantics + a `fetchUrl()` test seam that denies
  the unsigned shape (contract parity with the private bucket, #842).
