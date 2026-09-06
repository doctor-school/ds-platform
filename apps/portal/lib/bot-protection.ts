import type { BotProtectionMessages } from "@ds/design-system/blocks";

/**
 * Portal-side glue for the shared bot-protection block (021 EARS-19, #1558).
 *
 * The widget itself, the resume-one-action orchestration and the error
 * predicates moved into `@ds/design-system/blocks` so both storefronts mount ONE
 * implementation. What stays here is what a design-system package must not own:
 * the site key THIS app was built with, and the localized copy its failures map
 * onto.
 *
 * `NEXT_PUBLIC_*` is inlined by the Next build, so the read is a build-time
 * constant at the call site; it stays a FUNCTION rather than a module constant so
 * a test that configures the key after import sees it (the same reason
 * `<AuthShell>` reads it inline). Unset — the dev-stand default — the block
 * resumes the protected action tokenless, matching the backend guard's no-op when
 * the provider is disabled.
 */
export function botProtectionSiteKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY;
}

/** The `errors.*` catalog entries the block's three failure kinds resolve to. */
export function botProtectionMessages(
  te: (key: string) => string,
): BotProtectionMessages {
  return {
    unavailable: te("captchaUnavailable"),
    rejected: te("captchaRejected"),
    required: te("captchaRequired"),
  };
}
