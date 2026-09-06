import { expect, test, type Page } from "@playwright/test";
import { signInAsAdmin } from "./support/sign-in";

/**
 * 014 EARS-1 / EARS-2 (#1339), browser half — the REAL Refine → NestJS → Postgres
 * path through the «Записи» tab of the feature-007 event detail.
 *
 * The API e2e suite (`apps/api/test/recordings/lifecycle.e2e-spec.ts`) proves the
 * contract against the API directly. This proves the OPERATOR arc on the running
 * admin: take an event all the way to `ended` through 007's own transitions,
 * attach the edited recording, publish it through the modal confirmation,
 * unpublish it, attach the raw one, meet the occupied-slot refusal in RU, retire,
 * restore, and save the readiness date. The refusal half matters as much as the
 * happy path — an operator who cannot read WHY the platform said no is stuck.
 *
 * Dev-stand-gated + MANUAL like every other `apps/admin/e2e` flow spec — the
 * bootstrap provisions a real `platform_admin` against the stand's Zitadel and
 * throws when `IDP_*` is absent. Run against a booted admin + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test e2e/recordings.spec.ts \
 *     --config=playwright.flows.config.ts
 */

/** A real 32-char Rutube video code — the SSOT shape guard refuses anything else. */
const RUTUBE_EDITED = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const RUTUBE_RAW = "0f9e8d7c6b5a49382716f5e4d3c2b1a0";

/** Author a draft event and land on its detail page; returns the event id. */
async function createEvent(page: Page, title: string): Promise<string> {
  await page.goto("/events/create");
  await expect(page.getByTestId("event-form")).toBeVisible();
  await page.locator("#title").fill(title);
  await page.locator("#school").fill("Кардиология");
  await page.locator("#startsAtMsk").fill("2026-09-17T19:00");
  await page.locator("#durationMin").fill("90");
  await page.getByTestId("program-pdf").setInputFiles({
    name: "program.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF"),
  });
  await page.getByTestId("submit-event").click();
  await page.waitForURL(/\/events\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

/** Open the «Записи» tab of the currently-rendered event detail. */
async function openRecordingsTab(page: Page): Promise<void> {
  await page.getByTestId("tab-recordings").click();
  await expect(page.getByTestId("recordings-panel")).toBeVisible();
}

/** Fill and submit the attach dialog for a kind. */
async function attach(
  page: Page,
  kind: "edited" | "raw",
  embedRef: string,
): Promise<void> {
  const testId = `recording-attach-${kind}`;
  await page.getByTestId(testId).click();
  await expect(page.getByTestId(`${testId}-form`)).toBeVisible();
  await page.getByTestId(`${testId}-provider`).selectOption("rutube");
  await page.getByTestId(`${testId}-embed-ref`).fill(embedRef);
  await page.getByTestId(`${testId}-submit`).click();
}

/**
 * Turn «Показывать отозванные» on in the history list. The DS `Switch` is a REAL
 * checkbox that is `sr-only` behind its painted track, so `.check()` on the input
 * is intercepted by the track — exactly as a mouse would be. A user clicks the
 * TRACK, i.e. the wrapping `<label>`, so the spec does the same. Since 014
 * EARS-22 the retained rows live in the shared `AdminDataList` history, whose
 * default read excludes them.
 */
async function showRetired(page: Page): Promise<void> {
  await page
    .getByTestId("recordings-history-include-retired")
    .locator("xpath=ancestor::label[1]")
    .click();
}

/**
 * The one control an operator can actually press. The DS `DataTable` renders the
 * wide table AND the narrow card list at every viewport, hiding one by CSS, so a
 * row-scoped testid exists twice in the DOM — a bare `getByTestId` is a strict
 * mode violation on any history-list control.
 */
function visibleByTestId(page: Page, testId: string) {
  return page.locator(`[data-testid="${testId}"]:visible`).first();
}

/**
 * The retained row's «Восстановить» button in the history list. Its testid
 * carries the row id (`recording-row-<uuid>-restore`), which the browser half
 * never learns, so the spec addresses it by shape and reads the id back.
 */
async function retiredRestoreTestId(page: Page): Promise<string> {
  const button = page
    .locator(
      '[data-testid^="recording-row-"][data-testid$="-restore"]:visible',
    )
    .first();
  await expect(button).toBeVisible();
  return (await button.getAttribute("data-testid"))!;
}

/** Answer a §3 command's modal confirmation. */
async function confirmCommand(page: Page, testId: string): Promise<void> {
  await visibleByTestId(page, testId).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await visibleByTestId(page, `${testId}-submit`).click();
  await expect(dialog).toBeHidden();
}

test.describe.configure({ mode: "serial" });

test.describe("014 EARS-1/EARS-2 — retained recordings in the live admin", () => {
  test("014 EARS-2: publication shall not be offered while the event is not finished, and the panel shall say why", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await createEvent(page, `Запись — черновик ${Date.now()}`);
    await openRecordingsTab(page);

    // The event is `draft`, so the panel states the precondition in RU rather
    // than offering a Publish button that would always be refused with 409
    // EVENT_NOT_FINISHED (014-design §3).
    await expect(page.getByTestId("recordings-event-state")).toContainText(
      "завершённого эфира",
    );

    await attach(page, "edited", RUTUBE_EDITED);
    await expect(page.getByTestId("recordings-notice")).toBeVisible();
    await expect(page.getByTestId("recording-status-edited")).toContainText(
      "Черновик",
    );
    // No Publish control anywhere on a non-finished event — and no Delete
    // control ever (EARS-2: retire is the terminal action).
    await expect(page.getByTestId("recording-edited-publish")).toHaveCount(0);
    await expect(page.getByText("Удалить", { exact: true })).toHaveCount(0);
  });

  test("014 EARS-1: «Изменить источник» shall open on the stored source, both right after an attach and after a correction", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await createEvent(page, `Запись — правка источника ${Date.now()}`);
    await openRecordingsTab(page);

    await attach(page, "edited", RUTUBE_EDITED);
    await expect(page.getByTestId("recording-status-edited")).toContainText(
      "Черновик",
    );

    // The attach dialog and the edit dialog are the SAME component in the same
    // slot: without a remount its form keeps the values captured when the slot
    // was still empty, so the operator's first «Изменить» would open a blank
    // source and a blind Save would wipe the row they just attached.
    const edit = "recording-edit-edited";
    await page.getByTestId(edit).click();
    await expect(page.getByTestId(`${edit}-form`)).toBeVisible();
    await expect(page.getByTestId(`${edit}-embed-ref`)).toHaveValue(
      RUTUBE_EDITED,
    );
    await expect(page.getByTestId(`${edit}-provider`)).toHaveValue("rutube");

    // Correct the source through that same dialog…
    await page.getByTestId(`${edit}-embed-ref`).fill(RUTUBE_RAW);
    await page.getByTestId(`${edit}-poster-ref`).fill("posters/edited.jpg");
    await page.getByTestId(`${edit}-duration`).fill("3600");
    await page.getByTestId(`${edit}-submit`).click();
    await expect(page.getByTestId("recordings-notice")).toContainText(
      "Источник записи обновлён",
    );
    await expect(page.getByTestId("recording-embed-ref-edited")).toContainText(
      RUTUBE_RAW,
    );

    // …and reopening it in the SAME session shows the corrected values, not the
    // ones the form was mounted with.
    await page.getByTestId(edit).click();
    await expect(page.getByTestId(`${edit}-form`)).toBeVisible();
    await expect(page.getByTestId(`${edit}-embed-ref`)).toHaveValue(RUTUBE_RAW);
    await expect(page.getByTestId(`${edit}-poster-ref`)).toHaveValue(
      "posters/edited.jpg",
    );
    await expect(page.getByTestId(`${edit}-duration`)).toHaveValue("3600");
  });

  test("014 EARS-1: an operator shall attach, publish, unpublish, retire and restore a recording of a finished event", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    const id = await createEvent(page, `Запись — эфир ${Date.now()}`);

    // ── Reach `ended` through feature 007's OWN transitions ────────────────
    // publish → open → close. Not a fixture write and not #1338's future
    // mark-ended command: the recording lifecycle must work against the state
    // the platform actually produces today.
    await page.getByTestId("provider").selectOption("rutube");
    await page.getByTestId("embed-ref").fill(RUTUBE_EDITED);
    await page.getByTestId("save-stream").click();
    await expect(page.getByTestId("stream-ok")).toBeVisible();

    await page.getByTestId("action-publish").click();
    await expect(page.getByTestId("state-published")).toBeVisible();
    await page.getByTestId("action-open").click();
    await expect(page.getByTestId("state-live")).toBeVisible();
    await page.getByTestId("action-close").click();
    await expect(page.getByTestId("state-ended")).toBeVisible();

    await openRecordingsTab(page);
    await expect(page.getByTestId("recordings-event-state")).toContainText(
      "Эфир завершён",
    );

    // ── Attach the edited recording, then publish it through the modal ─────
    await attach(page, "edited", RUTUBE_EDITED);
    await expect(page.getByTestId("recording-status-edited")).toContainText(
      "Черновик",
    );

    await confirmCommand(page, "recording-edited-publish");
    await expect(page.getByTestId("recording-status-edited")).toContainText(
      "Опубликована",
    );
    await expect(page.getByTestId("recordings-notice")).toContainText(
      "опубликована",
    );

    // ── Unpublish returns it to draft; the first-published instant survives ─
    await confirmCommand(page, "recording-edited-unpublish");
    await expect(page.getByTestId("recording-status-edited")).toContainText(
      "Черновик",
    );

    // ── The second kind is its own slot, not a replacement ─────────────────
    await attach(page, "raw", RUTUBE_RAW);
    await expect(page.getByTestId("recording-status-raw")).toContainText(
      "Черновик",
    );
    await expect(page.getByTestId("recording-embed-ref-edited")).toContainText(
      RUTUBE_EDITED,
    );

    // ── Retire frees the slot; the row stays addressable and restorable ────
    await confirmCommand(page, "recording-edited-retire");
    await expect(page.getByTestId("recording-empty-edited")).toBeVisible();

    await showRetired(page);
    await expect(page.getByTestId("recordings-history-table")).toContainText(
      "Отозвана",
    );

    await confirmCommand(page, await retiredRestoreTestId(page));
    await expect(page.getByTestId("recording-status-edited")).toContainText(
      "Черновик",
    );

    // ── The readiness date is an EVENT fact, saved through 007's PATCH ─────
    await page.getByTestId("recording-expected-by-input").fill("2026-10-01");
    await page.getByTestId("recording-expected-by-save").click();
    await expect(page.getByTestId("recordings-notice")).toContainText(
      "Дата готовности сохранена",
    );
    await page.reload();
    await openRecordingsTab(page);
    await expect(page.getByTestId("recording-expected-by-input")).toHaveValue(
      "2026-10-01",
    );

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("014 EARS-1: a second recording of an occupied kind shall be refused in RU, naming the slot", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await createEvent(page, `Запись — занятый слот ${Date.now()}`);
    await openRecordingsTab(page);

    await attach(page, "edited", RUTUBE_EDITED);
    await expect(page.getByTestId("recording-status-edited")).toContainText(
      "Черновик",
    );

    // The slot is filled, so the panel offers «Изменить источник», not a second
    // attach — the refusal is reached the only way an operator can reach it:
    // retire the row, restore it, and try to restore into a slot taken since.
    await confirmCommand(page, "recording-edited-retire");
    await attach(page, "edited", RUTUBE_RAW);
    await expect(page.getByTestId("recording-status-edited")).toContainText(
      "Черновик",
    );

    await showRetired(page);
    await confirmCommand(page, await retiredRestoreTestId(page));
    await expect(page.getByTestId("recordings-command-error")).toContainText(
      "Слот этого вида уже занят",
    );
  });

  test("014 EARS-1: a failed collection read shall render the RU error state, never a white screen (#1428)", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await createEvent(page, `Запись — сбой чтения ${Date.now()}`);

    // Fault injection at the transport: the failure under test is the BROWSER's
    // rendering of a read that has no answer. Refine's `result.data` substitutes
    // a frozen `{}` there, so a presence check against it reads "loaded" and the
    // panel then trips over `list.eventState` — the white screen of #1428. Only
    // the query's own `data` distinguishes the two states.
    // A regex, not a glob: since EARS-22 the collection read carries the list
    // query (`?page=1&pageSize=…`), which a `**/recordings` glob no longer
    // matches — the whole URL, search string included, has to match.
    const collectionRead = /\/v1\/admin\/events\/[0-9a-f-]{36}\/recordings(\?|$)/;
    await page.route(collectionRead, async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "injected read failure" }),
      });
    });

    await page.getByTestId("tab-recordings").click();
    await expect(page.getByTestId("recordings-error")).toContainText(
      "Не удалось загрузить записи эфира",
    );
    // The panel body never rendered, and the tab is still a live screen rather
    // than a blank document — an operator can read WHY and retry.
    await expect(page.getByTestId("recordings-panel")).toHaveCount(0);
    await expect(page.getByTestId("tab-recordings")).toBeVisible();
  });

  test("014 EARS-22: the recording history applies search and facets instantly, and one control undoes them", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await createEvent(page, `Запись — список ${Date.now()}`);
    await openRecordingsTab(page);

    // Two rows the filters can actually tell apart, both created through the
    // real attach dialog — so this asserts the list against records the API
    // just produced, not a fixture.
    await attach(page, "edited", RUTUBE_EDITED);
    await expect(page.getByTestId("recording-status-edited")).toContainText(
      "Черновик",
    );
    await attach(page, "raw", RUTUBE_RAW);
    await expect(page.getByTestId("recording-status-raw")).toContainText(
      "Черновик",
    );

    const filters = page.getByTestId("recordings-history-filters");
    const table = page.getByTestId("recordings-history-table");
    const search = filters.getByRole("searchbox");
    await expect(filters).toBeVisible();
    // Retained rows are out of the default read (the 012 default this list
    // adopts), so the toggle starts off.
    await expect(
      page.getByTestId("recordings-history-include-retired"),
    ).not.toBeChecked();
    await expect(table).toContainText(RUTUBE_EDITED);
    await expect(table).toContainText(RUTUBE_RAW);

    // ── EARS-22: typing IS the gesture — no Enter, no «Применить» ──────────
    await search.fill(RUTUBE_EDITED.slice(0, 12));
    await expect(
      page.getByRole("button", { name: "Применить", exact: true }),
    ).toHaveCount(0);
    await expect(table).toContainText(RUTUBE_EDITED);
    await expect(table).not.toContainText(RUTUBE_RAW);
    await expect(page.getByTestId("recordings-history-total")).toBeVisible();
    await expect(page.getByText("Выбрано:", { exact: false })).toBeVisible();

    // The two named slots are the server's UNFILTERED projection, so the
    // operator's primary surface survives a search that matches neither.
    await search.fill("нет-такой-записи");
    await expect(page.getByTestId("recording-embed-ref-edited")).toContainText(
      RUTUBE_EDITED,
    );
    await search.fill(RUTUBE_EDITED.slice(0, 12));

    // ── EARS-22: the kind facet applies on change, not on submit ───────────
    await page.getByTestId("recordings-history-kind").selectOption("raw");
    await expect(table).not.toContainText(RUTUBE_EDITED);

    // ── EARS-22: ONE control clears the whole applied set ─────────────────
    const resetAll = filters.getByRole("button", { name: "Сбросить всё" });
    await expect(resetAll).toHaveCount(1);
    await resetAll.click();
    await expect(page.getByText("Выбрано:", { exact: false })).toHaveCount(0);
    await expect(search).toHaveValue("");
    await expect(page.getByTestId("recordings-history-kind")).toHaveValue("");
    await expect(page.getByTestId("recordings-history-status")).toHaveValue("");
    await expect(table).toContainText(RUTUBE_EDITED);
    await expect(table).toContainText(RUTUBE_RAW);

    // ── EARS-22: no dead-end pager ────────────────────────────────────────
    // The DS `Pagination` block omits «Назад» on the first page and the whole
    // pager on a single page rather than rendering a control that does nothing.
    await expect(
      page.getByRole("button", { name: "Назад", exact: true }),
    ).toHaveCount(0);

    // ── EARS-22: an action that cannot change state is never rendered ─────
    // Both rows are `draft`, so the server's `validCommands` offers no
    // «Восстановить» — the row actions come from that list, so there is no
    // present-but-doomed button here.
    await expect(
      page.locator('[data-testid^="recording-row-"][data-testid$="-restore"]'),
    ).toHaveCount(0);
  });
});
