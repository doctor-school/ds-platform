import { afterEach, describe, expect, it, vi } from "vitest";

import { authClient } from "./auth-client";

afterEach(() => vi.restoreAllMocks());

describe("auth client machine-readable bot-protection errors", () => {
  it("EARS-17: preserves a stable challenge code without parsing exception copy", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 403,
          code: "BOT_PROTECTION_REQUIRED",
          message: "provider-independent copy",
        }),
        {
          status: 403,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await expect(
      authClient.login({
        identifier: "doctor@example.com",
        password: "Sup3r$ecretPw!9",
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "BOT_PROTECTION_REQUIRED",
    });
  });
});
