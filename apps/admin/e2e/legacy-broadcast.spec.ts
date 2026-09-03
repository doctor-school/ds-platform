import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signInAsAdmin } from "./support/sign-in";

/**
 * 014 EARS-24 (#1741 slice 3), browser half — an архивный эфир is authored in the
 * ORDINARY create-event form, with «Это архивный эфир» checked.
 *
 * There is one creation surface, not two (owner decision 2026-09-03: «Просто при
 * создании мероприятия должна быть галочка "Это архивный эфир" и всё.»). The
 * checkbox switches the same form to its legacy variant — the date reads «Дата и
 * время проведения (МСК)», the partner field and the «Программа (PDF)» section
 * disappear, and a mandatory «Запись» section appears — and submits to
 * `POST /v1/admin/legacy-broadcasts` instead of the multipart create.
 *
 * The unit rows (`lib/form-schemas.test.ts`, `providers/data-provider.test.ts`)
 * prove the validation and the request shape; the API e2e proves the route. What
 * only a browser can prove is the ARC the operator lives: check the box, watch
 * the form change, submit, and land on an эфир that is born «Скрыто» with its
 * draft recording — then publish that recording and archive the эфир, which is
 * the whole point of the feature (an archive with content from day one).
 *
 * Unlike `legacy-lifecycle.spec.ts` this spec creates its OWN rows rather than
 * driving the shared seed fixtures, so it leaves the stand's `seed-006` эфир
 * untouched. The rows it creates are `hidden`/`in_archive` legacy эфиры, which
 * appear on no public surface, and their titles carry the run's timestamp so a
 * re-run never collides with itself.
 *
 * `E2E_SHOT_DIR` opts into the render evidence the PR body cites — the create
 * form with the checkbox CHECKED at two widths × both palettes, full-page so the
 * «Запись» section below the fold is in frame. Unset, the spec
 * still asserts: the images are evidence for a human, not the gate.
 *
 * Dev-stand-gated + MANUAL like every other `apps/admin/e2e` flow spec — the
 * bootstrap provisions a real `platform_admin` against the stand's Zitadel and
 * throws when `IDP_*` is absent. Run against a booted admin + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     --config=playwright.flows.config.ts e2e/legacy-broadcast.spec.ts
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;

/** The phone width the admin narrow specs (#1387/#1399) are measured at. */
const NARROW = { width: 390, height: 844 };
/** A desktop width comfortably past every admin breakpoint. */
const WIDE = { width: 1440, height: 900 };

/** A real 32-char Rutube video code — the SSOT shape guard refuses anything else. */
const RUTUBE_EDITED = "b1c2d3e4f5061728394a5b6c7d8e9f01";

/** The owner-approved copy (`messages/ru.json`). */
const LEGACY_TOGGLE_LABEL = "Это архивный эфир";
const HELD_AT_LABEL = "Дата и время проведения (МСК)";
const PROGRAM_SECTION = "Программа (PDF)";
const RECORDING_SECTION = "Запись";
const HIDDEN_BADGE = "Скрыто";
const ARCHIVED_BADGE = "Архивировано";
const LEGACY_BADGE = "Архивный эфир";

/**
 * Wait until the browser has PAINTED whatever was just changed (a palette swap,
 * a viewport resize). `page.screenshot` does not wait for a style recalculation
 * of its own, so without this the mobile-light shot could land mid-repaint and
 * show the previous palette's input fills (Mode-a review of PR #1849).
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

/**
 * `fullPage` evidence captures the WHOLE create form, not the viewport slice —
 * the «Запись» section sits below the fold at both widths, and the point of the
 * evidence is that the kind/provider/embedRef trio is there and the poster and
 * duration inputs are NOT (Mode-a review of PR #1849).
 */
async function shot(
  page: Page,
  name: string,
  { fullPage = false }: { fullPage?: boolean } = {},
): Promise<void> {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  await settle(page);
  await page.screenshot({
    path: path.join(SHOT_DIR, `${name}.png`),
    fullPage,
  });
}

/**
 * Render the page under the design-system dark palette. The admin ships no theme
 * toggle of its own — the palette is the `.dark` token block in
 * `@ds/design-system` — so the dark evidence is captured by putting the app
 * under exactly that class rather than by inventing a control it does not have.
 */
async function setPalette(
  page: Page,
  palette: "light" | "dark",
): Promise<void> {
  await page.evaluate((mode) => {
    document.documentElement.classList.toggle("dark", mode === "dark");
  }, palette);
  // `body` is token-painted (`background-color: var(--color-background)`), so its
  // COMPUTED colour is the honest signal that the new palette has been applied —
  // waiting on the class alone would return before the recalculation.
  await page.waitForFunction((mode) => {
    const channels = getComputedStyle(document.body).backgroundColor.match(
      /[\d.]+/g,
    );
    if (!channels || channels.length < 3) return false;
    const [r, g, b] = channels.map(Number);
    const luminance = (r * 299 + g * 587 + b * 114) / 1000;
    return mode === "dark" ? luminance < 128 : luminance >= 128;
  }, palette);
  await settle(page);
}

/**
 * Toggle «Это архивный эфир». The DS `Checkbox` is a REAL input that is `sr-only`
 * behind its painted box, so a click on the input itself is intercepted by that
 * box — exactly as a mouse would be. A user clicks the BOX, i.e. the wrapping
 * `<label>`, so the spec does the same (the `recordings.spec.ts` Switch
 * precedent).
 */
async function toggleLegacy(page: Page): Promise<void> {
  await page
    .getByTestId("legacy-toggle")
    .locator("xpath=ancestor::label[1]")
    .click();
}

async function checkLegacy(page: Page): Promise<void> {
  await toggleLegacy(page);
  await expect(page.getByTestId("legacy-toggle")).toBeChecked();
}

/** Fill the shared half of the create form (identical on both variants). */
async function fillShared(page: Page, title: string): Promise<void> {
  await page.locator("#title").fill(title);
  await page.locator("#school").fill("Кардиология");
  await page.locator("#startsAtMsk").fill("2024-03-14T18:00");
  await page.locator("#durationMin").fill("75");
  // The authoring form starts with NO speaker rows — the operator adds them.
  if ((await page.getByTestId("speaker-name-0").count()) === 0) {
    await page.getByTestId("add-speaker").click();
  }
  await page.getByTestId("speaker-name-0").fill("Докладчик Архивный");
}

/**
 * Author a legacy эфир through the create form and return its id. The URL the
 * form lands on IS the assertion that the legacy route answered 201 with a real
 * event — a failed submit stays on `/events/create`.
 */
async function createLegacyBroadcast(
  page: Page,
  title: string,
): Promise<string> {
  await page.goto("/events/create");
  await expect(page.getByTestId("event-form")).toBeVisible();
  await checkLegacy(page);
  await fillShared(page, title);
  await page.getByTestId("legacy-recording-provider").selectOption("rutube");
  await page.getByTestId("legacy-recording-embed-ref").fill(RUTUBE_EDITED);
  await page.getByTestId("submit-event").click();
  await page.waitForURL(/\/events\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return page.url().split("/").pop()!;
}

test.describe.configure({ mode: "serial" });

test.describe("014 EARS-24 — «Это архивный эфир» on the admin create-event form", () => {
  test("014 EARS-24.4: checking «Это архивный эфир» hides the PDF section and shows «Запись»", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.setViewportSize(WIDE);
    await page.goto("/events/create");
    await expect(page.getByTestId("event-form")).toBeVisible({
      timeout: 20_000,
    });

    // ── Unchecked: today's form, byte-for-byte. The checkbox is present and
    //    off, the program section and the partner field are there, and no
    //    recording block is asked for. ───────────────────────────────────────
    const toggle = page.getByTestId("legacy-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await expect(page.getByText(LEGACY_TOGGLE_LABEL).first()).toBeVisible();
    await expect(page.getByTestId("program-pdf")).toBeVisible();
    await expect(page.locator("#partnerRef")).toBeVisible();
    await expect(page.getByTestId("legacy-recording")).toHaveCount(0);

    // Typing BEFORE the toggle: the shared fields must survive the switch, so
    // an operator who realises mid-form does not retype what they entered.
    await fillShared(page, `Черновик до галочки ${Date.now()}`);
    const typedTitle = await page.locator("#title").inputValue();

    // ── Checked: the same form, the legacy variant. ────────────────────────
    await checkLegacy(page);

    await expect(page.getByTestId("legacy-recording")).toBeVisible();
    await expect(page.getByText(RECORDING_SECTION).first()).toBeVisible();
    await expect(page.getByTestId("legacy-recording-kind")).toBeVisible();
    await expect(page.getByTestId("legacy-recording-provider")).toBeVisible();
    await expect(page.getByTestId("legacy-recording-embed-ref")).toBeVisible();
    // …and NOTHING else. The owner refused authoring a poster as a storage key
    // and a duration by hand (Stage B 2026-09-03): a poster is a file to upload
    // and a duration is a fact to read off the recording, both delivered by
    // #1611 (EARS-20). The block asks for the source and the source only.
    await expect(page.getByTestId("legacy-recording-poster-ref")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("legacy-recording-duration")).toHaveCount(0);
    // No PDF and no partner — the legacy body carries neither.
    await expect(page.getByTestId("program-pdf")).toHaveCount(0);
    await expect(page.getByText(PROGRAM_SECTION)).toHaveCount(0);
    await expect(page.locator("#partnerRef")).toHaveCount(0);
    // The date is the date it WAS HELD, not a scheduled start.
    await expect(page.getByText(HELD_AT_LABEL).first()).toBeVisible();
    // Nothing the operator typed was wiped.
    await expect(page.locator("#title")).toHaveValue(typedTitle);
    await expect(page.locator("#school")).toHaveValue("Кардиология");
    await expect(page.locator("#durationMin")).toHaveValue("75");
    await expect(page.getByTestId("speaker-name-0")).toHaveValue(
      "Докладчик Архивный",
    );

    // ── Render evidence: the CHECKED create form, two widths × both palettes.
    await shot(page, "create-legacy-desktop-light", { fullPage: true });
    await setPalette(page, "dark");
    await shot(page, "create-legacy-desktop-dark", { fullPage: true });
    await page.setViewportSize(NARROW);
    await shot(page, "create-legacy-mobile-dark", { fullPage: true });
    await setPalette(page, "light");
    await shot(page, "create-legacy-mobile-light", { fullPage: true });
    await page.setViewportSize(WIDE);

    // ── And back: unchecking restores the platform variant with the typed
    //    values intact — the toggle is a variant switch, not a form reset. ──
    await toggleLegacy(page);
    await expect(toggle).not.toBeChecked();
    await expect(page.getByTestId("program-pdf")).toBeVisible();
    await expect(page.locator("#partnerRef")).toBeVisible();
    await expect(page.getByTestId("legacy-recording")).toHaveCount(0);
    await expect(page.locator("#title")).toHaveValue(typedTitle);

    await shot(page, "create-platform-desktop-light");
  });

  test("014 EARS-24.5: a legacy эфир is created hidden with its draft recording", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.setViewportSize(WIDE);

    const title = `Архивный эфир из формы ${Date.now()}`;
    const eventId = await createLegacyBroadcast(page, title);

    // ── Born hidden. ──────────────────────────────────────────────────────
    const hiddenBadge = page.getByTestId("state-hidden");
    await expect(hiddenBadge).toBeVisible({ timeout: 20_000 });
    await expect(hiddenBadge).toHaveText(HIDDEN_BADGE);

    // ── The edit form reads as a legacy эфир: the read-only badge instead of
    //    the checkbox, the held-at label, and no PDF section. ──────────────
    const badge = page.getByTestId("legacy-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(LEGACY_BADGE);
    await expect(page.getByTestId("legacy-toggle")).toHaveCount(0);
    await expect(page.getByText(HELD_AT_LABEL).first()).toBeVisible();
    await expect(page.getByTestId("program-pdf")).toHaveCount(0);
    // The recording block belongs to creation only — afterwards the «Записи»
    // tab owns recordings.
    await expect(page.getByTestId("legacy-recording")).toHaveCount(0);

    // ── The legacy machine, and only it: no «Опубликовать», no «Открыть эфир»
    //    on an эфир the platform never hosted (EARS-27). «Архивировать» is not
    //    offered YET either — the `hidden → in_archive` edge is withheld until a
    //    recording is published (014-design §3.1, `offeredTransitions`), which
    //    is exactly the arc EARS-24.6 walks. ────────────────────────────────
    await expect(page.getByTestId("action-publish")).toHaveCount(0);
    await expect(page.getByTestId("action-open")).toHaveCount(0);
    await expect(page.getByTestId("action-archive-legacy")).toHaveCount(0);
    await expect(page.getByTestId("action-hide-legacy")).toHaveCount(0);

    await shot(page, "created-legacy-detail-desktop-light");

    // ── And it SAVES. The edit form renders no «Запись» block, so it must not
    //    demand one either — the create-only requirement leaking into the edit
    //    resolver made an existing архивный эфир permanently unsavable (#1849
    //    review BLOCKER), with no visible error to explain the dead button.
    await page.locator("#description").fill("Уточнили описание архива.");
    await page.getByTestId("submit-event").click();
    await expect(page.getByTestId("edit-ok")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("edit-error")).toHaveCount(0);
    await expect(page.locator("#description")).toHaveValue(
      "Уточнили описание архива.",
    );

    // ── The recording it was created WITH is on the «Записи» tab, in draft. ─
    await page.getByTestId("tab-recordings").click();
    await expect(page.getByTestId("recordings-panel")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("recording-slot-edited")).toBeVisible();
    await expect(page.getByTestId("recording-embed-ref-edited")).toContainText(
      RUTUBE_EDITED,
    );
    await expect(page.getByTestId("recording-empty-edited")).toHaveCount(0);

    await shot(page, "created-legacy-recordings-desktop-light");

    expect(eventId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("014 EARS-24.6: publish the recording → «Архивировать» → «Архивировано»", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.setViewportSize(WIDE);

    const title = `Архивный эфир в архив ${Date.now()}`;
    await createLegacyBroadcast(page, title);
    await expect(page.getByTestId("state-hidden")).toBeVisible({
      timeout: 20_000,
    });

    // ── Publish the draft recording through its modal confirmation. ────────
    await page.getByTestId("tab-recordings").click();
    await expect(page.getByTestId("recordings-panel")).toBeVisible({
      timeout: 20_000,
    });
    await page.getByTestId("recording-edited-publish").click();
    await expect(
      page.getByTestId("recording-edited-publish-confirm"),
    ).toBeVisible();
    await page.getByTestId("recording-edited-publish-submit").click();
    await expect(page.getByTestId("recording-status-edited")).toHaveText(
      /Опубликована/,
      { timeout: 20_000 },
    );
    await expect(page.getByTestId("recordings-command-error")).toHaveCount(0);

    // ── Then «Архивировать» on the main tab: the эфир the operator authored
    //    minutes ago reaches the archive, which is the whole feature. ──────
    await page.getByTestId("tab-main").click();
    const archive = page.getByTestId("action-archive-legacy");
    await expect(archive).toBeVisible({ timeout: 20_000 });
    await archive.click();

    const archivedBadge = page.getByTestId("state-in_archive");
    await expect(archivedBadge).toBeVisible({ timeout: 20_000 });
    await expect(archivedBadge).toHaveText(ARCHIVED_BADGE);
    await expect(page.getByTestId("transition-error")).toHaveCount(0);

    await shot(page, "created-legacy-archived-desktop-light");
  });
});
