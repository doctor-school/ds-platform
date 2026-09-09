import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeMailer } from "../../mailer/mailer.fake.js";
import { ZitadelIdpClient, type FetchLike } from "./zitadel.idp.js";

describe("003 detached email native request deadline", () => {
  afterEach(() => vi.useRealTimers());

  it.each(["register", "resend", "reset"] as const)(
    "EARS-16: %s cancels stalled native response consumption before any mailer attempt",
    async (route) => {
      vi.useFakeTimers();
      let requestSignal: AbortSignal | undefined;
      let bodyCancelled = false;
      const mailer = new FakeMailer();
      const fetchImpl: FetchLike = async (_url, init) => {
        requestSignal = (init as typeof init & { signal?: AbortSignal }).signal;
        return {
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              requestSignal?.addEventListener(
                "abort",
                () => {
                  bodyCancelled = true;
                  reject(new Error("private provider response"));
                },
                { once: true },
              );
            }),
        };
      };
      const idp = new ZitadelIdpClient({
        baseUrl: "https://idp.ds.test",
        serviceToken: "test",
        fetchImpl,
        mailer,
      });
      const operation =
        route === "register"
          ? idp.requestEmailVerification("sub", "user@ds.test")
          : route === "resend"
            ? idp.resendEmailVerification("user@ds.test")
            : idp.requestPasswordReset("user@ds.test");
      // Observe rejection immediately, as the service's detached runner does.
      const result = operation.catch(() => undefined);
      await Promise.resolve();
      expect(requestSignal).toBeInstanceOf(AbortSignal);
      await vi.advanceTimersByTimeAsync(5000);
      await result;
      expect(bodyCancelled).toBe(true);
      expect(mailer.verificationCodeEmails).toEqual([]);
      expect(mailer.passwordResetCodeEmails).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
