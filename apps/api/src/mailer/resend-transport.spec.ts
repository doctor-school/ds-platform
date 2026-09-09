import { describe, expect, it, vi } from "vitest";
import { ResendChannel } from "./resend-transport.js";
const mail = {
  to: "doctor@example.com",
  subject: "code",
  text: "code",
  html: "code",
};
describe("Resend cancellation", () => {
  it("EARS-31: aborts a request that stalls before headers", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    try {
      const fetchFn = vi.fn(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            signal = init.signal;
            signal!.addEventListener("abort", () => reject(signal!.reason));
          }),
      ) as typeof fetch;
      const send = new ResendChannel({ apiKey: "key", fetchFn }).send(mail);
      const result = expect(send).rejects.toMatchObject({
        code: "timeout",
        outcome: "uncertain",
      });
      await vi.advanceTimersByTimeAsync(10_000);
      await result;
      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("EARS-31: aborts body consumption and preserves an explicit rejection status", async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn(async (_url, init) => ({
        status: 429,
        text: () =>
          new Promise((_r, reject) =>
            init.signal.addEventListener("abort", () =>
              reject(init.signal.reason),
            ),
          ),
      })) as unknown as typeof fetch;
      const result = expect(
        new ResendChannel({ apiKey: "key", fetchFn }).send(mail),
      ).rejects.toMatchObject({ code: "429", outcome: "rejected" });
      await vi.advanceTimersByTimeAsync(10_000);
      await result;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
