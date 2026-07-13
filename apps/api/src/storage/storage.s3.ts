import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  ObjectStorage,
  PutObjectInput,
  StoredObject,
} from "./storage.types.js";
import { SIGNED_URL_TTL_SECONDS } from "./storage.types.js";

/** The S3 config the adapter needs — resolved from env by the module (never hardcoded). */
export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
}

/**
 * S3-compatible {@link ObjectStorage} adapter (MinIO on the dev stand, Timeweb
 * Object Storage in prod). Endpoint / bucket / credentials all come from the
 * resolved env config — nothing is hardcoded (EARS-1 AC; AGENTS.md §9). The
 * bucket is PRIVATE (#842): `urlFor` issues a short-lived SigV4 **presigned
 * GET** ({@link SIGNED_URL_TTL_SECONDS}) — a plain unsigned object URL
 * (`endpoint/bucket/key`) is denied by the store with `AccessDenied`.
 * Path-style vs virtual-hosted addressing follows `forcePathStyle`.
 */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
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
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
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
    } catch {
      return false;
    }
  }

  async getBytes(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    // S3 DeleteObject is idempotent (deleting an absent key succeeds); a real
    // storage failure rejects and the caller applies its best-effort policy.
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }
}
