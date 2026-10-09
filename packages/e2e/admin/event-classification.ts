import type { Page } from "@playwright/test";

/**
 * 012 EARS-26/29/30 (#2509) — the classification every event now carries. An
 * event is created with a kind, a participation format the kind allows and an
 * audience. Flow specs that only need *an* event pick the Academy defaults the
 * pre-#2509 rows were mapped to: the seeded «Эфир» kind (migration 0046; online
 * only, so the form selects the format itself) and the `experts` audience.
 */
export const ACADEMY_KIND_TITLE = "Эфир";

export async function chooseEventClassification(
  page: Page,
  options: {
    kindTitle?: string;
    audience?: "experts" | "doctors";
  } = {},
): Promise<void> {
  const kind = page.getByTestId("event-kind");
  // The kinds load from the dictionary; wait until the wanted option exists.
  await kind
    .locator("option", { hasText: options.kindTitle ?? ACADEMY_KIND_TITLE })
    .first()
    .waitFor({ state: "attached" });
  await kind.selectOption({ label: options.kindTitle ?? ACADEMY_KIND_TITLE });
  await page
    .getByTestId("event-audience")
    .selectOption(options.audience ?? "experts");
}
