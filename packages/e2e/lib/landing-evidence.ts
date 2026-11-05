import { expect, type Page } from "@playwright/test";

import { landingEvidenceAt } from "../navigation-model.js";
import type { NavigationItem } from "../navigation-model.js";

/**
 * The §6.2 landing assertion both derived walks share (staging/regression-
 * contour tech spec §6.3): the navigation walk for every chrome item, the route
 * walk for a static address the model declares as a redirect by design.
 *
 * Assert the visitor landed where `item` declares: the pathname must be the
 * item's own href (or, for an item whose href redirects by design, one of its
 * declared targets), and the page there must carry that landing's evidence.
 */
export async function assertLanding(
  page: Page,
  item: NavigationItem,
  where: string,
): Promise<void> {
  const landed = new URL(page.url()).pathname;
  const evidence = landingEvidenceAt(item, landed);
  expect(
    evidence,
    `pathname after opening ${where} — ${landed} is not a landing the model declares for ${item.href}`,
  ).not.toBeNull();
  if (evidence!.kind === "h1") {
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: evidence!.value,
        exact: true,
      }),
      `the h1 of ${where}`,
    ).toBeVisible();
  } else {
    await expect(
      page.locator(`[data-surface="${evidence!.value}"]`),
      `the data-surface marker of ${where}`,
    ).toBeVisible();
  }
}
