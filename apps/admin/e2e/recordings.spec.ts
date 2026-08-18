import { expect, test, type Page } from "@playwright/test";
import { bootstrapAdminSession } from "./support/admin-session";
import { totpCode } from "./support/totp";

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
const ORIGIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3200";

/** A real 32-char Rutube video code — the SSOT shape guard refuses anything else. */
const RUTUBE_EDITED = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const RUTUBE_RAW = "0f9e8d7c6b5a49382716f5e4d3c2b1a0";

/** Sign in and complete the one-time TOTP enrollment; lands on `/events`. */
async function signInAsAdmin(page: Page): Promise<void> {
  const { email, password } = await bootstrapAdminSession(ORIGIN);
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/mfa\/enroll/, { timeout: 20_000 });
  const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
  await page
    .getByTestId("mfa-enroll-form")
    .getByRole("textbox")
    .fill(totpCode(secret));
  await page.waitForURL(/\/events/, { timeout: 20_000 });
}

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
 * Turn the «показать снятые» toggle on. The DS `Switch` is a REAL checkbox that is
 * `sr-only` behind its painted track, so `.check()` on the input is intercepted by
 * the track — exactly as a mouse would be. A user clicks the TRACK, i.e. the
 * wrapping `<label>`, so the spec does the same.
 */
async function showRetired(page: Page): Promise<void> {
  await page
    .getByTestId("recordings-show-retired")
    .locator("xpath=ancestor::label[1]")
    .click();
}

/** Answer a §3 command's modal confirmation. */
async function confirmCommand(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await page.getByTestId(`${testId}-submit`).click();
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
    await expect(page.getByTestId("recording-retired-edited")).toBeVisible();

    await confirmCommand(page, "recording-retired-edited-restore");
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
    await confirmCommand(page, "recording-retired-edited-restore");
    await expect(page.getByTestId("recordings-command-error")).toContainText(
      "Слот этого вида уже занят",
    );
  });
});
