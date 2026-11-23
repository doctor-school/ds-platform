import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  ObjectStorage,
  PutObjectInput,
  StorageProbeResult,
  StoredObject,
} from "./storage.types.js";
import {
  ObjectAlreadyExistsError,
  ObjectStorageError,
  SIGNED_URL_TTL_SECONDS,
  describeStorageFailure,
} from "./storage.types.js";

/** The S3 config the adapter needs — resolved from env by the module (never hardcoded). */
export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
}

/** TCP connect bound — a reachable store opens a socket in well under a second (#4211). */
export const S3_CONNECTION_TIMEOUT_MS = 5_000;
/**
 * Socket-IDLE bound, not total duration: a large upload that keeps transferring
 * never trips it, a store that accepts and then stalls does (#4211).
 */
export const S3_SOCKET_IDLE_TIMEOUT_MS = 20_000;
/** One retry: worst case (5 s + 20 s) × 2 = 50 s, still under a minute (#4211). */
export const S3_MAX_ATTEMPTS = 2;

/** Network bounds of every S3 call; injectable so tests can use small values. */
export interface S3Timeouts {
  connectionTimeoutMs: number;
  socketIdleTimeoutMs: number;
  maxAttempts: number;
}

const DEFAULT_S3_TIMEOUTS: S3Timeouts = {
  connectionTimeoutMs: S3_CONNECTION_TIMEOUT_MS,
  socketIdleTimeoutMs: S3_SOCKET_IDLE_TIMEOUT_MS,
  maxAttempts: S3_MAX_ATTEMPTS,
};

/**
 * S3-compatible {@link ObjectStorage} adapter (MinIO on the dev stand, Timeweb
 * Object Storage in prod). Endpoint / bucket / credentials all come from the
 * resolved env config — nothing is hardcoded (EARS-1 AC; AGENTS.md §9). The
 * bucket is PRIVATE (#842): `urlFor` issues a short-lived SigV4 **presigned
 * GET** ({@link SIGNED_URL_TTL_SECONDS}) — a plain unsigned object URL
 * (`endpoint/bucket/key`) is denied by the store with `AccessDenied`.
 * Path-style vs virtual-hosted addressing follows `forcePathStyle`.
 *
 * A store failure that rejects (put / delete) is rethrown as an
 * {@link ObjectStorageError} whose message is the readable
 * `<Name> (HTTP <status>)` reason (#2821) — the raw SDK error often carries
 * only `"UnknownError"`.
 *
 * Every network call is bounded by {@link S3Timeouts} (#4211): a stalled store
 * rejects with {@link ObjectStorageError} instead of hanging the request.
 * `exists()` / `getBytes()` answer absent (`false` / `null`) ONLY for a
 * not-found answer; any other failure rejects, so a stall never reads as an
 * acknowledged absence.
 */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(
    private readonly config: S3StorageConfig,
    timeouts: S3Timeouts = DEFAULT_S3_TIMEOUTS,
  ) {
    this.client = new S3Client({
      maxAttempts: timeouts.maxAttempts,
      // `socketTimeout` is the idle bound; `requestTimeout` in this handler
      // version is a total-duration timer that only WARNs, so it is not used.
      requestHandler: {
        connectionTimeout: timeouts.connectionTimeoutMs,
        socketTimeout: timeouts.socketIdleTimeoutMs,
      },
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
    });
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          // `If-None-Match: *` is the S3 conditional-write precondition; the
          // store answers 412 when the key is taken (012-design §6).
          ...(input.onlyIfAbsent ? { IfNoneMatch: "*" } : {}),
        }),
      );
    } catch (err) {
      if (input.onlyIfAbsent && isPreconditionFailed(err)) {
        throw new ObjectAlreadyExistsError(input.key);
      }
      throw readable(err);
    }
    return { key: input.key, url: await this.urlFor(input.key) };
  }

  urlFor(key: string): Promise<string> {
    // Presigned GET (SigV4) — the ONLY browser-fetchable URL shape against the
    // private bucket. The presigner derives path-style / virtual-hosted
    // addressing from the client config, so no hand-composed URL here.
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw readable(err);
    }
  }

  async getBytes(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw readable(err);
    }
  }

  async delete(key: string): Promise<void> {
    // S3 DeleteObject is idempotent (deleting an absent key succeeds); a real
    // storage failure rejects and the caller applies its best-effort policy.
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
    } catch (err) {
      throw readable(err);
    }
  }

  async probe(signal?: AbortSignal): Promise<StorageProbeResult> {
    // A one-key listing proves reachability + credentials for the uploads
    // bucket without touching any object (002 EARS-3). Not HeadBucket: a HEAD
    // answer has no body, so the SDK cannot read the error code and a stale key
    // surfaces as `Unknown (HTTP 403)` instead of `InvalidAccessKeyId (HTTP 403)`
    // (observed against MinIO, #2821). Both need the same s3:ListBucket grant.
    try {
      await this.client.send(
        new ListObjectsV2Command({ Bucket: this.config.bucket, MaxKeys: 1 }),
        signal ? { abortSignal: signal } : {},
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: describeStorageFailure(err) };
    }
  }
}

/** Wrap a raw SDK rejection in the readable {@link ObjectStorageError}. */
function readable(err: unknown): ObjectStorageError {
  return new ObjectStorageError(describeStorageFailure(err), { cause: err });
}

/** Whether a store rejection is the conditional-write "key already taken" answer. */
function isPreconditionFailed(err: unknown): boolean {
  const meta = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
  const name = (err as { name?: string }).name;
  return meta?.httpStatusCode === 412 || name === "PreconditionFailed";
}

/** Whether a store rejection is the not-found answer (the only acknowledged absence). */
function isNotFound(err: unknown): boolean {
  const meta = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
  const name = (err as { name?: string }).name;
  return (
    meta?.httpStatusCode === 404 || name === "NotFound" || name === "NoSuchKey"
  );
}
