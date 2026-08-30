import type { Locator, Page } from "@playwright/test";

export async function searchRelationshipCombobox(
  page: Page,
  triggerId: string,
  query: string,
): Promise<Locator> {
  const trigger = page.locator(`#${triggerId}`);
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
  const panelId = await trigger.getAttribute("aria-controls");
  if (!panelId) throw new Error(`Combobox #${triggerId} has no panel id`);
  const panel = page.locator(`[id="${panelId}"]`);
  await panel.getByRole("combobox").fill(query);
  return panel;
}

export async function selectRelationshipCombobox(
  page: Page,
  triggerId: string,
  query: string,
  label: string,
): Promise<void> {
  const panel = await searchRelationshipCombobox(page, triggerId, query);
  await panel.getByText(label, { exact: true }).click();
}
