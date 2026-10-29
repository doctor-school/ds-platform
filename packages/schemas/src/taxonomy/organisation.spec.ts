import { describe, expect, it } from "vitest";

import {
  CreateOrganisationRequestSchema,
  ORGANISATION_DESCRIPTION_MAX,
  ORGANISATION_TITLE_MAX,
  OrganisationAdminDetailSchema,
  UpdateOrganisationRequestSchema,
} from "./organisation.js";
import {
  CreateOrganisationRoleRequestSchema,
  ORGANISATION_ROLE_TITLE_MAX,
  OrganisationRoleAdminListQuerySchema,
  UpdateOrganisationRoleRequestSchema,
} from "./organisation-role.js";

const ROLE_A = "03200000-0000-4000-8000-000000000001";
const ROLE_B = "03200000-0000-4000-8000-000000000002";

describe("032 organisation contract", () => {
  it("032 EARS-1: create accepts a trimmed title, an HTTPS website, a trimmed description, roles and both display rules", () => {
    expect(
      CreateOrganisationRequestSchema.parse({
        title: "  Фармкомпания  ",
        websiteUrl: "https://pharma.example",
        description: "  Описание  ",
        roleIds: [ROLE_A, ROLE_B],
        publicNameVisible: false,
        publicLogoVisible: true,
      }),
    ).toEqual({
      title: "Фармкомпания",
      websiteUrl: "https://pharma.example",
      description: "Описание",
      roleIds: [ROLE_A, ROLE_B],
      publicNameVisible: false,
      publicLogoVisible: true,
    });
  });

  it("032 EARS-1: the title is bounded 1–160 and the description 0–1000 after trimming", () => {
    expect(
      CreateOrganisationRequestSchema.safeParse({ title: "   " }).success,
    ).toBe(false);
    expect(
      CreateOrganisationRequestSchema.safeParse({
        title: "x".repeat(ORGANISATION_TITLE_MAX + 1),
      }).success,
    ).toBe(false);
    expect(
      CreateOrganisationRequestSchema.safeParse({
        title: "Т",
        description: "x".repeat(ORGANISATION_DESCRIPTION_MAX + 1),
      }).success,
    ).toBe(false);
    expect(
      CreateOrganisationRequestSchema.safeParse({
        title: "Т",
        description: "x".repeat(ORGANISATION_DESCRIPTION_MAX),
      }).success,
    ).toBe(true);
  });

  it("032 EARS-1: a non-HTTPS website or a client-supplied storage reference is refused", () => {
    expect(
      CreateOrganisationRequestSchema.safeParse({
        title: "Т",
        websiteUrl: "http://plain.example",
      }).success,
    ).toBe(false);
    expect(
      CreateOrganisationRequestSchema.safeParse({ title: "Т", logoRef: "k" })
        .success,
    ).toBe(false);
  });

  it("032 EARS-2: the role set is distinct canonical ids; a repeated or malformed id is refused, zero roles is accepted", () => {
    expect(
      CreateOrganisationRequestSchema.safeParse({
        title: "Т",
        roleIds: [ROLE_A, ROLE_A],
      }).success,
    ).toBe(false);
    expect(
      CreateOrganisationRequestSchema.safeParse({
        title: "Т",
        roleIds: ["investor"],
      }).success,
    ).toBe(false);
    expect(
      UpdateOrganisationRequestSchema.safeParse({ roleIds: [] }).success,
    ).toBe(true);
  });

  it("032 EARS-2: the admin detail carries each held role with its status, so a retired held role can be marked", () => {
    const parsed = OrganisationAdminDetailSchema.parse({
      id: ROLE_A,
      slug: "pharma",
      title: "Фарма",
      logoUrl: null,
      websiteUrl: null,
      description: null,
      publicNameVisible: true,
      publicLogoVisible: true,
      roles: [
        {
          id: ROLE_B,
          slug: "clinical-base",
          title: "Клиническая площадка",
          status: "retired",
        },
      ],
      status: "draft",
      firstPublishedAt: null,
      version: 1,
      createdAt: "2026-10-29T00:00:00.000Z",
      updatedAt: "2026-10-29T00:00:00.000Z",
    });
    expect(parsed.roles[0]?.status).toBe("retired");
  });
});

describe("032 organisation-role contract", () => {
  it("032 EARS-3: a role title is trimmed and bounded 1–80; nothing but the title is authored", () => {
    expect(
      CreateOrganisationRoleRequestSchema.parse({ title: "  Спонсор КМЕ " }),
    ).toEqual({
      title: "Спонсор КМЕ",
    });
    expect(
      CreateOrganisationRoleRequestSchema.safeParse({ title: "" }).success,
    ).toBe(false);
    expect(
      CreateOrganisationRoleRequestSchema.safeParse({
        title: "x".repeat(ORGANISATION_ROLE_TITLE_MAX + 1),
      }).success,
    ).toBe(false);
    expect(
      CreateOrganisationRoleRequestSchema.safeParse({ title: "Т", slug: "t" })
        .success,
    ).toBe(false);
    expect(
      UpdateOrganisationRoleRequestSchema.safeParse({ title: "Новое" }).success,
    ).toBe(true);
  });

  it("032 EARS-3: the list query filters by status only", () => {
    expect(
      OrganisationRoleAdminListQuerySchema.parse({ status: "active" }),
    ).toEqual({
      status: "active",
    });
    expect(
      OrganisationRoleAdminListQuerySchema.safeParse({ status: "draft" })
        .success,
    ).toBe(false);
  });
});
