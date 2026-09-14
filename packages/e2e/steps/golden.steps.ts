import { expect } from "@playwright/test";

import { Given } from "./support/fixtures.js";
import { goldenDoctorPassword, resolveGoldenDoctor } from "../lib/golden.js";

/**
 * GOLDEN-ENTITY steps — staging/regression-contour tech spec §6.1: every scenario
 * names golden entities BY THEIR SEED NAME (`Given the golden doctor
 * "verified-cardiologist" is signed in`), never by hand-typed data. The seed name
 * is resolved through `lib/golden.ts`, the one registry that knows which `@ds/db`
 * golden account a name denotes and which env var carries its IdP password.
 *
 * The sign-in itself adds NO auth primitive: it drives the host's real login
 * surface exactly the way the shipped 008 shell journey does today
 * (`apps/portal/e2e/steps/shell.steps.ts` → `When("the doctor completes login via
 * the feature-003 auth flow")`: `goto("/login")` → fill the email/password
 * textboxes → submit). Selectors key off stable `autocomplete` attributes rather
 * than visible copy, because the two hosts render different labels (#177) — the
 * academy card is `next-intl`, the doctor card is Russian literals.
 */
Given(
  "the golden doctor {string} is signed in",
  async ({ page, world }, seedName: string) => {
    const doctor = resolveGoldenDoctor(seedName);
    const password = goldenDoctorPassword(doctor);

    await page.goto(world.host.loginPath, { waitUntil: "domcontentloaded" });
    await page.locator('input[autocomplete="email"]').fill(doctor.email);
    await page
      .locator('input[autocomplete="current-password"]')
      .fill(password);
    await page.getByRole("button", { name: /войти|продолжить/i }).click();

    // The session cookie is set before the post-login redirect, so leaving the
    // login surface IS the signal that the doctor is signed in. Asserting «not
    // /login» rather than a specific landing keeps the step reusable: the
    // post-login destination is a product decision each host owns, and the
    // scenario's own `Then` asserts where it wanted to end up.
    await page.waitForURL(
      (url) => new URL(url).pathname !== world.host.loginPath,
    );
    expect(new URL(page.url()).pathname).not.toBe(world.host.loginPath);
    world.signedInAs = doctor.seedName;
  },
);
