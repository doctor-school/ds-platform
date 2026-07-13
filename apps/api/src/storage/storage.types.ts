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
}

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
}

/** Nest DI token for the {@link ObjectStorage} port. */
export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");
