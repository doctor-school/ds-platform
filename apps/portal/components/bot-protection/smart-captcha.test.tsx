import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SmartCaptcha } from "./smart-captcha";

type CaptchaEvent =
  | "challenge-visible"
  | "challenge-hidden"
  | "network-error"
  | "javascript-error"
  | "success"
  | "token-expired";

describe("SmartCaptcha provider adapter", () => {
  const captchaWindow = window as Window & { smartCaptcha?: unknown };
  const subscriptions = new Map<CaptchaEvent, (...args: unknown[]) => void>();
  const renderWidget = vi.fn(() => 17);
  const execute = vi.fn();
  const setTheme = vi.fn();
  const destroy = vi.fn();

  beforeEach(() => {
    subscriptions.clear();
    renderWidget.mockClear();
    execute.mockClear();
    setTheme.mockClear();
    destroy.mockClear();
    document.documentElement.classList.add("dark");
    captchaWindow.smartCaptcha = {
      render: renderWidget,
      execute,
      setTheme,
      reset: vi.fn(),
      destroy,
      getResponse: vi.fn(),
      executePromise: vi.fn(),
      showError: vi.fn(),
      subscribe: vi.fn((_, event, callback) => {
        subscriptions.set(event as CaptchaEvent, callback);
        return vi.fn();
      }),
      _origin: "",
      _test: "",
      _webview: "",
    } as never;
  });

  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove("dark");
    delete captchaWindow.smartCaptcha;
  });

  it("EARS-17: executes an invisible challenge on demand and follows the resolved portal theme live", async () => {
    render(
      <SmartCaptcha
        sitekey="client-key"
        active
        onToken={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1));
    expect(renderWidget).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        sitekey: "client-key",
        invisible: true,
        theme: "dark",
      }),
    );
    await waitFor(() => expect(execute).toHaveBeenCalledWith(17));

    act(() => document.documentElement.classList.remove("dark"));
    await waitFor(() => expect(setTheme).toHaveBeenCalledWith(17, "light"));
  });

  it("EARS-17: reports provider failures truthfully instead of converting them into an empty token", async () => {
    const onToken = vi.fn();
    const onError = vi.fn();
    render(
      <SmartCaptcha
        sitekey="client-key"
        active
        onToken={onToken}
        onError={onError}
      />,
    );
    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1));

    act(() => subscriptions.get("network-error")?.());
    expect(onError).toHaveBeenCalledWith("unavailable");
    expect(onToken).not.toHaveBeenCalled();

    act(() => subscriptions.get("token-expired")?.());
    expect(onError).toHaveBeenCalledWith("expired");

    act(() =>
      subscriptions.get("javascript-error")?.({
        filename: "captcha.js",
        message: "load failed",
        col: 0,
        line: 0,
      }),
    );
    expect(onError).toHaveBeenCalledWith("unavailable");
  });
});
