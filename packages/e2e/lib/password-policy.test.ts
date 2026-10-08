import { describe, expect, it, vi } from "vitest";
import { readPasswordPolicy } from "./password-policy.js";

describe("live length-only creation-password policy", () => {
  const policy = {
    minLength: "8",
    hasUppercase: false,
    hasLowercase: false,
    hasNumber: false,
    hasSymbol: false,
  };
  const effects = (
    body: unknown = { policy },
    idpDomain = "id.stage.doctor.school",
  ) => ({
    capture: vi.fn(async (script: string) =>
      script.includes("idp-bootstrap-pat.txt")
        ? "synthetic-pat\n"
        : `STAGE_BASE_DOMAIN=stage.doctor.school\nIDP_EXTERNAL_DOMAIN=${idpDomain}\nIDP_EXTERNAL_SECURE=true\nIDP_EXTERNAL_PORT=443`,
    ),
    fetch: vi.fn(
      async () => new Response(JSON.stringify(body), { status: 200 }),
    ),
  });
  it.each(["main", "pr-2721"])(
    "EARS-36: reads actual min8/class-flags-off policy through the canonical %s IdP",
    async (slot) => {
      const io = effects();
      expect(
        await readPasswordPolicy(
          `https://academy-${slot}.stage.doctor.school`,
          io,
        ),
      ).toEqual({
        minLength: 8,
        hasUppercase: false,
        hasLowercase: false,
        hasNumber: false,
        hasSymbol: false,
      });
      expect(io.capture).toHaveBeenCalledTimes(2);
      const [url, init] = io.fetch.mock.calls[0]! as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe(
        "https://id.stage.doctor.school/admin/v1/policies/password/complexity",
      );
      expect(init.method).toBe("GET");
    },
  );
  it("EARS-36: treats omitted protobuf false flags as false", async () => {
    expect(
      await readPasswordPolicy(
        "https://academy-main.stage.doctor.school",
        effects({ policy: { minLength: "8" } }),
      ),
    ).toEqual({
      minLength: 8,
      hasUppercase: false,
      hasLowercase: false,
      hasNumber: false,
      hasSymbol: false,
    });
  });
  it.each([
    { ...policy, minLength: "9" },
    { ...policy, minLength: "0" },
    { ...policy, hasUppercase: true },
    { ...policy, hasLowercase: true },
    { ...policy, hasNumber: true },
    { ...policy, hasSymbol: true },
    { ...policy, hasSymbol: "false" },
    null,
  ])(
    "EARS-36: refuses missing, stricter or invalid live configuration %#",
    async (value) => {
      await expect(
        readPasswordPolicy(
          "https://academy-main.stage.doctor.school",
          effects({ policy: value }),
        ),
      ).rejects.toThrow(
        "Live password policy is not minimum eight with every character-class flag off",
      );
    },
  );
  it.each([
    "https://academy-pr-2721.other.test",
    "https://academy.doctor.school",
    "http://academy-main.stage.doctor.school",
    "https://secret@academy-main.stage.doctor.school",
    "https://academy-main.stage.doctor.school:8443",
  ])(
    "EARS-36: cannot send the operator PAT to an unvalidated origin %#",
    async (base) => {
      const io = effects();
      await expect(readPasswordPolicy(base, io)).rejects.toThrow(
        "Live password-policy read failed",
      );
      expect(io.fetch).not.toHaveBeenCalled();
      expect(
        io.capture.mock.calls.some(([script]) =>
          script.includes("idp-bootstrap-pat.txt"),
        ),
      ).toBe(false);
    },
  );
  it("EARS-36: a non-staging IdP origin cannot receive the operator credential", async () => {
    const io = effects({ policy }, "id.doctor.school");
    await expect(
      readPasswordPolicy("https://academy-main.stage.doctor.school", io),
    ).rejects.toThrow("Live password-policy read failed");
    expect(io.capture).toHaveBeenCalledOnce();
    expect(io.fetch).not.toHaveBeenCalled();
  });
  it("EARS-36: failed credential-bearing IdP read yields only a generic error", async () => {
    const io = effects();
    io.fetch.mockImplementation(async () => {
      throw new Error("synthetic-secret");
    });
    await expect(
      readPasswordPolicy("https://academy-main.stage.doctor.school", io),
    ).rejects.toThrow(/^Live password-policy read failed$/);
  });
});
