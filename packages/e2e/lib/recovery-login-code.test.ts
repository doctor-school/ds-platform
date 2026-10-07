import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRecoveryCode } from "./mailpit.js";

const email = "owned@example.test";
const after = "2026-10-07T00:00:00Z";
const mail = {
  ID: "login",
  Created: after,
  Subject: "123456 — код для входа в Doctor.School",
  To: [{ Address: email }],
};
function client(search = mail, detail: unknown = mail) {
  return {
    get: vi.fn(async (url: string) => ({
      ok: () => true,
      status: () => 200,
      json: async () =>
        url.includes("/search?")
          ? { messages: [search], messages_count: 1, start: 0 }
          : detail,
    })),
  };
}
afterEach(() => vi.useRealTimers());

describe("owned recovery account login mail", () => {
  it("EARS-35: reads only the fresh addressed login code", async () => {
    vi.useFakeTimers();
    const assertion = expect(
      fetchRecoveryCode(client(), "https://mail.test", email, after, "login"),
    ).resolves.toBe("123456");
    await Promise.all([assertion, vi.advanceTimersByTimeAsync(15_000)]);
  });
  it.each([
    { ...mail, Subject: "123456 — код подтверждения Doctor.School" },
    { ...mail, Subject: "123456 — код сброса пароля Doctor.School" },
    { ...mail, To: [{ Address: "other@example.test" }] },
    { ...mail, Created: "2026-10-06T00:00:00Z" },
  ])(
    "EARS-35: rejects the wrong purpose, recipient or stale arrival %#",
    async (search) => {
      vi.useFakeTimers();
      const assertion = expect(
        fetchRecoveryCode(
          client(search, search),
          "https://mail.test",
          email,
          after,
          "login",
        ),
      ).rejects.toThrow("No fresh addressed");
      await Promise.all([assertion, vi.advanceTimersByTimeAsync(15_000)]);
    },
  );
  it.each([
    { ...mail, ID: "other" },
    { ...mail, To: [{ Address: "other@example.test" }] },
    { ...mail, Subject: "123456 — код подтверждения Doctor.School" },
  ])(
    "EARS-35: binds login detail to the addressed search result %#",
    async (detail) => {
      vi.useFakeTimers();
      const assertion = expect(
        fetchRecoveryCode(
          client(mail, detail),
          "https://mail.test",
          email,
          after,
          "login",
        ),
      ).rejects.toThrow("did not match");
      await Promise.all([assertion, vi.advanceTimersByTimeAsync(15_000)]);
    },
  );
  it.each(["", "two words", "12345", "1234567", "abc123"])(
    "EARS-35: rejects malformed login code %#",
    async (code) => {
      vi.useFakeTimers();
      const malformed = {
        ...mail,
        Subject: `${code} — код для входа в Doctor.School`,
      };
      const assertion = expect(
        fetchRecoveryCode(
          client(malformed, malformed),
          "https://mail.test",
          email,
          after,
          "login",
        ),
      ).rejects.toThrow("subject is malformed");
      await Promise.all([assertion, vi.advanceTimersByTimeAsync(15_000)]);
    },
  );
});
