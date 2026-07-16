import { test, expect } from "@playwright/test";
import { LIVE_STAND, provisionLoggedInDoctor } from "../support/doctor-session";
import { shellHeader, desktopThemeToggle } from "../support/shell";

/**
 * 008 EARS-1 — the persistent app-shell header (logo, top-nav [Эфиры · Мои
 * события], theme toggle) is present on EVERY portal route, not only by direct
 * link. Driven in the running UI against the ALREADY-SHIPPED header (#982/#994,
 * `components/app-shell-header.tsx` mounted in `app/layout.tsx`).
 *
 * The route sample spans a public surface (`/`) and two authenticated ones
 * (`/account`, `/account/events`) — the latter two require a session, so this pin
 * is the LIVE_STAND (real Zitadel + Mailpit) tier: it provisions a fresh 003 doctor
 * and hard-loads each route so `useHeaderAuth` reads the session per load. It
 * `test.skip`s cleanly on a bare CI run.
 */

// The header is deliberately absent on the auth surfaces (/login, /register, …)
// and inside the webinar room — those carry their own chrome (spec §Constraints).
const ROUTES = ["/", "/account", "/account/events"] as const;

test.describe("008 EARS-1 persistent app-shell header presence (e2e)", () => {
  test.skip(!LIVE_STAND, "requires a live portal + real Zitadel + Mailpit");

  test("008 EARS-1: the header renders the logo, top-nav, and theme toggle on every portal route", async ({
    page,
  }) => {
    // A logged-in doctor so the authenticated routes render (a guest would be
    // redirected to /login, where the shell header is intentionally absent).
    await provisionLoggedInDoctor(page);

    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: "domcontentloaded" });

      const header = shellHeader(page);
      await expect(header, `header present on ${route}`).toBeVisible();
      // Logo → the discovery front-door (a link to /).
      await expect(header.getByTestId("shell-logo")).toBeVisible();
      // Top-nav [Эфиры · Мои события].
      const nav = page.getByTestId("shell-nav-desktop");
      await expect(nav, `top-nav present on ${route}`).toBeVisible();
      await expect(nav.getByTestId("shell-nav-broadcasts")).toBeVisible();
      await expect(nav.getByTestId("shell-nav-my-events")).toBeVisible();
      // Theme toggle.
      await expect(
        desktopThemeToggle(page),
        `theme toggle present on ${route}`,
      ).toBeVisible();
    }
  });
});
