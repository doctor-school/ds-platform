import { expect, test, type Page } from "@playwright/test";
import {
  chooseEventClassification,
  chooseProjectDefaultAudience,
} from "./support/event-classification";
import { selectRelationshipCombobox } from "./support/relationship-combobox";
import { signInAsAdmin } from "./support/sign-in";
import { visible } from "./support/visible";

/**
 * 012 EARS-25…30 (#2509), browser half — the REAL Refine → NestJS → Postgres
 * path for the event-kind dictionary and the classification fields it drives.
 *
 * The API e2e suites (`apps/api/test/taxonomy/event-kinds.e2e-spec.ts`) prove
 * the contract. This proves the operator-facing arc on the running admin:
 *
 * - the kind dictionary is a Refine resource like «Направления» (owner look
 *   decision): reach it from the chrome, create (a kind with no format is
 *   refused in the browser), publish, edit;
 * - the event form's format select offers ONLY the formats the chosen kind
 *   allows, and switching to a kind that disallows the current format clears
 *   it (owner rule: an incompatible pair is unchoosable);
 * - narrowing a kind while one of its events carries the removed format is
 *   refused, and the refusal names that event (state `kind-narrow-refused`);
 * - a linked project's default audience prefills a new event's audience and
 *   stays editable; an event created without a project has no prefill.
 *
 * Dev-stand-gated + MANUAL like every other `apps/admin/e2e` flow spec. Run
 * against a booted admin + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3201 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     e2e/taxonomy-event-kinds.spec.ts --config=playwright.flows.config.ts
 */

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF");

/** Fill the event form's shared fields (everything but the classification). */
async function fillEventBasics(page: Page, title: string): Promise<void> {
  await page.goto("/events/create");
  await expect(page.getByTestId("event-form")).toBeVisible();
  await page.locator("#title").fill(title);
  await page.locator("#school").fill("Кардиология");
  await page.locator("#specialties").fill("cardiology");
  await page.locator("#startsAtMsk").fill("2026-07-17T19:00");
  await page.locator("#durationMin").fill("90");
  await page.getByTestId("program-pdf").setInputFiles({
    name: "program.pdf",
    mimeType: "application/pdf",
    buffer: PDF,
  });
}

/** Create + publish a kind with the given formats; returns its detail URL. */
async function createPublishedKind(
  page: Page,
  title: string,
  formats: string[],
): Promise<string> {
  await page.goto("/event-kinds/create");
  await page.getByTestId("event-kind-title").fill(title);
  for (const format of formats) {
    await toggleFormat(page, format);
  }
  await page.getByTestId("submit-event-kind").click();
  await page.waitForURL(/\/event-kinds\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  const url = page.url();
  await page.getByTestId("event-kind-publish").click();
  await expect(page.getByTestId("event-kind-status")).toHaveText(
    "Опубликовано",
  );
  return url;
}

/**
 * Toggle an allowed-format box the way a mouse does: the design-system
 * checkbox is `sr-only` behind its painted box, so the wrapping label is the
 * click target (`.check()` on the input is intercepted, as in the siblings).
 */
async function toggleFormat(page: Page, format: string): Promise<void> {
  await page
    .getByTestId(`event-kind-format-${format}`)
    .locator("xpath=ancestor::label[1]")
    .click();
}

function formatOptions(page: Page) {
  return page.getByTestId("event-participation-format").locator("option");
}

test.describe.configure({ mode: "serial" });

test.describe("012 EARS-25…30 — event kinds and event classification in the live admin", () => {
  test("012 EARS-25: an operator creates, publishes and edits an event kind like a direction", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    await page.getByTestId("nav-event-kinds").click();
    await page.waitForURL(/\/event-kinds$/, { timeout: 20_000 });
    // The seeded dictionary is listed (migration 0046).
    await expect(page.getByTestId("event-kinds-table")).toContainText("Эфир");
    await expect(
      page.getByRole("columnheader", { name: "Действия" }),
    ).toHaveCount(0);

    // ── Reject (client): a kind with no allowed format never leaves the browser
    await page.getByTestId("event-kinds-create").click();
    await page.waitForURL(/\/event-kinds\/create$/, { timeout: 20_000 });
    const title = `Клинический разбор ${Date.now()}`;
    await page.getByTestId("event-kind-title").fill(title);
    await page.getByTestId("submit-event-kind").click();
    await expect(page.getByText("Отметьте хотя бы один формат.")).toBeVisible();
    expect(page.url()).toMatch(/\/event-kinds\/create$/);

    // ── Accept
    await toggleFormat(page, "online");
    await page.getByTestId("submit-event-kind").click();
    await page.waitForURL(/\/event-kinds\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const detailUrl = page.url();
    await expect(page.getByTestId("event-kind-heading")).toHaveText(title);
    await expect(page.getByTestId("event-kind-status")).toHaveText("Черновик");
    await expect(page.getByRole("button", { name: /удалить/i })).toHaveCount(0);

    // ── Publish, then widen the allowed formats (an If-Match round-trip)
    await page.getByTestId("event-kind-publish").click();
    await expect(page.getByTestId("event-kind-status")).toHaveText(
      "Опубликовано",
    );
    await toggleFormat(page, "offline");
    await page.getByTestId("submit-event-kind").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("event-kind-format-offline")).toBeChecked();
    expect(page.url()).toBe(detailUrl);

    // ── The row opens from the list
    await page.getByTestId("back-to-list").click();
    await page.waitForURL(/\/event-kinds$/, { timeout: 20_000 });
    await visible(
      page.getByTestId("event-kinds-table").getByText(title, { exact: false }),
    ).click();
    await page.waitForURL(/\/event-kinds\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    expect(page.url()).toBe(detailUrl);
  });

  test("012 EARS-26: the format select offers only the chosen kind's formats and clears on an incompatible kind", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await fillEventBasics(page, `Формат по типу ${Date.now()}`);

    // No kind yet ⇒ no format is choosable.
    await expect(page.getByTestId("event-participation-format")).toBeDisabled();

    // «Конгресс» allows offline + hybrid only.
    await chooseEventClassification(page, { kindTitle: "Конгресс" });
    // The placeholder plus exactly the kind's formats — «Онлайн» is absent.
    await expect(formatOptions(page)).toHaveText([
      /.+/,
      "Очно",
      "Очно и онлайн",
    ]);
    await page
      .getByTestId("event-participation-format")
      .selectOption("offline");

    // Switching to «Эфир» (online only) drops «Очно» and selects the only format.
    await page.getByTestId("event-kind").selectOption({ label: "Эфир" });
    await expect(page.getByTestId("event-participation-format")).toHaveValue(
      "online",
    );
    await expect(formatOptions(page)).toHaveCount(2);

    // Back to «Конгресс»: «Онлайн» is incompatible, so the format is cleared.
    await page.getByTestId("event-kind").selectOption({ label: "Конгресс" });
    await expect(page.getByTestId("event-participation-format")).toHaveValue(
      "",
    );
    await page.getByTestId("event-participation-format").selectOption("hybrid");
    await page.getByTestId("submit-event").click();
    await page.waitForURL(/\/events\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await page.reload();
    await expect(page.getByTestId("event-participation-format")).toHaveValue(
      "hybrid",
    );
  });

  test("012 EARS-27: narrowing a kind used by an event is refused and names that event", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    const stamp = Date.now();
    const kindTitle = `Выездная школа ${stamp}`;
    const kindUrl = await createPublishedKind(page, kindTitle, [
      "online",
      "offline",
    ]);

    const eventTitle = `Школа на выезде ${stamp}`;
    await fillEventBasics(page, eventTitle);
    await chooseEventClassification(page, { kindTitle });
    await page
      .getByTestId("event-participation-format")
      .selectOption("offline");
    await page.getByTestId("submit-event").click();
    await page.waitForURL(/\/events\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const eventUrl = page.url();

    await page.goto(kindUrl);
    await toggleFormat(page, "offline");
    await page.getByTestId("submit-event-kind").click();
    await expect(page.getByTestId("update-error")).toContainText(
      "Нельзя убрать формат: его использует 1 мероприятие этого типа.",
    );
    const named = page.getByTestId("narrow-refused-events");
    await expect(named).toContainText(eventTitle);
    await expect(named.getByRole("link", { name: eventTitle })).toHaveAttribute(
      "href",
      new URL(eventUrl).pathname,
    );
    // One blocking event, all named: no «и ещё M» tail.
    await expect(page.getByTestId("narrow-refused-more")).toHaveCount(0);
    // Nothing was narrowed.
    await page.reload();
    await expect(page.getByTestId("event-kind-format-offline")).toBeChecked();
  });

  test("012 EARS-30: a linked project's default audience prefills the event audience, which stays editable", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    const stamp = Date.now();
    const projectTitle = `Школа врачей ${stamp}`;
    await page.goto("/projects/create");
    await page.getByTestId("project-form").waitFor({ state: "visible" });
    await page.locator("#title").fill(projectTitle);
    await page.locator("#description").fill("Проект для врачей.");
    await chooseProjectDefaultAudience(page, "doctors");
    await page.getByTestId("submit-project").click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await page.reload();
    await expect(page.getByTestId("project-default-audience")).toHaveValue(
      "doctors",
    );

    // No project ⇒ no prefill: the audience must be chosen.
    await fillEventBasics(page, `Без проекта ${stamp}`);
    await expect(page.getByTestId("event-audience")).toHaveValue("");

    // Linking the project prefills its default…
    await selectRelationshipCombobox(
      page,
      "event-project-combobox",
      projectTitle,
      projectTitle,
    );
    await expect(page.getByTestId("event-audience")).toHaveValue("doctors");

    // …which the editor may override; the override is what is saved.
    await page.getByTestId("event-kind").selectOption({ label: "Вебинар" });
    await page.getByTestId("event-audience").selectOption("experts");
    await page.getByTestId("submit-event").click();
    await page.waitForURL(/\/events\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await page.reload();
    await expect(page.getByTestId("event-audience")).toHaveValue("experts");
  });

  test("012 EARS-30: the create-project form shows the default-audience hint the edit form shows; the required error takes its slot until an audience is chosen", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/projects/create");
    await page.getByTestId("project-form").waitFor({ state: "visible" });
    const hint = page.getByText(
      "Подставляется в новые мероприятия проекта; у каждого мероприятия её можно изменить. Смена здесь не меняет уже созданные мероприятия.",
    );
    await expect(hint).toBeVisible();

    // ADR-0013 §7 inline message: the error swaps into the helper's place…
    await page.getByTestId("submit-project").click();
    await expect(page.getByTestId("project-default-audience")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(hint).toHaveCount(0);
    // …and the hint returns once the audience is chosen.
    await chooseProjectDefaultAudience(page, "doctors");
    await expect(hint).toBeVisible();
  });
});
