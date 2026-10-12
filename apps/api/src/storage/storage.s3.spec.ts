import {
  ListObjectsV2Command,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeObjectStorage } from "./storage.fake.js";
import { S3ObjectStorage } from "./storage.s3.js";
import {
  ObjectAlreadyExistsError,
  ObjectStorageError,
  describeStorageFailure,
} from "./storage.types.js";

// #2821 — prod held a stale S3 key; Timeweb answered `403 InvalidAccessKeyId`
// and the SDK surfaced it as `err.message === "UnknownError"`, so the services'
// logs showed nothing actionable and nothing reported the outage until a user
// upload failed. The adapter now carries the readable reason, and the port has
// a bucket-level probe the readiness monitor (002 EARS-3) polls.
const config = {
  endpoint: "http://127.0.0.1:9000",
  region: "us-east-1",
  bucket: "ds-prod-uploads",
  accessKey: "contract-test-access",
  secretKey: "contract-test-secret",
  forcePathStyle: true,
};

/** The shape the SDK throws for a 403 whose XML body has a Code but no Message. */
function invalidAccessKey(): S3ServiceException {
  return new S3ServiceException({
    name: "InvalidAccessKeyId",
    $fault: "client",
    $metadata: { httpStatusCode: 403 },
    message: "UnknownError",
  });
}

describe("002 EARS-3 object-storage probe + readable failures (#2821)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("EARS-3: a refused bucket listing resolves ok:false with the readable reason, never rejecting", async () => {
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockRejectedValue(invalidAccessKey() as never);
    const s3 = new S3ObjectStorage(config);

    expect(await s3.probe()).toEqual({
      ok: false,
      reason: "InvalidAccessKeyId (HTTP 403)",
    });
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(ListObjectsV2Command);
    expect((command as ListObjectsV2Command).input).toEqual({
      Bucket: config.bucket,
      MaxKeys: 1,
    });
  });

  it("EARS-3: an accepted bucket listing resolves ok:true", async () => {
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
    expect(await new S3ObjectStorage(config).probe()).toEqual({ ok: true });
  });

  it("EARS-3: the fake store always probes ok", async () => {
    expect(await new FakeObjectStorage().probe()).toEqual({ ok: true });
  });

  it("EARS-3: a refused PUT rejects with ObjectStorageError carrying the readable reason and the original as cause", async () => {
    const original = invalidAccessKey();
    vi.spyOn(S3Client.prototype, "send").mockRejectedValue(original as never);
    const s3 = new S3ObjectStorage(config);

    const err = await s3
      .put({ key: "k", body: Buffer.from("x"), contentType: "image/webp" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ObjectStorageError);
    expect((err as Error).message).toBe("InvalidAccessKeyId (HTTP 403)");
    expect((err as Error).cause).toBe(original);
    expect((err as Error).message).not.toContain(config.secretKey);
    expect((err as Error).message).not.toContain(config.accessKey);
  });

  it("EARS-3: a refused DELETE rejects with ObjectStorageError carrying the readable reason", async () => {
    vi.spyOn(S3Client.prototype, "send").mockRejectedValue(
      invalidAccessKey() as never,
    );
    await expect(new S3ObjectStorage(config).delete("k")).rejects.toThrow(
      new ObjectStorageError("InvalidAccessKeyId (HTTP 403)"),
    );
  });

  it("EARS-3: the write-once precondition still maps to ObjectAlreadyExistsError, not the generic failure", async () => {
    vi.spyOn(S3Client.prototype, "send").mockRejectedValue(
      new S3ServiceException({
        name: "PreconditionFailed",
        $fault: "client",
        $metadata: { httpStatusCode: 412 },
      }) as never,
    );
    await expect(
      new S3ObjectStorage(config).put({
        key: "k",
        body: Buffer.from("x"),
        contentType: "image/webp",
        onlyIfAbsent: true,
      }),
    ).rejects.toBeInstanceOf(ObjectAlreadyExistsError);
  });

  it("EARS-3: describeStorageFailure keeps only the status for a bodiless answer and the code for a transport failure", () => {
    expect(
      describeStorageFailure({
        name: "403",
        $metadata: { httpStatusCode: 403 },
      }),
    ).toBe("HTTP 403");
    expect(
      describeStorageFailure({
        name: "Unknown",
        $metadata: { httpStatusCode: 403 },
      }),
    ).toBe("HTTP 403");
    expect(
      describeStorageFailure({
        name: "UnknownError",
        $metadata: { httpStatusCode: 403 },
      }),
    ).toBe("HTTP 403");
    expect(
      describeStorageFailure(
        Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        }),
      ),
    ).toBe("Error ECONNREFUSED");
  });
});
