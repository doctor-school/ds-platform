import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

for (const theme of ["light", "dark"] as const) {
  test(`Academy demo passes WCAG 2 A/AA (${theme})`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("main").waitFor({ state: "visible" });
    if (theme === "dark") {
      await page.evaluate(() => document.documentElement.classList.add("dark"));
      await page.evaluate(
        () =>
          new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
      );
    }

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      // The canvas giant wordmark is explicitly aria-hidden decorative ink.
      .exclude('[data-testid="academy-footer-wordmark"]')
      .analyze();
    const summary = results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.flatMap((node) => node.target),
    }));
    expect(summary, `axe violations on / (${theme})`).toEqual([]);
  });
}
