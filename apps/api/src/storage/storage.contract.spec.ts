import { describe, expect, it } from "vitest";
import { FakeObjectStorage } from "./storage.fake.js";
import { S3ObjectStorage } from "./storage.s3.js";
import { SIGNED_URL_TTL_SECONDS } from "./storage.types.js";

// 004 EARS-2 — the public event page's «downloadable program PDF» is only
// downloadable if the projection URL actually opens in a browser. The prod
// bucket is PRIVATE (#842): a plain unsigned object URL (`endpoint/bucket/key`)
// is denied with AccessDenied, so the port contract is "signed GET or nothing".
// This bug shipped past dev verification because the old fake happily served
// what real S3 denies — so the contract is pinned on BOTH implementations:
// the fake denies the unsigned shape (403) exactly like the private bucket,
// and the S3 adapter never emits the unsigned shape (its URLs carry a SigV4
// signature with the short TTL). The live-store half of the parity check
// (a real private bucket denying the unsigned URL over HTTP) runs in
// `test/storage/signed-url.e2e-spec.ts` against MinIO.
describe("004 EARS-2 program-PDF storage URL signing contract (#842)", () => {
  const key = "events/programs/2026/program.pdf";
  const bytes = Buffer.from("%PDF-1.4 contract fixture");

  describe("FakeObjectStorage — no more permissive than the private prod bucket", () => {
    it("EARS-2: urlFor returns a signed URL that dereferences to the stored bytes (2xx)", async () => {
      const fake = new FakeObjectStorage();
      const { url } = await fake.put({
        key,
        body: bytes,
        contentType: "application/pdf",
      });
      expect(url).toBe(await fake.urlFor(key));

      const res = await fake.fetchUrl(url);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(bytes);
    });

    it("EARS-2: the unsigned object path is DENIED (403) even when the object exists — the exact prod-bucket semantics the old fake violated", async () => {
      const fake = new FakeObjectStorage();
      await fake.put({ key, body: bytes, contentType: "application/pdf" });

      // The pre-#842 URL shape: a bare object path with no signature.
      const unsigned = fake.baseUrlFor(key);
      expect(await fake.fetchUrl(unsigned)).toEqual({
        status: 403,
        body: null,
      });
    });

    it("EARS-2: a tampered signature is denied (403); a signed URL for an absent key is 404, never a phantom 200", async () => {
      const fake = new FakeObjectStorage();
      await fake.put({ key, body: bytes, contentType: "application/pdf" });

      const tampered = `${fake.baseUrlFor(key)}?X-Fake-Signature=deadbeef`;
      expect((await fake.fetchUrl(tampered)).status).toBe(403);

      const absent = await fake.urlFor("events/programs/2026/missing.pdf");
      expect((await fake.fetchUrl(absent)).status).toBe(404);
    });
  });

  describe("S3ObjectStorage — never emits the unsigned URL shape", () => {
    // SigV4 presigning is pure client-side crypto — no live store needed to
    // pin the SHAPE of the URL the adapter hands to the public projection.
    const config = {
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      bucket: "ds-prod-uploads",
      accessKey: "contract-test-access",
      secretKey: "contract-test-secret",
      forcePathStyle: true,
    };

    it("EARS-2: urlFor is a SigV4 presigned GET with the short TTL — not the bare endpoint/bucket/key that AccessDenied'd on prod", async () => {
      const s3 = new S3ObjectStorage(config);
      const url = new URL(await s3.urlFor(key));

      // Addresses the right object…
      expect(url.pathname).toBe(`/${config.bucket}/${key}`);
      // …and is signed, time-boxed to the contract TTL (15 min).
      expect(url.searchParams.get("X-Amz-Algorithm")).toBe(
        "AWS4-HMAC-SHA256",
      );
      expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]+$/);
      expect(url.searchParams.get("X-Amz-Expires")).toBe(
        String(SIGNED_URL_TTL_SECONDS),
      );
      // The unsigned pre-#842 shape is gone.
      expect(await s3.urlFor(key)).not.toBe(
        `${config.endpoint}/${config.bucket}/${key}`,
      );
    });
  });
});
