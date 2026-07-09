import { test, expect, type Page } from "@playwright/test";
import { LIVE_STAND } from "./support/doctor-session";
import { fetchOtpCode } from "./support/mailpit";
import { NOTIFICATION_SUBJECTS } from "./support/notification-subjects";

/**
 * 006 EARS-6 — denied-access routing (the front door). When a caller reaches
 * `/webinars/:slug/room` but is NOT admissible, the room routes them TRUTHFULLY per
 * the server-side gate outcome (EARS-1), never a soft wall over a rendered player:
 *
 *   • UNAUTHENTICATED             → through the 003 auth flow carrying a `returnTo`
 *                                   back to the ROOM url; on login the gate RE-RUNS
 *                                   (re-evaluated on return) and admits a doctor
 *                                   registered for a live room.
 *   • AUTHENTICATED, UNREGISTERED → guided to the 005 register front door on the
 *                                   event page (`?from=room` surfaces the access
 *                                   guidance); on register the doctor is admitted.
 *   • EVENT NOT `live`            → the truthful 004 lifecycle state on the event
 *                                   page, with NO watchable room.
 *
 * No branch renders the player, the chat, or the room composition (no soft wall).
 *
 * Live-stand-gated tier (mirrors `room.spec.ts` / `event-page-registered.spec.ts`):
 * it needs a running portal whose `/v1/*` rewrite reaches a running api + Postgres +
 * real Zitadel + Mailpit, seeded with a LIVE event (`seed-005-live`) and an
 * upcoming event (`seed-005-upcoming`) — the 005/006↔007 fixture seam. Each branch
 * SELF-PROVISIONS its own doctor through the real 003 register→verify→auto-login
 * flow (no operator-seeded credentials), so the whole suite runs on `LIVE_STAND` +
 * the seeds alone. It `test.skip`s unless the live stand env is present, so a stray
 * CI invocation is inert. Stage-B (canvas fidelity, both breakpoints × both themes)
 * is batched at #584.
 */

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
// A seeded LIVE event (the 006↔007 fixture seam). The room GRANT needs only
// authenticated ∧ registered ∧ live — an unconfigured live event still admits and
// renders the room composition (the player resolves to the truthful "unavailable"
// state), which is all the admission branches assert.
const SLUG_LIVE = process.env.E2E_ROOM_SLUG_LIVE ?? "seed-005-live";
// A seeded NON-live (upcoming) event the doctor registers for (branch 3 — the
// not-`live` fallback).
const SLUG_NOT_LIVE =
  process.env.E2E_WEBINAR_SLUG_NOT_LIVE ??
  process.env.E2E_WEBINAR_SLUG ??
  "seed-005-upcoming";

test.skip(
  !LIVE_STAND,
  "dev-stand env absent (E2E_PORTAL_URL / IDP_ISSUER / MAILPIT_URL) — manual gate",
);

const rand = (): string => Math.random().toString(36).slice(2, 8);

/**
 * Provision a doctor through the REAL 003 register→verify→auto-login flow (the same
 * path `support/doctor-session` drives), returning the KNOWN credentials so the
 * caller can log the doctor back in (branch 1's unauth round-trip). When `returnTo`
 * is a safe event target the auto-login also completes the 005 registration and
 * lands on that event page (registered); otherwise it lands on `/account`
 * (authenticated, unregistered).
 */
async function registerDoctor(
  page: Page,
  opts?: { returnTo?: string },
): Promise<{ email: string; password: string }> {
  const email = `e2e-582-${Date.now()}-${rand()}@ds.test`;
  const password = `Prt-${Date.now()}-aA1!`;
  const sentAt = new Date().toISOString();
  const entry = opts?.returnTo
    ? `/register?returnTo=${encodeURIComponent(opts.returnTo)}`
    : "/register";
  await page.goto(`${BASE}${entry}`, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="email"]').fill(email);
  await page.locator('input[autocomplete="new-password"]').fill(password);
  await page.getByTestId("register-submit").click();
  await page.waitForURL(/\/verify/);
  const code = await fetchOtpCode(
    email,
    sentAt,
    NOTIFICATION_SUBJECTS.verifyEmail,
  );
  expect(code, "registration OTP should reach Mailpit").toBeTruthy();
  // Entering the final digit auto-submits + auto-logs-in (#175).
  await page.locator('input[autocomplete="one-time-code"]').fill(code!);
  return { email, password };
}

/** Log the doctor in through the real 003 password flow on the CURRENT /login page. */
async function loginAs(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.getByRole("textbox", { name: /почта|email/i }).fill(email);
  await page.getByRole("textbox", { name: /пароль|password/i }).fill(password);
  await page.getByRole("button", { name: /войти|продолжить/i }).click();
}

/**
 * Assert the current page renders NO room composition — no player frame (real or
 * the "unavailable" state), no chat aside, no room context. This is the "no soft
 * wall" invariant: a denied caller never sees the player, chat, or a room shell.
 */
async function expectNoRoom(page: Page): Promise<void> {
  await expect(page.getByTestId("room-player-youtube")).toHaveCount(0);
  await expect(page.getByTestId("room-player-rutube")).toHaveCount(0);
  await expect(page.getByTestId("room-player-unavailable")).toHaveCount(0);
  await expect(page.getByTestId("room-chat")).toHaveCount(0);
  await expect(page.getByTestId("room-context")).toHaveCount(0);
}

// The leading `006 EARS-6 ` prefix is the ears-test-lint feature scope — a
// parenthesized mid-title does NOT scope.
test.describe("006 EARS-6 denied-access routing (auth/register/not-live front door)", () => {
  test("006 EARS-6.1: an unauthenticated visitor is routed through 003 auth carrying a room returnTo, and the gate RE-RUNS on return to admit a registered doctor", async ({
    page,
    context,
  }) => {
    // Provision a doctor already REGISTERED for the live event (register carrying
    // the event returnTo → auto-login completes the 005 registration).
    const { email, password } = await registerDoctor(page, {
      returnTo: `/webinars/${SLUG_LIVE}`,
    });
    await page.waitForURL(new RegExp(`/webinars/${SLUG_LIVE}(?:$|[?#])`));
    await expect(
      page.getByText("Вы записаны", { exact: false }).first(),
    ).toBeVisible();

    // Log the doctor out and hit the room as a GUEST.
    await context.clearCookies();
    await page.goto(`${BASE}/webinars/${SLUG_LIVE}/room`, {
      waitUntil: "domcontentloaded",
    });

    // …the gate refuses server-side and the room routes THROUGH 003 auth, carrying
    // a returnTo back to THIS room url (not a soft wall over a hidden player).
    await page.waitForURL(/\/login\?/);
    expect(page.url()).toContain(
      `returnTo=${encodeURIComponent(`/webinars/${SLUG_LIVE}/room`)}`,
    );
    await expectNoRoom(page);

    // On login the gate RE-EVALUATES: the doctor lands BACK on the room url (not
    // `/account`) and — registered for a live room — is admitted, the room renders.
    await loginAs(page, email, password);
    await page.waitForURL(new RegExp(`/webinars/${SLUG_LIVE}/room$`));
    await expect(page.getByTestId("room-context").first()).toBeVisible();
  });

  test("006 EARS-6.2: an authenticated-but-unregistered doctor is guided to the register front door (no player), and admitted to the room on register", async ({
    page,
  }) => {
    // A freshly provisioned doctor: authenticated (003 session) but NOT registered
    // for the seeded live event.
    await registerDoctor(page);
    await page.waitForURL(/\/account/);

    // Directly navigating to the room is refused (403 → register) and routed to the
    // 005 register front door on the event page, carrying `?from=room`.
    await page.goto(`${BASE}/webinars/${SLUG_LIVE}/room`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForURL(new RegExp(`/webinars/${SLUG_LIVE}\\?from=room`));

    // The catalog-sourced access guidance is surfaced above the register CTA, and
    // no player/chat/room shell renders (no soft wall).
    await expect(page.getByTestId("room-access-guidance")).toBeVisible();
    const registerCta = page.getByTestId("event-register-one-tap");
    await expect(registerCta).toBeVisible();
    await expectNoRoom(page);

    // The doctor registers (one-tap, register-during-live is a normal path)…
    await registerCta.click();
    await expect(
      page.getByText("Вы записаны", { exact: false }).first(),
    ).toBeVisible();

    // …and is now ADMITTED: a fresh navigation to the room grants and renders it.
    await page.goto(`${BASE}/webinars/${SLUG_LIVE}/room`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForURL(new RegExp(`/webinars/${SLUG_LIVE}/room$`));
    await expect(page.getByTestId("room-context").first()).toBeVisible();
  });

  test("006 EARS-6.3: a registered doctor reaching the room of a NOT-`live` event lands on the truthful 004 lifecycle state, no watchable room", async ({
    page,
  }) => {
    // A freshly provisioned doctor, registered for an UPCOMING (not-`live`) event.
    await registerDoctor(page, { returnTo: `/webinars/${SLUG_NOT_LIVE}` });
    await page.waitForURL(new RegExp(`/webinars/${SLUG_NOT_LIVE}(?:$|[?#])`));
    await expect(
      page.getByText("Вы записаны", { exact: false }).first(),
    ).toBeVisible();

    // Reaching the room of the not-`live` event is refused (409 not-live) and
    // routed to the truthful 004 lifecycle state on the event page — NOT the
    // register front door (no `?from=room`), and NO watchable room.
    await page.goto(`${BASE}/webinars/${SLUG_NOT_LIVE}/room`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForURL(new RegExp(`/webinars/${SLUG_NOT_LIVE}$`));
    await expect(page.getByTestId("room-access-guidance")).toHaveCount(0);
    // The truthful registered-upcoming lifecycle state holds (the «вы записаны»
    // confirmation), and no room composition renders.
    await expect(
      page.getByText("Вы записаны", { exact: false }).first(),
    ).toBeVisible();
    await expectNoRoom(page);
  });
});
