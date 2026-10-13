import { expect, type Page } from "@playwright/test";

/**
 * The 012 event-kind dictionary writers (EARS-25, EARS-28), through the
 * production admin screens only — the same arc `apps/admin/e2e/
 * taxonomy-event-kinds.spec.ts` drives. Shared so a storefront suite that needs a
 * kind an editor published or retired (019 EARS-17) gets one the platform itself
 * produced. The page must already be signed in on the admin origin.
 */

/** The participation formats a kind may allow (012 EARS-26). */
export type EventKindFormat = "online" | "offline" | "hybrid";

/**
 * The design-system checkbox is `sr-only` behind its painted box, so the
 * wrapping label is the click target, as a mouse uses it.
 */
async function toggleFormat(
  page: Page,
  format: EventKindFormat,
): Promise<void> {
  await page
    .getByTestId(`event-kind-format-${format}`)
    .locator("xpath=ancestor::label[1]")
    .click();
}

/** Create a kind with the given formats and publish it; returns its detail URL. */
export async function createPublishedEventKind(
  page: Page,
  title: string,
  formats: readonly EventKindFormat[],
): Promise<string> {
  await page.goto("/event-kinds/create");
  await page.getByTestId("event-kind-title").fill(title);
  for (const format of formats) await toggleFormat(page, format);
  await page.getByTestId("submit-event-kind").click();
  await page.waitForURL(/\/event-kinds\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  const url = page.url();
  await page.getByTestId("event-kind-publish").click();
  await expect(page.getByTestId("event-kind-status")).toHaveText(
    "Опубликовано",
  );
  return url;
}

/**
 * Retire the kind at `detailUrl` through its lifecycle-impact preview and
 * confirmation (012 EARS-28) — the events that carry it keep it.
 */
export async function retireEventKind(
  page: Page,
  detailUrl: string,
): Promise<void> {
  await page.goto(detailUrl);
  await page.getByTestId("event-kind-retire").click();
  await expect(page.getByTestId("event-kind-retire-impact")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId("event-kind-retire-submit").click();
  await expect(page.getByTestId("event-kind-status")).toHaveText(
    "Снято с публикации",
    { timeout: 20_000 },
  );
}

/**
 * The cleanup form of {@link retireEventKind}: retire the kind at `detailUrl`
 * only while its detail does not already read it retired. A scenario that failed after
 * sending a retire may have landed it without seeing the answer, and then the
 * detail offers «restore», not «retire» — waiting for the retire control there
 * would spend the cleanup's whole budget on one kind.
 */
export async function ensureEventKindRetired(
  page: Page,
  detailUrl: string,
): Promise<void> {
  await page.goto(detailUrl);
  const status = page.getByTestId("event-kind-status");
  await expect(status).toBeVisible({ timeout: 20_000 });
  if ((await status.innerText()).trim() === "Снято с публикации") return;
  await retireEventKind(page, detailUrl);
}
