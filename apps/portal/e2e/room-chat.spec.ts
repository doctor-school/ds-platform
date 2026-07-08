import { test, expect, type Page } from "@playwright/test";

/**
 * 006 EARS-3 — live chat over Centrifugo (gated read + real-time post). Two gated
 * doctors are in the same live room: one posts a message and the other sees it
 * appear WITHOUT a reload, over the REAL dev-stand Centrifugo. A message is posted
 * only through the gated command (the composer POSTs to
 * `POST /v1/events/:slug/chat`); the fan-out rides the subscribe-only connection
 * token the `RoomConfig` grant carried. This browser spec pins the end-to-end
 * real-time behaviour; the API-side gate + publish + subscribe-only/gate-scoped
 * token shape is pinned by the Vitest e2e (`apps/api/test/room/chat.e2e-spec.ts`).
 *
 * Live-stand-gated tier (mirrors `room.spec.ts` / the 005 harness): it needs a
 * running portal whose `/v1/*` rewrite reaches a running api + Postgres seeded
 * with a LIVE event both test doctors are registered for, plus real 003 logins for
 * TWO distinct doctors. It `test.skip`s unless the dev-stand env is present, so a
 * stray CI invocation is inert. The full both-breakpoints × both-themes fidelity +
 * Stage-B live confirmation is owned by the 006 integration slice (#584).
 */

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
const DOCTOR_A_EMAIL = process.env.E2E_DOCTOR_EMAIL;
const DOCTOR_A_PASSWORD = process.env.E2E_DOCTOR_PASSWORD;
const DOCTOR_B_EMAIL = process.env.E2E_DOCTOR2_EMAIL;
const DOCTOR_B_PASSWORD = process.env.E2E_DOCTOR2_PASSWORD;
// A seeded LIVE room BOTH doctors are registered for (SLUG_LIVE reuses the room
// spec's live-room env; a chat-specific slug overrides it when set).
const SLUG_LIVE =
  process.env.E2E_ROOM_CHAT_SLUG ??
  process.env.E2E_ROOM_SLUG_LIVE ??
  process.env.E2E_ROOM_SLUG_YOUTUBE;

test.skip(
  !process.env.E2E_PORTAL_URL ||
    !DOCTOR_A_EMAIL ||
    !DOCTOR_A_PASSWORD ||
    !DOCTOR_B_EMAIL ||
    !DOCTOR_B_PASSWORD ||
    !SLUG_LIVE,
  "requires a live portal + two doctors registered for the seeded live room",
);

/** Log a doctor in through the real 003 flow (identifier + password). */
async function login(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: /почта|email/i }).fill(email);
  await page.getByRole("textbox", { name: /пароль|password/i }).fill(password);
  await page.getByRole("button", { name: /войти|продолжить/i }).click();
  await page.waitForURL(/\/account|\/webinars/);
}

/** Open the live room and return the chat composer input (visible chat pane). */
async function openRoomChat(page: Page) {
  await page.goto(`${BASE}/webinars/${SLUG_LIVE}/room`, {
    waitUntil: "domcontentloaded",
  });
  // The chat message log renders once the grant carried a chat credential and the
  // Centrifugo connection is up (subscribe is server-side, so the pane is present
  // immediately; the log region is the readiness anchor).
  await expect(page.getByTestId("room-chat-messages").first()).toBeVisible();
  return page.getByRole("textbox", { name: /написать в чат|chat/i }).first();
}

test.describe("006 EARS-3 live chat over Centrifugo (e2e)", () => {
  test("006 EARS-3: a message one doctor posts appears in the other doctor's room without a reload", async ({
    browser,
  }) => {
    // Two independent browser contexts → two distinct 003 sessions in one room.
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      await login(pageA, DOCTOR_A_EMAIL!, DOCTOR_A_PASSWORD!);
      await login(pageB, DOCTOR_B_EMAIL!, DOCTOR_B_PASSWORD!);

      const composerA = await openRoomChat(pageA);
      await openRoomChat(pageB);

      // Doctor A posts a unique message through the gated composer.
      const messageFromA = `Вопрос от коллеги A — ${Date.now()}`;
      await composerA.fill(messageFromA);
      await pageA
        .getByRole("button", { name: /отправить|send/i })
        .first()
        .click();

      // Doctor B sees A's message appear in real time — no reload of page B.
      await expect(
        pageB.getByTestId("room-chat-message").filter({ hasText: messageFromA }),
      ).toBeVisible({ timeout: 15_000 });

      // The reverse direction proves the bidirectional fan-out: B posts, A sees it.
      const composerB = pageB
        .getByRole("textbox", { name: /написать в чат|chat/i })
        .first();
      const messageFromB = `Ответ от коллеги B — ${Date.now()}`;
      await composerB.fill(messageFromB);
      await pageB
        .getByRole("button", { name: /отправить|send/i })
        .first()
        .click();
      await expect(
        pageA.getByTestId("room-chat-message").filter({ hasText: messageFromB }),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test("006 EARS-3: the composer rejects an empty/whitespace-only message (send stays disabled) — the SSOT reject path", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await login(page, DOCTOR_A_EMAIL!, DOCTOR_A_PASSWORD!);
      const composer = await openRoomChat(page);
      const send = page.getByRole("button", { name: /отправить|send/i }).first();

      // Empty and whitespace-only drafts are not sendable (the same rule the server
      // enforces) — the send control stays disabled, never posting garbage.
      await expect(send).toBeDisabled();
      await composer.fill("   ");
      await expect(send).toBeDisabled();

      // Valid content enables send.
      await composer.fill("настоящее сообщение");
      await expect(send).toBeEnabled();
    } finally {
      await ctx.close();
    }
  });
});
