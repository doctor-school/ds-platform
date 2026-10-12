import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertNoAddressedMail,
  assertNoVerificationMail,
  captureAddressedMailCheckpoint,
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

describe("duplicate-registration mail checkpoint", () => {
  const checkpoint = { recipient: email, messageIds: ["seen"] };

  it("EARS-23: captures only exact-recipient IDs without filtering them by the client clock", async () => {
    await expect(
      captureAddressedMailCheckpoint(
        verificationMailClient([
          addressedMessage({ ID: "old", Created: "2026-10-11T00:00:00Z" }),
          addressedMessage({ ID: "future", Created: "2026-10-12T01:00:00Z" }),
          addressedMessage({
            ID: "foreign",
            To: [{ Address: "other@example.test" }],
          }),
        ]),
        "https://mailpit.example.test",
        email.toUpperCase(),
      ),
    ).resolves.toEqual({ recipient: email, messageIds: ["old", "future"] });
  });

  it("EARS-23: rejects a checkpoint bound to another recipient before reading mail", async () => {
    const request = verificationMailClient([]);
    await expect(
      assertNoAddressedMail(
        request,
        "https://mailpit.example.test",
        email,
        after,
        {
          recipient: "other@example.test",
          messageIds: ["seen"],
        },
      ),
    ).rejects.toThrow(/^Invalid addressed-mail checkpoint$/);
    expect(request.get).not.toHaveBeenCalled();
  });

  it.each([{ messages_count: 1 }, { start: 1 }])(
    "EARS-23: neither capture nor absence accepts incomplete checkpoint-query metadata %j",
    async (metadata) => {
      const request = verificationMailClient([], metadata);
      await expect(
        captureAddressedMailCheckpoint(
          request,
          "https://mailpit.example.test",
          email,
        ),
      ).rejects.toThrow("search payload");
      await expect(
        assertNoAddressedMail(
          request,
          "https://mailpit.example.test",
          email,
          after,
          checkpoint,
        ),
      ).rejects.toThrow("search payload");
    },
  );

  it.each([{ ID: 123 }, { Created: "invalid" }, { To: [{ Address: 123 }] }])(
    "EARS-23: neither capture nor absence accepts malformed checkpoint-query rows %j",
    async (override) => {
      const request = verificationMailClient([addressedMessage(override)]);
      await expect(
        captureAddressedMailCheckpoint(
          request,
          "https://mailpit.example.test",
          email,
        ),
      ).rejects.toThrow("search payload");
      await expect(
        assertNoAddressedMail(
          request,
          "https://mailpit.example.test",
          email,
          after,
          checkpoint,
        ),
      ).rejects.toThrow("search payload");
    },
  );

  it("EARS-23: capture and absence fail closed on HTTP, transport and JSON failures without retaining credential/code diagnostics", async () => {
    for (const [request, expected] of [
      [
        {
          get: async () => ({
            ok: () => false,
            status: () => 503,
            json: async () => ({}),
          }),
        },
        "Mailpit search failed with HTTP 503",
      ],
      [
        {
          get: async () => {
            throw new Error("credential-bearing transport bytes");
          },
        },
        "Mailpit request failed",
      ],
      [
        {
          get: async () => ({
            ok: () => true,
            status: () => 200,
            json: async () => {
              throw new Error("code-bearing JSON bytes");
            },
          }),
        },
        "Malformed Mailpit JSON payload",
      ],
    ] as const) {
      const captureError = await captureAddressedMailCheckpoint(
        request,
        "https://mailpit.example.test",
        email,
      ).catch((error: unknown) => error);
      const absenceError = await assertNoAddressedMail(
        request,
        "https://mailpit.example.test",
        email,
        after,
        checkpoint,
      ).catch((error: unknown) => error);
      expect(captureError).toBeInstanceOf(Error);
      expect(absenceError).toBeInstanceOf(Error);
      expect((captureError as Error).message).toBe(expected);
      expect((absenceError as Error).message).toBe(expected);
    }
  });

  it("EARS-23: ignores only already-observed recipient IDs through the full delivery horizon even with future Created timestamps", async () => {
    vi.useFakeTimers();
    const request = verificationMailClient([
      addressedMessage({ ID: "seen", Created: "2026-10-12T01:00:00Z" }),
      addressedMessage({
        ID: "foreign",
        Created: "2026-10-12T01:00:00Z",
        To: [{ Address: "other@example.test" }],
      }),
    ]);
    let settled = false;
    let rejected = false;
    const result = assertNoAddressedMail(
      request,
      "https://mailpit.example.test",
      email.toUpperCase(),
      after,
      checkpoint,
    ).then(
      () => {
        settled = true;
      },
      () => {
        rejected = true;
      },
    );
    await vi.advanceTimersByTimeAsync(14_999);
    expect(rejected, "observed mail is not a new delivery").toBe(false);
    expect(settled, "absence cannot pass before the delivery deadline").toBe(
      false,
    );
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(settled).toBe(true);
    expect(rejected).toBe(false);
    expect(request.get).toHaveBeenCalledTimes(31);
  });

  it("EARS-23: rejects every unseen addressed ID even when its Created timestamp predates the client request", async () => {
    vi.useFakeTimers();
    const result = assertNoAddressedMail(
      verificationMailClient([
        addressedMessage({ ID: "seen", Created: "2026-10-11T00:00:00Z" }),
        addressedMessage({ ID: "unseen", Created: "2026-10-11T00:00:00Z" }),
      ]),
      "https://mailpit.example.test",
      email,
      after,
      checkpoint,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(15_000);
    const error = await result;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Unexpected addressed mail after observed mailbox checkpoint",
    );
  });

  it("EARS-23: rejects an unseen addressed ID arriving at the end of the delivery horizon despite an old Created timestamp", async () => {
    vi.useFakeTimers();
    const messages: unknown[] = [
      addressedMessage({ ID: "seen", Created: "2026-10-11T00:00:00Z" }),
    ];
    const result = assertNoAddressedMail(
      verificationMailClient(messages),
      "https://mailpit.example.test",
      email,
      after,
      checkpoint,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(14_500);
    messages.push(
      addressedMessage({ ID: "late", Created: "2026-10-11T00:00:00Z" }),
    );
    await vi.advanceTimersByTimeAsync(500);
    const error = await result;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Unexpected addressed mail after observed mailbox checkpoint",
    );
  });
});

describe("timestamp-based addressed-mail absence compatibility", () => {
  it("EARS-16: still ignores stale mail and waits the full delivery horizon without a checkpoint", async () => {
    vi.useFakeTimers();
    let settled = false;
    const result = assertNoAddressedMail(
      verificationMailClient([
        addressedMessage({ Created: "2026-10-11T00:00:00Z" }),
      ]),
      "https://mailpit.example.test",
      email,
      after,
    ).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(settled).toBe(true);
  });

  it("EARS-16: still rejects fresh addressed mail without a checkpoint", async () => {
    await expect(
      assertNoAddressedMail(
        verificationMailClient([addressedMessage()]),
        "https://mailpit.example.test",
        email,
        after,
      ),
    ).rejects.toThrow(
      /^Unexpected addressed mail after unknown reset request$/,
    );
  });
});

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
