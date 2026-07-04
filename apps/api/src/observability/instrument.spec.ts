import { beforeEach, describe, expect, it, vi } from "vitest";

import * as Sentry from "@sentry/node";
import { initSentry } from "./instrument.js";

vi.mock("@sentry/node", () => ({ init: vi.fn() }));

describe("initSentry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is a no-op when SENTRY_DSN is unset (dev-stand / CI default)", () => {
    expect(initSentry({} as NodeJS.ProcessEnv)).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("initialises the SDK with PII stripped when SENTRY_DSN is set", () => {
    const ok = initSentry({
      SENTRY_DSN: "https://key@glitchtip.internal/1",
      SENTRY_ENVIRONMENT: "production",
    } as NodeJS.ProcessEnv);

    expect(ok).toBe(true);
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const config = vi.mocked(Sentry.init).mock.calls[0]![0]!;
    expect(config.dsn).toBe("https://key@glitchtip.internal/1");
    expect(config.environment).toBe("production");
    expect(config.sendDefaultPii).toBe(false);
    expect(config.maxBreadcrumbs).toBe(0);

    // beforeSend must drop every PII-bearing surface.
    const redacted = config.beforeSend!(
      {
        request: { headers: { cookie: "session=secret" } },
        user: { email: "doc@example.com" },
        server_name: "api-prod",
        exception: { values: [{ type: "Error" }] },
      } as never,
      {} as never,
    ) as unknown as Record<string, unknown>;
    expect(redacted.request).toBeUndefined();
    expect(redacted.user).toBeUndefined();
    expect(redacted.server_name).toBeUndefined();
    expect(redacted.exception).toBeDefined();
  });
});
