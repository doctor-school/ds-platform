import { describe, expect, it } from "vitest";
import {
  academyPublicOrigin,
  adminOriginOf,
  receiptRecipient,
} from "./application-notices.js";
import { APPLICATION_KIND_TABLE } from "./applications.kinds.js";

describe("033 application notices — resolvers", () => {
  it("EARS-12: the receipt goes to the account email for author, is not applicable for partnership, and takes the contact email for a no-account kind with a receipt", () => {
    expect(
      receiptRecipient(APPLICATION_KIND_TABLE.author.receiptTo, {
        accountEmail: "expert@ds.test",
        contact: null,
      }),
    ).toBe("expert@ds.test");
    expect(
      receiptRecipient(APPLICATION_KIND_TABLE.partnership.receiptTo, {
        accountEmail: null,
        contact: { emailOrTelegram: "partner@ds.test" },
      }),
    ).toBeNull();
    expect(
      receiptRecipient("contact-email", {
        accountEmail: null,
        contact: { email: "investor@ds.test" },
      }),
    ).toBe("investor@ds.test");
    // A kind with a receipt but no address is a failed send, never «not applicable».
    expect(
      receiptRecipient("account-email", { accountEmail: null, contact: null }),
    ).toBeUndefined();
    expect(
      receiptRecipient("contact-email", { accountEmail: null, contact: {} }),
    ).toBeUndefined();
  });

  it("EARS-11: the admin link sits on the admin sibling of the configured Academy host, and an underivable host is refused by name", () => {
    expect(adminOriginOf("https://academy.doctor.school")).toBe(
      "https://admin.doctor.school",
    );
    expect(adminOriginOf("https://academy-pr-7.stage.example")).toBe(
      "https://admin-pr-7.stage.example",
    );
    expect(() => adminOriginOf("http://localhost:3001")).toThrow(
      /cannot derive the admin origin/,
    );
    expect(() => adminOriginOf("https://academyx.doctor.school")).toThrow();
    expect(
      academyPublicOrigin({
        ACADEMY_PUBLIC_ORIGIN: " https://academy.ds.test/ ",
      }),
    ).toBe("https://academy.ds.test");
    expect(() => academyPublicOrigin({})).toThrow(/ACADEMY_PUBLIC_ORIGIN/);
  });
});
