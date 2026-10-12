/**
 * Object-storage port (007 — the program-PDF binary; ADR-0003). The event
 * aggregate holds only a reference (`program_pdf_ref`); the bytes live in
 * Timeweb Object Storage (prod) / MinIO (dev stand). The port is the seam the
 * S3 adapter (storage.s3.ts) and the in-memory fake (storage.fake.ts) implement,
 * so the domain never imports the AWS SDK directly.
 */
export interface PutObjectInput {
  /** Storage key (the value stored on the aggregate as `program_pdf_ref`). */
  key: string;
  body: Buffer;
  contentType: string;
  /**
   * Write-once semantics — the S3 `If-None-Match: *` precondition (012-design
   * §6). With a deterministic record-scoped key, a resumed request and its
   * lapsed predecessor target the SAME key: without this flag the late loser
   * would overwrite the winner's object after the domain row already referenced
   * it. Set it and a second write to an existing key rejects with
   * {@link ObjectAlreadyExistsError} instead of clobbering.
   *
   * Absent/false keeps the plain overwrite behaviour 007's program-PDF upload
   * relies on.
   */
  onlyIfAbsent?: boolean;
}

/**
 * Thrown by `put({ onlyIfAbsent: true })` when the key already holds an object.
 * A distinct type (not a generic storage failure) because for an idempotent
 * retry it is a SUCCESS signal: the canonical bytes are already there.
 */
export class ObjectAlreadyExistsError extends Error {
  constructor(readonly key: string) {
    super(`object ${key} already exists`);
  }
}

/**
 * A store failure in a readable form (#2821). The AWS SDK surfaces a bodiless
 * or message-less S3 error (a Timeweb `403 InvalidAccessKeyId`) as
 * `err.message === "UnknownError"`, so services that log `err.message` showed
 * nothing actionable. The adapter wraps every non-precondition failure in this
 * type: `message` is the {@link describeStorageFailure} reason (SDK error name +
 * HTTP status, e.g. `InvalidAccessKeyId (HTTP 403)`), the original error is the
 * `cause`. The message never carries key material or a signed URL.
 */
export class ObjectStorageError extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(reason, options);
    this.name = "ObjectStorageError";
  }
}

/**
 * Render an S3/SDK failure as `<Name> (HTTP <status>)` — the one readable form
 * shared by adapter errors and the readiness probe (002 EARS-3). A bodiless
 * response (HEAD) leaves the SDK name numeric or absent, so only the status is
 * kept; a transport failure (no HTTP status) keeps its name and system code.
 */
export function describeStorageFailure(err: unknown): string {
  const e = (err ?? {}) as {
    name?: unknown;
    code?: unknown;
    $metadata?: { httpStatusCode?: number };
  };
  const name =
    typeof e.name === "string" && e.name !== "" && !/^\d+$/.test(e.name)
      ? e.name
      : null;
  const status = e.$metadata?.httpStatusCode;
  if (status !== undefined) {
    return name && !["Unknown", "UnknownError", "Error"].includes(name)
      ? `${name} (HTTP ${status})`
      : `HTTP ${status}`;
  }
  const code = typeof e.code === "string" ? e.code : null;
  return [name ?? "Error", code].filter(Boolean).join(" ");
}

/** Result of {@link ObjectStorage.probe}: reachable with valid credentials, or the readable reason it is not. */
export type StorageProbeResult = { ok: true } | { ok: false; reason: string };

export interface StoredObject {
  key: string;
  /** A browser-fetchable signed URL for the current object (config-derived, never hardcoded). */
  url: string;
}

/**
 * TTL of a signed GET URL (seconds). The bucket is PRIVATE in prod (#842), so
 * every public URL is a short-lived presigned GET issued at projection-read
 * time — long enough for a page view + download click, short enough that a
 * leaked link goes stale quickly.
 */
export const SIGNED_URL_TTL_SECONDS = 15 * 60;

export interface ObjectStorage {
  /** Upload (or overwrite) an object and return its key + signed URL. */
  put(input: PutObjectInput): Promise<StoredObject>;
  /**
   * Browser-fetchable **signed** GET URL for a stored key, valid for
   * {@link SIGNED_URL_TTL_SECONDS}. The backing bucket is private (#842): a
   * plain unsigned object URL (`endpoint/bucket/key`) is denied by the store,
   * so signing is part of the port contract — every implementation (real S3
   * and the fake alike) MUST reject the unsigned shape and serve the signed one.
   * Signing is async (SigV4 presign), hence the Promise.
   */
  urlFor(key: string): Promise<string>;
  /** Whether an object exists — used by the e2e to assert the PDF landed. */
  exists(key: string): Promise<boolean>;
  /** Fetch the stored bytes (or null when absent). */
  getBytes(key: string): Promise<Buffer | null>;
  /**
   * Delete a stored object (GC of a superseded program PDF, #627). Rejects on
   * a storage failure — the caller owns the best-effort policy (log the orphan,
   * never fail the supersede); deleting an absent key is not an error.
   */
  delete(key: string): Promise<void>;
  /**
   * Bucket-level health probe (002 EARS-3): proves the store is reachable and
   * accepts the configured credentials for the uploads bucket. Never rejects —
   * a failure resolves `{ ok: false, reason }` with the
   * {@link describeStorageFailure} reason. `signal` aborts the in-flight
   * request (the readiness monitor's probe timeout).
   */
  probe(signal?: AbortSignal): Promise<StorageProbeResult>;
}

/** Nest DI token for the {@link ObjectStorage} port. */
export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");
