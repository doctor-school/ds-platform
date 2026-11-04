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

/**
 * 030 EARS-1 — a new project starts «Скоро», whose «Что происходит сейчас» is
 * then required. Flow specs that only need *a* project pick «Проект идёт», which
 * owes no stage note.
 */
export async function chooseProjectStage(
  page: Page,
  stage: "running" | "completed" = "running",
): Promise<void> {
  // The radio input is `sr-only` behind its painted circle, so the wrapping
  // label is the click target, as a mouse uses it.
  await page
    .getByTestId(`project-stage-${stage}`)
    .locator("xpath=ancestor::label[1]")
    .click();
}
