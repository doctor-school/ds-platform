import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3ObjectStorage } from "../../src/storage/storage.s3.js";

// 004 EARS-2 — live-store half of the URL-signing contract (#842): against a
// REAL private bucket (MinIO on the dev stand; buckets are private by default,
// mirroring prod `ds-prod-uploads`), the unsigned object URL the pre-#842 code
// emitted is denied over plain HTTP (403 AccessDenied — the exact prod
// failure), while the presigned GET the adapter now issues serves the bytes to
// an unauthenticated client (a browser). Uses its OWN ephemeral bucket so the
// check never depends on (or mutates) the shared uploads bucket's ACL, and
// skips when no S3 endpoint is configured (CI unit/api-e2e run without MinIO).
describe.skipIf(!process.env.S3_ENDPOINT)(
  "004 EARS-2 private-bucket program-PDF URL signing (live store e2e)",
  () => {
    const endpoint = (process.env.S3_ENDPOINT ?? "").replace(/\/+$/, "");
    const config = {
      endpoint,
      region: process.env.S3_REGION ?? "us-east-1",
      bucket: `ds-e2e-842-${randomUUID().slice(0, 8)}`,
      accessKey: process.env.S3_ACCESS_KEY ?? "",
      secretKey: process.env.S3_SECRET_KEY ?? "",
      forcePathStyle: true,
    };
    const key = `events/programs/e2e/${randomUUID().slice(0, 8)}.pdf`;
    const bytes = Buffer.from("%PDF-1.4 signed-url e2e fixture");
    let client: S3Client;
    let storage: S3ObjectStorage;

    beforeAll(async () => {
      client = new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: true,
        credentials: {
          accessKeyId: config.accessKey,
          secretAccessKey: config.secretKey,
        },
      });
      await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
      storage = new S3ObjectStorage(config);
      await storage.put({ key, body: bytes, contentType: "application/pdf" });
    });

    afterAll(async () => {
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
      );
      await client.send(new DeleteBucketCommand({ Bucket: config.bucket }));
      client.destroy();
    });

    it("EARS-2: the unsigned object URL (pre-#842 shape) is denied by the private bucket — no anonymous read", async () => {
      const unsigned = `${config.endpoint}/${config.bucket}/${key}`;
      const res = await fetch(unsigned);
      expect(res.status).toBe(403);
    });

    it("EARS-2: the presigned GET from urlFor serves the bytes to an unauthenticated HTTP client (2xx)", async () => {
      const res = await fetch(await storage.urlFor(key));
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
    });
  },
);
