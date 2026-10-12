import { describe, expect, it } from "vitest";
import { mirrorPhoneFields } from "./user-mirror.service.js";

// 003 EARS-58 (#2449): the mirror upsert (webhook, reconcile sweep, self-heal)
// holds a phone only while the IdP holds it verified, and clears both columns
// whenever the IdP phone is absent or unverified.
describe("003 EARS-58 mirror phone projection", () => {
  it("EARS-58: a verified IdP phone is written as the confirmed phone", () => {
    expect(
      mirrorPhoneFields({
        zitadelSub: "s",
        phone: "+79991234567",
        phoneVerified: true,
      }),
    ).toEqual({ phone: "+79991234567", phoneVerified: true });
  });

  it("EARS-58: an unverified IdP phone writes nothing onto users.phone and clears a confirmed one", () => {
    expect(
      mirrorPhoneFields({
        zitadelSub: "s",
        phone: "+79997654321",
        phoneVerified: false,
      }),
    ).toEqual({ phone: null, phoneVerified: false });
  });

  it("EARS-58: an absent IdP phone clears both columns", () => {
    expect(
      mirrorPhoneFields({ zitadelSub: "s", phoneVerified: false }),
    ).toEqual({ phone: null, phoneVerified: false });
    expect(
      mirrorPhoneFields({ zitadelSub: "s", phone: "+79991234567" }),
    ).toEqual({ phone: null, phoneVerified: false });
  });

  it("EARS-58: a payload that carries no phone fields leaves the phone columns untouched", () => {
    expect(
      mirrorPhoneFields({ zitadelSub: "s", email: "a@b.test" }),
    ).toBeUndefined();
  });
});
