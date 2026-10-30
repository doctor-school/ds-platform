import { expect, type Page } from "@playwright/test";
import { signInPageThroughHost } from "@ds/e2e/host-sign-in";

/**
 * 006 · 020 (#1912, #1722 slice 4) — a real `__Host-ds_session` on the DOCTOR
 * origin for the live-stand room tier, minted the production way (#3565): the
 * storefront's `/login` entry, the IdP and the sign-in host's password form,
 * then the storefront's `/auth/callback` (`@ds/e2e/host-sign-in`). The room's
 * EARS-1 grant is evaluated server-side against this session exactly as in
 * production; the browser that signed in carries it, so the session
 * fingerprint (`hash(user-agent + IP/24 + accept-language)`) matches the
 * navigations that follow.
 *
 * ACCOUNT PROVISIONING (once per stand, NOT per run — self-signup throttles after
 * ~4-5 attempts per window with a 429, so mint ONE pair and reuse it). Account
 * state is host-independent: users, event registrations and the saved display name
 * live in the api/Postgres BOTH storefronts share, and only the cookie is
 * per-origin.
 *
 *   1-2. register through the doctor storefront's `/register` door on the
 *      sign-in host and confirm with the Mailpit code (`MAILPIT_URL`) —
 *      `provisionConfirmedAccount` in `@ds/e2e/host-sign-in` is the recipe
 *   3. `PUT /v1/me/display-name` — REQUIRED: with no saved name the 006 EARS-14
 *      JIT prompt renders INSTEAD of the room and every in-room assertion fails
 *   4. register the doctor for each seeded room this tier drives
 *      (`seed-006-room-youtube`, `seed-006-room-rutube`,
 *      `seed-006-room-unavailable`) and for the not-live event
 *      (`seed-005-upcoming`) that the EARS-6 not-live leg uses
 *
 * Export the resulting credentials as `E2E_DOCTOR_EMAIL` / `E2E_DOCTOR_PASSWORD`.
 */

/** The doctor storefront origin under test. */
export const DOCTOR_BASE =
  process.env.E2E_DOCTOR_URL ?? "http://localhost:3004";

/**
 * Put a real doctor session cookie on the doctor origin for `page`, leaving the
 * page on that origin and ready to navigate to a gated route.
 */
export async function loginAsDoctor(page: Page): Promise<void> {
  const identifier = process.env.E2E_DOCTOR_EMAIL;
  const password = process.env.E2E_DOCTOR_PASSWORD;
  expect(
    identifier && password,
    "E2E_DOCTOR_EMAIL / E2E_DOCTOR_PASSWORD must be exported (see the ENV SET table)",
  ).toBeTruthy();
  await signInPageThroughHost(page, DOCTOR_BASE, {
    email: identifier!,
    password: password!,
  });
}
