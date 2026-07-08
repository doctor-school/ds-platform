import { test, expect, type Page } from "@playwright/test";

/**
 * 006 EARS-2 — a gated doctor's webinar room renders the player + chat aside to
 * the vendored `webinar-room.dc.html` composition, and the embed player is
 * instantiated from the event stream config's EXPLICIT provider enum
 * (`rutube | youtube`), asserted PER PROVIDER; an unknown/absent provider yields
 * the truthful "stream unavailable" state (never a guessed embed). The provider is
 * read from the enum, never sniffed from the URL — that structural half is pinned
 * by the unit tests (`apps/api/src/room/provider-enum.spec.ts`,
 * `apps/portal/lib/room-player.test.ts`); this browser spec pins the rendered
 * composition + the per-provider embed frame on the live stand.
 *
 * Live-stand-gated tier (mirrors `event-page-registered.spec.ts` / the 005
 * harness, PR #673): it needs a running portal whose `/v1/*` rewrite reaches a
 * running api + Postgres seeded with LIVE events carrying a seeded stream config
 * (the 006↔007 fixture seam — stream-config authoring is feature 007) + a roster
 * registration for the test doctor, plus a real 003 login. It `test.skip`s unless
 * the dev-stand env is present, so a stray CI invocation is inert. The full
 * both-breakpoints × both-themes fidelity + Stage-B live confirmation is owned by
 * the 006 integration slice (#584).
 */

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
const DOCTOR_EMAIL = process.env.E2E_DOCTOR_EMAIL;
const DOCTOR_PASSWORD = process.env.E2E_DOCTOR_PASSWORD;
// Seeded LIVE events the test doctor is registered for, each with a seeded stream
// config (the 006↔007 fixture seam): one per provider + one deliberately
// unconfigured (no stream config → the "stream unavailable" state).
const SLUG_YOUTUBE = process.env.E2E_ROOM_SLUG_YOUTUBE;
const SLUG_RUTUBE = process.env.E2E_ROOM_SLUG_RUTUBE;
const SLUG_UNAVAILABLE = process.env.E2E_ROOM_SLUG_UNAVAILABLE;

test.skip(
  !process.env.E2E_PORTAL_URL || !DOCTOR_EMAIL || !DOCTOR_PASSWORD,
  "requires a live portal + a doctor registered for the seeded live rooms",
);

/** Log the doctor in through the real 003 flow (identifier + password). */
async function login(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: /почта|email/i }).fill(DOCTOR_EMAIL!);
  await page
    .getByRole("textbox", { name: /пароль|password/i })
    .fill(DOCTOR_PASSWORD!);
  await page.getByRole("button", { name: /войти|продолжить/i }).click();
  await page.waitForURL(/\/account|\/webinars/);
}

// The leading `006 EARS-2 ` prefix is the ears-test-lint feature scope — a
// parenthesized mid-title does NOT scope.
test.describe("006 EARS-2 room composition + embed player from the provider enum (e2e)", () => {
  test("006 EARS-2: a gated doctor's room renders the YouTube embed frame + the chat aside composition", async ({
    page,
  }) => {
    test.skip(!SLUG_YOUTUBE, "requires a seeded live YouTube-provider room");
    await login(page);
    await page.goto(`${BASE}/webinars/${SLUG_YOUTUBE}/room`, {
      waitUntil: "domcontentloaded",
    });

    // The player is instantiated from the `youtube` enum value — a YouTube embed
    // frame (NOT the rutube branch, NOT the unavailable state).
    const player = page.getByTestId("room-player-youtube");
    await expect(player).toBeVisible();
    await expect(player).toHaveAttribute("src", /youtube\.com\/embed\//);
    await expect(page.getByTestId("room-player-rutube")).toHaveCount(0);
    await expect(page.getByTestId("room-player-unavailable")).toHaveCount(0);

    // The composition renders the chat aside + the event context (the canvas
    // player + chat aside shell). Chat BEHAVIOUR is EARS-3 (#579) — this is the
    // composition shell only.
    await expect(page.getByTestId("room-chat").first()).toBeVisible();
    await expect(page.getByTestId("room-context").first()).toBeVisible();
  });

  test("006 EARS-2: a gated doctor's room renders the Rutube embed frame from the enum", async ({
    page,
  }) => {
    test.skip(!SLUG_RUTUBE, "requires a seeded live Rutube-provider room");
    await login(page);
    await page.goto(`${BASE}/webinars/${SLUG_RUTUBE}/room`, {
      waitUntil: "domcontentloaded",
    });

    // The player is instantiated from the `rutube` enum value — a Rutube embed
    // frame. Asserting the DIFFERENT provider renders the DIFFERENT frame proves
    // the player is keyed on the enum, not sniffed from a URL.
    const player = page.getByTestId("room-player-rutube");
    await expect(player).toBeVisible();
    await expect(player).toHaveAttribute("src", /rutube\.ru\/play\/embed\//);
    await expect(page.getByTestId("room-player-youtube")).toHaveCount(0);
    await expect(page.getByTestId("room-chat").first()).toBeVisible();
  });

  test("006 EARS-2: an unconfigured/unknown provider renders the truthful 'stream unavailable' state, not a guessed embed", async ({
    page,
  }) => {
    test.skip(
      !SLUG_UNAVAILABLE,
      "requires a seeded live room with NO stream config",
    );
    await login(page);
    await page.goto(`${BASE}/webinars/${SLUG_UNAVAILABLE}/room`, {
      waitUntil: "domcontentloaded",
    });

    // No embed iframe is rendered — the truthful unavailable state holds, and the
    // room chrome (chat aside) still composes.
    await expect(page.getByTestId("room-player-unavailable")).toBeVisible();
    await expect(page.getByTestId("room-player-youtube")).toHaveCount(0);
    await expect(page.getByTestId("room-player-rutube")).toHaveCount(0);
    await expect(page.getByTestId("room-chat").first()).toBeVisible();
  });
});
