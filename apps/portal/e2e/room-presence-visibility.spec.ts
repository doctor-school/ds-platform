import { test, expect, type Page } from "@playwright/test";
import { requireLiveStandEnv } from "./support/live-stand-env";

/**
 * 006 EARS-19 (#2911) — the live presence count is withheld from viewers while
 * the event's «Показывать зрителям число участников» is off, and a staff account
 * sees it in the room whatever the setting.
 *
 * The API e2e (`apps/api/test/room/presence-count-visibility.e2e-spec.ts`) proves
 * the three paths (RoomConfig, heartbeat ack, realtime channel) carry no number to
 * a doctor, and `apps/api/src/room/chat.gateway.spec.ts` pins the channel each
 * count is published to; the component rows (`packages/room/src/room-shell.test.tsx`,
 * `ui/room-presence.test.tsx`, `ui/room-chat.test.tsx`) prove a `null` renders
 * nothing and the staff channel feeds the header. RoomConfig is read server-side
 * (`packages/room-page/src/ui/room-page.tsx`), so the browser makes no `/room`
 * request to inspect — this spec asserts on the rendered room only. What only a
 * browser over the real stand proves is the composition:
 * a doctor in a live room with the setting off sees NO count element — no slot,
 * no «0» — while a staff session in the same room, at the same moment, sees the
 * participants' count (the doctor; staff are never counted).
 *
 * The setting-ON half is the EARS-5 tier (`room-presence-count.spec.ts`): its
 * `seed-005-live` fixture is seeded with the setting on.
 *
 * Live-stand-gated tier (mirrors `room-presence-count.spec.ts`): it is inert-green
 * only on a BARE environment; a partially exported env set fails loudly (#1871),
 * and with the full set present a rendered count on the doctor's page fails it.
 * It rides the `live/academy/default` tier (`tools/staging/live-tiers.mjs`).
 *
 * ENV SET (#1871) — export ALL of these, or none (inert-green on a bare env):
 *
 * | variable                     | value on the dev stand                          |
 * | ---------------------------- | ----------------------------------------------- |
 * | `E2E_PORTAL_URL`             | the running portal origin                       |
 * | `E2E_DOCTOR_EMAIL`           | a doctor registered for the hidden-count room   |
 * | `E2E_DOCTOR_PASSWORD`        | that doctor's password                          |
 * | `E2E_STAFF_EMAIL`            | a staff account registered for the same room    |
 * | `E2E_STAFF_PASSWORD`         | that account's password                         |
 * | `E2E_ROOM_HIDDEN_SLUG`       | a live room with the setting off (`seed-006-room-rutube`) |
 *
 * Both accounts need a saved display name (006 EARS-14) — see the stand
 * preconditions of `room-presence-count.spec.ts`. `E2E_SHOT_DIR` opts into the
 * evidence captures the PR body cites.
 */
const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
const SLUG = process.env.E2E_ROOM_HIDDEN_SLUG;
const SHOT_DIR = process.env.E2E_SHOT_DIR;
requireLiveStandEnv([
  "E2E_PORTAL_URL",
  "E2E_DOCTOR_EMAIL",
  "E2E_DOCTOR_PASSWORD",
  "E2E_STAFF_EMAIL",
  "E2E_STAFF_PASSWORD",
  "E2E_ROOM_HIDDEN_SLUG",
]);

// The header count is a DESKTOP element (canvas line 21).
test.use({ viewport: { width: 1440, height: 900 } });

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

/**
 * Open the live room and wait until it has rendered: the chat panel and its
 * «Чат эфира» message log are the anchor present in both settings, so a missing
 * count afterwards is a withheld count, not an unrendered room.
 */
async function openRoom(page: Page): Promise<void> {
  await page.goto(`${BASE}/webinars/${SLUG}/room`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("room-chat").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("log", { name: /чат эфира/i }).first(),
  ).toBeVisible();
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
}

test.describe("006 EARS-19 — the presence count is withheld from viewers", () => {
  test("006 EARS-19: setting off — the doctor's room renders no count, while a staff session in the same room sees it", async ({
    browser,
  }) => {
    const doctorCtx = await browser.newContext();
    const staffCtx = await browser.newContext();
    try {
      const doctor = await doctorCtx.newPage();
      await login(
        doctor,
        process.env.E2E_DOCTOR_EMAIL!,
        process.env.E2E_DOCTOR_PASSWORD!,
      );
      // The doctor's rendered room carries no count from the first paint.
      await openRoom(doctor);
      await expect(doctor.getByTestId("room-presence-count")).toHaveCount(0);

      const staff = await staffCtx.newPage();
      await login(
        staff,
        process.env.E2E_STAFF_EMAIL!,
        process.env.E2E_STAFF_PASSWORD!,
      );
      await openRoom(staff);
      // Staff see the participants' count (the doctor beating in the room).
      await expect(staff.getByTestId("room-presence-count")).toHaveText(
        /^\d+ /,
        { timeout: 20_000 },
      );
      await shot(staff, "room-staff-count-visible-1440");

      // The doctor, at the same moment and across their own beats, still sees
      // no count element — no slot, no «0».
      await doctor.waitForTimeout(3_000);
      await expect(doctor.getByTestId("room-presence-count")).toHaveCount(0);
      await expect(doctor.getByText(/в комнате/)).toHaveCount(0);
      await shot(doctor, "room-doctor-count-withheld-1440");
    } finally {
      await doctorCtx.close();
      await staffCtx.close();
    }
  });
});
