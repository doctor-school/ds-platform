import {
  ListObjectsV2Command,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import {
  type AddressInfo,
  type Server,
  type Socket,
  createServer,
} from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeObjectStorage } from "./storage.fake.js";
import {
  S3_CONNECTION_TIMEOUT_MS,
  S3_MAX_ATTEMPTS,
  S3_SOCKET_IDLE_TIMEOUT_MS,
  S3ObjectStorage,
} from "./storage.s3.js";
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

  it("EARS-3: the probe forwards the caller's abort signal to the SDK request", async () => {
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockResolvedValue({} as never);
    const controller = new AbortController();
    await new S3ObjectStorage(config).probe(controller.signal);
    expect(send.mock.calls[0]?.[1]).toEqual({
      abortSignal: controller.signal,
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

// #4211 — prod Timeweb S3 stalled >10 s (13/17/23 Nov) and the client had no
// connection / socket timeout, so an upload hung until the store recovered. A
// stall must now reject with ObjectStorageError within the bound, and a failed
// HEAD must never read as an acknowledged absence.
describe("002 EARS-3 object-storage calls are bounded; only not-found reads as absent (#4211)", () => {
  let server: Server | undefined;
  const sockets = new Set<Socket>();

  /** A real TCP server that accepts every connection and never answers. */
  async function stalledEndpoint(): Promise<string> {
    server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  const testTimeouts = {
    connectionTimeoutMs: 200,
    socketIdleTimeoutMs: 300,
    maxAttempts: 2,
  };

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) =>
      server ? server.close(() => resolve()) : resolve(),
    );
    server = undefined;
  });

  it("EARS-3: a PUT against a store that accepts and never answers rejects with ObjectStorageError within the bound", async () => {
    const endpoint = await stalledEndpoint();
    const s3 = new S3ObjectStorage({ ...config, endpoint }, testTimeouts);
    const started = Date.now();
    const err = await s3
      .put({ key: "k", body: Buffer.from("x"), contentType: "image/webp" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ObjectStorageError);
    expect(Date.now() - started).toBeLessThan(3_000);
  }, 6_000);

  it("EARS-3: a HEAD against a stalled store rejects with ObjectStorageError instead of reading as absent", async () => {
    const endpoint = await stalledEndpoint();
    const s3 = new S3ObjectStorage({ ...config, endpoint }, testTimeouts);
    await expect(s3.exists("k")).rejects.toBeInstanceOf(ObjectStorageError);
  }, 6_000);

  it("EARS-3: the production bounds keep the worst-case stalled call well under a minute", () => {
    expect(
      (S3_CONNECTION_TIMEOUT_MS + S3_SOCKET_IDLE_TIMEOUT_MS) * S3_MAX_ATTEMPTS,
    ).toBeLessThan(60_000);
  });

  it("EARS-3: exists() resolves false only for a not-found answer", async () => {
    vi.spyOn(S3Client.prototype, "send").mockRejectedValue(
      new S3ServiceException({
        name: "NotFound",
        $fault: "client",
        $metadata: { httpStatusCode: 404 },
      }) as never,
    );
    expect(await new S3ObjectStorage(config).exists("k")).toBe(false);
  });

  it("EARS-3: exists() rejects with the readable ObjectStorageError on a 503", async () => {
    vi.spyOn(S3Client.prototype, "send").mockRejectedValue(
      new S3ServiceException({
        name: "ServiceUnavailable",
        $fault: "server",
        $metadata: { httpStatusCode: 503 },
      }) as never,
    );
    await expect(new S3ObjectStorage(config).exists("k")).rejects.toThrow(
      new ObjectStorageError("ServiceUnavailable (HTTP 503)"),
    );
  });

  it("EARS-3: getBytes() resolves null on NoSuchKey and rejects on any other failure", async () => {
    const send = vi.spyOn(S3Client.prototype, "send");
    send.mockRejectedValueOnce(
      new S3ServiceException({
        name: "NoSuchKey",
        $fault: "client",
        $metadata: { httpStatusCode: 404 },
      }) as never,
    );
    const s3 = new S3ObjectStorage(config);
    expect(await s3.getBytes("k")).toBeNull();
    send.mockRejectedValueOnce(invalidAccessKey() as never);
    await expect(s3.getBytes("k")).rejects.toBeInstanceOf(ObjectStorageError);
  });
});
