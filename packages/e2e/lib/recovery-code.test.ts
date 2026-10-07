import type { APIRequestContext } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRecoveryCode } from "./mailpit.js";

const email = "owned@example.test";
const after = "2026-10-07T00:00:00Z";
const mail = {
  ID: "fresh",
  Created: after,
  Subject: "AB12CD — код сброса пароля Doctor.School",
  To: [{ Address: email }],
};
function client(detail: unknown = mail, status = 200, metadata = {}) {
  return {
    get: vi.fn(async (url: string) => ({
      ok: () => status === 200,
      status: () => status,
      json: async () =>
        url.includes("/search?")
          ? { messages: [mail], messages_count: 1, start: 0, ...metadata }
          : detail,
    })),
  } as unknown as APIRequestContext;
}
afterEach(() => vi.useRealTimers());
describe("owned reset account mail", () => {
  it.each(["search", "detail"])(
    "EARS-12: malformed %s JSON fails closed without persisting the code in its error",
    async (endpoint) => {
      const request = {
        get: async (url: string) => ({
          ok: () => true,
          json: async () => {
            const search = url.includes("/search?");
            if (search === (endpoint === "search")) {
              return JSON.parse("SECRET2657-invalid-json");
            }
            return { messages: [mail], messages_count: 1, start: 0 };
          },
        }),
      } as unknown as APIRequestContext;
      const error = await fetchRecoveryCode(
        request,
        "https://mail.test",
        email,
        after,
        "reset",
      ).catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Malformed Mailpit JSON payload");
      expect((error as Error).cause).toBeUndefined();
      expect(String((error as Error).stack)).not.toContain("SECRET2657");
    },
  );
  it("EARS-12: uses search arrival time when live Mailpit detail exposes Date only", async () => {
    const detail = { ID: mail.ID, Subject: mail.Subject, To: mail.To };
    await expect(
      fetchRecoveryCode(
        client({ ...detail, Date: "2026-10-06T23:59:59Z" }),
        "https://mail.test",
        email,
        after,
        "reset",
      ),
    ).resolves.toBe("AB12CD");
  });
  it("EARS-12: rejects stale search arrivals even if detail would contain a code", async () => {
    vi.useFakeTimers();
    const assertion = expect(
      fetchRecoveryCode(
        client(mail, 200, {
          messages: [{ ...mail, Created: "2026-10-06T00:00:00Z" }],
        }),
        "https://mail.test",
        email,
        after,
        "reset",
      ),
    ).rejects.toThrow("No fresh addressed");
    await Promise.all([assertion, vi.advanceTimersByTimeAsync(15_000)]);
  });
  it("EARS-12: reads a registration code only from its addressed confirmation mail", async () => {
    const confirmation = {
      ...mail,
      Subject: "XYZ123 — код подтверждения Doctor.School",
    };
    await expect(
      fetchRecoveryCode(
        client(confirmation, 200, { messages: [confirmation] }),
        "https://mail.test",
        email,
        after,
        "register",
      ),
    ).resolves.toBe("XYZ123");
  });
  it("EARS-12: reads the real fresh addressed reset code", async () => {
    await expect(
      fetchRecoveryCode(client(), "https://mail.test", email, after, "reset"),
    ).resolves.toBe("AB12CD");
  });
  it.each([
    null,
    {},
    { ...mail, Subject: "AB12CD — код подтверждения Doctor.School" },
    { ...mail, To: [{ Address: "other@example.test" }] },
    { ...mail, ID: "different" },
    { ...mail, To: [null] },
    { ...mail, Subject: " — код сброса пароля Doctor.School" },
  ])(
    "EARS-12: rejects mismatched or malformed mail detail %#",
    async (detail) => {
      await expect(
        fetchRecoveryCode(
          client(detail),
          "https://mail.test",
          email,
          after,
          "reset",
        ),
      ).rejects.toThrow();
    },
  );
  it("EARS-12: fails closed on HTTP and incomplete search results", async () => {
    await expect(
      fetchRecoveryCode(
        client(mail, 503),
        "https://mail.test",
        email,
        after,
        "reset",
      ),
    ).rejects.toThrow("HTTP 503");
    await expect(
      fetchRecoveryCode(
        client(mail, 200, { messages_count: 2 }),
        "https://mail.test",
        email,
        after,
        "reset",
      ),
    ).rejects.toThrow("incomplete");
  });
});
