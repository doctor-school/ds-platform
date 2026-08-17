import { describe, expect, it } from "vitest";

import {
  AdminTaxonomyListQuerySchema,
  CreateProjectRequestSchema,
  isCanonicalIdempotencyKey,
  parseIfMatchVersion,
  slugifyTaxonomyTitle,
  SlugSchema,
  taxonomyETag,
  UpdateProjectRequestSchema,
} from "./index.js";

// 012 EARS-1 (#1283) — the wire-contract half. These are the bounds the Refine
// form derives its client-side messages from, so a bound asserted here is a
// bound the operator sees BEFORE the round-trip and the server enforces after.

describe("012 taxonomy — authoring contract (SSOT)", () => {
  it("012 EARS-1: when a project create omits the title or exceeds its bound, the schema shall refuse it", () => {
    expect(
      CreateProjectRequestSchema.safeParse({ kind: "school" }).success,
    ).toBe(false);
    expect(
      CreateProjectRequestSchema.safeParse({ kind: "school", title: "" })
        .success,
    ).toBe(false);
    expect(
      CreateProjectRequestSchema.safeParse({
        kind: "school",
        title: "x".repeat(161),
      }).success,
    ).toBe(false);
    expect(
      CreateProjectRequestSchema.safeParse({
        kind: "school",
        title: "Школа кардиологии",
      }).success,
    ).toBe(true);
  });

  it("012 EARS-1: when a project create carries an unknown kind or an over-long description, the schema shall refuse it", () => {
    expect(
      CreateProjectRequestSchema.safeParse({ kind: "podcast", title: "Тест" })
        .success,
    ).toBe(false);
    expect(
      CreateProjectRequestSchema.safeParse({
        kind: "media",
        title: "Тест",
        description: "x".repeat(2001),
      }).success,
    ).toBe(false);
  });

  it("012 EARS-16: when client JSON supplies a storage reference, the schema shall refuse it rather than ignore it", () => {
    const withRef = CreateProjectRequestSchema.safeParse({
      kind: "school",
      title: "Тест",
      coverRef: "projects/covers/attacker.webp",
    });
    expect(withRef.success).toBe(false);
    const withUrl = UpdateProjectRequestSchema.safeParse({
      coverUrl: "https://example.test/x.webp",
    });
    expect(withUrl.success).toBe(false);
  });

  it("012 EARS-1: mediaAction shall be a PATCH-only verb", () => {
    expect(
      CreateProjectRequestSchema.safeParse({
        kind: "school",
        title: "Тест",
        mediaAction: "clear",
      }).success,
    ).toBe(false);
    expect(UpdateProjectRequestSchema.safeParse({ mediaAction: "clear" }).success).toBe(
      true,
    );
    expect(UpdateProjectRequestSchema.safeParse({ mediaAction: "set" }).success).toBe(
      false,
    );
  });

  it("012 EARS-1: an authored slug shall be lowercase-hyphen ASCII and never canonical UUID text", () => {
    expect(SlugSchema.safeParse("shkola-kardiologii").success).toBe(true);
    for (const bad of [
      "Not valid",
      "trailing-",
      "-leading",
      "double--hyphen",
      "под-чёрту",
      "00000000-0000-4000-8000-000000000000",
    ]) {
      expect(SlugSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("012 EARS-1: the shared slugifier shall transliterate Cyrillic deterministically", () => {
    expect(slugifyTaxonomyTitle("Школа кардиологии")).toBe("shkola-kardiologii");
    expect(slugifyTaxonomyTitle("  Щи & Ёлка — 2026!  ")).toBe("shchi-elka-2026");
    expect(slugifyTaxonomyTitle("Café Zürich")).toBe("cafe-zurich");
    // No sluggable character at all — the caller must refuse, never invent one.
    expect(slugifyTaxonomyTitle("🙂🙂")).toBe("");
    // Every produced value satisfies the wire schema.
    for (const title of ["Школа кардиологии", "Медиа-проект №3", "ABC"]) {
      const s = slugifyTaxonomyTitle(title);
      expect(SlugSchema.safeParse(s).success, `${title} → ${s}`).toBe(true);
    }
  });

  it("012 EARS-15: the admin list query shall default to page 1 and exclude retired rows", () => {
    const parsed = AdminTaxonomyListQuerySchema.parse({});
    expect(parsed).toMatchObject({
      page: 1,
      pageSize: 20,
      includeRetired: false,
    });
    expect(
      AdminTaxonomyListQuerySchema.parse({ includeRetired: "true" })
        .includeRetired,
    ).toBe(true);
    expect(
      AdminTaxonomyListQuerySchema.safeParse({ pageSize: "500" }).success,
    ).toBe(false);
    expect(AdminTaxonomyListQuerySchema.safeParse({ status: "gone" }).success).toBe(
      false,
    );
  });

  it("012 EARS-17: only canonical lowercase UUID text shall be a valid idempotency key", () => {
    expect(isCanonicalIdempotencyKey("6f9619ff-8b86-4d01-b42d-00cf4fc964ff")).toBe(
      true,
    );
    for (const bad of [
      "6F9619FF-8B86-4D01-B42D-00CF4FC964FF",
      "{6f9619ff-8b86-4d01-b42d-00cf4fc964ff}",
      "6f9619ff8b864d01b42d00cf4fc964ff",
      "",
    ]) {
      expect(isCanonicalIdempotencyKey(bad), bad).toBe(false);
    }
  });

  it("012 EARS-17: an If-Match echo of the issued ETag shall always parse back to its version", () => {
    expect(parseIfMatchVersion(taxonomyETag(7))).toBe(7);
    expect(parseIfMatchVersion('"7"')).toBe(7);
    expect(parseIfMatchVersion("7")).toBe(7);
    expect(parseIfMatchVersion(undefined)).toBeNull();
    expect(parseIfMatchVersion("*")).toBeNull();
    expect(parseIfMatchVersion('W/"abc"')).toBeNull();
  });
});
