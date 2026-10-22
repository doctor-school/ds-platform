import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { onDemandProviderScript } from "./captcha-on-demand.js";

describe("S064 private provider observation", () => {
  it.each([true, false])(
    "EARS-17: holds callbacks and preserves replay probes (distinct probe tokens: %s)",
    (distinctTokens) => {
      let loaded = false;
      const window: Record<string, unknown> = {
        ready: () => {
          loaded = true;
        },
      };
      const frames: unknown[] = [];
      vm.runInNewContext(
        onDemandProviderScript("test-only", "ready", distinctTokens),
        {
          window,
          document: {
            createElement: () => ({ dataset: {} }),
            body: { appendChild: (frame: unknown) => frames.push(frame) },
            querySelectorAll: () => [],
          },
        },
      );
      const provider = window.smartCaptcha as {
        render(container: unknown, params: { invisible: boolean }): number;
        subscribe(
          id: number,
          event: string,
          callback: (token: string) => void,
        ): void;
        execute(id: number): void;
        destroy(id: number): void;
      };
      const probe = window.__captchaOnDemand as {
        calls: { id: number; invisible: boolean; token: string }[];
        emit(index: number, event: string): void;
      };
      const tokens: string[] = [];
      expect(loaded).toBe(true);
      const first = provider.render(null, { invisible: true });
      provider.subscribe(first, "success", (token) => tokens.push(token));
      provider.execute(first);
      expect(tokens).toEqual([]);
      expect(frames).toHaveLength(0);
      probe.emit(0, "challenge-visible");
      expect(frames).toHaveLength(1);
      probe.emit(0, "success");
      provider.destroy(first);
      probe.emit(0, "success");
      const second = provider.render(null, { invisible: true });
      provider.execute(second);
      expect(probe.calls.map((call) => call.invisible)).toEqual([true, true]);
      expect(new Set(probe.calls.map((call) => call.id)).size).toBe(2);
      const firstCall = probe.calls[0];
      const secondCall = probe.calls[1];
      if (!firstCall || !secondCall)
        throw new Error("Missing observed executions");
      expect(firstCall.token === secondCall.token).toBe(!distinctTokens);
      if (!distinctTokens) expect(firstCall.token).toBe("test-only");
      expect(tokens).toEqual([firstCall.token, firstCall.token]);
    },
  );
});
