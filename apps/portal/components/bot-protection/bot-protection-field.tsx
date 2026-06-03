"use client";

import { SmartCaptcha } from "./smart-captcha";

/**
 * Provider-neutral bot-protection field (003 design §10.1).
 *
 * Forms import THIS, never the Yandex-specific `<SmartCaptcha>` — the same
 * interface indirection the backend uses (the `BOT_PROTECTION` token), so
 * swapping the provider (DSO-26) touches one file, not every auth form. It
 * reads the site key from `NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY`; when unset (the
 * dev default — no Yandex account) it renders a labelled placeholder so the
 * portal still builds and the form still works, mirroring the backend's
 * disabled-by-default posture.
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

  if (!sitekey) {
    return (
      <div
        className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        role="note"
      >
        Bot protection inactive (no{" "}
        <code>NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY</code> configured) — set it to
        enable the SmartCaptcha widget.
      </div>
    );
  }

  return <SmartCaptcha sitekey={sitekey} onToken={onToken} />;
}
