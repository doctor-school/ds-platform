import { afterEach, describe, expect, it, vi } from "vitest";
import { setOwnedStaffProfileRoles } from "./staff-profile-fixture.js";

vi.mock("node:fs/promises", () => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("owned staff-profile grant safety", () => {
  it("EARS-27: refuses a production issuer before any management request", async () => {
    vi.stubEnv("IDP_ISSUER", "https://id.doctor.school");
    vi.stubEnv("E2E_STAFF_ROLE_FIXTURE", "true");
    vi.stubEnv("E2E_STAFF_FIXTURE_ISSUER", "https://id.doctor.school");
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await expect(
      setOwnedStaffProfileRoles(
        "staff-profile-3256-12345678-1234-1234-1234-123456789abc@example.test",
        "owned-sub",
        ["doctor_guest"],
        ["platform_admin"],
      ),
    ).rejects.toThrow("unowned or unpinned");
    expect(request).not.toHaveBeenCalled();
  });
  it("EARS-27: refuses a foreign email or mismatched issuer pin before requests", async () => {
    vi.stubEnv("IDP_ISSUER", "http://localhost:8080");
    vi.stubEnv("E2E_STAFF_ROLE_FIXTURE", "true");
    vi.stubEnv("E2E_STAFF_FIXTURE_ISSUER", "http://localhost:8080");
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await expect(
      setOwnedStaffProfileRoles(
        "foreign@example.test",
        "foreign-sub",
        ["doctor_guest"],
        ["platform_admin"],
      ),
    ).rejects.toThrow("unowned or unpinned");
    vi.stubEnv("E2E_STAFF_FIXTURE_ISSUER", "http://other.local");
    await expect(
      setOwnedStaffProfileRoles(
        "staff-profile-3256-12345678-1234-1234-1234-123456789abc@example.test",
        "owned-sub",
        ["doctor_guest"],
        ["platform_admin"],
      ),
    ).rejects.toThrow("unowned or unpinned");
    expect(request).not.toHaveBeenCalled();
  });
  it("EARS-27: refuses an unexpected existing role instead of overwriting foreign grants", async () => {
    vi.stubEnv("IDP_ISSUER", "http://localhost:8080");
    vi.stubEnv("E2E_STAFF_ROLE_FIXTURE", "true");
    vi.stubEnv("E2E_STAFF_FIXTURE_ISSUER", "http://localhost:8080");
    vi.stubEnv("E2E_STAFF_FIXTURE_LOG", "unit-only.jsonl");
    vi.stubEnv("IDP_PROJECT_ID", "owned-project");
    vi.stubEnv("IDP_SERVICE_TOKEN", "unit-token");
    const email =
      "staff-profile-3256-12345678-1234-1234-1234-123456789abc@example.test";
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: [{ id: "owned-sub", human: { email: { email } } }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: [
              {
                id: "grant",
                projectId: "owned-project",
                roleKeys: ["doctor_guest", "pd_officer"],
              },
            ],
          }),
        ),
      );
    vi.stubGlobal("fetch", request);
    await expect(
      setOwnedStaffProfileRoles(
        email,
        "owned-sub",
        ["doctor_guest"],
        ["platform_admin"],
      ),
    ).rejects.toThrow("unexpected existing grant");
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.every((call) => call[1].method === "POST")).toBe(
      true,
    );
  });
});
