import { test, expect, type Page } from "@playwright/test";

/**
 * 006 EARS-5 — the live in-room presence counter, REALTIME push over Centrifugo.
 * Two gated doctors share one live room. When the second doctor JOINS, the first
 * doctor's header count rises WITHOUT the observer sending their own heartbeat —
 * the count is server-published on the joiner's beat and fanned out over the shared
 * room channel, so the observer renders it instantly (the #1122 "frozen until my
 * own beat" perception is gone). When that doctor LEAVES, the count falls after the
 * presence window ages their last beat out (a server-side expiry publish, again
 * with no observer beat).
 *
 * This is the live-verify vehicle for #1141 (the #1139 behavioural harness is not
 * ready): it drives the REAL dev-stand Centrifugo + api + Postgres. It asserts
 * RELATIVE change (observer's count +1 on a join, −1 on a leave), never an absolute
 * value, so it is robust to other doctors lingering on the shared stand. The
 * deterministic push-vs-beat separation (publish only on change; no publish when
 * unchanged; expiry-driven decrease) is pinned by
 * `apps/api/src/room/presence-publisher.service.spec.ts`; the client
 * discriminate-and-apply seam by `presence-channel.test.tsx`.
 *
 * Live-stand-gated tier (mirrors `room-chat.spec.ts`): it `test.skip`s unless the
 * dev-stand env is present, so a stray CI invocation is inert. The presence count
 * is a DESKTOP header element (canvas), so the contexts run a desktop viewport.
 */

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
const DOCTOR_A_EMAIL = process.env.E2E_DOCTOR_EMAIL;
const DOCTOR_A_PASSWORD = process.env.E2E_DOCTOR_PASSWORD;
const DOCTOR_B_EMAIL = process.env.E2E_DOCTOR2_EMAIL;
const DOCTOR_B_PASSWORD = process.env.E2E_DOCTOR2_PASSWORD;
const SLUG_LIVE =
  process.env.E2E_ROOM_CHAT_SLUG ??
  process.env.E2E_ROOM_SLUG_LIVE ??
  process.env.E2E_ROOM_SLUG_YOUTUBE;
// The presence freshness window (≈ 2 × heartbeat cadence) bounds how long a leave
// takes to age out server-side. Export it (seconds) to enable the leave assertion;
// with the 60 s default the window is 120 s — too long to wait in most runs — so
// the leave case is skipped unless a shorter cadence is configured and surfaced.
const PRESENCE_WINDOW_SECONDS = Number(
  process.env.E2E_ROOM_PRESENCE_WINDOW_SECONDS ?? "0",
);

test.skip(
  !process.env.E2E_PORTAL_URL ||
    !DOCTOR_A_EMAIL ||
    !DOCTOR_A_PASSWORD ||
    !DOCTOR_B_EMAIL ||
    !DOCTOR_B_PASSWORD ||
    !SLUG_LIVE,
  "requires a live portal + two doctors registered for the seeded live room",
);

test.use({ viewport: { width: 1280, height: 800 } });

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

/** Open the live room and wait until the presence count has rendered (≥ 1). */
async function openRoom(page: Page): Promise<void> {
  await page.goto(`${BASE}/webinars/${SLUG_LIVE}/room`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("room-presence-count").first()).toBeVisible({
    timeout: 15_000,
  });
}

/** The integer rendered in the «N врачей в комнате» header count (0 when hidden). */
async function presenceValue(page: Page): Promise<number> {
  const el = page.getByTestId("room-presence-count").first();
  if ((await el.count()) === 0) return 0;
  const text = (await el.textContent()) ?? "";
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

test.describe("006 EARS-5 realtime presence count over Centrifugo (e2e)", () => {
  test("006 EARS-5: a second doctor joining raises the observer's count in realtime — no observer beat", async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      await login(pageA, DOCTOR_A_EMAIL!, DOCTOR_A_PASSWORD!);
      await openRoom(pageA);

      // A's baseline (whoever is already in the window). Read it AFTER A settled so
      // A's own presence is counted; the assertion below is purely relative.
      const before = await presenceValue(pageA);

      // Doctor B joins in a separate session. B's first beat changes the distinct-
      // doctor count server-side, which is PUBLISHED to the shared room channel.
      const pageB = await ctxB.newPage();
      await login(pageB, DOCTOR_B_EMAIL!, DOCTOR_B_PASSWORD!);
      await openRoom(pageB);

      // A's header reflects B within a couple of seconds — the push, not A's own
      // next beat (the default 60 s cadence is far longer than this poll window,
      // so an increment observed now can only have arrived over the channel).
      await expect
        .poll(() => presenceValue(pageA), { timeout: 8_000, intervals: [250] })
        .toBeGreaterThanOrEqual(before + 1);

      // Leave: B closes its session. After the presence window ages B's last beat
      // out, the server publishes the decreased count — again with no A beat.
      test.skip(
        !PRESENCE_WINDOW_SECONDS || PRESENCE_WINDOW_SECONDS > 40,
        "leave assertion needs a short E2E_ROOM_PRESENCE_WINDOW_SECONDS (≈ 2 × a short heartbeat cadence)",
      );
      const afterJoin = await presenceValue(pageA);
      await ctxB.close();
      await expect
        .poll(() => presenceValue(pageA), {
          timeout: PRESENCE_WINDOW_SECONDS * 1000 + 8_000,
          intervals: [500],
        })
        .toBeLessThanOrEqual(afterJoin - 1);
    } finally {
      await ctxA.close();
      await ctxB.close().catch(() => {});
    }
  });
});
