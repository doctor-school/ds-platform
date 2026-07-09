import { test, expect, type Page } from "@playwright/test";
import { LIVE_STAND } from "./support/doctor-session";
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
 * (no operator-seeded credentials), so the whole suite runs on `LIVE_STAND` + the
 * seeds alone. It `test.skip`s unless the live stand env is present, so a stray CI
 * invocation is inert. Stage-B (canvas fidelity, both breakpoints × both themes)
 * is batched at #584.
 */

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
// A seeded LIVE event the doctor registers for — the OPEN room the doctor can
// watch (the baseline the ended room degrades away from).
const SLUG_LIVE = process.env.E2E_ROOM_SLUG_LIVE ?? "seed-005-live";
// A seeded ENDED event — a room that has left `live` (the post-close state 006
// consumes read-only; the live → ended transition is authored by 007).
const SLUG_ENDED = process.env.E2E_ROOM_SLUG_ENDED ?? "seed-005-ended";

test.skip(
  !LIVE_STAND,
  "dev-stand env absent (E2E_PORTAL_URL / IDP_ISSUER / MAILPIT_URL) — manual gate",
);

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
    await expect(page.getByTestId("room-context").first()).toBeVisible();
  });

  test("006 EARS-7: a doctor reaching the room of an event that has left `live` (ended) degrades to the truthful ended state — no watchable room", async ({
    page,
  }) => {
    // A self-provisioned, authenticated doctor (lands on /account).
    await registerDoctor(page);
    await page.waitForURL(/\/account/);

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
