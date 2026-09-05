import { test, expect, type Page } from "@playwright/test";
import {
  requireLiveStandEnv,
  requireShortHeartbeat,
} from "./support/live-stand-env";

/**
 * 006 EARS-5 — the live in-room presence counter, REALTIME push over Centrifugo.
 * Two gated doctors share one live room. When the second doctor JOINS, the first
 * doctor's header count rises after the joiner's fresh beat. When that doctor's
 * beats stop, the count falls only after the `2 × N` freshness window ages the
 * latest beat out. Closing a browser/WS merely stops this test client; it is not
 * itself the count-changing event.
 *
 * This broad live E2E drives real dev-stand Centrifugo + api + Postgres; the #1139
 * low-N harness is the publication-level ~1 s / `2 × N` timing and no-observer-beat
 * causality proof. This broad test asserts only RELATIVE results (observer's count
 * +1 on a fresh beat, −1 at stopped-beat age-out), never an absolute value; it does
 * not instrument the observer's independent heartbeat schedule. The deterministic
 * push-vs-beat separation (publish only on change; no publish when unchanged;
 * expiry-driven decrease) is also pinned by
 * `apps/api/src/room/presence-publisher.service.spec.ts`; the client
 * discriminate-and-apply seam by `presence-channel.test.tsx`.
 *
 * Live-stand-gated tier (mirrors `room-chat.spec.ts`): it is inert-green only on a
 * BARE environment; a partially exported env set fails loudly (#1871). The presence
 * count is a DESKTOP header element (canvas), so the contexts run a desktop
 * viewport.
 *
 * ENV SET (#1871) — export ALL of these to run this spec; exporting SOME of them
 * fails loudly naming the missing ones (`support/live-stand-env.ts`), while a
 * completely bare environment stays inert-green:
 *
 * | variable                     | value on the dev stand                   |
 * | ---------------------------- | ---------------------------------------- |
 * | `E2E_PORTAL_URL`             | the running portal origin                |
 * | `E2E_DOCTOR_EMAIL`           | doctor A, registered for the live room   |
 * | `E2E_DOCTOR_PASSWORD`        | doctor A's password                      |
 * | `E2E_DOCTOR2_EMAIL`          | doctor B, registered for the same room   |
 * | `E2E_DOCTOR2_PASSWORD`       | doctor B's password                      |
 * | `E2E_ROOM_CHAT_SLUG`         | `seed-005-live`                          |
 * | `E2E_ROOM_HEARTBEAT_SECONDS` | the api's cadence, ≤ 10 (see below)      |
 *
 * API PRECONDITION: the api under test MUST be booted with
 * `ROOM_HEARTBEAT_INTERVAL_SECONDS=2` (its default is 60). The join-raises-count
 * and age-out waits are multiples of that cadence, so the default cadence pushes
 * them past the 120 s Playwright timeout; `E2E_ROOM_HEARTBEAT_SECONDS` must MIRROR
 * the api value and is capped at 10 — a larger value fails loudly by name instead
 * of timing out. The presence freshness window defaults to `2 ×` that cadence and
 * can be overridden with `E2E_ROOM_PRESENCE_WINDOW_SECONDS`.
 *
 * DOCTOR PROVISIONING: the two doctors are self-signup accounts reused across
 * runs. Zitadel/api throttles after ~4–5 signups per window (429) — reuse the
 * exported credentials rather than minting a fresh pair per run.
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
requireLiveStandEnv([
  "E2E_PORTAL_URL",
  "E2E_DOCTOR_EMAIL",
  "E2E_DOCTOR_PASSWORD",
  "E2E_DOCTOR2_EMAIL",
  "E2E_DOCTOR2_PASSWORD",
  "E2E_ROOM_CHAT_SLUG",
  "E2E_ROOM_HEARTBEAT_SECONDS",
]);
// The server-side heartbeat cadence, capped at 10 s so the age-out waits below fit
// inside the 120 s Playwright timeout (#1871): the api's own default is 60 s, which
// silently turned these tests into opaque timeouts.
const HEARTBEAT_SECONDS = requireShortHeartbeat();
// The presence freshness window (2 × heartbeat cadence) bounds when stopped beats
// age out server-side. It derives from the cadence by default; override only when
// the api's window is not exactly 2 × N.
const PRESENCE_WINDOW_SECONDS = Number(
  process.env.E2E_ROOM_PRESENCE_WINDOW_SECONDS ?? String(HEARTBEAT_SECONDS * 2),
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
  test("006 EARS-5: a second doctor joining raises the observer's count in realtime", async ({
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

      // A's header eventually reflects B. This broad E2E asserts the relative +1
      // result but does not instrument whether A also beats inside this poll window;
      // exact no-observer-beat causality belongs to the #1139 harness + publisher unit.
      await expect
        .poll(() => presenceValue(pageA), { timeout: 8_000, intervals: [250] })
        .toBeGreaterThanOrEqual(before + 1);

      // Closing B stops this client's beats but does not itself change the count.
      // The broad E2E observes the decreased result after stopped-beat age-out;
      // exact timer/no-A-beat causality belongs to the #1139 harness + publisher unit.
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
