import { test, expect, type Page } from "@playwright/test";
import { waitForAuthenticatedLanding } from "./support/doctor-session";
import { requireLiveStandEnv } from "./support/live-stand-env";
import { fetchOtpCode } from "./support/mailpit";
import { NOTIFICATION_SUBJECTS } from "./support/notification-subjects";

/**
 * 006 EARS-7 — room-close stops capture; the room degrades to the truthful ended
 * state. When the event leaves `live` (the director closes the room, feature 007)
 * the server-side gate stops issuing the `RoomAccess` grant for that event, so the
 * room surface degrades TRUTHFULLY to the 004 ended lifecycle state — no watchable
 * player, no writable chat, no room composition — rather than a soft wall over a
 * dead room. The server-side refusal (a late beat / post / grant read is a 409
 * carrying the truthful `ended` state) is pinned by the Vitest e2e
 * (`apps/api/test/room/room-close.e2e-spec.ts`); this browser spec pins the
 * user-observable degradation on the live stand.
 *
 * Live-stand-gated tier (mirrors `room-access-branches.spec.ts`): it needs a
 * running portal whose `/v1/*` rewrite reaches a running api + Postgres + real
 * Zitadel + Mailpit, seeded with a LIVE event (`seed-005-live`) and an ENDED event
 * (`seed-005-ended`) — the 006↔007 fixture seam (until 007's director controls
 * drive the live → ended transition, the ended seed stands in for a closed room).
 * The doctor SELF-PROVISIONS through the real 003 register→verify→auto-login flow
 * (no operator-seeded credentials), so the whole suite runs on the live-stand env +
 * the seeds alone. It is inert-green only on a BARE environment; a partially
 * exported env set fails loudly (#1871). Stage-B (canvas fidelity, both
 * breakpoints × both themes) is batched at #584.
 *
 * ENV SET (#1871) — export ALL of these to run this spec; exporting SOME of them
 * fails loudly naming the missing ones (`support/live-stand-env.ts`), while a
 * completely bare environment stays inert-green:
 *
 * | variable               | value on the dev stand                    |
 * | ---------------------- | ----------------------------------------- |
 * | `E2E_PORTAL_URL`       | the running portal origin                 |
 * | `IDP_ISSUER`           | the real Zitadel issuer                   |
 * | `MAILPIT_URL`          | the Mailpit REST base (OTP sink)          |
 * | `E2E_ROOM_SLUG_LIVE`   | `seed-005-live`                           |
 * | `E2E_ROOM_SLUG_ENDED`  | `seed-005-ended`                          |
 *
 * DOCTOR PROVISIONING: every test SELF-SIGNS-UP a fresh doctor (register → Mailpit
 * OTP → auto-login). Zitadel/api throttles after ~4–5 signups per window (429) —
 * wait ~10 min between full runs rather than retrying into the throttle.
 *
 * STAND PRECONDITIONS (#1871) — beyond the variables above, the STAND itself must
 * be prepared; otherwise the tier fails against a CORRECT product render:
 *
 * - **Saved display name.** Any REUSED account (`E2E_DOCTOR_*` / `E2E_DOCTOR2_*`)
 *   must already have a display name saved. Without one, 006 EARS-14's JIT name
 *   prompt renders INSTEAD of the room composition and every in-room assertion
 *   fails. Specs that self-sign-up a fresh doctor satisfy that prompt inline
 *   instead, so this applies only to the exported reusable pair.
 * - **Raised rate-limit ceilings.** Boot the api with
 *   `RATE_LIMIT_PER_USER_15MIN=1000`, `RATE_LIMIT_PER_IP_15MIN=2000` and
 *   `RATE_LIMIT_PER_ASN_1H=5000`. The 003 EARS-13 defaults (10 per user per
 *   15 min, 20 per IP) are an order of magnitude below the ~25 real logins one
 *   serial run of this tier drives from a single IP: at the defaults the suite
 *   hard-429s mid-run and every login-based test dies on `waitForURL`. These
 *   ceilings are env-overridable BY DESIGN for exactly this window (#1076,
 *   `apps/api/src/auth/rate-limit/rate-limit.types.ts`).
 */

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
// A seeded LIVE event the doctor registers for — the OPEN room the doctor can
// watch (the baseline the ended room degrades away from).
const SLUG_LIVE = process.env.E2E_ROOM_SLUG_LIVE ?? "seed-005-live";
// A seeded ENDED event — a room that has left `live` (the post-close state 006
// consumes read-only; the live → ended transition is authored by 007).
const SLUG_ENDED = process.env.E2E_ROOM_SLUG_ENDED ?? "seed-005-ended";

requireLiveStandEnv([
  "E2E_PORTAL_URL",
  "IDP_ISSUER",
  "MAILPIT_URL",
  "E2E_ROOM_SLUG_LIVE",
  "E2E_ROOM_SLUG_ENDED",
]);

const rand = (): string => Math.random().toString(36).slice(2, 8);

/**
 * Provision a doctor through the REAL 003 register→verify→auto-login flow (the
 * same path `support/doctor-session` drives). When `returnTo` is a safe event
 * target the auto-login also completes the 005 registration and lands on that
 * event page (registered); otherwise it lands on `/account` (authenticated,
 * unregistered). Selectors are locale-agnostic (stable `autocomplete` /
 * `data-testid`), never the Russian visible copy.
 */
async function registerDoctor(
  page: Page,
  opts?: { returnTo?: string },
): Promise<void> {
  const email = `e2e-583-${Date.now()}-${rand()}@ds.test`;
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
}

/**
 * Assert the current page renders NO room composition — no player frame (real or
 * the "unavailable" state), no chat aside, no room context. The ended room is NOT
 * watchable: the surface degraded to the truthful lifecycle state, not a soft wall
 * over a dead player.
 */
async function expectNoRoom(page: Page): Promise<void> {
  await expect(page.getByTestId("room-player-youtube")).toHaveCount(0);
  await expect(page.getByTestId("room-player-rutube")).toHaveCount(0);
  await expect(page.getByTestId("room-player-unavailable")).toHaveCount(0);
  await expect(page.getByTestId("room-chat")).toHaveCount(0);
  // Both breakpoint mounts of the context block (#1123): the desktop one-line
  // `room-context-strip` and the mobile «O эфире»-tab `room-context`.
  await expect(page.getByTestId("room-context-strip")).toHaveCount(0);
  await expect(page.getByTestId("room-context")).toHaveCount(0);
}

// The leading `006 EARS-7 ` prefix is the ears-test-lint feature scope — a
// parenthesized mid-title does NOT scope.
test.describe("006 EARS-7 room-close degrades to the truthful ended state", () => {
  test("006 EARS-7: a room OPEN while the event is `live` is watchable — the baseline the ended state degrades away from", async ({
    page,
  }) => {
    // Provision a doctor REGISTERED for the live event (register carrying the event
    // returnTo → auto-login completes the 005 registration), then enter the room.
    await registerDoctor(page, { returnTo: `/webinars/${SLUG_LIVE}` });
    await page.waitForURL(new RegExp(`/webinars/${SLUG_LIVE}(?:$|[?#])`));
    await page.goto(`${BASE}/webinars/${SLUG_LIVE}/room`, {
      waitUntil: "domcontentloaded",
    });

    // The gate admits (authenticated ∧ registered ∧ live) → the room composition
    // renders: the room is watchable while it is open.
    await page.waitForURL(new RegExp(`/webinars/${SLUG_LIVE}/room$`));
    // A SELF-SIGNED-UP doctor carries no display name, so 006 EARS-14 renders the
    // JIT name prompt as a PRE-RENDER step and the room composition is not mounted
    // yet (`room-display-name.spec.ts` pins that behaviour). Satisfy the prompt —
    // it is a precondition of this EARS-7 baseline, not its subject.
    await page.getByTestId("display-name-input").fill("Тест Врачов");
    await page.getByTestId("display-name-submit").click();
    // Desktop Chrome project → `WebinarRoomLayout` mounts the one-line
    // `room-context-strip`; `room-context` is the MOBILE-tab mount only (#1123).
    await expect(page.getByTestId("room-context-strip")).toBeVisible();
  });

  test("006 EARS-7: a doctor reaching the room of an event that has left `live` (ended) degrades to the truthful ended state — no watchable room", async ({
    page,
  }) => {
    // A self-provisioned, authenticated doctor. The default post-auth landing is
    // the discovery listing `/webinars` since 013 EARS-15 — accept any
    // authenticated landing rather than pinning the pre-013 `/account`.
    await registerDoctor(page);
    await waitForAuthenticatedLanding(page);

    // Reaching the room of an ENDED event (the post-close state): the server-side
    // gate no longer issues the grant, so the room degrades to the truthful 004
    // ended lifecycle state on the event page — NOT a watchable room.
    await page.goto(`${BASE}/webinars/${SLUG_ENDED}/room`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForURL(new RegExp(`/webinars/${SLUG_ENDED}(?:$|[?#])`));

    // The truthful ended lifecycle state is shown («Эфир завершён» — the 004 ended
    // render), and NO room composition (player / chat / context) is present: the
    // room degraded, it was not soft-walled over a dead player.
    await expect(
      page.getByText("Эфир завершён", { exact: false }).first(),
    ).toBeVisible();
    await expectNoRoom(page);
  });
});
