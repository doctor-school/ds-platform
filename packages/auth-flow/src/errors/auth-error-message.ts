import { BotProtectionErrorCodes } from "@ds/schemas";

import { AuthError } from "../client/auth-client";
import type { AuthFlowErrorCopy } from "../host-config";

/**
 * The ONE auth error dictionary both storefronts read (#2027, gate rows 10–15).
 *
 * The package owns the BRANCH — which status may be spoken about plainly and
 * which one is an account oracle — and the host owns the WORDING, which is why
 * `copy` is a plain messages object rather than a translator: the Academy builds
 * it once from its `errors` catalog and the doctor storefront, which ships no
 * i18n runtime, states its RU literals. Before this unit the rule lived twice
 * (`apps/portal/lib/auth-error-message.ts` and its doctor twin) and had already
 * drifted — only one of the two knew the bot-protection codes.
 *
 * The branch is on whether the status is an ACCOUNT ORACLE:
 *
 *   • `BOT_PROTECTION_REQUIRED` / `BOT_PROTECTION_REJECTED` → the real obstacle
 *     is the challenge, not the credential. Named first, because the api sends
 *     these with a 403 and the generic below would blame the doctor's password.
 *   • 429 (rate limit — per-IP/ASN/global, never per-account) → actionable
 *     "too many attempts". Not an existence oracle.
 *   • 5xx, or a thrown non-`AuthError` (`fetch` rejecting on offline / DNS / TLS,
 *     or a programming failure) → "temporarily unavailable". Availability, not
 *     an oracle.
 *   • everything else — 400 / 401 / any other status, i.e. the authentication
 *     OUTCOME (wrong credential, unknown account, an account still awaiting
 *     verification, a failed factor) → the CALLER's generic. 003 EARS-16: this
 *     MUST stay neutral, so the surface never tells a stranger whether an
 *     address is registered here, and a dedicated "confirm your email first"
 *     message is deliberately NOT written — it would be that exact oracle.
 *
 * `callerGeneric` is supplied per call site rather than held in `copy` (row 11)
 * so a failed verification never says «войти»: only the caller knows which
 * action the doctor was performing.
 */
export function authErrorMessage(
  error: unknown,
  copy: AuthFlowErrorCopy,
  callerGeneric: string,
): string {
  if (error instanceof AuthError) {
    if (error.code === BotProtectionErrorCodes.required) {
      return copy.botProtectionRequired;
    }
    if (error.code === BotProtectionErrorCodes.rejected) {
      return copy.botProtectionRejected;
    }
    if (error.status === 429) return copy.tooManyAttempts;
    if (error.status >= 500) return copy.unavailable;
    // 400 / 401 / any other status = the auth outcome → stay EARS-16-generic.
    return callerGeneric;
  }
  // A non-AuthError escaped the call: transport-class, not an oracle.
  return copy.unavailable;
}
