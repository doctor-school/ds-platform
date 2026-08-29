import { describe, expect, it } from "vitest";

import {
  AdminTaxonomyListQuerySchema,
  CreateExpertRequestSchema,
  CreateProjectRequestSchema,
  expertDisplayName,
  expertInitials,
  ExpertAdminDetailSchema,
  ExpertAdminListItemSchema,
  EligibleExpertUserListSchema,
  EligibleExpertUserQuerySchema,
  CreateDirectionRequestSchema,
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
  DirectionAdminDetailSchema,
  DirectionAdminListItemSchema,
  UpdateExpertRequestSchema,
  UpdateDirectionRequestSchema,
  UpdateProjectRequestSchema,
  CreateEventProjectRequestSchema,
  EventProjectAdminDetailSchema,
  LifecycleImpactRowSchema,
  LifecycleImpactSchema,
  PublicCursorQuerySchema,
  PublicEventSummarySchema,
  PublicProjectSummarySchema,
  PUBLIC_PAGE_SIZE_MAX,
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
    expect(
      UpdateProjectRequestSchema.safeParse({ mediaAction: "clear" }).success,
    ).toBe(true);
    expect(
      UpdateProjectRequestSchema.safeParse({ mediaAction: "set" }).success,
    ).toBe(false);
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
    expect(slugifyTaxonomyTitle("Школа кардиологии")).toBe(
      "shkola-kardiologii",
    );
    expect(slugifyTaxonomyTitle("  Щи & Ёлка — 2026!  ")).toBe(
      "shchi-elka-2026",
    );
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
    expect(
      AdminTaxonomyListQuerySchema.safeParse({ status: "gone" }).success,
    ).toBe(false);
  });

  it("012 EARS-17: only canonical lowercase UUID text shall be a valid idempotency key", () => {
    expect(
      isCanonicalIdempotencyKey("6f9619ff-8b86-4d01-b42d-00cf4fc964ff"),
    ).toBe(true);
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
  it("012 EARS-19: when the Expert form requests eligible Users, the schema shall bound pagination, trim search and validate the current Expert id", () => {
    expect(
      EligibleExpertUserQuerySchema.parse({
        q: "  doctor@example.test  ",
        currentExpertId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toEqual({
      q: "doctor@example.test",
      page: 1,
      pageSize: 20,
      currentExpertId: "11111111-1111-4111-8111-111111111111",
    });
    expect(
      EligibleExpertUserQuerySchema.safeParse({ pageSize: "101" }).success,
    ).toBe(false);
    expect(
      EligibleExpertUserQuerySchema.safeParse({ currentExpertId: "expert-1" })
        .success,
    ).toBe(false);
  });

  it("012 EARS-19: when eligible User options cross the wire, the schema shall expose only stable id, display name and email", () => {
    const option = {
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "Иван Иванов",
      email: "doctor@example.test",
    };
    expect(
      EligibleExpertUserListSchema.parse({
        data: [option],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
    ).toEqual({ data: [option], total: 1, page: 1, pageSize: 20 });
    expect(
      EligibleExpertUserListSchema.safeParse({
        data: [{ ...option, phone: "+79990000000" }],
        total: 1,
        page: 1,
        pageSize: 20,
      }).success,
    ).toBe(false);
  });

  it("EARS-19: when an Expert is authored, the system shall accept an optional User link and explicit unlink", () => {
    const userId = "11111111-1111-4111-8111-111111111111";

    expect(
      CreateExpertRequestSchema.safeParse({
        familyName: "Иванов",
        givenName: "Иван",
        patronymic: "Иванович",
        userId,
      }).success,
    ).toBe(true);
    expect(UpdateExpertRequestSchema.safeParse({ userId }).success).toBe(true);
    expect(UpdateExpertRequestSchema.safeParse({ userId: null }).success).toBe(
      true,
    );
  });

  it("EARS-20: when an Expert is authored, the system shall require structured names and derive its display name", () => {
    expect(
      CreateExpertRequestSchema.safeParse({
        familyName: "Иванов",
        givenName: "Иван",
        patronymic: "Иванович",
      }).success,
    ).toBe(true);
    expect(
      CreateExpertRequestSchema.safeParse({
        familyName: "Иванов",
        givenName: "Иван",
      }).success,
    ).toBe(true);
    expect(
      CreateExpertRequestSchema.safeParse({ name: "Иванов Иван" }).success,
    ).toBe(false);
    expect(
      expertDisplayName({
        familyName: "Иванов",
        givenName: "Иван",
        patronymic: "Иванович",
      }),
    ).toBe("Иванов Иван Иванович");
  });

  it("012 EARS-2: when an expert create omits a required structured name or exceeds a field bound, the schema shall refuse it", () => {
    expect(CreateExpertRequestSchema.safeParse({}).success).toBe(false);
    expect(
      CreateExpertRequestSchema.safeParse({ familyName: "", givenName: "Иван" })
        .success,
    ).toBe(false);
    expect(
      CreateExpertRequestSchema.safeParse({
        familyName: "x".repeat(81),
        givenName: "Иван",
      }).success,
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
          familyName: "Иванов",
          givenName: "Иван",
          [field]: "x".repeat(max + 1),
        }).success,
      ).toBe(false);
      expect(
        CreateExpertRequestSchema.safeParse({
          familyName: "Иванов",
          givenName: "Иван",
          [field]: "x".repeat(max),
        }).success,
      ).toBe(true);
    }
    expect(
      CreateExpertRequestSchema.safeParse({
        familyName: "Иванов",
        givenName: "Иван",
      }).success,
    ).toBe(true);
  });

  it("012 EARS-2: when client JSON carries a storage reference or a create-time mediaAction, the schema shall refuse it", () => {
    // `.strict()` — an attempt to supply storage authority is a refusal, never
    // an ignored field (012-design §5.1).
    expect(
      CreateExpertRequestSchema.safeParse({
        familyName: "Иванов",
        givenName: "Иван",
        photoRef: "taxonomy/experts/photos/x.webp",
      }).success,
    ).toBe(false);
    expect(
      CreateExpertRequestSchema.safeParse({
        familyName: "Иванов",
        givenName: "Иван",
        photoUrl: "https://cdn.example/x.webp",
      }).success,
    ).toBe(false);
    // `mediaAction` is a PATCH-only verb: there is nothing to clear on create.
    expect(
      CreateExpertRequestSchema.safeParse({
        familyName: "Иванов",
        givenName: "Иван",
        mediaAction: "clear",
      }).success,
    ).toBe(false);
    expect(
      UpdateExpertRequestSchema.safeParse({ mediaAction: "clear" }).success,
    ).toBe(true);
    // The optional User link must be a canonical UUID.
    expect(
      CreateExpertRequestSchema.safeParse({
        familyName: "Иванов",
        givenName: "Иван",
        userId: "u1",
      }).success,
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
    // …but required structured names are only removed by editorial removal.
    expect(
      UpdateExpertRequestSchema.safeParse({ familyName: null }).success,
    ).toBe(false);
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
      familyName: "Иванов",
      givenName: "Иван",
      patronymic: null,
      userId: null,
      professionalRole: "Кардиолог",
      credentials: "д.м.н.",
      affiliation: "НМИЦ кардиологии",
      bio: "Биография",
      photoUrl: "https://cdn.example/photo.webp",
      initials: "ИИ",
      status: "draft" as const,
      firstPublishedAt: null,
      contentRemovedAt: null,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const parsed = ExpertAdminDetailSchema.parse(detail);
    expect(parsed).not.toHaveProperty("photoRef");
    expect(ExpertAdminListItemSchema.parse(detail)).not.toHaveProperty("bio");
  });

  it("012 EARS-3: when a direction create omits the title or exceeds its 120-char bound, the schema shall refuse it", () => {
    expect(CreateDirectionRequestSchema.safeParse({}).success).toBe(false);
    expect(CreateDirectionRequestSchema.safeParse({ title: "" }).success).toBe(
      false,
    );
    expect(
      CreateDirectionRequestSchema.safeParse({ title: "x".repeat(121) })
        .success,
    ).toBe(false);
    // 120 is the direction's own bound (012-design §2.2) — deliberately tighter
    // than the 160 a project title or an expert name allows.
    expect(
      CreateDirectionRequestSchema.safeParse({ title: "x".repeat(120) })
        .success,
    ).toBe(true);
    expect(
      CreateDirectionRequestSchema.safeParse({ title: "Кардиология" }).success,
    ).toBe(true);
  });

  it("EARS-18.7: when a direction request carries a slug, the schema shall refuse it rather than honour the override", () => {
    // The address is derived from the title by the server and frozen on first
    // publish (017-design §9.3). It is not an editorial decision, so `.strict()`
    // makes a posted `slug` a 400 — the derivation has exactly ONE
    // implementation and a client cannot opt out of it.
    for (const slug of ["kardiologiya", "", null]) {
      expect(
        CreateDirectionRequestSchema.safeParse({ title: "Кардиология", slug })
          .success,
      ).toBe(false);
      expect(UpdateDirectionRequestSchema.safeParse({ slug }).success).toBe(
        false,
      );
    }
    expect(
      CreateDirectionRequestSchema.parse({ title: "Детская кардиология" }),
    ).toEqual({ title: "Детская кардиология" });
  });

  it("012 EARS-3: when a direction request carries a field the entity does not have, the schema shall refuse it", () => {
    // A direction has NO description and NO media (012-design §2 ER, §5.2
    // `PublicDirection { id, slug, title }`). `.strict()` turns an attempt to author
    // one into a refusal instead of a silently dropped field the operator would
    // believe was stored.
    for (const extra of [
      { description: "Про сердце" },
      { coverRef: "taxonomy/directions/covers/x.webp" },
      { mediaAction: "clear" },
      { kind: "school" },
    ]) {
      expect(
        CreateDirectionRequestSchema.safeParse({
          title: "Кардиология",
          ...extra,
        }).success,
      ).toBe(false);
      expect(
        UpdateDirectionRequestSchema.safeParse({
          title: "Кардиология",
          ...extra,
        }).success,
      ).toBe(false);
    }
  });

  it("012 EARS-3: when a direction PATCH omits a field, the schema shall mean unchanged — and shall refuse a null title", () => {
    const empty = UpdateDirectionRequestSchema.parse({});
    expect(Object.keys(empty)).toHaveLength(0);
    expect(
      UpdateDirectionRequestSchema.safeParse({ title: "Кардиология" }).success,
    ).toBe(true);
    // `title` is the direction's only descriptive value and NOT NULL in the DB,
    // so it is never cleared.
    expect(
      UpdateDirectionRequestSchema.safeParse({ title: null }).success,
    ).toBe(false);
  });

  it("012 EARS-3: when an admin direction detail is projected, it shall carry exactly the curated identity", () => {
    const detail = {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "kardiologiya",
      title: "Кардиология",
      status: "draft" as const,
      firstPublishedAt: null,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const parsed = DirectionAdminDetailSchema.parse(detail);
    expect(parsed).not.toHaveProperty("description");
    expect(parsed).not.toHaveProperty("coverUrl");
    // No `slugEditable` counterpart: "may the operator change the public URL"
    // has one permanent answer, and a boolean stating it would advertise an
    // affordance the interface does not offer.
    expect(parsed).not.toHaveProperty("slugEditable");
    expect(DirectionAdminListItemSchema.parse(detail)).not.toHaveProperty(
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
        CreatePartnerRequestSchema.safeParse({
          title: "Партнёр",
          websiteUrl: bad,
        }).success,
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

// 012 EARS-6 (#1288) — the wire-contract half of the event↔project relationship.
// The public summaries are a DISCLOSURE boundary (012-design §5.2): a field added
// to an admin projection must be unable to reach them by being spread into a
// response, which is what `.strict()` is asserted for here.

const PUBLIC_PROJECT_SUMMARY_KEYS = [
  "id",
  "slug",
  "kind",
  "title",
  "description",
  "coverUrl",
  "primaryPartner",
] as const;

const PUBLIC_EVENT_SUMMARY_KEYS = [
  "id",
  "slug",
  "title",
  "school",
  "startsAt",
  "state",
] as const;

const publicProjectSummary = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "kardio-school",
  kind: "school" as const,
  title: "Кардиошкола",
  description: null,
  coverUrl: null,
  primaryPartner: null,
};

const publicEventSummary = {
  id: "33333333-3333-4333-8333-333333333333",
  slug: "vebinar-2026",
  title: "Вебинар 2026",
  school: "Кардиошкола",
  startsAt: new Date().toISOString(),
  state: "published",
};

describe("012 EARS-6 — event↔project relationship contract (SSOT)", () => {
  it("012 EARS-6: when a public project summary is projected, it shall carry exactly the §5.2 key set and refuse any admin or storage field", () => {
    const parsed = PublicProjectSummarySchema.parse(publicProjectSummary);
    expect(Object.keys(parsed).sort()).toEqual(
      [...PUBLIC_PROJECT_SUMMARY_KEYS].sort(),
    );
    for (const leak of [
      { coverRef: "taxonomy/projects/covers/a.webp" },
      { status: "draft" },
      { version: 1 },
      { deletedAt: null },
      { relationshipId: "44444444-4444-4444-8444-444444444444" },
    ]) {
      expect(
        PublicProjectSummarySchema.safeParse({
          ...publicProjectSummary,
          ...leak,
        }).success,
        `public project summary must refuse ${JSON.stringify(leak)}`,
      ).toBe(false);
    }
  });

  it("012 EARS-6: when a public event summary is projected, it shall carry exactly the §5.2 key set and refuse any admin or storage field", () => {
    const parsed = PublicEventSummarySchema.parse(publicEventSummary);
    expect(Object.keys(parsed).sort()).toEqual(
      [...PUBLIC_EVENT_SUMMARY_KEYS].sort(),
    );
    for (const leak of [
      { coverRef: "events/covers/a.webp" },
      { coverUrl: "https://cdn.example.org/a.webp" },
      { version: 2 },
      { deletedAt: null },
    ]) {
      expect(
        PublicEventSummarySchema.safeParse({ ...publicEventSummary, ...leak })
          .success,
        `public event summary must refuse ${JSON.stringify(leak)}`,
      ).toBe(false);
    }
  });

  it("012 EARS-6: when a public traversal is paged, the schema shall bound the limit and keep the cursor opaque", () => {
    expect(PublicCursorQuerySchema.parse({}).limit).toBe(20);
    expect(PublicCursorQuerySchema.parse({ limit: "5" }).limit).toBe(5);
    expect(
      PublicCursorQuerySchema.safeParse({ limit: PUBLIC_PAGE_SIZE_MAX + 1 })
        .success,
    ).toBe(false);
    expect(PublicCursorQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(PublicCursorQuerySchema.safeParse({ cursor: "" }).success).toBe(
      false,
    );
    // An unknown query key is a caller mistake, not a silently ignored field.
    expect(PublicCursorQuerySchema.safeParse({ offset: 10 }).success).toBe(
      false,
    );
  });

  it("012 EARS-6: when an affected row is previewed, the schema shall require an operator-readable title and refuse a draft status", () => {
    const row = {
      kind: "event↔project" as const,
      id: "44444444-4444-4444-8444-444444444444",
      title: "Вебинар 2026 — Кардиошкола",
      slug: null,
      status: "active" as const,
    };
    expect(LifecycleImpactRowSchema.parse(row)).toEqual(row);
    expect(
      LifecycleImpactRowSchema.safeParse({ ...row, title: null }).success,
    ).toBe(false);
    expect(
      LifecycleImpactRowSchema.safeParse({ ...row, title: "" }).success,
    ).toBe(false);
    // `draft` never appears — the affected list is scoped to public projections.
    expect(
      LifecycleImpactRowSchema.safeParse({ ...row, status: "draft" }).success,
    ).toBe(false);
    expect(
      LifecycleImpactRowSchema.safeParse({ ...row, kind: "event↔partner" })
        .success,
    ).toBe(false);

    const impact = {
      transition: "retire" as const,
      version: 1,
      affected: [row],
      impactToken: "signed.envelope.value",
    };
    expect(LifecycleImpactSchema.parse(impact)).toEqual(impact);
    // A transition with no visible consequence is an EMPTY list, never absent.
    expect(
      LifecycleImpactSchema.parse({ ...impact, affected: [] }).affected,
    ).toEqual([]);
    expect(
      LifecycleImpactSchema.safeParse({ ...impact, impactToken: "" }).success,
    ).toBe(false);
    expect(
      LifecycleImpactSchema.safeParse({ ...impact, version: 0 }).success,
    ).toBe(false);
    expect(
      LifecycleImpactSchema.safeParse({ ...impact, transition: "delete" })
        .success,
    ).toBe(false);
  });

  it("012 EARS-6: when a relate request is made, the schema shall demand two endpoint ids and refuse a client-supplied lifecycle field", () => {
    const body = {
      eventId: "33333333-3333-4333-8333-333333333333",
      projectId: "22222222-2222-4222-8222-222222222222",
    };
    expect(CreateEventProjectRequestSchema.parse(body)).toEqual(body);
    expect(
      CreateEventProjectRequestSchema.safeParse({ eventId: body.eventId })
        .success,
    ).toBe(false);
    for (const bad of ["", "not-a-uuid", "33333333-3333-4333-8333"]) {
      expect(
        CreateEventProjectRequestSchema.safeParse({ ...body, projectId: bad })
          .success,
        `projectId ${JSON.stringify(bad)} must be refused`,
      ).toBe(false);
    }
    // Lifecycle moves via retire/restore behind the §3.1 impact gate only.
    for (const leak of [
      { status: "active" },
      { version: 1 },
      { deletedAt: null },
    ]) {
      expect(
        CreateEventProjectRequestSchema.safeParse({ ...body, ...leak }).success,
        `create body must refuse ${JSON.stringify(leak)}`,
      ).toBe(false);
    }
  });

  it("012 EARS-6: when a relationship is projected for the admin, it shall round-trip both endpoints' display forms", () => {
    const detail = {
      id: "44444444-4444-4444-8444-444444444444",
      eventId: "33333333-3333-4333-8333-333333333333",
      eventTitle: "Вебинар 2026",
      eventSlug: "vebinar-2026",
      projectId: "22222222-2222-4222-8222-222222222222",
      projectTitle: "Кардиошкола",
      projectSlug: "kardio-school",
      status: "active" as const,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(EventProjectAdminDetailSchema.parse(detail)).toEqual(detail);
    expect(
      EventProjectAdminDetailSchema.safeParse({ ...detail, version: 0 })
        .success,
    ).toBe(false);
    expect(
      EventProjectAdminDetailSchema.safeParse({ ...detail, status: "draft" })
        .success,
    ).toBe(false);
  });
});
