import AxeBuilder from "@axe-core/playwright";

// FIXTURE (axe-exclude-lint): leaf-scoped excludes targeting specific elements
// via `[data-testid=…]` attribute selectors → clean (the live room-axe pattern).
export async function scan(page: unknown) {
  return new AxeBuilder({ page })
    .withTags(["wcag2aa"])
    .exclude('[data-testid="room-player-rutube"]')
    .exclude('[data-testid="room-player-youtube"]')
    .analyze();
}
