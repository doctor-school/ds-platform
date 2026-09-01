import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signInAsAdmin } from "./support/sign-in";

/**
 * #1593, browser half — what an operator SEES when a lifecycle command is refused
 * because the screen is behind the row (`412 PRECONDITION_FAILED`).
 *
 * The API e2e (`apps/api/test/admin/optimistic-concurrency.e2e-spec.ts`) proves
 * the contract against the API. This proves the operator-facing half on the
 * running admin, which the contract alone cannot: that the refusal is explained
 * as a STALE READ rather than as an illegal transition, that the screen re-reads
 * the event by itself, and that the retry is therefore one more click instead of
 * a manual browser reload (before the fix a retry resent the spent validator and
 * answered 412 again, indefinitely).
 *
 * The conflict is forced the way two real operators produce it: TWO tabs on the
 * same event in one session. Tab B saves an edit — an authoring write bumps
 * `version` WITHOUT moving the lifecycle state — so tab A still offers a legal
 * transition, built from a validator that is now spent. That ordering matters:
 * had tab B performed the TRANSITION instead, tab A's command would be refused
 * `409 INVALID_TRANSITION` by the domain guard, which runs before the version
 * check, and the stale path would never be reached.
 *
 * `E2E_SHOT_DIR` opts into the render evidence the PR body cites — the refusal
 * state at two widths × both palettes, plus the three-step interaction strip.
 * Unset, the spec still asserts: the images are evidence for a human, not the
 * gate.
 *
 * Dev-stand-gated + MANUAL like every other `apps/admin/e2e` flow spec — the
 * bootstrap provisions a real `platform_admin` against the stand's Zitadel and
 * throws when `IDP_*` is absent. Run against a booted admin + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     --config=playwright.flows.config.ts e2e/lifecycle-stale-refusal.spec.ts
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;

/** The phone width the admin narrow specs (#1387/#1399) are measured at. */
const NARROW = { width: 390, height: 844 };
/** A desktop width comfortably past every admin breakpoint. */
const WIDE = { width: 1440, height: 900 };

/** The owner-approved stale-refusal copy (`events.errors.stale`, `messages/ru.json`). */
const STALE_COPY =
  "Это мероприятие только что было изменено. Данные на этой странице уже обновлены до актуального состояния. Можете повторить своё действие.";

/**
 * A `datetime-local` value for the MSK (UTC+3) wall clock `offsetMs` from now.
 * Computed, never a literal — a pinned date rots into the past and silently
 * turns a "future event" fixture into a different scenario.
 */
function mskInput(offsetMs: number): string {
  return new Date(Date.now() + offsetMs + 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOT_DIR, `${name}.png`),
    fullPage: false,
  });
}

/**
 * Render the page under the design-system dark palette. The admin ships no theme
 * toggle of its own — the palette is the `.dark` token block in
 * `@ds/design-system` (`styles/tokens.css`), which is what a dark-mode host
 * applies — so the dark evidence is captured by putting the app under exactly
 * that class rather than by inventing a control this surface does not have.
 */
async function setPalette(page: Page, palette: "light" | "dark"): Promise<void> {
  await page.evaluate((mode) => {
    document.documentElement.classList.toggle("dark", mode === "dark");
  }, palette);
}

/** A real event through the real 007 create form; returns its id. */
async function createEvent(page: Page, title: string): Promise<string> {
  await page.goto("/events/create");
  await expect(page.getByTestId("event-form")).toBeVisible();
  await page.locator("#title").fill(title);
  await page.locator("#school").fill("Кардиология");
  await page.locator("#startsAtMsk").fill(mskInput(7 * 24 * 60 * 60 * 1000));
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

test.describe.configure({ mode: "serial" });

test.describe("#1593 — a stale lifecycle command in the live admin", () => {
  test("#1593: a concurrent edit refuses the command as a stale read, re-reads the event, and the same click then succeeds", async ({
    page,
    context,
  }) => {
    await signInAsAdmin(page);
    await page.setViewportSize(WIDE);

    const eventId = await createEvent(
      page,
      `Конкурентная правка ${Date.now()}`,
    );

    // ── Tab A holds the event at the version it rendered. ──────────────────
    await page.goto(`/events/${eventId}`);
    await expect(page.getByTestId("action-publish")).toBeVisible();
    await shot(page, "interaction-1-before-desktop-light");

    // ── Tab B — the second operator — saves an edit. An authoring write bumps
    //    `version` and leaves the state alone, so tab A's offer stays legal and
    //    only its validator goes stale. ─────────────────────────────────────
    const other = await context.newPage();
    await other.setViewportSize(WIDE);
    await other.goto(`/events/${eventId}`);
    await expect(other.getByTestId("event-form")).toBeVisible();
    await other.locator("#title").fill(`Правка второго администратора ${Date.now()}`);
    await other.getByTestId("submit-event").click();
    await expect(other.getByTestId("edit-ok")).toBeVisible({ timeout: 20_000 });
    await other.close();

    // ── Tab A fires the command it was offered, on the spent validator. ────
    await page.getByTestId("action-publish").click();

    const alert = page.getByTestId("transition-error");
    await expect(alert).toBeVisible({ timeout: 20_000 });
    // The CAUSE is the point: the refusal must not be worded as an illegal
    // transition — the transition is legal, the read behind the screen is not.
    // `toContainText`, not `toHaveText`: the DS `Alert` prefixes a decorative
    // «✕» glyph, which belongs to the variant, not to the sentence under test.
    await expect(alert).toContainText(STALE_COPY);
    // The command was refused, not applied: the event is still a draft.
    await expect(page.getByTestId("state-draft")).toBeVisible();
    await shot(page, "stale-412-desktop-light");

    await setPalette(page, "dark");
    await shot(page, "stale-412-desktop-dark");

    await page.setViewportSize(NARROW);
    await shot(page, "stale-412-mobile-dark");
    await setPalette(page, "light");
    await shot(page, "stale-412-mobile-light");

    await page.setViewportSize(WIDE);
    await shot(page, "interaction-2-refusal-desktop-light");

    // ── The recovery this fix exists for: the screen re-read the event by
    //    itself, so the SAME click now carries a fresh validator and succeeds.
    //    No reload happens here — that is the assertion. ────────────────────
    await page.getByTestId("action-publish").click();
    await expect(page.getByTestId("state-published")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("transition-error")).toHaveCount(0);
    await shot(page, "interaction-3-retry-succeeded-desktop-light");
  });

  test("#1593: a domain refusal on a stale screen also re-reads the event, so the page stops lying about the state (owner Stage-B finding)", async ({
    page,
    context,
  }) => {
    await signInAsAdmin(page);
    await page.setViewportSize(WIDE);

    const eventId = await createEvent(
      page,
      `Конкурентная публикация ${Date.now()}`,
    );

    // ── Tab A renders the draft and its legal `publish` offer. ─────────────
    await page.goto(`/events/${eventId}`);
    await expect(page.getByTestId("action-publish")).toBeVisible();

    // ── Tab B publishes — the state MOVES, not just the version, so tab A's
    //    held command is now illegal at every version and the domain guard
    //    (409 INVALID_TRANSITION), which runs before the version check,
    //    refuses it. This is exactly the two-window sequence the owner drove
    //    at Stage-B (2026-09-01). ─────────────────────────────────────────────
    const other = await context.newPage();
    await other.setViewportSize(WIDE);
    await other.goto(`/events/${eventId}`);
    await expect(other.getByTestId("action-publish")).toBeVisible();
    await other.getByTestId("action-publish").click();
    await expect(other.getByTestId("state-published")).toBeVisible({
      timeout: 20_000,
    });
    await other.close();

    // ── Tab A fires the held command. The refusal keeps the domain wording —
    //    the transition IS illegal — but the screen must re-read the event:
    //    before the fix it kept showing «черновик» with a publish button that
    //    could never work, a dead end the operator could only F5 out of. ─────
    await page.getByTestId("action-publish").click();

    const alert = page.getByTestId("transition-error");
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(alert).toContainText("Недопустимый переход статуса");
    // The refetch is the point: the badge now tells the truth…
    await expect(page.getByTestId("state-published")).toBeVisible({
      timeout: 20_000,
    });
    // …and the impossible offer is gone from the bar.
    await expect(page.getByTestId("action-publish")).toHaveCount(0);
  });
});
