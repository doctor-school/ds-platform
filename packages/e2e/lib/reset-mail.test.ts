import type { APIRequestContext } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertNoAddressedMail, waitForResetMail } from "./mailpit.js";

const after = "2026-10-06T00:00:00Z";
const email = "reset-test@example.test";
const message = (overrides = {}) => ({
  ID: "fresh",
  Created: after,
  Subject: "123456 — код сброса пароля Doctor.School",
  To: [{ Address: email }],
  ...overrides,
});
function client(
  messages: unknown[],
  searchStatus = 200,
  detailStatus = 200,
  metadata: Record<string, unknown> = {},
) {
  return {
    get: vi.fn(async (url: string) => ({
      ok: () =>
        (url.includes("/search?") ? searchStatus : detailStatus) === 200,
      status: () => (url.includes("/search?") ? searchStatus : detailStatus),
      json: async () =>
        url.includes("/search?")
          ? {
              total: 200,
              messages_count: messages.length,
              start: 0,
              ...metadata,
              messages,
            }
          : message(),
    })),
  } as unknown as APIRequestContext;
}
afterEach(() => vi.useRealTimers());
describe("reset delivery evidence", () => {
  it("EARS-11: accepts all query matches when the shared mailbox contains unrelated mail", async () => {
    await expect(
      waitForResetMail(
        client([message()]),
        "https://mailpit.example.test",
        email,
        after,
      ),
    ).resolves.toBeUndefined();
  });
  it("EARS-16: accepts zero query matches in a nonempty shared mailbox", async () => {
    vi.useFakeTimers();
    const result = assertNoAddressedMail(
      client([]),
      "https://mailpit.example.test",
      email,
      after,
    );
    const assertion = expect(result).resolves.toBeUndefined();
    await Promise.all([assertion, vi.advanceTimersByTimeAsync(15_000)]);
  });
  it.each([
    { messages_count: 1 },
    { messages_count: undefined },
    { messages_count: -1 },
    { messages_count: 0.5 },
    { messages_count: "0" },
    { start: 1 },
    { start: undefined },
  ])("EARS-16: rejects incomplete or malformed query metadata %j", async (metadata) => {
    vi.useFakeTimers();
    const assertion = expect(
      assertNoAddressedMail(
        client([], 200, 200, { total: 0, ...metadata }),
        "https://mailpit.example.test",
        email,
        after,
      ),
    ).rejects.toThrow("search payload");
    await Promise.all([assertion, vi.advanceTimersByTimeAsync(15_000)]);
  });
  it("EARS-11: ignores stale, unrelated-subject and wrong-recipient mail before fresh reset delivery", async () => {
    vi.useFakeTimers();
    const messages = [
      message({ Created: "2026-10-05T00:00:00Z" }),
      message({ Subject: "login" }),
      message({ To: [{ Address: "other@example.test" }] }),
    ];
    const request = client(messages);
    const result = waitForResetMail(
      request,
      "https://mailpit.example.test",
      email,
      after,
    );
    await vi.advanceTimersByTimeAsync(500);
    messages.push(message());
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toBeUndefined();
  });
  it("EARS-11: requires successful message read", async () => {
    await expect(
      waitForResetMail(
        client([message()], 200, 503),
        "https://mailpit.example.test",
        email,
        after,
      ),
    ).rejects.toThrow("message read failed");
  });
  it("EARS-16: observes the entire 15 second window including mail arriving at its end", async () => {
    vi.useFakeTimers();
    const messages: unknown[] = [];
    const result = assertNoAddressedMail(
      client(messages),
      "https://mailpit.example.test",
      email,
      after,
    );
    const assertion = expect(result).rejects.toThrow(
      "Unexpected addressed mail",
    );
    await vi.advanceTimersByTimeAsync(14_500);
    messages.push(message({ Subject: "anything" }));
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });
  it("EARS-16: ignores stale and wrong-recipient messages throughout the absence window", async () => {
    vi.useFakeTimers();
    const result = assertNoAddressedMail(
      client([
        message({ Created: "2026-10-05T00:00:00Z" }),
        message({ To: [{ Address: "other@example.test" }] }),
      ]),
      "https://mailpit.example.test",
      email,
      after,
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(result).resolves.toBeUndefined();
  });
  it("EARS-16: fails closed when Mailpit search fails", async () => {
    await expect(
      assertNoAddressedMail(
        client([], 503),
        "https://mailpit.example.test",
        email,
        after,
      ),
    ).rejects.toThrow("search failed");
  });
  it("EARS-16: fails closed when Mailpit search returns malformed data", async () => {
    const request = {
      get: async () => ({ ok: () => true, json: async () => ({}) }),
    } as unknown as APIRequestContext;
    await expect(
      assertNoAddressedMail(
        request,
        "https://mailpit.example.test",
        email,
        after,
      ),
    ).rejects.toThrow("search payload");
  });
});
