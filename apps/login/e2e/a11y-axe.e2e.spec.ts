import AxeBuilder from "@axe-core/playwright";
import { MAIN_LANDMARK_RULES } from "@ds/e2e";
import { test, expect } from "@playwright/test";

/**
 * 003 EARS-60 / 70 (#3170) — the sign-in host's doors pass WCAG 2 A/AA and
 * the one-h1 check, for both storefronts' forms, under the host's strict
 * nonce CSP (a page whose scripts the policy refused would not hydrate).
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const DOORS = [
  ["doctor", "login", "/login?authRequest=doctor-login"],
  ["doctor", "register", "/register?authRequest=doctor-register"],
  ["academy", "login", "/login?authRequest=academy-login"],
  ["academy", "register", "/register?authRequest=academy-register"],
] as const;

for (const [storefront, door, path] of DOORS) {
  test(`003 EARS-60: the ${storefront} ${door} door on the sign-in host passes WCAG 2 A/AA + one-h1`, async ({
    page,
  }) => {
    const refused: string[] = [];
    page.on("console", (msg) => {
      if (/Content Security Policy/i.test(msg.text())) refused.push(msg.text());
    });
    await page.goto(path);

    const h1 = page.locator("h1");
    await expect(h1, `h1 count on ${path}`).toHaveCount(1);
    await expect(h1, `h1 text on ${path}`).not.toHaveText(/^\s*$/);
    await expect(page.locator("form").first()).toBeVisible();

    const results = await new AxeBuilder({ page })
      .options({ rules: MAIN_LANDMARK_RULES })
      .withTags(WCAG_TAGS)
      .analyze();
    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => n.target).flat(),
    }));
    expect(summary, `axe violations on ${path}`).toEqual([]);
    expect(refused, "CSP refusals").toEqual([]);
  });
}
