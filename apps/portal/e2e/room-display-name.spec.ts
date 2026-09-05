import { test, expect } from "@playwright/test";
import { provisionLoggedInDoctor } from "./support/doctor-session";
import { requireLiveStandEnv } from "./support/live-stand-env";

/**
 * 006 EARS-14 / EARS-15 — the just-in-time room-entry display-name prompt and the
 * header-avatar initials, driven end-to-end on the live stand.
 *
 * Live-stand-gated tier (mirrors `room.spec.ts` / the 005 harness): it needs a
 * running portal whose `/v1/*` rewrite reaches a running api + real Zitadel +
 * Mailpit (for `provisionLoggedInDoctor`), plus a seeded LIVE room the doctor can
 * register for (`E2E_ROOM_SLUG_LIVE`). It is inert-green only on a BARE
 * environment; a partially exported env set fails loudly (#1871).
 *
 * ENV SET (#1871) — export ALL of these to run this spec; exporting SOME of them
 * fails loudly naming the missing ones (`support/live-stand-env.ts`), while a
 * completely bare environment stays inert-green:
 *
 * | variable             | value on the dev stand                |
 * | -------------------- | ------------------------------------- |
 * | `E2E_PORTAL_URL`     | the running portal origin             |
 * | `IDP_ISSUER`         | the real Zitadel issuer               |
 * | `MAILPIT_URL`        | the Mailpit REST base (OTP sink)      |
 * | `E2E_ROOM_SLUG_LIVE` | `seed-005-live`                       |
 *
 * DOCTOR PROVISIONING: EACH test SELF-SIGNS-UP a fresh doctor (register → Mailpit
 * OTP → auto-login). Zitadel/api throttles after ~4–5 signups per window (429) —
 * wait ~10 min between full runs rather than retrying into the throttle.
 *
 * State isolation: EACH test provisions a FRESH doctor via
 * `provisionLoggedInDoctor` — a brand-new 003 account collects NO name, so the JIT
 * prompt is guaranteed to fire on first room entry and no cross-run name leaks in.
 * Selectors are locale-agnostic (data-testids) except the avatar initial, whose
 * visible text IS the assertion (EARS-15).
 *
 * "The room rendered" is asserted on `room-context-strip` — the DESKTOP one-line
 * context strip under the player. Since #1123 the `WebinarRoomLayout` primitive
 * branches on a JS media query: desktop mounts the strip and mobile mounts the
 * `room-context` block inside its «О эфире» tab, so `room-context` is not in the
 * desktop DOM at all. Both playwright projects here are Desktop Chrome.
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

const SLUG_LIVE = process.env.E2E_ROOM_SLUG_LIVE;

requireLiveStandEnv([
  "E2E_PORTAL_URL",
  "IDP_ISSUER",
  "MAILPIT_URL",
  "E2E_ROOM_SLUG_LIVE",
]);

/** Register the freshly-provisioned doctor for the seeded live room, then enter it. */
async function registerAndEnterRoom(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.goto(`/webinars/${SLUG_LIVE}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("event-register-one-tap").click();
  // The one-tap swaps to the registered confirmation via a server refresh — wait
  // for the register CTA to leave before entering the room.
  await expect(page.getByTestId("event-register-one-tap")).toHaveCount(0);
  await page.goto(`/webinars/${SLUG_LIVE}/room`, {
    waitUntil: "domcontentloaded",
  });
}

// The leading `006 EARS-14 ` prefix is the ears-test-lint feature scope — a
// parenthesized mid-title does NOT scope.
test.describe("006 EARS-14 JIT display-name prompt on first room entry (e2e)", () => {
  test("006 EARS-14: a name-less doctor is prompted before the room, empty is rejected, and once set the prompt never returns", async ({
    page,
  }) => {
    await provisionLoggedInDoctor(page);
    await registerAndEnterRoom(page);

    // The prompt renders as a PRE-RENDER step — the room player is NOT composed.
    await expect(page.getByTestId("display-name-prompt")).toBeVisible();
    await expect(page.getByTestId("room-player-youtube")).toHaveCount(0);
    await expect(page.getByTestId("room-player-rutube")).toHaveCount(0);
    await expect(page.getByTestId("room-player-unavailable")).toHaveCount(0);

    // Whitespace-only is rejected (trims to empty) — the prompt stays, no room.
    await page.getByTestId("display-name-input").fill("   ");
    await page.getByTestId("display-name-submit").click();
    await expect(page.getByTestId("display-name-prompt")).toBeVisible();
    await expect(page.getByTestId("room-player-youtube")).toHaveCount(0);

    // A valid two-word name is accepted → the room renders.
    await page.getByTestId("display-name-input").fill("Тест Врачов");
    await page.getByTestId("display-name-submit").click();
    await expect(page.getByTestId("room-context-strip")).toBeVisible();
    await expect(page.getByTestId("display-name-prompt")).toHaveCount(0);

    // Reloading the room does NOT re-prompt — the name is persisted server-side.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("room-context-strip")).toBeVisible();
    await expect(page.getByTestId("display-name-prompt")).toHaveCount(0);
  });
});

// The leading `006 EARS-15 ` prefix is the ears-test-lint feature scope.
test.describe("006 EARS-15 header-avatar initials from the real saved name (e2e)", () => {
  // The avatar is DESKTOP-ONLY (canvas geometry) — a desktop viewport so it renders.
  test.use({ viewport: { width: 1280, height: 800 } });

  test("006 EARS-15: a single-word name yields the single initial in the header avatar", async ({
    page,
  }) => {
    await provisionLoggedInDoctor(page);
    await registerAndEnterRoom(page);

    await expect(page.getByTestId("display-name-prompt")).toBeVisible();
    await page.getByTestId("display-name-input").fill("Врачова");
    await page.getByTestId("display-name-submit").click();
    await expect(page.getByTestId("room-context-strip")).toBeVisible();

    // The header avatar (queried by its accessible name) shows the ONE initial «В»
    // — derived from the real saved name, never fabricated.
    const avatar = page.getByLabel("Ваш профиль: Врачова");
    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveText("В");
  });
});
