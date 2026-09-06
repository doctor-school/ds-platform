import { BotProtectionErrorCodes } from "@ds/schemas";

import type { BotProtectionFailure } from "./smart-captcha";

/**
 * 003 EARS-17 error predicates and copy routing, lifted out of
 * `apps/portal/components/bot-protection/` with the package's app-agnostic seam
 * (021 EARS-19, #1558).
 *
 * The portal versions narrowed on its own `AuthError` class before reading the
 * code. A design-system block cannot: it is mounted by two storefronts whose
 * transports throw different error classes, and importing either one would make
 * the package depend on an app. So the predicates read the STABLE CODE off any
 * `{ code }`-bearing value instead — the codes are the `@ds/schemas` SSOT and are
 * unique across the contract, so an instance check adds no discrimination the
 * code does not already carry.
 */
function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function isBotProtectionRequired(error: unknown): boolean {
  return errorCode(error) === BotProtectionErrorCodes.required;
}

export function isBotProtectionRejected(error: unknown): boolean {
  return errorCode(error) === BotProtectionErrorCodes.rejected;
}

/**
 * The three localized strings a host supplies for the challenge failures.
 *
 * Copy never lives in the package (the #235 i18n contract), so the caller hands
 * in its own catalog entries — the portal its `next-intl` `errors.*` messages,
 * the doctor storefront its module constants — and this block only decides
 * WHICH of the three a given provider failure means.
 */
export interface BotProtectionMessages {
  /** The provider could not run at all — network or script failure. */
  unavailable: string;
  /** A token was minted but is expired or was refused. */
  rejected: string;
  /** No token was produced — the challenge was dismissed or never completed. */
  required: string;
}

export function botProtectionFailureMessage(
  failure: BotProtectionFailure,
  messages: BotProtectionMessages,
): string {
  if (failure === "unavailable") return messages.unavailable;
  if (failure === "expired") return messages.rejected;
  return messages.required;
}
