import { describe, expect, it } from "vitest";
import {
  APPLICATION_KINDS,
  INVESTOR_REQUEST_CONSENT,
  INVESTOR_REQUEST_CONSENT_PURPOSE,
  INVESTOR_REQUEST_CONSENT_VERSION_TAG,
  InvestorRequestContactSchema,
  InvestorRequestIntakeSchema,
  InvestorRequestPayloadSchema,
} from "../index.js";

/**
 * 034 EARS-4, EARS-6 — the `investor` kind of the 033 application queue: the
 * body of `POST /v1/public/applications/investor`, its stored contact and
 * payload, and the consent the page and the intake read as one value.
 */
const body = {
  contact: {
    organisation: "ООО «Партнёр А»",
    fullName: "Анна Петрова",
    role: "Директор по развитию",
    email: "anna@partner-a.test",
    phone: "+7 900 000-00-00",
  },
  payload: { task: "Хотим войти в проект школы кардиологов" },
  consent: { accepted: true, versionTag: INVESTOR_REQUEST_CONSENT_VERSION_TAG },
};

describe("034 investor request schemas", () => {
  it("EARS-6: ApplicationKind has investor and the intake accepts a full body trimmed within its bounds", () => {
    expect(APPLICATION_KINDS).toContain("investor");
    const parsed = InvestorRequestIntakeSchema.parse({
      ...body,
      contact: { ...body.contact, organisation: "  ООО «Партнёр А»  " },
    });
    expect(parsed.contact.organisation).toBe("ООО «Партнёр А»");
    expect(
      InvestorRequestIntakeSchema.safeParse({
        ...body,
        contact: {
          organisation: "о".repeat(200),
          fullName: "ф".repeat(200),
          role: "р".repeat(120),
          email: `${"a".repeat(64)}@${"b".repeat(180)}.test`,
          phone: "1".repeat(32),
        },
        payload: { task: "з".repeat(2000) },
      }).success,
    ).toBe(true);
  });

  it("EARS-6: role, phone and task are optional — absent or empty — while organisation, full name and work email are required", () => {
    expect(
      InvestorRequestIntakeSchema.safeParse({
        contact: {
          organisation: "ООО «Партнёр А»",
          fullName: "Анна Петрова",
          email: "anna@partner-a.test",
        },
        payload: {},
        consent: body.consent,
      }).success,
    ).toBe(true);
    expect(
      InvestorRequestIntakeSchema.safeParse({
        ...body,
        contact: { ...body.contact, role: "  ", phone: "" },
        payload: { task: "" },
      }).success,
    ).toBe(true);
    for (const field of ["organisation", "fullName", "email"] as const) {
      const { [field]: _omitted, ...rest } = body.contact;
      expect(
        InvestorRequestIntakeSchema.safeParse({ ...body, contact: rest })
          .success,
        field,
      ).toBe(false);
    }
  });

  it("EARS-6: out-of-bounds values, a malformed work email and unknown fields are refused", () => {
    const bad = [
      { ...body, contact: { ...body.contact, organisation: "   " } },
      { ...body, contact: { ...body.contact, organisation: "о".repeat(201) } },
      { ...body, contact: { ...body.contact, fullName: "ф".repeat(201) } },
      { ...body, contact: { ...body.contact, role: "р".repeat(121) } },
      { ...body, contact: { ...body.contact, phone: "1".repeat(33) } },
      { ...body, contact: { ...body.contact, email: "anna@" } },
      {
        ...body,
        contact: {
          ...body.contact,
          email: `${"a".repeat(64)}@${"b".repeat(186)}.test`,
        },
      },
      { ...body, payload: { task: "з".repeat(2001) } },
      { ...body, extra: 1 },
      { ...body, contact: { ...body.contact, extra: 1 } },
    ];
    for (const b of bad)
      expect(InvestorRequestIntakeSchema.safeParse(b).success).toBe(false);
  });

  it("EARS-4: a body without the consent, or with the consent unticked, is refused on the consent field", () => {
    const { consent: _omitted, ...withoutConsent } = body;
    for (const b of [
      withoutConsent,
      { ...body, consent: { ...body.consent, accepted: false } },
      {
        ...body,
        consent: { versionTag: INVESTOR_REQUEST_CONSENT_VERSION_TAG },
      },
    ]) {
      const refused = InvestorRequestIntakeSchema.safeParse(b);
      expect(refused.success).toBe(false);
      expect(refused.error?.issues[0]?.path[0]).toBe("consent");
    }
  });

  it("EARS-4: the consent carries its own purpose, the current version tag and the page's text and policy link", () => {
    expect(INVESTOR_REQUEST_CONSENT_PURPOSE).toBe(
      "investor-request-personal-data",
    );
    expect(INVESTOR_REQUEST_CONSENT.versionTag).toBe(
      INVESTOR_REQUEST_CONSENT_VERSION_TAG,
    );
    expect(INVESTOR_REQUEST_CONSENT.policyHref).toBe(
      "/documents/privacy-policy",
    );
  });

  it("EARS-6: the stored contact and payload hold no empty optional value", () => {
    expect(
      InvestorRequestContactSchema.safeParse({ ...body.contact, role: "" })
        .success,
    ).toBe(false);
    expect(InvestorRequestPayloadSchema.safeParse({ task: "" }).success).toBe(
      false,
    );
    expect(InvestorRequestPayloadSchema.parse({})).toEqual({});
  });
});
