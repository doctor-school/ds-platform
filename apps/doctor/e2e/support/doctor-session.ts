import { expect, type Page } from "@playwright/test";

/**
 * 006 · 020 (#1912, #1722 slice 4) — mint a real `__Host-ds_session` on the
 * DOCTOR origin for the live-stand room tier.
 *
 * Why this is not a UI login helper (the academy's `room.spec.ts` drives the
 * `/login` form): doctor.school has NO login route by design — ADR-0015 §4 REQ-24
 * / 020 §6.1 D10 give this host exactly one link into the Academy and no auth
 * form of its own, and its `/register` form is fail-closed pending #1541/#1558.
 * So the only honest way to put a REAL session cookie on this origin in a test is
 * the same-origin BFF the app already ships: `apps/doctor/next.config.ts` rewrites
 * `/v1/:path*` to the api, and `POST /v1/auth/login` answers with the
 * `Set-Cookie: __Host-ds_session` the browser then carries on every subsequent
 * navigation. No cookie is fabricated and no gate is bypassed — the room's EARS-1
 * grant is evaluated server-side against this session exactly as in production.
 *
 * Two mechanics the call shape encodes:
 *
 * - **In-page `fetch`, never `request.post`.** The api binds the session
 *   fingerprint to `hash(user-agent + IP/24 + accept-language)`
 *   (`apps/api/src/auth/session-auth.hook.ts`). A fetch issued from the PAGE
 *   carries the browser's own UA and `accept-language`, so the fingerprint matches
 *   the navigations that follow; a Playwright `APIRequestContext` call would mint a
 *   session bound to a different fingerprint and every room read would 401.
 * - **`page.goto(BASE)` first.** `__Host-` cookies require a secure context and a
 *   same-origin request. Chromium treats `http://localhost` as secure (the academy
 *   tier already relies on this on the same stand), but the page must be ON the
 *   doctor origin before the relative `/v1/auth/login` is issued.
 *
 * ACCOUNT PROVISIONING (once per stand, NOT per run — self-signup throttles after
 * ~4-5 attempts per window with a 429, so mint ONE pair and reuse it). Account
 * state is host-independent: users, event registrations and the saved display name
 * live in the api/Postgres BOTH storefronts share, and only the cookie is
 * per-origin. Against the api port directly:
 *
 *   1. `POST /v1/auth/register` `{ email, password }`
 *   2. read the OTP from Mailpit (`MAILPIT_URL`), then
 *      `POST /v1/auth/verify` `{ email, code }`
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
export const DOCTOR_BASE = process.env.E2E_DOCTOR_URL ?? "http://localhost:3004";

interface LoginOutcome {
  readonly status: number;
  readonly body: string;
}

/**
 * Put a real doctor session cookie on the doctor origin for `page`, leaving the
 * page on that origin and ready to navigate to a gated route.
 *
 * Throws (via `expect`) with the api's own status + body when the login is
 * refused, so a 401 (wrong credentials) and a 429 (rate-limit ceiling not raised —
 * see the STAND PRECONDITIONS in `live-stand-env.ts`) are distinguishable at a
 * glance instead of surfacing later as an opaque redirect to the event page.
 */
export async function loginAsDoctor(page: Page): Promise<void> {
  const identifier = process.env.E2E_DOCTOR_EMAIL;
  const password = process.env.E2E_DOCTOR_PASSWORD;
  expect(
    identifier && password,
    "E2E_DOCTOR_EMAIL / E2E_DOCTOR_PASSWORD must be exported (see the ENV SET table)",
  ).toBeTruthy();

  await page.goto(`${DOCTOR_BASE}/`, { waitUntil: "domcontentloaded" });

  const outcome = await page.evaluate<LoginOutcome, [string, string]>(
    async ([id, pw]) => {
      const response = await fetch("/v1/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: id, password: pw }),
      });
      return { status: response.status, body: await response.text() };
    },
    [identifier!, password!],
  );

  expect(
    outcome.status,
    `POST /v1/auth/login through the doctor BFF should authenticate — got ${outcome.status}: ${outcome.body}`,
  ).toBe(200);
  expect(
    outcome.body,
    `the login response should report an authenticated session — got ${outcome.body}`,
  ).toContain("authenticated");
}
