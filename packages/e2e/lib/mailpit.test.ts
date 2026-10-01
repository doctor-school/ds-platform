import { describe, expect, it } from "vitest";

import { extractLoginCode, mailpitUrlFor, selectLoginMail } from "./mailpit.js";

describe("stage login mail selection", () => {
  it("EARS-6: derives the shared inbox from an Academy slot host", () => {
    expect(mailpitUrlFor("https://academy-pr-2442.stage.doctor.school")).toBe(
      "https://mailpit.stage.doctor.school",
    );
    expect(() => mailpitUrlFor("http://localhost:3000")).toThrow();
  });

  it("EARS-6: selects the newest login message after the request", () => {
    const messages = [
      {
        ID: "old",
        Created: "2026-09-29T06:00:00Z",
        Subject: "12345678 — код для входа в Doctor.School",
      },
      {
        ID: "verify",
        Created: "2026-09-29T06:01:01Z",
        Subject: "ABC123 — код подтверждения Doctor.School",
      },
      {
        ID: "new",
        Created: "2026-09-29T06:01:02Z",
        Subject: "87654321 — код для входа в Doctor.School",
      },
    ];
    expect(selectLoginMail(messages, "2026-09-29T06:01:00Z")?.ID).toBe("new");
    expect(selectLoginMail(messages, "2026-09-29T06:02:00Z")).toBeNull();
  });

  it("EARS-6: accepts only the eight-digit login code in its subject", () => {
    expect(extractLoginCode("87654321 — код для входа в Doctor.School")).toBe(
      "87654321",
    );
    expect(
      extractLoginCode("ABC123 — код для входа в Doctor.School"),
    ).toBeNull();
    expect(
      extractLoginCode("87654321 — код подтверждения Doctor.School"),
    ).toBeNull();
  });
});
