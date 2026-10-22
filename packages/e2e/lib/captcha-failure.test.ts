import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { failureProviderScript } from "./captcha-failure.js";

describe("S067 provider-only lifecycle observation", () => {
  it("EARS-17: holds success, records themes and destruction, and retains queued retired callbacks", () => {
    let loaded = 0;
    const window: Record<string, unknown> = { ready: () => loaded++ };
    vm.runInNewContext(failureProviderScript("private-test-token", "ready"), {
      window,
    });
    const provider = window.smartCaptcha as {
      render(
        container: unknown,
        params: { theme: string; invisible: boolean },
      ): number;
      execute(id: number): void;
      destroy(id: number): void;
      subscribe(id: number, event: string, cb: (value: string) => void): void;
    };
    const probe = window.__captchaFailure as {
      calls: { id: number; theme: string; invisible: boolean }[];
      destroyed: number[];
      emit(index: number, event: string, token?: string): void;
    };
    const events: string[] = [];
    const first = provider.render(null, { theme: "light", invisible: true });
    provider.subscribe(first, "success", (token) => events.push(token));
    provider.execute(first);
    expect(events).toEqual([]);
    provider.destroy(first);
    probe.emit(0, "success", "retired-token");
    const second = provider.render(null, { theme: "dark", invisible: true });
    provider.subscribe(second, "network-error", () => events.push("network"));
    provider.execute(second);
    probe.emit(1, "network-error");
    expect(loaded).toBe(1);
    expect(probe.destroyed).toEqual([first]);
    expect(
      probe.calls.map(({ id, theme, invisible }) => ({ id, theme, invisible })),
    ).toEqual([
      { id: first, theme: "light", invisible: true },
      { id: second, theme: "dark", invisible: true },
    ]);
    expect(events).toEqual(["retired-token", "network"]);
  });
});
