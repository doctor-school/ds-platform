import type { Page } from "@playwright/test";

/**
 * 012 EARS-29/30 (#2509) — a project carries a default audience. Flow specs that
 * only need *a* project pick the Academy default (`experts`). The event half of
 * the classification (`chooseEventClassification`) is shared with the storefront
 * e2e suites and lives in `@ds/e2e/admin-events`.
 */
export async function chooseProjectDefaultAudience(
  page: Page,
  audience: "experts" | "doctors" = "experts",
): Promise<void> {
  await page.getByTestId("project-default-audience").selectOption(audience);
}
