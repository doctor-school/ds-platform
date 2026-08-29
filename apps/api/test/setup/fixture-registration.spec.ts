import { describe, expect, it, vi } from "vitest";
import { registerUniqueUserFixture } from "./fixture-registration.js";

describe("registerUniqueUserFixture", () => {
  it("retries a confirmed retained subject collision and returns the next mirror", async () => {
    const emails = ["first@ds.test", "second@ds.test"];
    const result = await registerUniqueUserFixture({
      nextEmail: () => emails.shift()!,
      register: vi.fn(async () => ({ statusCode: 200, payload: "{}" })),
      idpSubForEmail: async (email) =>
        email === "first@ds.test" ? "fake-sub-1" : "fake-sub-2",
      mirrorByEmail: async (email) =>
        email === "second@ds.test" ? { sub: "fake-sub-2", email } : null,
      mirrorBySub: async (sub) =>
        sub === "fake-sub-1"
          ? { sub, email: "retained-from-prior-run@ds.test" }
          : { sub, email: "second@ds.test" },
    });
    expect(result).toEqual({ email: "second@ds.test", sub: "fake-sub-2" });
  });

  it("fails immediately when the missing mirror is not a confirmed subject collision", async () => {
    const register = vi.fn(async () => ({ statusCode: 200, payload: "{}" }));
    await expect(
      registerUniqueUserFixture({
        nextEmail: () => "broken@ds.test",
        register,
        idpSubForEmail: async () => "fake-sub-1",
        mirrorByEmail: async () => null,
        mirrorBySub: async () => null,
      }),
    ).rejects.toThrow("without a confirmed subject collision");
    expect(register).toHaveBeenCalledOnce();
  });
});
