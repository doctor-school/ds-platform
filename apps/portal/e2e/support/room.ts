import { expect, type Page } from "@playwright/test";

/**
 * Wait until the room's chat pane is LIVE: the Centrifugo connection subscribed
 * and its history read settled, which is when `room-chat` drops its
 * `room-chat-loading` skeleton (`packages/room` `RoomChat`). The pane is
 * server-rendered with that skeleton and the composer, so a visible log region
 * proves nothing: #3229 slot traces show a composer filled before hydration
 * (the send button stays disabled — React never saw the draft) and a reader
 * whose subscription was not up yet missing a live message. The skeleton leaves
 * only from a client effect, so its absence is the hydration signal too.
 */
export async function waitForRoomChatLive(page: Page): Promise<void> {
  await expect(page.getByTestId("room-chat-messages").first()).toBeVisible();
  await expect(page.getByTestId("room-chat-loading")).toHaveCount(0, {
    timeout: 20_000,
  });
}

/**
 * Answer 006 EARS-14's just-in-time display-name prompt, which a freshly
 * self-registered doctor (no name collected at sign-up) meets on first room
 * entry INSTEAD of the room composition. The prompt is a client form: submitted
 * before hydration it is a native GET (`/room?displayName=…`) that saves nothing
 * (#3229 slot trace), hence the `networkidle` wait before filling it.
 */
export async function answerDisplayNamePrompt(
  page: Page,
  name = "Тест Врачов",
): Promise<void> {
  await expect(page.getByTestId("display-name-prompt")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("display-name-input").fill(name);
  await page.getByTestId("display-name-submit").click();
  await expect(page.getByTestId("display-name-prompt")).toHaveCount(0);
}
