"use client";

import { useEffect } from "react";

import { SmartCaptcha, type BotProtectionFailure } from "./smart-captcha";

export interface BotProtectionFieldProps {
  /**
   * The provider site key, resolved by the HOST (021 EARS-19, #1558).
   *
   * The portal-local original read `process.env.NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY`
   * itself. A design-system block must not: the package ships no build-time env
   * of its own and is mounted by two Next apps that inline their own, so the key
   * arrives as a prop and each host names the variable it actually builds with.
   * Absent or empty — the dev-stand default, and the state a storefront built
   * without a key runs in — the pending action RESUMES TOKENLESS, exactly
   * matching the backend guard's no-op when the provider is disabled.
   */
  sitekey?: string | undefined;
  /** Monotonic key for one pending protected action; `null` is idle. */
  requestKey: number | null;
  /** Emits one fresh token; `undefined` means protection is disabled locally. */
  onToken: (token?: string) => void;
  onError: (failure: BotProtectionFailure) => void;
}

/**
 * Provider-neutral, invisible bot-protection mechanism (003 design §10.1).
 * Policy lives at call sites; this wrapper owns configuration and guarantees a
 * new provider instance for every request key, so a one-time token is never
 * reused. With no site key (the dev default), it resumes the pending action
 * without a token, matching the disabled backend provider.
 */
export function BotProtectionField({
  sitekey,
  requestKey,
  onToken,
  onError,
}: BotProtectionFieldProps) {
  useEffect(() => {
    if (!sitekey && requestKey !== null) onToken(undefined);
  }, [onToken, requestKey, sitekey]);

  if (!sitekey) return null;

  return (
    <SmartCaptcha
      key={requestKey ?? "idle"}
      sitekey={sitekey}
      active={requestKey !== null}
      onToken={onToken}
      onError={onError}
    />
  );
}
