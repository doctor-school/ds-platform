import { test, expect } from "@playwright/test";
import { LIVE_STAND, provisionLoggedInDoctor } from "../support/doctor-session";
import {
  shellHeader,
  shellLogo,
  themeToggle,
  NAV_BROADCASTS,
} from "../support/shell";

/**
 * 008 EARS-1 / EARS-14 — the persistent chrome (logo, top-nav «Эфиры», theme
 * toggle, footer) is present on EVERY portal route, not only by direct link.
 * Driven in the running UI against the SHARED chrome (`@ds/storefront-shell`,
 * #2180): `components/academy-shell-header.tsx` fills the `@chrome` slot and
 * `app/layout.tsx` mounts the footer, both from `lib/shell-config.ts`.
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
      // Logo → the discovery front-door.
      await expect(shellLogo(page)).toBeVisible();
      // Top-nav — «Эфиры» alone since the owner's 2026-09-10 decision (the nav
      // grows with features 015/016 and the partner surface; «Мои события» is
      // reached from the profile, not from the chrome).
      const nav = page.getByTestId("shell-nav-desktop");
      await expect(nav, `top-nav present on ${route}`).toBeVisible();
      await expect(
        nav.getByRole("link", { name: NAV_BROADCASTS }),
      ).toBeVisible();
      // Theme toggle.
      await expect(
        themeToggle(page),
        `theme toggle present on ${route}`,
      ).toBeVisible();
      // 008 EARS-14 — the footer is part of the persistent chrome too, on
      // every non-hidden route (new on this host with #2180).
      await expect(
        page.getByTestId("storefront-footer"),
        `footer present on ${route}`,
      ).toBeVisible();
    }
  });
});
