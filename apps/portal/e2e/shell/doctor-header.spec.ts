import { test, expect, type Locator } from "@playwright/test";
import { LIVE_STAND, provisionLoggedInDoctor } from "../support/doctor-session";
import {
  shellHeader,
  setMyDisplayName,
  MY_EVENTS_HREF,
  MY_EVENTS_LABEL,
} from "../support/shell";

/**
 * 008 EARS-5 / EARS-6 — while the caller is a logged-in doctor, the header renders
 * an AVATAR ICON showing the doctor's initials (an icon-LINK, NOT a dropdown menu),
 * carries NO «Выйти», and activating it navigates in a single tap to the profile
 * `/account` (one destination, no intermediate menu).
 *
 * LIVE_STAND tier: provisions a fresh 003 doctor and gives them a real saved
 * display name via the shipped `PUT /v1/me/display-name` (006 EARS-14, no new
 * endpoint) so the avatar renders GENUINE initials — a fresh account with no name
 * would render only the neutral fallback silhouette icon. A hard load of `/` then lets
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

  test("008 EARS-5: the desktop bar carries «Мои события» → /account/events, in canvas order", async ({
    page,
  }) => {
    // #2243 — the canvas draws this link inside the NAV GROUP
    // (`design-source/ds-shell.dc.html`, `user.links` line 209, rendered at
    // line 33), after the nav items and before the theme control (line 35) and
    // the chip (line 36). It vanished when this storefront moved onto the
    // shared chrome, and came back one slot too far right.
    await provisionLoggedInDoctor(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("shell-auth-cluster")).toHaveAttribute(
      "data-cluster",
      "doctor",
    );
    const link = page
      .getByTestId("shell-nav-desktop")
      .getByTestId("shell-auth-link");
    await expect(link).toBeVisible();
    await expect(link).toHaveText(MY_EVENTS_LABEL);
    await expect(link).toHaveAttribute("href", MY_EVENTS_HREF);

    // The canvas order is GEOMETRY, so assert it on the painted bar:
    // «Эфиры · Мои события · ☾ · Личный кабинет», left to right.
    const x = async (locator: Locator): Promise<number> => {
      const box = await locator.boundingBox();
      if (!box) throw new Error("expected a painted element, got none");
      return box.x;
    };
    const navItem = page
      .getByTestId("shell-nav-desktop")
      .getByRole("link")
      .first();
    expect(await x(navItem)).toBeLessThan(await x(link));
    expect(await x(link)).toBeLessThan(
      await x(page.getByTestId("theme-toggle")),
    );
    expect(await x(page.getByTestId("theme-toggle"))).toBeLessThan(
      await x(page.getByTestId("shell-avatar")),
    );

    // It really navigates, and the page it lands on is the right one — the h1,
    // not just the URL.
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${MY_EVENTS_HREF}(?:$|[?#])`));
    await expect(
      page.getByRole("heading", { level: 1, name: MY_EVENTS_LABEL }),
    ).toBeVisible();
  });

  test("008 EARS-11: below the breakpoint the same link is a row of the ≡ menu", async ({
    page,
  }) => {
    // Canvas line 50. The mobile copies are nav ROWS, never a second cluster —
    // 017 EARS-1 allows exactly ONE `shell-auth-cluster` in the DOM.
    await provisionLoggedInDoctor(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("shell-auth-cluster")).toHaveCount(1);
    const menu = shellHeader(page).getByTestId("shell-mobile-menu");
    await menu.locator("summary").click();

    const mobileNav = page.getByTestId("shell-nav-mobile");
    const row = mobileNav.getByTestId("shell-auth-link-mobile");
    await expect(row).toBeVisible();
    await expect(row).toHaveText(MY_EVENTS_LABEL);
    await expect(row).toHaveAttribute("href", MY_EVENTS_HREF);

    await row.click();
    await expect(page).toHaveURL(new RegExp(`${MY_EVENTS_HREF}(?:$|[?#])`));
    await expect(
      page.getByRole("heading", { level: 1, name: MY_EVENTS_LABEL }),
    ).toBeVisible();
  });
});
