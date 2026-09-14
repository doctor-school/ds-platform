import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { Then, When } from "./support/fixtures.js";

/**
 * NAVIGATION steps — staging/regression-contour tech spec §6.2: «a navigation
 * step asserts the destination, not the address».
 *
 * The bare form `Then the shell navigates to "/account/events"` is rejected by
 * `tools/lint/scenario-step-lint.ts` (BLOCK) because a build that serves a 200
 * with the WRONG page satisfies it — the #2012 class, where a route's runtime
 * files are missing from the standalone image and a fallback renders. The
 * accepted form names the landing evidence and the implementation asserts BOTH:
 *
 *   Then the doctor lands on "/account/events" showing "Мои события"
 *
 * `data-surface` is the accepted alternative for a page that owns no `h1`:
 *
 *   Then the visitor lands on "/documents" showing data-surface "documents"
 *
 * `{word}` on the actor keeps one binding for every persona a feature file
 * writes (`the doctor`, `the visitor`, `the shell`) instead of a step per noun.
 */

/** Assert the pathname the visitor actually ended up on, query string ignored. */
async function expectPathname(page: Page, path: string): Promise<void> {
  await page.waitForURL((url) => new URL(url).pathname === path);
  expect(new URL(page.url()).pathname, `pathname after navigation`).toBe(path);
}

When(
  "the {word} opens {string}",
  async ({ page }, _actor: string, path: string) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
  },
);

Then(
  "the {word} lands on {string} showing {string}",
  async ({ page }, _actor: string, path: string, heading: string) => {
    await expectPathname(page, path);
    await expect(
      page.getByRole("heading", { level: 1, name: heading, exact: true }),
      `the h1 of ${path}`,
    ).toBeVisible();
  },
);

Then(
  "the {word} lands on {string} showing data-surface {string}",
  async ({ page }, _actor: string, path: string, surface: string) => {
    await expectPathname(page, path);
    await expect(
      page.locator(`[data-surface="${surface}"]`),
      `the data-surface marker of ${path}`,
    ).toBeVisible();
  },
);

Then(
  "the {word} is sent to the sign-in page showing {string} with returnTo {string}",
  async ({ page, world }, _actor: string, heading: string, returnTo: string) => {
    // §6.3: «a guest item that redirects to `/login` asserts the login `h1` and
    // the `returnTo` value» — the redirect target alone proves nothing about
    // which surface rendered, and losing `returnTo` silently strands the guest
    // after they sign in.
    await expectPathname(page, world.host.loginPath);
    await expect(
      page.getByRole("heading", { level: 1, name: heading, exact: true }),
      `the h1 of ${world.host.loginPath}`,
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(returnTo);
  },
);
