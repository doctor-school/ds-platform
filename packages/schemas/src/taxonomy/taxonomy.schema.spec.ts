import { describe, expect, it } from "vitest";

import {
  AdminTaxonomyListQuerySchema,
  CreateExpertRequestSchema,
  CreateProjectRequestSchema,
  expertInitials,
  ExpertAdminDetailSchema,
  ExpertAdminListItemSchema,
  CreateTopicRequestSchema,
  CreatePartnerRequestSchema,
  PartnerAdminDetailSchema,
  PartnerAdminListItemSchema,
  PARTNER_TITLE_MAX,
  PARTNER_WEBSITE_URL_MAX,
  UpdatePartnerRequestSchema,
  isCanonicalIdempotencyKey,
  parseIfMatchVersion,
  slugifyTaxonomyTitle,
  SlugSchema,
  taxonomyETag,
  TopicAdminDetailSchema,
  TopicAdminListItemSchema,
  UpdateExpertRequestSchema,
  UpdateTopicRequestSchema,
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

// 012 EARS-2 (#1284) — the expert wire contract. Same rule as EARS-1: a bound
// asserted here is the bound the Refine form shows the operator BEFORE the
// round-trip and the one the server enforces after.
describe("012 taxonomy — expert authoring contract (SSOT)", () => {
  it("012 EARS-2: when an expert create omits the name or exceeds a field bound, the schema shall refuse it", () => {
    expect(CreateExpertRequestSchema.safeParse({}).success).toBe(false);
    expect(CreateExpertRequestSchema.safeParse({ name: "" }).success).toBe(false);
    expect(
      CreateExpertRequestSchema.safeParse({ name: "x".repeat(161) }).success,
    ).toBe(false);
    // Every §2.2 bound, at its exact edge.
    for (const [field, max] of [
      ["professionalRole", 160],
      ["credentials", 500],
      ["affiliation", 240],
      ["bio", 4000],
    ] as const) {
      expect(
        CreateExpertRequestSchema.safeParse({
          name: "Иванов Иван",
          [field]: "x".repeat(max + 1),
        }).success,
      ).toBe(false);
      expect(
        CreateExpertRequestSchema.safeParse({
          name: "Иванов Иван",
          [field]: "x".repeat(max),
        }).success,
      ).toBe(true);
    }
    expect(
      CreateExpertRequestSchema.safeParse({ name: "Иванов Иван" }).success,
    ).toBe(true);
  });

  it("012 EARS-2: when client JSON carries a storage reference or a create-time mediaAction, the schema shall refuse it", () => {
    // `.strict()` — an attempt to supply storage authority is a refusal, never
    // an ignored field (012-design §5.1).
    expect(
      CreateExpertRequestSchema.safeParse({
        name: "Иванов Иван",
        photoRef: "taxonomy/experts/photos/x.webp",
      }).success,
    ).toBe(false);
    expect(
      CreateExpertRequestSchema.safeParse({
        name: "Иванов Иван",
        photoUrl: "https://cdn.example/x.webp",
      }).success,
    ).toBe(false);
    // `mediaAction` is a PATCH-only verb: there is nothing to clear on create.
    expect(
      CreateExpertRequestSchema.safeParse({
        name: "Иванов Иван",
        mediaAction: "clear",
      }).success,
    ).toBe(false);
    expect(
      UpdateExpertRequestSchema.safeParse({ mediaAction: "clear" }).success,
    ).toBe(true);
    // There is NO required platform-user link, so no such field is accepted.
    expect(
      CreateExpertRequestSchema.safeParse({ name: "Иванов Иван", userId: "u1" })
        .success,
    ).toBe(false);
  });

  it("012 EARS-2: when an expert PATCH omits a field, the schema shall mean unchanged — and shall refuse a null display label", () => {
    const empty = UpdateExpertRequestSchema.parse({});
    expect(Object.keys(empty)).toHaveLength(0);
    // Explicit null clears an optional / still-incomplete draft field…
    expect(
      UpdateExpertRequestSchema.safeParse({ affiliation: null, bio: null })
        .success,
    ).toBe(true);
    // …but the display label is only ever removed by #1306's editorial removal.
    expect(UpdateExpertRequestSchema.safeParse({ name: null }).success).toBe(
      false,
    );
  });

  it("012 EARS-2: when an expert has no photo, initials shall be derived deterministically from the name", () => {
    expect(expertInitials("Иванов Иван Петрович")).toBe("ИИ");
    expect(expertInitials("Мария Смирнова")).toBe("МС");
    expect(expertInitials("  анна   ")).toBe("А");
    expect(expertInitials("John Ronald Reuel Tolkien")).toBe("JR");
    // Same input, same output — the admin renders what the API computed.
    expect(expertInitials("Иванов Иван")).toBe(expertInitials("Иванов Иван"));
    // No letter at all yields no fabricated glyph.
    expect(expertInitials("🙂 🙃")).toBe("");
    expect(expertInitials(null)).toBe("");
  });

  it("012 EARS-2: when an admin expert detail is projected, it shall carry no storage key", () => {
    const detail = {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "ivanov-ivan",
      name: "Иванов Иван",
      professionalRole: "Кардиолог",
      credentials: "д.м.н.",
      affiliation: "НМИЦ кардиологии",
      bio: "Биография",
      photoUrl: "https://cdn.example/photo.webp",
      initials: "ИИ",
      status: "draft" as const,
      firstPublishedAt: null,
      slugEditable: true,
      contentRemovedAt: null,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const parsed = ExpertAdminDetailSchema.parse(detail);
    expect(parsed).not.toHaveProperty("photoRef");
    expect(ExpertAdminListItemSchema.parse(detail)).not.toHaveProperty("bio");
  });

  it("012 EARS-3: when a topic create omits the title or exceeds its 120-char bound, the schema shall refuse it", () => {
    expect(CreateTopicRequestSchema.safeParse({}).success).toBe(false);
    expect(CreateTopicRequestSchema.safeParse({ title: "" }).success).toBe(
      false,
    );
    expect(
      CreateTopicRequestSchema.safeParse({ title: "x".repeat(121) }).success,
    ).toBe(false);
    // 120 is the topic's own bound (012-design §2.2) — deliberately tighter
    // than the 160 a project title or an expert name allows.
    expect(
      CreateTopicRequestSchema.safeParse({ title: "x".repeat(120) }).success,
    ).toBe(true);
    expect(
      CreateTopicRequestSchema.safeParse({ title: "Кардиология" }).success,
    ).toBe(true);
    // An authored slug is optional; the server generates one from the title.
    expect(
      CreateTopicRequestSchema.parse({
        title: "Кардиология",
        slug: "kardiologiya",
      }).slug,
    ).toBe("kardiologiya");
  });

  it("012 EARS-3: when a topic request carries a field the entity does not have, the schema shall refuse it", () => {
    // A topic has NO description and NO media (012-design §2 ER, §5.2
    // `PublicTopic { id, slug, title }`). `.strict()` turns an attempt to author
    // one into a refusal instead of a silently dropped field the operator would
    // believe was stored.
    for (const extra of [
      { description: "Про сердце" },
      { coverRef: "taxonomy/topics/covers/x.webp" },
      { mediaAction: "clear" },
      { kind: "school" },
    ]) {
      expect(
        CreateTopicRequestSchema.safeParse({ title: "Кардиология", ...extra })
          .success,
      ).toBe(false);
      expect(
        UpdateTopicRequestSchema.safeParse({ title: "Кардиология", ...extra })
          .success,
      ).toBe(false);
    }
  });

  it("012 EARS-3: when a topic PATCH omits a field, the schema shall mean unchanged — and shall refuse a null title or slug", () => {
    const empty = UpdateTopicRequestSchema.parse({});
    expect(Object.keys(empty)).toHaveLength(0);
    expect(
      UpdateTopicRequestSchema.safeParse({ title: "Кардиология" }).success,
    ).toBe(true);
    // `title` is the topic's only descriptive value and NOT NULL in the DB;
    // `slug` is the permanent public identity. Neither is ever cleared.
    expect(UpdateTopicRequestSchema.safeParse({ title: null }).success).toBe(
      false,
    );
    expect(UpdateTopicRequestSchema.safeParse({ slug: null }).success).toBe(
      false,
    );
    // The slug grammar is the shared one — a canonical UUID is never a slug.
    expect(
      UpdateTopicRequestSchema.safeParse({
        slug: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(false);
  });

  it("012 EARS-3: when an admin topic detail is projected, it shall carry exactly the curated identity", () => {
    const detail = {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "kardiologiya",
      title: "Кардиология",
      status: "draft" as const,
      firstPublishedAt: null,
      slugEditable: true,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const parsed = TopicAdminDetailSchema.parse(detail);
    expect(parsed).not.toHaveProperty("description");
    expect(parsed).not.toHaveProperty("coverUrl");
    expect(TopicAdminListItemSchema.parse(detail)).not.toHaveProperty(
      "firstPublishedAt",
    );
  });
});

// 012 EARS-4 (#1286) — the partner wire contract. The partner-specific half of
// the matrix is the optional absolute-HTTPS website: everything else is the
// shared §2.2 vocabulary the sibling entities already prove.
describe("012 taxonomy — partner authoring contract (SSOT)", () => {
  it("012 EARS-4: when a partner create carries a title, the system shall accept it with an optional website and slug", () => {
    expect(
      CreatePartnerRequestSchema.parse({ title: "  Фармкомпания  " }),
    ).toEqual({ title: "Фармкомпания" });
    expect(
      CreatePartnerRequestSchema.parse({
        title: "Фармкомпания",
        websiteUrl: "https://example.org/ru/about?x=1#top",
        slug: "farmkompaniya",
      }).websiteUrl,
      // Stored VERBATIM — path, query and fragment survive, because a sponsor's
      // URL is their identity and a "tidied" one may point elsewhere.
    ).toBe("https://example.org/ru/about?x=1#top");
  });

  it("012 EARS-4: when the website is not an absolute https URL, the system shall reject it", () => {
    for (const bad of [
      "doctor.school",
      "/about",
      "http://example.org",
      "ftp://example.org",
      "javascript:alert(1)",
      "data:text/html,x",
      "https:///nohost",
      "",
    ]) {
      expect(
        CreatePartnerRequestSchema.safeParse({ title: "Партнёр", websiteUrl: bad })
          .success,
        `websiteUrl ${JSON.stringify(bad)} must be refused`,
      ).toBe(false);
    }
    expect(
      CreatePartnerRequestSchema.safeParse({
        title: "Партнёр",
        websiteUrl: `https://example.org/${"x".repeat(PARTNER_WEBSITE_URL_MAX)}`,
      }).success,
    ).toBe(false);
  });

  it("012 EARS-4: when the title is empty or over the matrix bound, the system shall reject it", () => {
    expect(CreatePartnerRequestSchema.safeParse({ title: "   " }).success).toBe(
      false,
    );
    expect(
      CreatePartnerRequestSchema.safeParse({
        title: "x".repeat(PARTNER_TITLE_MAX + 1),
      }).success,
    ).toBe(false);
  });

  it("012 EARS-16: when client JSON supplies a storage reference or mediaAction on create, the system shall reject the request", () => {
    expect(
      CreatePartnerRequestSchema.safeParse({
        title: "Партнёр",
        logoRef: "taxonomy/partners/logos/x.webp",
      }).success,
    ).toBe(false);
    expect(
      CreatePartnerRequestSchema.safeParse({
        title: "Партнёр",
        logoUrl: "https://cdn.example.org/x.webp",
      }).success,
    ).toBe(false);
    // `mediaAction` is a PATCH-only verb — there is nothing to clear on create.
    expect(
      CreatePartnerRequestSchema.safeParse({
        title: "Партнёр",
        mediaAction: "clear",
      }).success,
    ).toBe(false);
  });

  it("012 EARS-4: when a partner PATCH clears the website, the system shall accept null there but never for the title", () => {
    expect(UpdatePartnerRequestSchema.parse({ websiteUrl: null })).toEqual({
      websiteUrl: null,
    });
    expect(UpdatePartnerRequestSchema.parse({})).toEqual({});
    expect(
      UpdatePartnerRequestSchema.parse({ mediaAction: "clear" }).mediaAction,
    ).toBe("clear");
    expect(UpdatePartnerRequestSchema.safeParse({ title: null }).success).toBe(
      false,
    );
    expect(
      UpdatePartnerRequestSchema.safeParse({ mediaAction: "replace" }).success,
    ).toBe(false);
  });

  it("012 EARS-4: when an admin partner detail is projected, it shall carry the logo URL and never the storage key", () => {
    const detail = {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "farmkompaniya",
      title: "Фармкомпания",
      logoUrl: "https://cdn.example.org/taxonomy/partners/logos/a.webp",
      websiteUrl: null,
      status: "draft" as const,
      firstPublishedAt: null,
      slugEditable: true,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const parsed = PartnerAdminDetailSchema.parse(detail);
    expect(parsed).not.toHaveProperty("logoRef");
    expect(PartnerAdminListItemSchema.parse(detail)).not.toHaveProperty(
      "logoUrl",
    );
  });
});
