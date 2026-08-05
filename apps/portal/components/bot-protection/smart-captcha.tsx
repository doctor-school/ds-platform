"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  InvisibleSmartCaptcha,
  type InvisibleSmartCaptchaProps,
} from "@yandex/smart-captcha";

export type BotProtectionFailure = "expired" | "unavailable" | "incomplete";

type PortalTheme = "light" | "dark";

function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function readTheme(): PortalTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function serverTheme(): PortalTheme {
  return "light";
}

export interface SmartCaptchaProps {
  sitekey: string;
  /** Execute the provider-native invisible check for the pending action. */
  active: boolean;
  /** A fresh one-time token, or `undefined` when protection is disabled upstream. */
  onToken: (token?: string) => void;
  /** Provider/script lifecycle failure; callers map it to localized action copy. */
  onError: (failure: BotProtectionFailure) => void;
  /** Widget UI language; defaults to Russian (the portal default locale). */
  hl?: InvisibleSmartCaptchaProps["language"];
}

/**
 * Thin EARS-17 adapter over Yandex's official MIT React package.
 *
 * `InvisibleSmartCaptcha` owns script loading, provider challenge UI and the
 * imperative execute lifecycle. The portal supplies only policy: when to run,
 * its resolved `.dark`/light theme, and truthful error routing. No custom
 * challenge UI is implemented here.
 */
export function SmartCaptcha({
  sitekey,
  active,
  onToken,
  onError,
  hl = "ru",
}: SmartCaptchaProps) {
  const theme = useSyncExternalStore(subscribeToTheme, readTheme, serverTheme);
  const solved = useRef(false);

  useEffect(() => {
    if (active) solved.current = false;
  }, [active]);

  return (
    <InvisibleSmartCaptcha
      sitekey={sitekey}
      language={hl}
      visible={active}
      theme={theme}
      onSuccess={(token) => {
        solved.current = true;
        onToken(token);
      }}
      onTokenExpired={() => onError("expired")}
      onNetworkError={() => onError("unavailable")}
      onJavascriptError={() => onError("unavailable")}
      onChallengeHidden={() => {
        // Yandex also hides the challenge after success. Defer one microtask so
        // the success callback wins regardless of provider event ordering.
        queueMicrotask(() => {
          if (active && !solved.current) onError("incomplete");
        });
      }}
    />
  );
}
