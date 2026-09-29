import { describe, expect, it } from "vitest";
import {
  CONGRESS_INTAKE_CLOSING_NOT_AFTER_OPENING,
  CONGRESS_INTAKE_DEFAULTS,
  CONGRESS_INTAKE_OPENING_WITHOUT_CLOSING,
  CongressIntakeSettingsRequestSchema,
  type CongressIntakeSettings,
} from "@ds/schemas";
import {
  INTAKE_KIND_ORDER,
  formatIntakeDay,
  intakeFormFields,
  intakeRefusals,
  intakeRequest,
} from "./congress-intake-settings";

/** The GET body of an event with no settings row: the product defaults. */
function unconfigured(): CongressIntakeSettings {
  const kind = (k: "oral" | "poster" | "abstract") => ({
    kind: k,
    ...CONGRESS_INTAKE_DEFAULTS.kinds[k],
    opensAt: null,
    closesAt: null,
  });
  return {
    eventId: "00000000-0000-4000-8000-000000000001",
    configured: false,
    registrationUrl: null,
    firstAuthorCounts: false,
    kinds: {
      oral: kind("oral"),
      poster: kind("poster"),
      abstract: kind("abstract"),
    },
  };
}

describe("046 EARS-2 — the admin intake-settings form projection", () => {
  it("EARS-2: the three kinds read in the spec order — oral, poster, abstract", () => {
    expect(INTAKE_KIND_ORDER).toEqual(["oral", "poster", "abstract"]);
  });

  it("EARS-2: an event with no settings prefills the product defaults — abstracts 3, poster age 40, rule off, no dates", () => {
    const fields = intakeFormFields(unconfigured());
    expect(fields).toEqual({
      registrationUrl: "",
      firstAuthorCounts: false,
      kinds: {
        oral: { opensOn: "", lastDay: "", submitLimit: "", maxAgeYears: "" },
        poster: {
          opensOn: "",
          lastDay: "",
          submitLimit: "",
          maxAgeYears: "40",
        },
        abstract: {
          opensOn: "",
          lastDay: "",
          submitLimit: "3",
          maxAgeYears: "",
        },
      },
    });
    // Saving the untouched prefill writes exactly the product defaults.
    expect(intakeRequest(fields)).toEqual(CONGRESS_INTAKE_DEFAULTS);
  });

  it("EARS-2: entered values become the PUT body — empty is null, numbers are numbers, the address is trimmed", () => {
    const fields = intakeFormFields(unconfigured());
    fields.registrationUrl = "  https://orthobio.ru/registration  ";
    fields.firstAuthorCounts = true;
    fields.kinds.oral = {
      opensOn: "2026-11-01",
      lastDay: "2026-11-20",
      submitLimit: " 2 ",
      maxAgeYears: "",
    };
    const body = intakeRequest(fields);
    expect(body).toEqual({
      registrationUrl: "https://orthobio.ru/registration",
      firstAuthorCounts: true,
      kinds: {
        oral: {
          opensOn: "2026-11-01",
          lastDay: "2026-11-20",
          submitLimit: 2,
          maxAgeYears: null,
        },
        poster: {
          opensOn: null,
          lastDay: null,
          submitLimit: null,
          maxAgeYears: 40,
        },
        abstract: {
          opensOn: null,
          lastDay: null,
          submitLimit: 3,
          maxAgeYears: null,
        },
      },
    });
    expect(CongressIntakeSettingsRequestSchema.safeParse(body).success).toBe(
      true,
    );
  });

  it("EARS-2: a saved event reads back into the form it was entered from", () => {
    const saved = unconfigured();
    saved.configured = true;
    saved.registrationUrl = "https://orthobio.ru/registration";
    saved.kinds.poster = {
      ...saved.kinds.poster,
      opensOn: "2026-11-01",
      lastDay: "2026-11-20",
      submitLimit: 1,
      maxAgeYears: 35,
    };
    const fields = intakeFormFields(saved);
    expect(fields.registrationUrl).toBe("https://orthobio.ru/registration");
    expect(fields.kinds.poster).toEqual({
      opensOn: "2026-11-01",
      lastDay: "2026-11-20",
      submitLimit: "1",
      maxAgeYears: "35",
    });
  });

  it("EARS-3: a last day reads as a Moscow calendar date, «до {дата} включительно» copy takes it verbatim", () => {
    expect(formatIntakeDay("2026-11-20")).toBe("20.11.2026");
  });
});

describe("046 EARS-2 — server refusals land on their field", () => {
  /** The refusal body exactly as the server's own schema produces it. */
  function refusalOf(body: unknown) {
    const parsed = CongressIntakeSettingsRequestSchema.safeParse(body);
    expect(parsed.success).toBe(false);
    return parsed.success ? [] : parsed.error.issues;
  }

  it("EARS-2: a closing day before the opening day refuses on that kind's last day", () => {
    const fields = intakeFormFields(unconfigured());
    fields.kinds.poster.opensOn = "2026-11-10";
    fields.kinds.poster.lastDay = "2026-11-01";
    const issues = refusalOf(intakeRequest(fields));
    expect(issues[0]?.path).toEqual(["kinds", "poster", "lastDay"]);
    expect(intakeRefusals(issues)).toEqual([
      { field: "kinds.poster.lastDay", reason: "closingBeforeOpening" },
    ]);
    expect((issues[0] as { params?: { code?: string } }).params?.code).toBe(
      CONGRESS_INTAKE_CLOSING_NOT_AFTER_OPENING,
    );
  });

  it("EARS-2: an opening day without a last day refuses on that kind's last day", () => {
    const fields = intakeFormFields(unconfigured());
    fields.kinds.oral.opensOn = "2026-11-10";
    const issues = refusalOf(intakeRequest(fields));
    expect((issues[0] as { params?: { code?: string } }).params?.code).toBe(
      CONGRESS_INTAKE_OPENING_WITHOUT_CLOSING,
    );
    expect(intakeRefusals(issues)).toEqual([
      { field: "kinds.oral.lastDay", reason: "openingWithoutClosing" },
    ]);
  });

  it("EARS-2: a limit that is not a positive integer and an age outside 18…99 refuse on their own fields", () => {
    const fields = intakeFormFields(unconfigured());
    fields.kinds.abstract.submitLimit = "0";
    fields.kinds.poster.maxAgeYears = "17";
    fields.registrationUrl = "ftp://orthobio.ru";
    const refusals = intakeRefusals(refusalOf(intakeRequest(fields)));
    expect(refusals).toEqual(
      expect.arrayContaining([
        { field: "kinds.abstract.submitLimit", reason: "submitLimit" },
        { field: "kinds.poster.maxAgeYears", reason: "maxAgeYears" },
        { field: "registrationUrl", reason: "registrationUrl" },
      ]),
    );
    expect(refusals).toHaveLength(3);
  });

  it("EARS-2: a body that is not a list of field issues maps to nothing — the caller shows the general refusal", () => {
    expect(intakeRefusals(undefined)).toEqual([]);
    expect(intakeRefusals([{ path: ["unknown"], code: "custom" }])).toEqual([]);
    expect(intakeRefusals("Validation failed")).toEqual([]);
  });
});
