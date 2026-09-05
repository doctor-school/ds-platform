import { test, expect, type Page } from "@playwright/test";
import { requireLiveStandEnv } from "./support/live-stand-env";
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
 * flow (no operator-seeded credentials), so the whole suite runs on the live-stand
 * env + the seeds alone. It is inert-green only on a BARE environment; a partially
 * exported env set fails loudly (#1871). Stage-B (canvas fidelity, both breakpoints
 * × both themes) is batched at #584.
 *
 * ENV SET (#1871) — export ALL of these to run this spec; exporting SOME of them
 * fails loudly naming the missing ones (`support/live-stand-env.ts`), while a
 * completely bare environment stays inert-green:
 *
 * | variable                   | value on the dev stand                 |
 * | -------------------------- | -------------------------------------- |
 * | `E2E_PORTAL_URL`           | the running portal origin              |
 * | `IDP_ISSUER`               | the real Zitadel issuer                |
 * | `MAILPIT_URL`              | the Mailpit REST base (OTP sink)       |
 * | `E2E_ROOM_SLUG_LIVE`       | `seed-005-live`                        |
 * | `E2E_WEBINAR_SLUG_NOT_LIVE`| `seed-005-upcoming`                    |
 *
 * DOCTOR PROVISIONING: every branch SELF-SIGNS-UP a fresh doctor (register →
 * Mailpit OTP → auto-login). Zitadel/api throttles after ~4–5 signups per window
 * (429) — wait ~10 min between full runs rather than retrying into the throttle.
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

requireLiveStandEnv([
  "E2E_PORTAL_URL",
  "IDP_ISSUER",
  "MAILPIT_URL",
  "E2E_ROOM_SLUG_LIVE",
  "E2E_WEBINAR_SLUG_NOT_LIVE",
]);

/**
 * Assert the event page shows the REGISTERED state for the doctor (#1871).
 *
 * The visible copy differs per lifecycle state — a LIVE registered event renders
 * the room-entry CTA «Войти в эфир», an upcoming one the «Вы записаны» statement —
 * so a `getByText("Вы записаны")` assertion silently missed the live branch. Key
 * off the card's `data-cta-action` policy attribute instead: locale-agnostic
 * (#177) and the exact discriminator the signup card renders from.
 */
async function expectRegistered(
  page: Page,
  lifecycle: "live" | "not-live",
): Promise<void> {
  await expect(page.getByTestId("event-signup-card")).toHaveAttribute(
    "data-cta-action",
    lifecycle === "live" ? "enter-room" : "registered",
  );
}

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
 *
 * The context assertions cover BOTH breakpoint faces of the #1123
 * `WebinarRoomLayout` split — desktop mounts `room-context-strip`, mobile mounts
 * `room-context` in its «О эфире» tab — so the absence check stays meaningful
 * whichever branch renders. (The positive "the room rendered" assertions in this
 * file target `room-context-strip`: this project is Desktop Chrome, where
 * `room-context` is never in the DOM.)
 */
/**
 * Assert the room composition RENDERED on the admitted branches. Since 006
 * EARS-14 (#803) a freshly provisioned doctor carries NO display name, so the
 * admitted room url first serves the just-in-time «Имя и фамилия» prompt —
 * complete it (the way `room-display-name.spec.ts` / `room-axe.e2e.spec.ts` do)
 * and the refreshed server page composes the room. Precondition only; the
 * assertion is still "the room rendered".
 */
async function expectRoomRendered(page: Page): Promise<void> {
  const prompt = page.getByTestId("display-name-prompt");
  if (await prompt.isVisible().catch(() => false)) {
    await page.getByTestId("display-name-input").fill("Тест Врачов");
    await page.getByTestId("display-name-submit").click();
  }
  await expect(page.getByTestId("room-context-strip")).toBeVisible();
}

async function expectNoRoom(page: Page): Promise<void> {
  await expect(page.getByTestId("room-player-youtube")).toHaveCount(0);
  await expect(page.getByTestId("room-player-rutube")).toHaveCount(0);
  await expect(page.getByTestId("room-player-unavailable")).toHaveCount(0);
  await expect(page.getByTestId("room-chat")).toHaveCount(0);
  await expect(page.getByTestId("room-context-strip")).toHaveCount(0);
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
    await expectRegistered(page, "live");

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
    await expectRoomRendered(page);
  });

  test("006 EARS-6.2: an authenticated-but-unregistered doctor is guided to the register front door (no player), and admitted to the room on register", async ({
    page,
  }) => {
    // A freshly provisioned doctor: authenticated (003 session) but NOT registered
    // for the seeded live event.
    await registerDoctor(page);
    // The precondition is "authenticated, unregistered", not a specific landing
    // route: a returnTo-less auto-login now lands on the logged-in `/webinars`
    // home (observed 2026-08-14), not `/account`. Accept either — this test's
    // subject is the room front door reached below, not the post-signup landing.
    await page.waitForURL(/\/(webinars|account)(?:$|[/?#])/);

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
    await expectRegistered(page, "live");

    // …and is now ADMITTED: a fresh navigation to the room grants and renders it.
    await page.goto(`${BASE}/webinars/${SLUG_LIVE}/room`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForURL(new RegExp(`/webinars/${SLUG_LIVE}/room$`));
    await expectRoomRendered(page);
  });

  test("006 EARS-6.3: a registered doctor reaching the room of a NOT-`live` event lands on the truthful 004 lifecycle state, no watchable room", async ({
    page,
  }) => {
    // A freshly provisioned doctor, registered for an UPCOMING (not-`live`) event.
    await registerDoctor(page, { returnTo: `/webinars/${SLUG_NOT_LIVE}` });
    await page.waitForURL(new RegExp(`/webinars/${SLUG_NOT_LIVE}(?:$|[?#])`));
    await expectRegistered(page, "not-live");

    // Reaching the room of the not-`live` event is refused (409 not-live) and
    // routed to the truthful 004 lifecycle state on the event page — NOT the
    // register front door (no `?from=room`), and NO watchable room.
    await page.goto(`${BASE}/webinars/${SLUG_NOT_LIVE}/room`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForURL(new RegExp(`/webinars/${SLUG_NOT_LIVE}$`));
    await expect(page.getByTestId("room-access-guidance")).toHaveCount(0);
    // The truthful registered-upcoming lifecycle state holds (the `registered`
    // statement, no room-entry control), and no room composition renders.
    await expectRegistered(page, "not-live");
    await expectNoRoom(page);
  });
});
