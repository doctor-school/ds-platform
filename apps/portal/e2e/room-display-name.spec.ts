import { test, expect } from "@playwright/test";
import { LIVE_STAND, provisionLoggedInDoctor } from "./support/doctor-session";

/**
 * 006 EARS-14 / EARS-15 — the just-in-time room-entry display-name prompt and the
 * header-avatar initials, driven end-to-end on the live stand.
 *
 * Live-stand-gated tier (mirrors `room.spec.ts` / the 005 harness): it needs a
 * running portal whose `/v1/*` rewrite reaches a running api + real Zitadel +
 * Mailpit (for `provisionLoggedInDoctor`), plus a seeded LIVE room the doctor can
 * register for (`E2E_ROOM_SLUG_LIVE`). It `test.skip`s unless that env is present,
 * so a stray CI invocation is inert.
 *
 * State isolation: EACH test provisions a FRESH doctor via
 * `provisionLoggedInDoctor` — a brand-new 003 account collects NO name, so the JIT
 * prompt is guaranteed to fire on first room entry and no cross-run name leaks in.
 * Selectors are locale-agnostic (data-testids) except the avatar initial, whose
 * visible text IS the assertion (EARS-15).
 */

const SLUG_LIVE = process.env.E2E_ROOM_SLUG_LIVE;

test.skip(
  !LIVE_STAND || !SLUG_LIVE,
  "requires the live stand + a seeded live room the doctor can register for",
);

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
    await expect(page.getByTestId("room-context").first()).toBeVisible();
    await expect(page.getByTestId("display-name-prompt")).toHaveCount(0);

    // Reloading the room does NOT re-prompt — the name is persisted server-side.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("room-context").first()).toBeVisible();
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
    await expect(page.getByTestId("room-context").first()).toBeVisible();

    // The header avatar (queried by its accessible name) shows the ONE initial «В»
    // — derived from the real saved name, never fabricated.
    const avatar = page.getByLabel("Ваш профиль: Врачова");
    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveText("В");
  });
});
