"use client";

import { BotProtectionErrorCodes } from "@ds/schemas";

import { AuthError } from "./auth-client";

/**
 * Map an auth-call failure to the RU sentence the doctor reads (#1933).
 *
 * The doctor storefront is a single-locale RU app with no `next-intl` provider
 * (see `components/auth-shell.tsx`), so the copy is literal here exactly as it is
 * in `components/registration-screen.tsx` — the portal's twin takes a translator
 * because the portal HAS a catalogue, and that is the only difference between
 * the two. The BRANCHING RULE below is the shared product decision (003 EARS-16),
 * not portal-local behaviour, and it is reproduced deliberately rather than
 * imported: `apps/doctor` may not import from `apps/portal` (ADR-0013 A1).
 *
 * The branch is on whether the status is an ACCOUNT ORACLE:
 *
 *   • 429 (rate limit — per-IP/ASN/global, never per-account) → actionable
 *     "too many attempts". Not an existence oracle.
 *   • `BOT_PROTECTION_REQUIRED` / `BOT_PROTECTION_REJECTED` → the challenge the
 *     doctor host cannot yet render (below). Availability, not an oracle.
 *   • 5xx, or a thrown non-`AuthError` (network / DNS / TLS / a programming
 *     failure making `fetch` reject) → "temporarily unavailable". Availability,
 *     not an oracle.
 *   • everything else — 400 / 401 / any other status, i.e. the actual
 *     authentication OUTCOME (wrong password, unknown account, an account still
 *     awaiting email verification, a failed factor) → the per-action generic.
 *     EARS-16: this MUST stay neutral, so the surface never tells a stranger
 *     whether an address is registered here. A dedicated "confirm your email
 *     first" message is therefore NOT written: it would be precisely the
 *     existence oracle the requirement forbids, and the api does not distinguish
 *     the case in its response either.
 *
 * THE BOT-PROTECTION BRANCH IS A REAL GAP TRACKED AT #1558, NOT A STUB. `POST
 * /v1/auth/login` is `@LoginChallenged()` — captcha-after-N-failures, so an
 * ordinary sign-in is unburdened — and `POST /v1/auth/login/otp/request` is
 * `@BotProtected("otp-request")`, which no-ops until a provider is configured.
 * The widget that answers either challenge is portal-local
 * (`apps/portal/components/bot-protection/`) and the doctor host's copy is
 * tracked at #1558 (the same dependency that keeps `/register`'s submit inert).
 * Until it lands the honest thing is to SAY the check cannot be completed here
 * and name the way forward, rather than render a dead challenge slot or a
 * message blaming the doctor's password.
 */

/** The neutral EARS-16 outcome copy, one per action. */
export const AUTH_GENERIC_MESSAGES = {
  login: "Не удалось войти. Проверьте почту или телефон и пароль.",
  otpSend: "Не удалось отправить код. Проверьте адрес или номер и повторите.",
  otpVerify: "Код не подошёл. Проверьте цифры или запросите новый.",
} as const;

const TOO_MANY_ATTEMPTS =
  "Слишком много попыток. Подождите пару минут и попробуйте снова.";

const UNAVAILABLE =
  "Сервис временно недоступен. Попробуйте ещё раз через минуту.";

const BOT_PROTECTION =
  "Нужна дополнительная проверка, которую эта страница пока не умеет показывать. Попробуйте позже или войдите по паролю на academy.doctor.school.";

export function authErrorMessage(err: unknown, fallbackGeneric: string): string {
  if (err instanceof AuthError) {
    if (
      err.code === BotProtectionErrorCodes.required ||
      err.code === BotProtectionErrorCodes.rejected
    ) {
      return BOT_PROTECTION;
    }
    if (err.status === 429) return TOO_MANY_ATTEMPTS;
    if (err.status >= 500) return UNAVAILABLE;
    // 400 / 401 / any other status = the auth outcome → stay EARS-16-generic.
    return fallbackGeneric;
  }
  // A non-AuthError escaped the call: `fetch` rejected (offline / DNS / TLS) or a
  // programming error. Transport-class, not an oracle → actionable "unavailable".
  return UNAVAILABLE;
}
