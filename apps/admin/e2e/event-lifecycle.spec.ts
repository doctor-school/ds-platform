import { expect, test, type Page } from "@playwright/test";
import { signInAsAdmin } from "./support/sign-in";

/**
 * 014 EARS-18 (#1338), browser half — the REAL Refine → NestJS → Postgres path
 * for `MarkEventEnded`, the «эфир прошёл вне платформы» control.
 *
 * The API e2e (`apps/api/test/events/mark-ended.e2e-spec.ts`) proves the contract
 * against the API directly. This proves the operator-facing arc on the running
 * admin: the control APPEARS only on a published event whose scheduled end is
 * already past (and never on one still ahead), and clicking it actually moves the
 * event to `ended` through the real command — after which `hide`, the only
 * edge out of `ended`, is what the bar offers.
 *
 * The appearance rule is deliberately NOT re-implemented in the browser: the
 * server drops `ended` from a published event's `validTransitions` unless the
 * EARS-18 preconditions hold (scheduled end past AND the room never opened), and
 * `lib/lifecycle.ts` maps the `(published, ended)` PAIR to `mark-ended` while
 * `(live, ended)` stays `close`. So what is asserted here is that the ONE
 * authority reaches the button — not that a second copy of the rule agrees.
 *
 * Dev-stand-gated + MANUAL like every other `apps/admin/e2e` flow spec — the
 * bootstrap provisions a real `platform_admin` against the stand's Zitadel and
 * throws when `IDP_*` is absent. Run against a booted admin + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     e2e/event-lifecycle.spec.ts --config=playwright.flows.config.ts
 */

/**
 * A `datetime-local` value for the MSK (UTC+3) wall clock `offsetMs` from now.
 * Computed, never a literal: a pinned calendar date rots into the past and turns
 * a "future event" fixture into a silently different scenario (the failure this
 * slice had to repair in `publish.e2e-spec.ts` / `room-control.e2e-spec.ts`).
 */
function mskInput(offsetMs: number): string {
  return new Date(Date.now() + offsetMs + 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A real event through the real 007 create form; returns its id. */
async function createEvent(
  page: Page,
  title: string,
  startsAtMsk: string,
): Promise<string> {
  await page.goto("/events/create");
  // Settle on the mounted form before filling — the sibling flow specs do the
  // same; without it the first `fill` can race the client render.
  await expect(page.getByTestId("event-form")).toBeVisible();
  await page.locator("#title").fill(title);
  await page.locator("#school").fill("Кардиология");
  await page.locator("#startsAtMsk").fill(startsAtMsk);
  await page.locator("#durationMin").fill("90");
  await page.getByTestId("program-pdf").setInputFiles({
    name: "program.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF"),
  });
  await page.getByTestId("submit-event").click();
  await page.waitForURL(/\/events\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return page.url().split("/").pop()!;
}

/** Fire `publish` from the real action bar and wait for the badge to follow. */
async function publish(page: Page, eventId: string): Promise<void> {
  await page.goto(`/events/${eventId}`);
  await page.getByTestId("action-publish").click();
  await expect(page.getByTestId("state-published")).toBeVisible({
    timeout: 20_000,
  });
}

test.describe.configure({ mode: "serial" });

test.describe("014 EARS-18 — mark an off-platform broadcast ended, in the live admin", () => {
  test("014 EARS-18: the control is withheld on an event still ahead and offered on one whose эфир has passed", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    const stamp = Date.now();

    // ── A published event still ahead: `open` is the air-day action, and
    //    `mark-ended` must NOT be offered — its эфир has not happened yet. ──
    const futureId = await createEvent(
      page,
      `Предстоящий эфир ${stamp}`,
      mskInput(7 * DAY_MS),
    );
    await publish(page, futureId);
    await expect(page.getByTestId("action-open")).toBeVisible();
    await expect(page.getByTestId("action-mark-ended")).toHaveCount(0);

    // ── A published event whose scheduled end is already past: BOTH edges out
    //    of `published` are legal, so the operator is offered the choice. ──
    const pastId = await createEvent(
      page,
      `Прошедший эфир ${stamp}`,
      mskInput(-3 * DAY_MS),
    );
    await publish(page, pastId);
    const markEnded = page.getByTestId("action-mark-ended");
    await expect(markEnded).toBeVisible();
    // The label names the assertion the operator is making, not just the state.
    await expect(markEnded).toHaveText(
      "Отметить завершённым (трансляция прошла вне платформы)",
    );
    // `open` stays available: EARS-18 adds an edge, it does not remove one.
    await expect(page.getByTestId("action-open")).toBeVisible();
    // `close` is the LIVE-origin command and must never appear from `published`
    // — that pairing is exactly the drift the (origin, target) map prevents.
    await expect(page.getByTestId("action-close")).toHaveCount(0);
  });

  test("014 EARS-18: marking it ended moves the event to «Завершено» and leaves hide as the only way on", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    const eventId = await createEvent(
      page,
      `Внеплатформенный эфир ${Date.now()}`,
      mskInput(-3 * DAY_MS),
    );
    await publish(page, eventId);

    await page.getByTestId("action-mark-ended").click();

    // The badge is the server's answer re-read through Refine, not an optimistic
    // local flip: no `transition-error` alert, and the state is the real one.
    await expect(page.getByTestId("state-ended")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("transition-error")).toHaveCount(0);

    // `ended` has exactly one edge out; neither `ended`-targeting command may be
    // offered again from a state that has already reached it.
    await expect(page.getByTestId("action-hide")).toBeVisible();
    await expect(page.getByTestId("action-mark-ended")).toHaveCount(0);
    await expect(page.getByTestId("action-close")).toHaveCount(0);
    await expect(page.getByTestId("action-open")).toHaveCount(0);

    // A reload proves it was persisted, not held in the page's own state.
    await page.reload();
    await expect(page.getByTestId("state-ended")).toBeVisible({
      timeout: 20_000,
    });
  });
});
