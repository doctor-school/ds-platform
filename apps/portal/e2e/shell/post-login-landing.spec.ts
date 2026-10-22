import { test, expect } from "@playwright/test";
import { HOSTS } from "@ds/e2e/hosts";
import { signInWithPassword, submitSignInHostForm } from "@ds/e2e/sign-in";
import {
  expectAtSignInHostFrom,
  watchStorefrontEntries,
} from "@ds/e2e/storefront-entry-watch";

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
import { LIVE_STAND, provisionDoctorCreds } from "../support/doctor-session";
import { DISCOVERY_HEADING, SCAFFOLD_COPY } from "../support/shell";

/**
 * 008 EARS-7, re-pointed by 013 EARS-15 — completing the feature-003 LOGIN with no
 * valid return target lands the doctor on `/webinars` — the discovery listing of
 * upcoming broadcasts — never the Academy landing `/`, never a «Каркас приложения»
 * placeholder or a dead dashboard.
 *
 * BOTH EARS-15 branches are driven in the browser: the DEFAULT branch here (no
 * target, and a hostile target the same-origin guard rejects — both land on
 * `/webinars`), and the HONOURED branch by the shipped same-origin return
 * journeys, which land the doctor back on the page they came from — the 005
 * registration journey (`/register?returnTo=/webinars/<slug>`,
 * `e2e/steps/registration.steps.ts`) and the 006 room journey
 * (`returnTo=/webinars/<slug>/room`, `e2e/steps/room.steps.ts`). 013 adds no
 * second redirect rule (design §6, LD-12), so those journeys ARE the honoured
 * branch — re-driving them here would duplicate, not verify.
 *
 * LIVE_STAND tier: it provisions a doctor with KNOWN credentials (registration
 * lands on /account and verifies the email), clears that auto-login session, then
 * logs in deliberately via `/login` to observe the post-LOGIN landing (distinct
 * from the post-REGISTER landing). `test.skip`s on a bare CI run.
 */

test.describe("013 EARS-15 post-login landing is the return target, /webinars by default (e2e)", () => {
  test.skip(!LIVE_STAND, "requires a live portal + real Zitadel + Mailpit");

  test("013 EARS-15: completing login (no returnTo) lands on /webinars showing the discovery listing, not the Academy landing or a scaffold", async ({
    page,
    context,
  }) => {
    const { email, password } = await provisionDoctorCreds(page);

    // Drop the register auto-login session so `/login` drives a genuine sign-in.
    await context.clearCookies();

    // The storefront `/login` entry → the sign-in host's form → back (#3172),
    // through the shared hydration-safe walk of `@ds/e2e/sign-in`.
    await signInWithPassword(page, HOSTS.academy, { email, password });

    // The landing is the discovery listing — exactly `/webinars`, no returnTo.
    await page.waitForURL((url) => new URL(url).pathname === "/webinars");

    // `/webinars` serves the feature-004 discovery listing (its poster heading),
    // never the retired «Каркас приложения» scaffold card (EARS-7 / EARS-9).
    await expect(
      page.getByRole("heading", { name: DISCOVERY_HEADING }),
    ).toBeVisible();
    await expect(page.getByText(SCAFFOLD_COPY)).toHaveCount(0);
  });

  test("013 EARS-15: a cross-origin returnTo is rejected — login lands on the default /webinars, never off-origin", async ({
    page,
    context,
  }) => {
    const { email, password } = await provisionDoctorCreds(page);
    await context.clearCookies();

    // A hostile protocol-relative target rides the auth round-trip; the shipped
    // same-origin guard drops it, so the landing is the DEFAULT, never the
    // attacker's host and never the Academy landing `/`.
    watchStorefrontEntries(page, BASE);
    await page.goto("/login?returnTo=%2F%2Fevil.example", {
      waitUntil: "load",
    });
    await expectAtSignInHostFrom(page, BASE, {
      pathname: "/login",
      returnTo: "//evil.example",
    });
    await submitSignInHostForm(
      page,
      HOSTS.academy,
      { email, password },
      new URL(BASE).origin,
    );

    await page.waitForURL((url) => new URL(url).pathname === "/webinars");
    expect(page.url()).not.toContain("evil.example");
    await expect(
      page.getByRole("heading", { name: DISCOVERY_HEADING }),
    ).toBeVisible();
  });
});
