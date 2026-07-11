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
  /** A resolvable URL for the current object (config-derived, never hardcoded). */
  url: string;
}

export interface ObjectStorage {
  /** Upload (or overwrite) an object and return its key + resolvable URL. */
  put(input: PutObjectInput): Promise<StoredObject>;
  /** Resolvable URL for a stored key (config-derived path-style / vhost). */
  urlFor(key: string): string;
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
