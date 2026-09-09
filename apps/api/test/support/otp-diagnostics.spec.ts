import { describe, expect, it } from "vitest";
import { diagnosticFetch, mailboxSnapshot } from "./otp-diagnostics.js";

describe("#2085 OTP failure diagnostics", () => {
  it("shows an empty user search without copying identities or arbitrary provider codes", async () => {
    const records: unknown[] = [];
    await diagnosticFetch(
      async () =>
        new Response(JSON.stringify({ result: [], code: "private-token" })),
      records,
    )("https://idp.test/v2/users", { method: "POST" });
    expect(records).toEqual([
      {
        method: "POST",
        route: "user-search",
        status: 200,
        userMatches: 0,
        sessionPresent: false,
        sessionTokenPresent: false,
      },
    ]);
  });
  it("retains rejected challenge status without leaking response or request secrets", async () => {
    const records: unknown[] = [];
    const response = new Response(
      JSON.stringify({
        code: 9,
        message: "secret-otp",
        sessionToken: "secret-token",
      }),
      { status: 400 },
    );
    const wrapped = diagnosticFetch(async () => response, records);
    expect(
      await wrapped("https://idp.test/v2/sessions?secret=hidden", {
        method: "POST",
        body: "private-email",
      }),
    ).toBe(response);
    expect(records).toEqual([
      {
        method: "POST",
        route: "sessions",
        status: 400,
        code: 9,
        sessionPresent: false,
        sessionTokenPresent: true,
      },
    ]);
    expect(JSON.stringify(records)).not.toMatch(/secret|private|https/);
    expect(await response.json()).toHaveProperty("message", "secret-otp");
  });
  it("records transport failures while preserving the original rejection", async () => {
    const records: unknown[] = [];
    const error = new Error("secret-password");
    await expect(
      diagnosticFetch(async () => {
        throw error;
      }, records)("https://idp.test/v2/users/private/otp_email"),
    ).rejects.toBe(error);
    expect(records).toEqual([
      { method: "GET", route: "email-factor", status: 0 },
    ]);
  });
  it("distinguishes stale mail from wrong subject without retaining subjects, recipients or codes", () => {
    expect(
      mailboxSnapshot(
        [
          {
            Created: "2026-09-09T00:00:00Z",
            Subject: "12345678 target",
            To: "private",
          },
          { Created: "2026-09-09T00:00:02Z", Subject: "secret other" },
        ],
        Date.parse("2026-09-09T00:00:01Z"),
        "target",
      ),
    ).toEqual({ messages: 2, fresh: 1, subjectMatches: 1, eligible: 0 });
  });
});
