"use client";

import { SmartCaptcha } from "./smart-captcha";

/**
 * Provider-neutral bot-protection field (003 design §10.1).
 *
 * Forms import THIS, never the Yandex-specific `<SmartCaptcha>` — the same
 * interface indirection the backend uses (the `BOT_PROTECTION` token), so
 * swapping the provider (DSO-26) touches one file, not every auth form. It reads
 * the site key from `NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY`; when unset (the dev
 * default — no Yandex account) it renders **nothing** and the form still works,
 * mirroring the backend guard's disabled-by-default short-circuit (no widget
 * token is required when `BOT_PROTECTION_ENABLED` is off). No operator/dev
 * placeholder is ever shown to an end user.
 *
 * Policy — which surfaces show it and when (post-failure for login) — is
 * EARS-17, owned by 003 F1/F5/F6. This component is the mechanism only.
 */
export interface BotProtectionFieldProps {
  /** Emits the solve token, or `null` when absent / expired. */
  onToken: (token: string | null) => void;
}

export function BotProtectionField({ onToken }: BotProtectionFieldProps) {
  const sitekey = process.env.NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY;

  // No key configured (the dev default) → render nothing. The form still works:
  // the backend guard short-circuits to `ok` when `BOT_PROTECTION_ENABLED` is
  // off, so no widget token is needed and the user sees no dev-only placeholder.
  if (!sitekey) return null;

  return <SmartCaptcha sitekey={sitekey} onToken={onToken} />;
}
