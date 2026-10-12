import { describe, expect, it, vi } from "vitest";

import { AuthError, type AuthClient } from "./auth-client";
import { accountPhoneActions } from "./account-phone";

/**
 * 003 EARS-47/48/59 (#2449) — the ONE adapter both storefronts hand the shared
 * account-profile phone row: the host's bound auth client in, the row's
 * transport + failure classification out. No host maps these errors itself.
 */

function clientWith(overrides: Partial<AuthClient>): AuthClient {
  return overrides as AuthClient;
}

describe("accountPhoneActions", () => {
  it("003 EARS-47: requestCode sends the number as typed and answers the server's status", async () => {
    const requestPhoneCode = vi
      .fn()
      .mockResolvedValue({ status: "already_confirmed" });
    const actions = accountPhoneActions(clientWith({ requestPhoneCode }));

    await expect(actions.requestCode("8 913 402-88-71")).resolves.toBe(
      "already_confirmed",
    );
    expect(requestPhoneCode).toHaveBeenCalledWith({ phone: "8 913 402-88-71" });
  });

  it("003 EARS-48: confirm resolves the phone the server now holds confirmed", async () => {
    const confirmPhone = vi
      .fn()
      .mockResolvedValue({ status: "confirmed", phone: "+79134028871" });
    const actions = accountPhoneActions(clientWith({ confirmPhone }));

    await expect(actions.confirm("482913")).resolves.toBe("+79134028871");
    expect(confirmPhone).toHaveBeenCalledWith({ code: "482913" });
  });

  it("003 EARS-48/13: a 400 is the generic wrong code, a 429 the generic throttle, anything else unavailable", () => {
    const { classifyError } = accountPhoneActions(clientWith({}));

    expect(classifyError(new AuthError(400, "invalid code"))).toBe("invalid");
    expect(classifyError(new AuthError(429, "too many"))).toBe("throttled");
    expect(classifyError(new AuthError(503, "down"))).toBe("unavailable");
    expect(classifyError(new TypeError("network"))).toBe("unavailable");
  });
});
