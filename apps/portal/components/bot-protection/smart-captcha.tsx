"use client";

import { useEffect, useRef } from "react";

/**
 * Yandex SmartCaptcha widget (003 design §10.1, ADR-0001 open-q #7).
 *
 * The frontend half of the bot-protection abstraction: it renders the
 * RF-accessible captcha and emits the token the backend `BotProtectionGuard`
 * verifies. It is provider-specific by design and never imported directly by a
 * form — call sites depend on the neutral {@link BotProtectionField} wrapper, so
 * swapping the provider (DSO-26) is a one-file change.
 *
 * Self-contained loader (no npm dependency): it injects the official
 * `captcha.js` once and drives the documented `window.smartCaptcha` API.
 */

const SCRIPT_ID = "yandex-smart-captcha";
const SCRIPT_SRC = "https://smartcaptcha.yandexcloud.net/captcha.js";

interface SmartCaptchaApi {
  render: (
    container: HTMLElement,
    params: {
      sitekey: string;
      hl?: string;
      callback?: (token: string) => void;
    },
  ) => number;
  subscribe: (
    widgetId: number,
    event: "token-expired" | "challenge-hidden" | "network-error",
    callback: () => void,
  ) => () => void;
  destroy: (widgetId: number) => void;
}

declare global {
  interface Window {
    smartCaptcha?: SmartCaptchaApi;
  }
}

/** Load `captcha.js` once; resolve when `window.smartCaptcha` is available. */
function loadScript(): Promise<SmartCaptchaApi> {
  return new Promise((resolve, reject) => {
    if (window.smartCaptcha) {
      resolve(window.smartCaptcha);
      return;
    }
    const onReady = (): void => {
      if (window.smartCaptcha) resolve(window.smartCaptcha);
      else reject(new Error("smartCaptcha unavailable after load"));
    };
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      // The script may already have fired `load` before this listener attaches
      // (a second widget mounting after the first loaded it) — resolve eagerly.
      if (window.smartCaptcha) {
        resolve(window.smartCaptcha);
        return;
      }
      existing.addEventListener("load", onReady, { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("captcha.js failed")),
        {
          once: true,
        },
      );
      return;
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.defer = true;
    script.addEventListener("load", onReady, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("captcha.js failed")),
      {
        once: true,
      },
    );
    document.head.appendChild(script);
  });
}

export interface SmartCaptchaProps {
  sitekey: string;
  /** Emits the solve token, or `null` when it expires / is reset. */
  onToken: (token: string | null) => void;
  /** Widget UI language; defaults to Russian (the portal default locale). */
  hl?: string;
}

export function SmartCaptcha({
  sitekey,
  onToken,
  hl = "ru",
}: SmartCaptchaProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let widgetId: number | undefined;
    const unsubscribers: Array<() => void> = [];
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    void loadScript()
      .then((api) => {
        if (cancelled || !container) return;
        widgetId = api.render(container, {
          sitekey,
          hl,
          callback: (token) => onToken(token),
        });
        // Expiry or a mid-challenge network error invalidates the solve — clear
        // the token so the gate stays closed (fail-closed) until it re-solves.
        unsubscribers.push(
          api.subscribe(widgetId, "token-expired", () => onToken(null)),
          api.subscribe(widgetId, "network-error", () => onToken(null)),
        );
      })
      .catch(() => {
        // Load failure: emit no token so the gate stays closed (fail-closed,
        // mirroring the backend adapter). Errors are not surfaced to the user.
        if (!cancelled) onToken(null);
      });

    return () => {
      cancelled = true;
      for (const off of unsubscribers) off();
      if (widgetId !== undefined) window.smartCaptcha?.destroy(widgetId);
    };
  }, [sitekey, hl, onToken]);

  return <div ref={containerRef} />;
}
