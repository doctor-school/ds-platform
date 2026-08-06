"use client";

import { useEffect } from "react";
import { SmartCaptcha, type BotProtectionFailure } from "./smart-captcha";

export interface BotProtectionFieldProps {
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
  requestKey,
  onToken,
  onError,
}: BotProtectionFieldProps) {
  const sitekey = process.env.NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY;

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
