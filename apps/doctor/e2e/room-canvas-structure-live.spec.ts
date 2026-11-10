import { test, expect, type Page } from "@playwright/test";
import { expectSlotSectionMatchesCanvas } from "@ds/e2e/canvas-slots";

import { requireLiveStandEnv } from "./support/live-stand-env";
import { DOCTOR_BASE, loginAsDoctor } from "./support/doctor-session";

/**
 * #3892 — the doctor-storefront live room `/events/[slug]/room` is compared, as a
 * structure, with the vendored canvas `design-source/room.dc.html` (its frames
 * import `unit-room-frame`, which imports `unit-chat-column`): every visible
 * control of the room (`main`), by kind + visible label, in order, rendered by
 * the real Claude Design runtime (`@ds/e2e/canvas-runtime`, #3798). The Academy
 * twin is `apps/portal/e2e/room-canvas-structure-live.spec.ts`, over the same
 * `@ds/room-page` mount.
 *
 * The states a seeded stand reaches for a signed-in registered doctor in an
 * open room, each against its canvas frame (light theme):
 * - 1440, chat expanded ↔ «Десктоп светлая, чат развёрнут»;
 * - 1440, chat folded (the column's own fold control) ↔ «Десктоп светлая, чат
 *   свёрнут»;
 * - 390, tab «Чат» ↔ «Мобильный светлая, чат»;
 * - 390, tab «О эфире» ↔ «Мобильный светлая, о эфире».
 *
 * Chat messages are a data slot: the canvas's sample messages draw no control,
 * so each rendered message must draw none either — a message control would
 * appear as chrome the canvas lacks. Their count and text are never compared
 * (#3728). The canvas's message loop lives inside the imported chat column,
 * which the slot reader's `repeats` (root-template `sc-for` only) cannot mark.
 *
 * Not compared (every other frame the canvas labels):
 * - the dark-theme frames («Десктоп тёмная, …», «Мобильный тёмная, …») — the
 *   same template under another `theme` prop; a theme changes colour, not
 *   controls, and the light frames already pin the structure.
 * - «Чат: обычная лента» — the chat column alone; it is part of the desktop
 *   frame compared above.
 * - «Чат: пусто», «Чат: загрузка», «Чат: реконнект», «Чат: соединение
 *   потеряно», «Чат: ошибка отправки», «Чат: недоступен», «Чат: свёрнут» —
 *   transient or failure chat states (an empty history, the loading skeleton, a
 *   dropped Centrifugo connection, a failed send, a runtime without chat) no
 *   seeded room holds steadily; the folded column is the desktop folded frame.
 * - «Плеер недоступен» — the golden dataset seeds only reachable rutube
 *   streams, so no slot room shows the player-unavailable state.
 *
 * Live tier `live/doctor/room` (`playwright.room.config.ts`), signed in as the
 * run's golden doctor, registered for the golden doctor live room a slot hands
 * this tier as `E2E_ROOM_CANVAS_SLUG` (`tools/staging/live-tiers.mjs` →
 * `seededEnv`); a bare env skips it.
 */

requireLiveStandEnv([
  "E2E_DOCTOR_URL",
  "E2E_DOCTOR_EMAIL",
  "E2E_DOCTOR_PASSWORD",
  "E2E_ROOM_CANVAS_SLUG",
]);

/**
 * The chat pane is live once its subscription and history read settled — the
 * client effect that drops the `room-chat-loading` skeleton (`@ds/room`).
 */
async function waitForRoomChatLive(page: Page): Promise<void> {
  await expect(page.getByTestId("room-chat-messages").first()).toBeVisible();
  await expect(page.getByTestId("room-chat-loading")).toHaveCount(0, {
    timeout: 20_000,
  });
}

interface RoomCase {
  name: string;
  width: number;
  frame: string;
  /** Bring the room into the frame's state after it opened. */
  enter?: (page: Page) => Promise<void>;
}

const CASES: RoomCase[] = [
  {
    name: "chat expanded",
    width: 1440,
    frame: "Десктоп светлая, чат развёрнут",
  },
  {
    name: "chat folded",
    width: 1440,
    frame: "Десктоп светлая, чат свёрнут",
    enter: async (page) => {
      await page.getByRole("button", { name: "Свернуть чат" }).click();
      await expect(
        page.getByRole("button", { name: "Развернуть чат" }),
      ).toBeVisible();
    },
  },
  { name: "tab «Чат»", width: 390, frame: "Мобильный светлая, чат" },
  {
    name: "tab «О эфире»",
    width: 390,
    frame: "Мобильный светлая, о эфире",
    enter: async (page) => {
      await page.getByRole("button", { name: "О эфире" }).click();
      await page.getByTestId("room-context").waitFor();
    },
  },
];

for (const c of CASES) {
  test.describe(`#3892 doctor room ≡ room canvas · ${c.name} · ${c.width}`, () => {
    test.use({ viewport: { width: c.width, height: 900 } });
    test("the room has the canvas structure (controls by kind + label)", async ({
      page,
    }) => {
      await loginAsDoctor(page);
      await page.goto(
        `${DOCTOR_BASE}/events/${process.env.E2E_ROOM_CANVAS_SLUG}/room`,
        { waitUntil: "domcontentloaded" },
      );
      await waitForRoomChatLive(page);
      await c.enter?.(page);

      await expectSlotSectionMatchesCanvas(page, {
        canvas: "room.dc.html",
        section: { section: ["data-screen-label", c.frame] },
        rendered: { root: "main" },
      });
    });
  });
}
