import { runInNewContext } from "node:vm";

import type { BrowserContext, Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import {
  CaptchaTestTokenMissingError,
  captchaStubScript,
  captchaTestTokenFromEnv,
  installCaptchaStub,
  isSmartCaptchaScriptUrl,
} from "./captcha-stub.js";

/**
 * The stub stands in for Yandex's `captcha.js` (#2605): the real widget wrapper
 * (`@yandex/smart-captcha` → `InvisibleSmartCaptcha`) must load it, get
 * `window.smartCaptcha` through the `onload` callback, and receive the test
 * token on `execute` via its `success` subscription — the exact surface the
 * adapter calls (render/subscribe/execute/destroy/setTheme).
 */
type Listener = (payload?: unknown) => void;
interface StubSurface {
  render: (container: unknown, params: Record<string, unknown>) => number;
  subscribe: (id: number, event: string, cb: Listener) => () => void;
  execute: (id: number) => void;
  getResponse: (id: number) => string;
  reset: (id: number) => void;
  destroy: (id: number) => void;
  setTheme: (id: number, theme: string) => void;
}

function loadStub(token: string): {
  window: { smartCaptcha?: StubSurface; readyCalls: number };
  flush: () => Promise<void>;
} {
  const timers: Array<() => void> = [];
  const window = {
    readyCalls: 0,
    __onSmartCaptchaReady() {
      window.readyCalls += 1;
    },
  } as { smartCaptcha?: StubSurface; readyCalls: number };
  runInNewContext(captchaStubScript(token, "__onSmartCaptchaReady"), {
    window,
    setTimeout: (fn: () => void) => timers.push(fn),
  });
  return {
    window,
    flush: async () => {
      while (timers.length) timers.shift()?.();
    },
  };
}

const TOKEN = "f".repeat(64);

describe("captchaStubScript", () => {
  it("installs window.smartCaptcha and fires the loader's onload callback", () => {
    const { window } = loadStub(TOKEN);
    expect(window.smartCaptcha).toBeDefined();
    expect(window.readyCalls).toBe(1);
  });

  it("resolves execute with the test token through the `success` subscription", async () => {
    const { window, flush } = loadStub(TOKEN);
    const captcha = window.smartCaptcha!;
    const id = captcha.render({}, { sitekey: "ysc1_x", invisible: true });
    const tokens: unknown[] = [];
    captcha.subscribe(id, "success", (t) => tokens.push(t));
    captcha.execute(id);
    await flush();
    expect(tokens).toEqual([TOKEN]);
    expect(captcha.getResponse(id)).toBe(TOKEN);
  });

  it("stops notifying after unsubscribe, reset and destroy", async () => {
    const { window, flush } = loadStub(TOKEN);
    const captcha = window.smartCaptcha!;
    const id = captcha.render({}, {});
    const seen: unknown[] = [];
    const unsubscribe = captcha.subscribe(id, "success", (t) => seen.push(t));
    unsubscribe();
    captcha.execute(id);
    await flush();
    expect(seen).toEqual([]);
    captcha.reset(id);
    expect(captcha.getResponse(id)).toBe("");
    captcha.subscribe(id, "success", (t) => seen.push(t));
    captcha.destroy(id);
    captcha.execute(id);
    await flush();
    expect(seen).toEqual([]);
    expect(() => captcha.setTheme(id, "dark")).not.toThrow();
  });

  it("gives every render its own widget id", () => {
    const { window } = loadStub(TOKEN);
    const a = window.smartCaptcha!.render({}, {});
    const b = window.smartCaptcha!.render({}, {});
    expect(a).not.toBe(b);
    expect(typeof a).toBe("number");
  });
});

describe("isSmartCaptchaScriptUrl", () => {
  it("matches the adapter's default host and the yandexcloud host", () => {
    expect(
      isSmartCaptchaScriptUrl(
        new URL(
          "https://smartcaptcha.cloud.yandex.ru/captcha.js?render=onload&onload=__onSmartCaptchaReady",
        ),
      ),
    ).toBe(true);
    expect(
      isSmartCaptchaScriptUrl(
        new URL("https://smartcaptcha.yandexcloud.net/captcha.js"),
      ),
    ).toBe(true);
  });

  it("matches nothing else", () => {
    expect(
      isSmartCaptchaScriptUrl(
        new URL("https://doctor.pr-1.stage.doctor.school/captcha.js"),
      ),
    ).toBe(false);
    expect(
      isSmartCaptchaScriptUrl(
        new URL("https://smartcaptcha.cloud.yandex.ru/validate"),
      ),
    ).toBe(false);
  });
});

describe("captchaTestTokenFromEnv", () => {
  it("returns the box token exported by the operator", () => {
    expect(captchaTestTokenFromEnv({ E2E_CAPTCHA_TEST_TOKEN: TOKEN })).toBe(
      TOKEN,
    );
  });

  it("throws a named error when the token is absent — never a silent skip", () => {
    expect(() => captchaTestTokenFromEnv({})).toThrow(
      CaptchaTestTokenMissingError,
    );
    expect(() =>
      captchaTestTokenFromEnv({ E2E_CAPTCHA_TEST_TOKEN: " " }),
    ).toThrow(/E2E_CAPTCHA_TEST_TOKEN/);
  });
});

describe("installCaptchaStub", () => {
  it("accepts a Playwright page or a whole browser context (compile-time contract)", () => {
    const accepts = (page: Page, context: BrowserContext) => [
      installCaptchaStub(page, TOKEN),
      installCaptchaStub(context, TOKEN),
    ];
    expect(typeof accepts).toBe("function");
  });

  it("routes the captcha script to the stub and passes every other request on", async () => {
    let matcher: ((url: URL) => boolean) | undefined;
    let handler:
      | ((route: {
          request: () => { url: () => string };
          fulfill: (r: {
            status: number;
            contentType: string;
            body: string;
          }) => Promise<void>;
        }) => Promise<void>)
      | undefined;
    await installCaptchaStub(
      {
        route: async (m, h) => {
          matcher = m as (url: URL) => boolean;
          handler = h as typeof handler;
        },
      },
      TOKEN,
    );
    expect(
      matcher?.(
        new URL("https://smartcaptcha.cloud.yandex.ru/captcha.js?onload=cb"),
      ),
    ).toBe(true);
    let fulfilled:
      { status: number; contentType: string; body: string } | undefined;
    await handler?.({
      request: () => ({
        url: () =>
          "https://smartcaptcha.cloud.yandex.ru/captcha.js?render=onload&onload=cb",
      }),
      fulfill: async (r) => {
        fulfilled = r;
      },
    });
    expect(fulfilled?.status).toBe(200);
    expect(fulfilled?.contentType).toContain("javascript");
    expect(fulfilled?.body).toContain(JSON.stringify(TOKEN));
    expect(fulfilled?.body).toContain('"cb"');
  });
});
