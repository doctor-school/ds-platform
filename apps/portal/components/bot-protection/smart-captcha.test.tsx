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
  const subscriptions = new Map<
    number,
    Map<CaptchaEvent, (...args: unknown[]) => void>
  >();
  const renderWidget = vi.fn(() => 17);
  const execute = vi.fn();
  const setTheme = vi.fn();
  const destroy = vi.fn();

  beforeEach(() => {
    subscriptions.clear();
    renderWidget.mockReset();
    renderWidget.mockReturnValue(17);
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
      subscribe: vi.fn((widgetId, event, callback) => {
        const widgetSubscriptions =
          subscriptions.get(widgetId) ??
          new Map<CaptchaEvent, (...args: unknown[]) => void>();
        widgetSubscriptions.set(event as CaptchaEvent, callback);
        subscriptions.set(widgetId, widgetSubscriptions);
        return vi.fn();
      }),
      _origin: "",
      _test: "",
      _webview: "",
    } as never;
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    document.documentElement.classList.remove("dark");
    delete captchaWindow.smartCaptcha;
  });

  it("EARS-17: remounts the official widget for a new theme when its initial id is zero and resumes the action once", async () => {
    renderWidget.mockReturnValueOnce(0).mockReturnValueOnce(1);
    const onToken = vi.fn();
    const onError = vi.fn();
    const captcha = () => (
      <SmartCaptcha
        sitekey="client-key"
        active
        onToken={onToken}
        onError={onError}
      />
    );

    const { rerender } = render(captcha());

    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1));
    expect(renderWidget).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        sitekey: "client-key",
        invisible: true,
        hideShield: true,
        theme: "dark",
      }),
    );
    await waitFor(() => expect(execute).toHaveBeenCalledWith(0));
    await waitFor(() =>
      expect(subscriptions.get(0)?.get("success")).toEqual(
        expect.any(Function),
      ),
    );
    const staleChallengeHidden = subscriptions.get(0)?.get("challenge-hidden");
    const staleSuccess = subscriptions.get(0)?.get("success");

    act(() => {
      staleChallengeHidden?.();
      document.documentElement.classList.remove("dark");
    });
    rerender(captcha());
    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(2));
    expect(renderWidget).toHaveBeenNthCalledWith(
      2,
      expect.any(HTMLElement),
      expect.objectContaining({ theme: "light" }),
    );
    expect(destroy).toHaveBeenCalledWith(0);
    await waitFor(() => expect(execute).toHaveBeenCalledWith(1));

    await act(async () => Promise.resolve());
    expect(onError).not.toHaveBeenCalled();

    act(() => staleSuccess?.("stale-token"));
    expect(onToken).not.toHaveBeenCalled();

    await act(async () => {
      subscriptions.get(1)?.get("challenge-hidden")?.();
      subscriptions.get(1)?.get("success")?.("fresh-token");
      await Promise.resolve();
    });
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith("fresh-token");
    expect(onError).not.toHaveBeenCalled();
  });

  it("EARS-17: gives a stalled replacement widget its own bootstrap timeout after a visible predecessor", async () => {
    vi.useFakeTimers();
    renderWidget.mockReturnValueOnce(0).mockReturnValueOnce(1);
    const onError = vi.fn();
    const captcha = () => (
      <SmartCaptcha
        sitekey="client-key"
        active
        onToken={vi.fn()}
        onError={onError}
      />
    );

    const { rerender } = render(captcha());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(renderWidget).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(0);

    act(() => subscriptions.get(0)?.get("challenge-visible")?.());
    document.documentElement.classList.remove("dark");
    rerender(captcha());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(renderWidget).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledWith(0);
    expect(execute).toHaveBeenCalledWith(1);
    expect(onError).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("unavailable");
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

    act(() => subscriptions.get(17)?.get("network-error")?.());
    expect(onError).toHaveBeenCalledWith("unavailable");
    expect(onToken).not.toHaveBeenCalled();

    act(() => subscriptions.get(17)?.get("token-expired")?.());
    expect(onError).toHaveBeenCalledWith("expired");

    act(() =>
      subscriptions.get(17)?.get("javascript-error")?.({
        filename: "captcha.js",
        message: "load failed",
        col: 0,
        line: 0,
      }),
    );
    expect(onError).toHaveBeenCalledWith("unavailable");
  });

  it("EARS-17: reports a provider bootstrap that stalls without emitting an error", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();

    render(
      <SmartCaptcha
        sitekey="client-key"
        active
        onToken={vi.fn()}
        onError={onError}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(renderWidget).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("unavailable");
  });

  it("EARS-17: lets a visible human challenge outlive the provider bootstrap timeout", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();

    render(
      <SmartCaptcha
        sitekey="client-key"
        active
        onToken={vi.fn()}
        onError={onError}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(renderWidget).toHaveBeenCalledTimes(1);

    act(() => subscriptions.get(17)?.get("challenge-visible")?.());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(onError).not.toHaveBeenCalled();
  });
});
