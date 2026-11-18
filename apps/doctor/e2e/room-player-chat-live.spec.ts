import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { signInPageThroughHost } from "@ds/e2e/host-sign-in";
import { standHttpCredentials } from "@ds/e2e/stand-http-credentials";

import { DOCTOR_BASE, loginAsDoctor } from "./support/doctor-session";
import { requireLiveStandEnv } from "./support/live-stand-env";

const roomSlug = process.env.E2E_DOCTOR_ROOM_CHAT_SLUG;
const readerEmail = process.env.E2E_DOCTOR2_EMAIL;
const readerPassword = process.env.E2E_DOCTOR2_PASSWORD;

requireLiveStandEnv([
  "E2E_DOCTOR_URL",
  "E2E_DOCTOR_EMAIL",
  "E2E_DOCTOR_PASSWORD",
  "E2E_DOCTOR2_EMAIL",
  "E2E_DOCTOR2_PASSWORD",
  "E2E_DOCTOR_ROOM_CHAT_SLUG",
]);

async function enterRoom(page: Page): Promise<void> {
  const roomUrl = new URL(`/events/${roomSlug}/room`, DOCTOR_BASE).href;
  await page.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(roomUrl);

  const player = page.locator('iframe[data-testid="room-player-rutube"]');
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute(
    "src",
    /^https:\/\/rutube\.ru\/play\/embed\//,
  );

  // The log renders before the browser subscribes. Wait until subscription and
  // history loading settle so the receiver can observe the new publication.
  await expect(page.getByTestId("room-chat-messages").first()).toBeVisible();
  await expect(page.getByTestId("room-chat-loading")).toHaveCount(0);
}

test("006 EARS-2 and 006 EARS-3: registered doctors see the live player and receive a chat message without a reload", async ({
  page,
  browser,
}) => {
  expect(
    readerEmail,
    "the receiver must use a distinct doctor account",
  ).not.toBe(process.env.E2E_DOCTOR_EMAIL);

  const readerContext = await browser.newContext({
    locale: "ru-RU",
    httpCredentials: standHttpCredentials(),
  });
  try {
    const reader = await readerContext.newPage();
    await loginAsDoctor(page);
    await signInPageThroughHost(reader, DOCTOR_BASE, {
      email: readerEmail!,
      password: readerPassword!,
    });
    await enterRoom(page);
    await enterRoom(reader);

    const message = `Вопрос к эфиру ${randomUUID()}`;
    const received = reader
      .getByTestId("room-chat-message")
      .filter({ hasText: message });
    await expect(received).toHaveCount(0);
    await page
      .getByRole("textbox", { name: /написать в чат|chat/i })
      .first()
      .fill(message);
    await page
      .getByRole("button", { name: /отправить|send/i })
      .first()
      .click();
    await expect(received).toBeVisible();
  } finally {
    await readerContext.close();
  }
});
