import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertNoVerificationMail,
  extractLoginCode,
  fetchRecoveryCode,
  fetchRecoveryMail,
  mailpitUrlFor,
  selectLoginMail,
} from "./mailpit.js";

describe("stage login mail selection", () => {
  it("EARS-6: derives the shared inbox from an Academy slot host", () => {
    expect(mailpitUrlFor("https://academy-pr-2442.stage.doctor.school")).toBe(
      "https://mailpit.stage.doctor.school",
    );
    expect(() => mailpitUrlFor("http://localhost:3000")).toThrow();
  });

  it("#2670: the stage slot main derives mailpit.<suffix> from academy-main", () => {
    expect(mailpitUrlFor("https://academy-main.stage.doctor.school")).toBe(
      "https://mailpit.stage.doctor.school",
    );
    expect(() =>
      mailpitUrlFor("https://academy-foo.stage.doctor.school"),
    ).toThrow();
    expect(() =>
      mailpitUrlFor("https://academy-pr-0.stage.doctor.school"),
    ).toThrow();
  });

  it("EARS-6: selects the newest login message after the request", () => {
    const messages = [
      {
        ID: "old",
        Created: "2026-09-29T06:00:00Z",
        Subject: "193746 — код для входа в Doctor.School",
      },
      {
        ID: "verify",
        Created: "2026-09-29T06:01:01Z",
        Subject: "482913 — код подтверждения Doctor.School",
      },
      {
        ID: "new",
        Created: "2026-09-29T06:01:02Z",
        Subject: "550271 — код для входа в Doctor.School",
      },
    ];
    expect(selectLoginMail(messages, "2026-09-29T06:01:00Z")?.ID).toBe("new");
    expect(selectLoginMail(messages, "2026-09-29T06:02:00Z")).toBeNull();
  });

  it("EARS-6: accepts only the six-character login code in its subject", () => {
    expect(extractLoginCode("550271 — код для входа в Doctor.School")).toBe(
      "550271",
    );
    expect(
      extractLoginCode("87654321 — код для входа в Doctor.School"),
    ).toBeNull();
    expect(
      extractLoginCode("550271 — код подтверждения Doctor.School"),
    ).toBeNull();
  });
});

const after = "2026-10-12T00:00:00Z";
const email = "verified-2794@example.test";
const addressedMessage = (overrides = {}) => ({
  ID: "fresh",
  Created: after,
  Subject: "123456 — код подтверждения Doctor.School",
  To: [{ Address: email }],
  ...overrides,
});
function verificationMailClient(
  messages: unknown[],
  metadata: Record<string, unknown> = {},
) {
  return {
    get: vi.fn(async () => ({
      ok: () => true,
      status: () => 200,
      json: async () => ({
        total: 200,
        messages_count: messages.length,
        start: 0,
        ...metadata,
        messages,
      }),
    })),
  };
}
afterEach(() => vi.useRealTimers());

describe("fresh recovery-mail detail", () => {
  const subject = "123456 — код для входа в Doctor.School";
  function client(detail: Record<string, unknown>) {
    return {
      get: vi.fn(async (url: string) => ({
        ok: () => true,
        status: () => 200,
        json: async () =>
          url.includes("/message/")
            ? detail
            : {
                messages_count: 3,
                start: 0,
                messages: [
                  addressedMessage({
                    ID: "stale",
                    Subject: subject,
                    Created: "2026-10-11T00:00:00Z",
                  }),
                  addressedMessage({
                    ID: "foreign",
                    Subject: subject,
                    To: [{ Address: "other@example.test" }],
                  }),
                  addressedMessage({ Subject: subject }),
                ],
              },
      })),
    };
  }

  it("EARS-23: returns the code and both bodies from the exact fresh addressed re-registration mail", async () => {
    const detail = {
      ID: "fresh",
      Subject: subject,
      To: [{ Address: email }],
      Text: "123456 typed password is saved after confirmation",
      HTML: "<p>123456 typed password is saved after confirmation</p>",
    };
    const request = client(detail);
    await expect(
      fetchRecoveryMail(
        request,
        "https://mailpit.example.test",
        email.toUpperCase(),
        after,
        "login",
      ),
    ).resolves.toEqual({
      code: "123456",
      text: detail.Text,
      html: detail.HTML,
    });
    expect(request.get).toHaveBeenLastCalledWith(
      "https://mailpit.example.test/api/v1/message/fresh",
    );
    await expect(
      fetchRecoveryCode(
        client(detail),
        "https://mailpit.example.test",
        email,
        after,
        "login",
      ),
    ).resolves.toBe("123456");
  });

  it.each([
    { ID: "foreign" },
    { Subject: "654321 — код для входа в Doctor.School" },
    { To: [{ Address: "other@example.test" }] },
  ])(
    "EARS-23: rejects mismatched detail before returning code-bearing bodies %j",
    async (override) => {
      await expect(
        fetchRecoveryMail(
          client({
            ID: "fresh",
            Subject: subject,
            To: [{ Address: email }],
            Text: "code-bearing bytes",
            HTML: "code-bearing bytes",
            ...override,
          }),
          "https://mailpit.example.test",
          email,
          after,
          "login",
        ),
      ).rejects.toThrow(
        /^Mailpit code detail did not match its fresh addressed search result$/,
      );
    },
  );
});

describe("verified-account login excludes verification mail", () => {
  it("EARS-34: permits login mail and ignores stale or differently addressed verification mail through the full delivery horizon", async () => {
    vi.useFakeTimers();
    const request = verificationMailClient([
      addressedMessage({ Subject: "123456 — код для входа в Doctor.School" }),
      addressedMessage({ Created: "2026-10-11T00:00:00Z" }),
      addressedMessage({ To: [{ Address: "other@example.test" }] }),
    ]);
    let settled = false;
    const result = assertNoVerificationMail(
      request,
      "https://mailpit.example.test",
      email,
      after,
    ).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled, "absence cannot pass before the delivery deadline").toBe(
      false,
    );
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBeUndefined();
    expect(request.get).toHaveBeenCalledTimes(31);
  });

  it("EARS-34: rejects fresh verification mail to the exact recipient without exposing its code", async () => {
    const error = await assertNoVerificationMail(
      verificationMailClient([addressedMessage()]),
      "https://mailpit.example.test",
      email.toUpperCase(),
      after,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Unexpected verification mail after verified login-code request",
    );
  });

  it("EARS-34: rejects verification mail arriving at the end of the delivery horizon", async () => {
    vi.useFakeTimers();
    const messages: unknown[] = [];
    const result = assertNoVerificationMail(
      verificationMailClient(messages),
      "https://mailpit.example.test",
      email,
      after,
    );
    const assertion = expect(result).rejects.toThrow(
      "Unexpected verification mail",
    );
    await vi.advanceTimersByTimeAsync(14_500);
    messages.push(addressedMessage());
    await Promise.all([assertion, vi.advanceTimersByTimeAsync(500)]);
  });

  it.each([{ messages_count: 1 }, { start: 1 }])(
    "EARS-34: rejects incomplete verification-mail query metadata %j",
    async (metadata) => {
      await expect(
        assertNoVerificationMail(
          verificationMailClient([], metadata),
          "https://mailpit.example.test",
          email,
          after,
        ),
      ).rejects.toThrow("search payload");
    },
  );

  it("EARS-34: fails closed on transport errors without retaining credential-bearing diagnostics", async () => {
    const request = {
      get: async () => {
        throw new Error("credential-bearing transport bytes");
      },
    };
    await expect(
      assertNoVerificationMail(
        request,
        "https://mailpit.example.test",
        email,
        after,
      ),
    ).rejects.toThrow(/^Mailpit request failed$/);
  });

  it.each([
    { Subject: undefined },
    { Subject: 123456 },
    { Created: "invalid" },
    { To: [{ Address: 123 }] },
  ])("EARS-34: rejects malformed addressed-mail data %j", async (overrides) => {
    await expect(
      assertNoVerificationMail(
        verificationMailClient([addressedMessage(overrides)]),
        "https://mailpit.example.test",
        email,
        after,
      ),
    ).rejects.toThrow("search payload");
  });

  it("EARS-34: fails closed on unsuccessful or malformed Mailpit search responses", async () => {
    const unsuccessful = {
      get: async () => ({
        ok: () => false,
        status: () => 503,
        json: async () => ({}),
      }),
    };
    await expect(
      assertNoVerificationMail(
        unsuccessful,
        "https://mailpit.example.test",
        email,
        after,
      ),
    ).rejects.toThrow("Mailpit search failed with HTTP 503");
    const malformed = {
      get: async () => ({
        ok: () => true,
        status: () => 200,
        json: async () => {
          throw new Error("code-bearing JSON bytes");
        },
      }),
    };
    await expect(
      assertNoVerificationMail(
        malformed,
        "https://mailpit.example.test",
        email,
        after,
      ),
    ).rejects.toThrow(/^Malformed Mailpit JSON payload$/);
  });
});
