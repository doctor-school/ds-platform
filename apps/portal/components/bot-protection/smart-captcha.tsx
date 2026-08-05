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

const PROVIDER_BOOTSTRAP_TIMEOUT_MS = 10_000;

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
  const challengeVisible = useRef(false);
  const providerSettled = useRef(false);

  useEffect(() => {
    if (!active) {
      providerSettled.current = true;
      challengeVisible.current = false;
      return;
    }

    solved.current = false;
    challengeVisible.current = false;
    providerSettled.current = false;

    const bootstrapTimeout = window.setTimeout(() => {
      if (!providerSettled.current && !challengeVisible.current) {
        providerSettled.current = true;
        onError("unavailable");
      }
    }, PROVIDER_BOOTSTRAP_TIMEOUT_MS);

    return () => window.clearTimeout(bootstrapTimeout);
  }, [active, onError]);

  return (
    <InvisibleSmartCaptcha
      sitekey={sitekey}
      language={hl}
      visible={active}
      theme={theme}
      hideShield={true}
      onSuccess={(token) => {
        solved.current = true;
        providerSettled.current = true;
        onToken(token);
      }}
      onTokenExpired={() => {
        providerSettled.current = true;
        onError("expired");
      }}
      onNetworkError={() => {
        providerSettled.current = true;
        onError("unavailable");
      }}
      onJavascriptError={() => {
        providerSettled.current = true;
        onError("unavailable");
      }}
      onChallengeVisible={() => {
        // A person may legitimately need longer than the bootstrap timeout to
        // solve the provider challenge. Once it is visible, never time them out.
        challengeVisible.current = true;
      }}
      onChallengeHidden={() => {
        // Yandex also hides the challenge after success. Defer one microtask so
        // the success callback wins regardless of provider event ordering.
        queueMicrotask(() => {
          if (active && !solved.current) {
            providerSettled.current = true;
            onError("incomplete");
          }
        });
      }}
    />
  );
}
