import { describe, expect, it } from "vitest";

import {
  CONGRESS_PERSONAL_DATA_PURPOSE,
  CONGRESS_SIGN_UP_CONSENT_PURPOSES,
  isCongressSignUpConsentPurpose,
} from "./congress-consent.js";

describe("044 congress sign-up — consent purposes", () => {
  it("EARS-9: when the intake records the participant's consent, system shall name the single congress personal-data purpose", () => {
    expect(CONGRESS_PERSONAL_DATA_PURPOSE).toBe("congress-personal-data");
    expect(CONGRESS_SIGN_UP_CONSENT_PURPOSES).toEqual([
      "congress-personal-data",
    ]);
  });

  it("EARS-10: when a purpose outside the congress surface is offered, system shall reject it as not belonging to this surface", () => {
    expect(isCongressSignUpConsentPurpose(CONGRESS_PERSONAL_DATA_PURPOSE)).toBe(
      true,
    );
    expect(isCongressSignUpConsentPurpose("medical-worker-declaration")).toBe(
      false,
    );
    expect(isCongressSignUpConsentPurpose("partner-data-sharing")).toBe(false);
    expect(isCongressSignUpConsentPurpose("")).toBe(false);
  });
});
