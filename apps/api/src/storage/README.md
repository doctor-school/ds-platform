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

## What's here

| Concern                                 | File                |
| --------------------------------------- | ------------------- |
| `@Global` module + real-vs-fake binding | `storage.module.ts` |
| Port interface + DI token               | `storage.types.ts`  |
| S3-compatible adapter (MinIO / Timeweb) | `storage.s3.ts`     |
| In-memory fake (dev/test fallback)      | `storage.fake.ts`   |

## Exported symbols

- **`StorageModule`** (`storage.module.ts`) — `@Global()`; its factory binds
  `S3ObjectStorage` when the S3 env config is complete, else `FakeObjectStorage`.
- **`OBJECT_STORAGE`** (`storage.types.ts`) — DI token for the `ObjectStorage`
  port.
- **`ObjectStorage`** (`storage.types.ts`) — the port: `put()`, `urlFor()`
  (async — presigned GET, `SIGNED_URL_TTL_SECONDS`), `exists()`, `getBytes()`,
  `delete()` (GC of a superseded program PDF, #627 — the caller owns the
  best-effort policy; deleting an absent key is not an error).
- **`S3ObjectStorage`** (`storage.s3.ts`) — the AWS-SDK v3 adapter; presigned
  GET URLs via `@aws-sdk/s3-request-presigner` (path-style vs vhost is
  config-driven).
- **`FakeObjectStorage`** (`storage.fake.ts`) — in-memory implementation for the
  dev/test fallback; signed-URL semantics + a `fetchUrl()` test seam that denies
  the unsigned shape (contract parity with the private bucket, #842).
