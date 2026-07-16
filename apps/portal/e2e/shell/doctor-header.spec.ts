import { test, expect } from "@playwright/test";
import { LIVE_STAND, provisionLoggedInDoctor } from "../support/doctor-session";
import { shellHeader, setMyDisplayName } from "../support/shell";

/**
 * 008 EARS-5 / EARS-6 — while the caller is a logged-in doctor, the header renders
 * an AVATAR ICON showing the doctor's initials (an icon-LINK, NOT a dropdown menu),
 * carries NO «Выйти», and activating it navigates in a single tap to the profile
 * `/account` (one destination, no intermediate menu).
 *
 * LIVE_STAND tier: provisions a fresh 003 doctor and gives them a real saved
 * display name via the shipped `PUT /v1/me/display-name` (006 EARS-14, no new
 * endpoint) so the avatar renders GENUINE initials — a fresh account with no name
 * would render only the neutral fallback glyph. A hard load of `/` then lets
 * `useHeaderAuth` read the now-named profile. `test.skip`s on a bare CI run.
 */

test.describe("008 EARS-5/6 doctor header avatar icon → /account, no dropdown, no «Выйти» (e2e)", () => {
  test.skip(!LIVE_STAND, "requires a live portal + real Zitadel + Mailpit");

  test("008 EARS-5: the doctor sees an initials avatar ICON (not a dropdown) with no «Выйти»; EARS-6: activating it lands on /account", async ({
    page,
  }) => {
    await provisionLoggedInDoctor(page);
    // Give the doctor a real name → deterministic initials «ИП» (EARS-5).
    await setMyDisplayName(page, "Иван Петров");

    // Hard-load the discovery front-door so the header re-reads the named profile.
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const header = shellHeader(page);
    const avatar = page.getByTestId("shell-avatar");
    await expect(avatar).toBeVisible();
    // The genuine initials from the saved display name (EARS-5).
    await expect(avatar).toHaveText("ИП");
    // An icon-LINK to the profile — not a dropdown trigger.
    await expect(avatar).toHaveAttribute("href", "/account");
    expect(
      await avatar.evaluate((el) => el.tagName),
      "the avatar is an anchor, not a menu button",
    ).toBe("A");
    await expect(avatar).not.toHaveAttribute("aria-haspopup", /.*/);

    // No guest «Войти» chip and no «Выйти» anywhere in the header (EARS-5).
    await expect(page.getByTestId("shell-login")).toHaveCount(0);
    await expect(header.getByText(/выйти/i)).toHaveCount(0);

    // EARS-6: a single tap navigates straight to the profile — no interim menu.
    await avatar.click();
    await expect(page).toHaveURL(/\/account$/);
  });
});
