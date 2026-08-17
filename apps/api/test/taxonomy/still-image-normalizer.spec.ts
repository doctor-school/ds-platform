import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { CANONICAL_IMAGE_MIME, MAX_IMAGE_BYTES } from "@ds/schemas";
import { TaxonomyError } from "../../src/taxonomy/taxonomy.errors.js";
import {
  StillImageNormalizer,
  type UploadedImage,
} from "../../src/taxonomy/media/still-image-normalizer.js";
import { animatedWebpFixture, apngFixture } from "./support/animated-fixtures.js";

// 012 EARS-1 (#1283) — the shared normalizer's reject and accept branches, on
// real BYTE fixtures produced by the same codec the normalizer uses. Fixtures are
// generated rather than committed as binaries: a generated fixture states its own
// properties (frames, dimensions, metadata) in code, so a reviewer can see WHY it
// should be rejected instead of trusting a filename.

const normalizer = new StillImageNormalizer();

function part(body: Buffer, contentType: string): UploadedImage {
  return { fieldname: "cover", filename: "cover.bin", contentType, body };
}

/** A solid still image of the given size in the given container. */
async function still(
  format: "jpeg" | "png" | "webp",
  width = 64,
  height = 48,
): Promise<Buffer> {
  const base = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 12, g: 84, b: 200 },
    },
  });
  return format === "jpeg"
    ? base.jpeg().toBuffer()
    : format === "png"
      ? base.png().toBuffer()
      : base.webp().toBuffer();
}

async function expectRejected(file: UploadedImage, why: RegExp): Promise<void> {
  await expect(normalizer.normalize(file)).rejects.toSatisfy(
    (err: unknown) =>
      err instanceof TaxonomyError &&
      err.errorCode === "MEDIA_INVALID" &&
      why.test(err.detail ?? ""),
  );
}

describe("012 taxonomy — shared still-image normalizer", () => {
  it("012 EARS-1: when a valid JPEG, PNG or WebP still is uploaded, the system shall re-encode it to canonical WebP", async () => {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const source = await still(format);
      const out = await normalizer.normalize(part(source, `image/${format}`));
      expect(out.contentType).toBe(CANONICAL_IMAGE_MIME);
      expect(out.width).toBe(64);
      expect(out.height).toBe(48);
      expect(out.profileVersion).toBe("webp-1");
      expect(out.sourceBytes).toBe(source.length);
      expect(out.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
      // The stored MIME is derived from the OUTPUT bytes, not the declared type.
      const meta = await sharp(out.body).metadata();
      expect(meta.format).toBe("webp");
    }
  });

  it("012 EARS-1: when the same bytes are normalized twice, the system shall produce byte-identical output", async () => {
    const source = await still("png");
    const a = await normalizer.normalize(part(source, "image/png"));
    const b = await normalizer.normalize(part(source, "image/png"));
    expect(a.canonicalSha256).toBe(b.canonicalSha256);
    expect(a.body.equals(b.body)).toBe(true);
    expect(a.codecBuild).toMatch(/^sharp-\d/);
  });

  it("012 EARS-1: when an image carries EXIF, XMP, GPS or an original filename, the system shall strip every ancillary block", async () => {
    const withExif = await sharp({
      create: {
        width: 40,
        height: 40,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .withExif({
        IFD0: { Copyright: "operator", Software: "camera" },
        IFD2: { GPSLatitudeRef: "N" },
      })
      .jpeg()
      .toBuffer();
    const out = await normalizer.normalize(part(withExif, "image/jpeg"));
    const meta = await sharp(out.body).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    // The original filename never travels with the bytes.
    expect(out.body.includes(Buffer.from("cover.bin"))).toBe(false);
  });

  it("012 EARS-1: when the image is oriented by EXIF, the system shall apply the rotation and bound the ORIENTED size", async () => {
    const rotated = await sharp({
      create: {
        width: 80,
        height: 40,
        channels: 3,
        background: { r: 9, g: 9, b: 9 },
      },
    })
      // Orientation 6 = rotate 90° CW on display: the oriented size is 40×80.
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const out = await normalizer.normalize(part(rotated, "image/jpeg"));
    expect([out.width, out.height]).toEqual([40, 80]);
  });

  it("012 EARS-1: when a GIF or any non-accepted type is uploaded, the system shall refuse it", async () => {
    const gif = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .gif()
      .toBuffer();
    await expectRejected(part(gif, "image/gif"), /JPEG, PNG and WebP/);
    // …and a GIF RENAMED as a PNG is caught by the decoded container format.
    await expectRejected(part(gif, "image/png"), /JPEG, PNG and WebP/);
  });

  it("012 EARS-1: when the upload exceeds 10 MiB, the system shall refuse it before decoding", async () => {
    const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1, 0x00);
    await expectRejected(part(oversized, "image/png"), /byte limit/);
  });

  it("012 EARS-1: when a side exceeds 6000 px, the system shall refuse it", async () => {
    const wide = await still("png", 6001, 10);
    await expectRejected(part(wide, "image/png"), /at most 6000 px/);
  });

  it("012 EARS-1: when the aggregate decoded pixels exceed 25 megapixels, the system shall refuse it", async () => {
    // 5200 × 5000 = 26 Mpx — under the per-side cap, over the aggregate budget.
    const huge = await still("png", 5200, 5000);
    await expectRejected(part(huge, "image/png"), /pixel budget/);
  });

  it("012 EARS-1: when the container is an animated WebP, the system shall refuse it before allocating its frames", async () => {
    const animated = await animatedWebpFixture();
    // The fixture really is multi-frame, not merely labelled so.
    expect((await sharp(animated).metadata()).pages).toBe(2);
    await expectRejected(part(animated, "image/webp"), /animated|multi-frame/);
  });

  it("012 EARS-1: when the container is an APNG, the system shall refuse it even though the pinned codec reports no page count", async () => {
    const apng = await apngFixture();
    // Documents WHY the container check exists: this codec build would happily
    // normalize the default frame and report a still.
    expect((await sharp(apng).metadata()).pages).toBeUndefined();
    await expectRejected(part(apng, "image/png"), /animated|multi-frame/);
  });

  it("012 EARS-1: when the body is not an image at all, the system shall refuse it", async () => {
    await expectRejected(
      part(Buffer.from("not an image"), "image/png"),
      /could not be decoded|JPEG, PNG and WebP/,
    );
    await expectRejected(part(Buffer.alloc(0), "image/png"), /empty/);
  });
});
