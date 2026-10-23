import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Reach a named event's card on the events feed the way a visitor does: through
 * the feed's real «Показать ещё» (019 LD-2 — each tense pages by 10 events, and
 * each activation widens the URL horizon and renders the wider reading). A
 * card's position depends on the seed instant (a slot's golden season is
 * relative to its own pin), so a spec never assumes it is on the first screen
 * (#3229). Returns the one `[data-webinar-card]` holding `link`.
 */
export async function reachFeedCard(page: Page, link: Locator) {
  // Generic navigation stops at DOMContentLoaded. The server-rendered feed link
  // is already live then, before its client handler exists (archive trace #2253).
  // Match the shared sign-in helper's initial client-readiness wait before clicks.
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle");
  // The loop reads the feed card, not the bare link: a signed-in viewer's
  // «Мои события» rail links the same event outside the feed (#3229).
  const card = page.locator("[data-webinar-card]", { has: link });
  const seenHorizons = new Set<string>();
  while ((await card.count()) === 0) {
    const more = page.getByTestId("events-feed-show-more");
    await expect(more, "named event must be reachable").toBeVisible();
    await expect(more).toHaveAccessibleName(/^Показать ещё/);
    const horizon = await more.getAttribute("href");
    expect(horizon, "show-more link carries the wider horizon").toBeTruthy();
    expect(
      seenHorizons.has(horizon!),
      "listing show-more must widen the horizon",
    ).toBe(false);
    seenHorizons.add(horizon!);
    await more.click();
    await page.waitForURL((url) => `${url.pathname}${url.search}` === horizon);
    // The wider reading has rendered once the link no longer offers this horizon.
    await expect(more).not.toHaveAttribute("href", horizon!);
    await expect(page.locator("[data-webinar-card]").first()).toBeVisible();
  }
  await expect(card).toHaveCount(1);
  await expect(card).toBeVisible();
  return card;
}
