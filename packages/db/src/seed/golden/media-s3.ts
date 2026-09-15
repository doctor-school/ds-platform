// #2213 — the S3 binding of `GoldenMediaStore`.
//
// Kept out of `index.ts` and out of `media.ts` on purpose: `run.ts` is the only
// caller, and every other consumer of the golden dataset (step 7's route params,
// the regression scenarios, the unit suite) has no business loading an AWS SDK
// client to read a fixture. `media.ts` owns the seam; this file owns the wire.

import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { GoldenMediaStore } from "./media.js";

/** The env the golden media writer needs, resolved — never hardcoded (AGENTS.md §9). */
export interface GoldenS3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
}

/** The variables `run.ts` refuses to start without. */
export const GOLDEN_S3_ENV_VARS = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET_UPLOADS",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
] as const;

/** Raised when the golden seed is asked to write media it cannot address. */
export class GoldenS3ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldenS3ConfigError";
  }
}

/**
 * Reads the S3 config, or refuses.
 *
 * There is deliberately NO skip flag. The golden rows reference portraits and
 * programmes unconditionally, so a seed run that wrote rows and skipped objects
 * would leave every slot cloned from that template with broken portraits and
 * 404 programme downloads — and it would do so silently, which is the failure
 * mode staging exists to catch rather than to reproduce.
 * `S3_FORCE_PATH_STYLE` is the one optional member: MinIO needs path-style
 * addressing and says so, so it defaults on, matching the API's own env schema.
 */
export function resolveGoldenS3Config(
  env: Record<string, string | undefined>,
): GoldenS3Config {
  const missing = GOLDEN_S3_ENV_VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new GoldenS3ConfigError(
      `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required — the golden seed writes expert portraits and programme PDFs into object storage; read the values from the slot env (or ~/.ds-platform/.env.local), never hardcode an endpoint`,
    );
  }
  return {
    endpoint: env.S3_ENDPOINT as string,
    region: env.S3_REGION as string,
    bucket: env.S3_BUCKET_UPLOADS as string,
    accessKey: env.S3_ACCESS_KEY as string,
    secretKey: env.S3_SECRET_KEY as string,
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false",
  };
}

/** An S3-compatible {@link GoldenMediaStore} (MinIO on the stage box). */
export function createS3GoldenMediaStore(
  config: GoldenS3Config,
): GoldenMediaStore & { close(): void } {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
  });

  return {
    async exists(key) {
      try {
        await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        );
        return true;
      } catch (err) {
        if (isNotFound(err)) return false;
        throw err;
      }
    },
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    close() {
      client.destroy();
    },
  };
}

function isNotFound(err: unknown): boolean {
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  const name = (err as { name?: string })?.name;
  return status === 404 || name === "NotFound" || name === "NoSuchKey";
}
