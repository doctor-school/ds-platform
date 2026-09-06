import type { BotProtectionMessages } from "@ds/design-system/blocks";

/**
 * 021 EARS-19 (#1558) — the doctor storefront's glue for the shared
 * bot-protection block.
 *
 * The widget, its resume-one-action orchestration and the error predicates are
 * ONE implementation in `@ds/design-system/blocks` (lifted out of the portal in
 * this same slice). What a design-system package cannot own — and therefore
 * lives here — is the site key THIS app was built with and the localized copy
 * its failures map onto.
 *
 * A FUNCTION rather than a module constant so a caller that configures the key
 * after import (a test, a `next start` run) reads the current value;
 * `NEXT_PUBLIC_*` is inlined by the Next build, so in a real build it is a
 * constant either way. Unset — the dev-stand default, and the state a build
 * without the key runs in — the block resumes the protected action tokenless,
 * exactly matching the backend guard's no-op when the provider is disabled.
 *
 * The prod key is supplied as the `NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY` build arg
 * (`apps/doctor/Dockerfile`); `new.doctor.school` has to be an allowed domain of
 * the SmartCaptcha resource for the challenge to run there.
 */
export function botProtectionSiteKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY;
}

/**
 * The 003 EARS-17 failure copy, VERBATIM from the shipped Academy catalog
 * (`apps/portal/messages/ru.json` → `errors.captcha*`). Reused rather than
 * re-written: 021 invents no bot-protection copy of its own, and two storefronts
 * telling a doctor two different things about the same challenge is the
 * divergence the shared block exists to prevent. The doctor storefront ships no
 * i18n runtime, so the strings are module constants here instead of catalog keys.
 */
export const BOT_PROTECTION_MESSAGES: BotProtectionMessages = {
  required: "Подтвердите, что вы не робот.",
  rejected: "Проверка истекла или не пройдена. Подтвердите ещё раз.",
  unavailable:
    "Не удалось выполнить проверку. Проверьте подключение к интернету и попробуйте ещё раз.",
};
