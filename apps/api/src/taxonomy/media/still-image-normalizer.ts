import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import sharp from "sharp";
import type { Metadata, OutputInfo } from "sharp";
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  CANONICAL_IMAGE_MIME,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DECODED_PIXELS,
  MAX_IMAGE_SIDE_PX,
  MEDIA_PROFILE_VERSION,
} from "@ds/schemas";
import { TaxonomyError } from "../taxonomy.errors.js";

// 012-design §2.2 — THE shared still-image decoder/normalizer, introduced by
// #1283 (project cover) and consumed byte-for-byte by #1284 photos and #1286
// logos. There is deliberately no per-entity variant: one component, one pinned
// profile, so three surfaces cannot drift into three different "canonical"
// outputs.
//
// Two properties are load-bearing:
//
// 1. **Reject before allocating.** APNG, animated WebP, any frame count other
//    than one, oversized sides and an over-budget aggregate decode are all
//    refused from the container HEADER, before a full decode and before any
//    upload. A 10 MiB animated WebP can decode to gigabytes of frames; reading
//    metadata first is what keeps a hostile upload a 400 instead of an OOM.
// 2. **Deterministic output.** Same input bytes + same profile version ⇒ same
//    output bytes. The profile version enters the idempotency fingerprint
//    (§6), so a codec/option change is a NEW fingerprint rather than a silent
//    re-encode under an old key.

/** The pinned encode profile. Any change here MUST bump `MEDIA_PROFILE_VERSION`. */
export const WEBP_ENCODE_OPTIONS = {
  quality: 82,
  alphaQuality: 100,
  lossless: false,
  nearLossless: false,
  smartSubsample: true,
  effort: 4,
} as const;

/** A file part as read off the multipart request, before any decode. */
export interface UploadedImage {
  fieldname: string;
  filename: string;
  contentType: string;
  body: Buffer;
}

/** The normalizer's output — canonical bytes plus everything the fingerprint needs. */
export interface NormalizedImage {
  /** Canonical WebP bytes; the ONLY bytes that ever reach object storage. */
  body: Buffer;
  /** Derived from the canonical OUTPUT, never from the client's declared type. */
  contentType: typeof CANONICAL_IMAGE_MIME;
  width: number;
  height: number;
  /** SHA-256 of the ORIGINAL upload — the fingerprint input (§6). */
  sourceSha256: string;
  /** Byte length of the ORIGINAL upload — the fingerprint input (§6). */
  sourceBytes: number;
  /** SHA-256 of the canonical output — the storage-key seed. */
  canonicalSha256: string;
  profileVersion: string;
  /** The exact codec build the bytes were produced with, for the audit trail. */
  codecBuild: string;
}

/** The pinned codec build string, e.g. `sharp-0.35.3/libwebp-1.6.0/libvips-8.18.3`. */
export function codecBuild(): string {
  const v = sharp.versions as Record<string, string | undefined>;
  return `sharp-${v.sharp ?? "?"}/libwebp-${v.webp ?? "?"}/libvips-${v.vips ?? "?"}`;
}

@Injectable()
export class StillImageNormalizer {
  /**
   * Validate and normalize one uploaded still image. Throws
   * {@link TaxonomyError} `MEDIA_INVALID` (400) for every rejected input —
   * wrong type, animated/multi-frame container, oversized bytes/dimensions,
   * over-budget decode, or an undecodable body.
   */
  async normalize(file: UploadedImage): Promise<NormalizedImage> {
    if (file.body.length === 0) {
      throw new TaxonomyError("MEDIA_INVALID", "the uploaded file is empty");
    }
    if (file.body.length > MAX_IMAGE_BYTES) {
      throw new TaxonomyError(
        "MEDIA_INVALID",
        `the image exceeds the ${MAX_IMAGE_BYTES}-byte limit`,
      );
    }
    // The declared part type is a cheap first filter; the authority is the
    // decoded container format below, so a renamed GIF cannot slip through.
    if (
      !(ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(
        file.contentType,
      )
    ) {
      throw new TaxonomyError(
        "MEDIA_INVALID",
        "only JPEG, PNG and WebP still images are accepted",
      );
    }

    // Container-level animation detection, BEFORE handing the bytes to the
    // decoder. This is not redundant with the `pages` check below: the pinned
    // libvips build reports no page count for an APNG (it would silently
    // normalize the default frame only), so a header-flag check is the only
    // thing that actually REFUSES an APNG as §2.2 requires. Both checks stay —
    // a future codec build that grows APNG paging must not weaken the refusal.
    if (isApng(file.body)) {
      throw new TaxonomyError(
        "MEDIA_INVALID",
        "animated and multi-frame images are not accepted",
      );
    }
    if (isAnimatedWebp(file.body)) {
      throw new TaxonomyError(
        "MEDIA_INVALID",
        "animated and multi-frame images are not accepted",
      );
    }

    let meta: Metadata;
    try {
      // `metadata()` parses the header only — no full-frame allocation.
      meta = await sharp(file.body, { failOn: "error" }).metadata();
    } catch {
      throw new TaxonomyError("MEDIA_INVALID", "the image could not be decoded");
    }

    if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format)) {
      throw new TaxonomyError(
        "MEDIA_INVALID",
        "only JPEG, PNG and WebP still images are accepted",
      );
    }
    // Animated containers report `pages > 1` (animated WebP, APNG, multi-page
    // TIFF-in-disguise). Anything but exactly one frame is refused — including a
    // decoder that reports two frames for what looks like a still.
    if (meta.pages !== undefined && meta.pages !== 1) {
      throw new TaxonomyError(
        "MEDIA_INVALID",
        "animated and multi-frame images are not accepted",
      );
    }
    if (meta.delay !== undefined && meta.delay.length > 0) {
      throw new TaxonomyError(
        "MEDIA_INVALID",
        "animated and multi-frame images are not accepted",
      );
    }

    const { width, height } = orientedSize(meta);
    if (width <= 0 || height <= 0) {
      throw new TaxonomyError(
        "MEDIA_INVALID",
        "the image reports no usable dimensions",
      );
    }
    if (width > MAX_IMAGE_SIDE_PX || height > MAX_IMAGE_SIDE_PX) {
      throw new TaxonomyError(
        "MEDIA_INVALID",
        `each side must be at most ${MAX_IMAGE_SIDE_PX} px after orientation`,
      );
    }
    if (width * height > MAX_IMAGE_DECODED_PIXELS) {
      throw new TaxonomyError(
        "MEDIA_INVALID",
        `the decoded pixel budget is ${MAX_IMAGE_DECODED_PIXELS} px`,
      );
    }

    let out: { data: Buffer; info: OutputInfo };
    try {
      out = await sharp(file.body, { failOn: "error", animated: false })
        // Apply the EXIF orientation, then drop the metadata that carried it.
        .rotate()
        // Normalize colour into sRGB so two visually identical uploads in
        // different profiles converge on the same canonical bytes.
        .toColourspace("srgb")
        // No `withMetadata()`/`keepExif()` call: sharp strips EXIF/XMP/GPS/ICC
        // and every other ancillary block by default, which is exactly §2.2's
        // requirement. Asking to keep metadata here would be the bug.
        .webp(WEBP_ENCODE_OPTIONS)
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new TaxonomyError("MEDIA_INVALID", "the image could not be decoded");
    }

    return {
      body: out.data,
      contentType: CANONICAL_IMAGE_MIME,
      width: out.info.width,
      height: out.info.height,
      sourceSha256: sha256(file.body),
      sourceBytes: file.body.length,
      canonicalSha256: sha256(out.data),
      profileVersion: MEDIA_PROFILE_VERSION,
      codecBuild: codecBuild(),
    };
  }
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Whether `body` is an APNG — a PNG carrying an `acTL` animation-control chunk
 * ahead of the first `IDAT`. Walks the chunk list rather than searching the raw
 * bytes, so pixel data that happens to contain the four ASCII letters cannot
 * produce a false rejection.
 */
export function isApng(body: Buffer): boolean {
  if (body.length < 8 || !body.subarray(0, 8).equals(PNG_SIGNATURE)) return false;
  let offset = 8;
  while (offset + 8 <= body.length) {
    const length = body.readUInt32BE(offset);
    const type = body.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    offset += 12 + length;
  }
  return false;
}

/**
 * Whether `body` is an animated WebP — an extended (`VP8X`) RIFF container whose
 * flags byte sets the ANIMATION bit (0x02).
 */
export function isAnimatedWebp(body: Buffer): boolean {
  if (body.length < 16) return false;
  if (body.toString("ascii", 0, 4) !== "RIFF") return false;
  if (body.toString("ascii", 8, 12) !== "WEBP") return false;
  let offset = 12;
  while (offset + 8 <= body.length) {
    const fourcc = body.toString("ascii", offset, offset + 4);
    const size = body.readUInt32LE(offset + 4);
    if (fourcc === "VP8X") {
      return offset + 8 < body.length && (body[offset + 8]! & 0x02) !== 0;
    }
    if (fourcc === "ANIM" || fourcc === "ANMF") return true;
    offset += 8 + size + (size % 2);
  }
  return false;
}

/** Post-orientation dimensions: EXIF orientations 5–8 swap the axes. */
function orientedSize(meta: Metadata): {
  width: number;
  height: number;
} {
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const swap = (meta.orientation ?? 1) >= 5;
  return swap ? { width: height, height: width } : { width, height };
}

export function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}
