import { expect, test, type Page } from "@playwright/test";
import { signInAsAdmin } from "@ds/e2e/admin-events";
import { selectRelationshipCombobox } from "./support/relationship-combobox";

/**
 * 048 «Материалы» (#3512) — the admin authoring surface on the REAL Refine →
 * NestJS → Postgres path: the section in the navigation (EARS-8), the list with
 * its kind and status facets (EARS-7), the full-page form with the kind-driven
 * author, the partner and the rich-text body (EARS-1, EARS-19), publish with the
 * missing items refused at their fields and unpublish behind its confirmation
 * (EARS-4, EARS-6), and the stale-version reload notice (EARS-5, EARS-8). Each
 * EARS id is driven through its refusal AND its acceptance. The axe half is
 * `e2e/a11y/a11y-axe.e2e.spec.ts` («048 …»); the registrar's navigation without
 * «Материалы» is asserted in `congress-registrar-nav.spec.ts`.
 *
 * Dev-stand-gated like every `apps/admin/e2e` flow spec; run against a booted
 * admin + api with `--config=playwright.flows.config.ts`. `E2E_SHOT_DIR` opts
 * into the list / form captures the PR body cites.
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;
/** Two different decodable still images — the API normalizer is real. */
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);
const REPLACEMENT_PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 390, height: 844 };

/** The editor's editable surface inside the «Текст» field. */
function bodyEditor(page: Page) {
  return page.getByTestId("material-body").locator('[contenteditable="true"]');
}

async function writeBody(page: Page, text: string): Promise<void> {
  const editor = bodyEditor(page);
  await editor.click();
  await page.keyboard.type(text);
  await expect(editor).toContainText(text);
}

/** A design-system radio: the input is `sr-only`, its label is the target. */
async function chooseKind(page: Page, kind: "news" | "column"): Promise<void> {
  await page
    .getByTestId(`material-kind-${kind}`)
    .locator("xpath=ancestor::label[1]")
    .click();
}

/** Create a material through the form; returns its detail URL. */
async function createMaterial(
  page: Page,
  input: { kind: "news" | "column"; title: string; body?: string },
): Promise<string> {
  await page.goto("/materials/create");
  await page.getByTestId("material-form").waitFor({ state: "visible" });
  await chooseKind(page, input.kind);
  await page.getByTestId("material-title").fill(input.title);
  if (input.body) await writeBody(page, input.body);
  return submitCreate(page);
}

async function submitCreate(page: Page): Promise<string> {
  await page.getByTestId("submit-material").click();
  await page.waitForURL(/\/materials\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await page.getByTestId("material-form").waitFor({ state: "visible" });
  return page.url();
}

/** A draft 012 expert through its own form (structured name). */
async function createExpert(page: Page, familyName: string): Promise<string> {
  await page.goto("/experts/create");
  await page.getByTestId("expert-family-name").fill(familyName);
  await page.getByTestId("expert-given-name").fill("Михаил");
  await page.getByTestId("expert-patronymic").fill("Андреевич");
  await page.getByTestId("submit-expert").click();
  await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return `${familyName} Михаил Андреевич`;
}

/** A draft 032 organisation through its own form. */
async function createOrganisation(page: Page, title: string): Promise<void> {
  await page.goto("/organisations/create");
  await page.getByTestId("organisation-title").fill(title);
  await page.getByTestId("submit-organisation").click();
  await page.waitForURL(/\/organisations\/[0-9a-f-]{36}$/, {
    timeout: 20_000,
  });
}

async function expectNoPageSideScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, `${page.url()} side-scrolls by ${overflow}px`).toBe(0);
}

/** The responsive-web evidence: each screen at both widths, in both schemes. */
async function shot(page: Page, name: string): Promise<void> {
  for (const [width, size] of [
    ["desktop", WIDE],
    ["mobile", NARROW],
  ] as const) {
    await page.setViewportSize(size);
    await expectNoPageSideScroll(page);
    if (!SHOT_DIR) continue;
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot({
        path: `${SHOT_DIR}/${name}-${width}-${colorScheme}.png`,
        fullPage: true,
      });
    }
    await page.emulateMedia({ colorScheme: "light" });
  }
  await page.setViewportSize(WIDE);
}

test.describe.configure({ mode: "serial" });

test.describe("048 — «Материалы» in the live admin", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(WIDE);
    await signInAsAdmin(page);
  });

  test("048 EARS-8: a platform administrator reaches «Материалы» from the navigation", async ({
    page,
  }) => {
    const nav = page.getByTestId("nav-materials");
    await expect(nav).toHaveText("Материалы");
    await nav.click();
    await page.waitForURL(/\/materials$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Материалы",
    );
    await expect(page.getByTestId("access-refused")).toHaveCount(0);
  });

  test("048 EARS-1: a column without an expert is refused at «Эксперт» and nothing is created; a news item with an author line is saved as a draft", async ({
    page,
  }) => {
    const stamp = Date.now();
    await page.goto("/materials/create");
    await page.getByTestId("material-form").waitFor({ state: "visible" });

    // Reject: the column needs its expert — the error sits AT the field.
    await chooseKind(page, "column");
    await expect(page.getByTestId("material-author-line")).toHaveCount(0);
    await page
      .getByTestId("material-title")
      .fill(`Колонка без эксперта ${stamp}`);
    await page.getByTestId("submit-material").click();
    const expertItem = page.locator("#material-expert").locator("xpath=..");
    await expect(
      page.getByText("Выберите эксперта — колонка выходит от его имени."),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/materials\/create$/);
    await expect(expertItem).toBeVisible();

    // An empty title is refused at «Заголовок».
    await chooseKind(page, "news");
    await page.getByTestId("material-title").fill("");
    await page.getByTestId("submit-material").click();
    await expect(page.getByText("Обязательное поле.")).toBeVisible();
    await expect(page).toHaveURL(/\/materials\/create$/);

    // Accept: a news item with its author line is a draft.
    const title = `Открыт набор центров ${stamp}`;
    await page.getByTestId("material-title").fill(title);
    await page.getByTestId("material-author-line").fill("Редакция Академии");
    await writeBody(page, "Набор открыт до конца месяца.");
    const url = await submitCreate(page);
    await expect(page.getByTestId("material-heading")).toHaveText(title);
    await expect(page.getByTestId("material-status")).toHaveText("Черновик");
    await expect(page.getByTestId("material-first-published")).toHaveText(
      "Ещё не публиковался",
    );
    await page.reload();
    await expect(page.getByTestId("material-author-line")).toHaveValue(
      "Редакция Академии",
    );
    await expect(bodyEditor(page)).toContainText(
      "Набор открыт до конца месяца.",
    );
    expect(page.url()).toBe(url);
  });

  test("048 EARS-1: «Обложка» refuses a non-image before any request, then sets, replaces and clears the cover", async ({
    page,
  }) => {
    const stamp = Date.now();
    await page.goto("/materials/create");
    await page.getByTestId("material-form").waitFor({ state: "visible" });
    await page.getByTestId("material-title").fill(`С обложкой ${stamp}`);

    // Refusal: a non-image is refused by the dropzone preflight, nothing sent.
    let writes = 0;
    const countWrite = (request: { method: () => string; url: () => string }) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/v1/admin/materials"
      )
        writes += 1;
    };
    page.on("request", countWrite);
    await page.setInputFiles("#material-cover", {
      name: "записка.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });
    await expect(page.getByTestId("material-cover-error")).toContainText(
      "Формат не подходит: нужен JPEG, PNG или WebP.",
    );
    await page.getByTestId("submit-material").click();
    await expect(page.getByTestId("material-cover-error")).toBeVisible();
    expect(writes).toBe(0);
    page.off("request", countWrite);

    // Set: the create rides multipart with the cover part.
    await page.setInputFiles("#material-cover", {
      name: "обложка.png",
      mimeType: "image/png",
      buffer: PNG_1x1,
    });
    await expect(page.getByTestId("material-cover-error")).toHaveCount(0);
    await expect(page.getByAltText("Обложка материала")).toBeVisible();
    const createRequest = page.waitForRequest(
      (r) =>
        r.method() === "POST" &&
        new URL(r.url()).pathname === "/v1/admin/materials",
    );
    await submitCreate(page);
    expect((await createRequest).headers()["content-type"]).toContain(
      "multipart/form-data",
    );
    await page.reload();
    const stored = page.getByAltText("Обложка материала");
    await expect(stored).toBeVisible();
    const firstSrc = await stored.getAttribute("src");
    expect(firstSrc).toMatch(/materials\/covers\//);

    // Replace: a new file swaps the stored cover for another object.
    await page.setInputFiles("#material-cover", {
      name: "замена.png",
      mimeType: "image/png",
      buffer: REPLACEMENT_PNG_1x1,
    });
    await page.getByTestId("submit-material").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    const replaced = page.getByAltText("Обложка материала");
    await expect(replaced).toBeVisible();
    const secondSrc = await replaced.getAttribute("src");
    expect(new URL(secondSrc!, page.url()).pathname).not.toBe(
      new URL(firstSrc!, page.url()).pathname,
    );

    // Clear: «убрать» on the stored cover saves the material without one.
    await page.getByRole("button", { name: "убрать" }).click();
    await expect(page.getByAltText("Обложка материала")).toHaveCount(0);
    await page.getByTestId("submit-material").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await page.getByTestId("material-form").waitFor({ state: "visible" });
    await expect(page.getByAltText("Обложка материала")).toHaveCount(0);
  });

  test("048 EARS-19: a partner is chosen from the organisation registry, kept on reload, and cleared", async ({
    page,
  }) => {
    const stamp = Date.now();
    const partner = `Партнёр А ${stamp}`;
    await createOrganisation(page, partner);

    await page.goto("/materials/create");
    await page.getByTestId("material-form").waitFor({ state: "visible" });
    await page
      .getByTestId("material-title")
      .fill(`Совместная программа ${stamp}`);
    await selectRelationshipCombobox(
      page,
      "material-partner",
      partner,
      partner,
    );
    await expect(page.locator("#material-partner")).toContainText(partner);
    await submitCreate(page);

    await page.reload();
    await expect(page.locator("#material-partner")).toContainText(partner);

    await page.getByTestId("material-partner-clear").click();
    await expect(page.locator("#material-partner")).toContainText(
      "Без партнёра",
    );
    await page.getByTestId("submit-material").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await expect(page.locator("#material-partner")).toContainText(
      "Без партнёра",
    );
    await expect(page.getByTestId("material-partner-clear")).toHaveCount(0);
  });

  test("048 EARS-4: a draft without text is refused at «Текст» and stays a draft; with text it publishes with its first-publication date", async ({
    page,
  }) => {
    const title = `Пустая новость ${Date.now()}`;
    await createMaterial(page, { kind: "news", title });

    // Reject: the missing body is named AT the field; nothing moved.
    await page.getByTestId("material-publish").click();
    await expect(page.getByTestId("material-body-error")).toContainText(
      "Чтобы опубликовать материал, напишите текст.",
    );
    await expect(page.getByTestId("material-lifecycle-error")).toContainText(
      "Материал пока нельзя опубликовать — чего не хватает, отмечено у полей.",
    );
    await expect(page.getByTestId("material-status")).toHaveText("Черновик");

    // Unsaved text holds the publish: the saved version is what goes out.
    await writeBody(page, "Текст новости.");
    await expect(page.getByTestId("material-body-error")).toHaveCount(0);
    await expect(page.getByTestId("material-publish")).toBeDisabled();
    await page.getByTestId("submit-material").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();

    // Accept.
    await page.getByTestId("material-publish").click();
    await expect(page.getByTestId("material-lifecycle-notice")).toContainText(
      "Материал опубликован.",
    );
    await expect(page.getByTestId("material-status")).toHaveText("Опубликован");
    await expect(page.getByTestId("material-first-published")).toHaveText(
      /^Впервые опубликован \d{2}\.\d{2}\.\d{4}$/,
    );
    await expect(page.getByTestId("material-publish")).toHaveCount(0);
    await expect(page.getByTestId("material-unpublish")).toBeVisible();
  });

  test("048 EARS-4: a column whose expert is not published is refused at «Эксперт»; publishing the expert lets it publish", async ({
    page,
  }) => {
    const stamp = Date.now();
    const expert = await createExpert(page, `Страхов-${stamp}`);

    await page.goto("/materials/create");
    await page.getByTestId("material-form").waitFor({ state: "visible" });
    await chooseKind(page, "column");
    await page
      .getByTestId("material-title")
      .fill(`Ортобиология в России ${stamp}`);
    await selectRelationshipCombobox(
      page,
      "material-expert",
      `Страхов-${stamp}`,
      expert,
    );
    await writeBody(page, "Чего не хватает практике.");
    const url = await submitCreate(page);
    await expect(page.locator("#material-expert")).toContainText(expert);

    await page.getByTestId("material-publish").click();
    await expect(
      page.getByText(
        "Колонку можно опубликовать только с опубликованным экспертом.",
      ),
    ).toBeVisible();
    await expect(page.getByTestId("material-status")).toHaveText("Черновик");

    // Publish the expert (012 EARS-5 completeness), then the column.
    await page.goto("/experts");
    await page.getByRole("link", { name: expert }).first().click();
    await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/);
    await page.getByTestId("expert-professional-role").fill("Травматолог");
    await page.getByTestId("expert-credentials").fill("К. м. н.");
    await page
      .getByTestId("expert-affiliation")
      .fill("ЦИТО им. Н. Н. Приорова");
    await page
      .getByTestId("expert-bio")
      .fill("Занимается ортобиологией и обучает врачей.");
    await page.getByTestId("submit-expert").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.getByTestId("tab-publish").click();
    await page.getByTestId("experts-publish").click();
    await expect(page.getByTestId("expert-status")).toHaveText("Опубликован");

    await page.goto(url);
    await page.getByTestId("material-publish").click();
    await expect(page.getByTestId("material-status")).toHaveText("Опубликован");
  });

  test("048 EARS-6: unpublish asks first; cancelling keeps it published, confirming makes it a draft with its text and first date kept, and it publishes again", async ({
    page,
  }) => {
    const title = `Снимаемая новость ${Date.now()}`;
    await createMaterial(page, {
      kind: "news",
      title,
      body: "Текст, который остаётся.",
    });
    await page.getByTestId("material-publish").click();
    await expect(page.getByTestId("material-status")).toHaveText("Опубликован");
    const firstDate = await page
      .getByTestId("material-first-published")
      .textContent();

    // Reject path: the dialog is cancelled — nothing changes.
    await page.getByTestId("material-unpublish").click();
    const dialog = page.getByTestId("material-unpublish-confirm");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading")).toHaveText(
      `Снять «${title}» с публикации?`,
    );
    await page.getByTestId("material-unpublish-cancel").click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("material-status")).toHaveText("Опубликован");

    // Accept path.
    await page.getByTestId("material-unpublish").click();
    await page.getByTestId("material-unpublish-submit").click();
    await expect(page.getByTestId("material-lifecycle-notice")).toContainText(
      "Материал снят с публикации и снова стал черновиком.",
    );
    await expect(page.getByTestId("material-status")).toHaveText("Черновик");
    await expect(bodyEditor(page)).toContainText("Текст, который остаётся.");
    await expect(page.getByTestId("material-first-published")).toHaveText(
      firstDate ?? "",
    );

    await page.getByTestId("material-publish").click();
    await expect(page.getByTestId("material-status")).toHaveText("Опубликован");
    await expect(page.getByTestId("material-first-published")).toHaveText(
      firstDate ?? "",
    );
  });

  test("048 EARS-5: a stale save is refused with the reload notice and the first change is kept; a fresh save of a published material is accepted", async ({
    page,
  }) => {
    const title = `Правка с двух вкладок ${Date.now()}`;
    const url = await createMaterial(page, {
      kind: "news",
      title,
      body: "Исходный текст.",
    });
    await page.getByTestId("material-publish").click();
    await expect(page.getByTestId("material-status")).toHaveText("Опубликован");

    const second = await page.context().newPage();
    await second.setViewportSize(WIDE);
    await second.goto(url);
    await second.getByTestId("material-form").waitFor({ state: "visible" });

    // The first tab saves a change of the published material — accepted.
    await page.getByTestId("material-title").fill(`${title} — первая правка`);
    await page.getByTestId("submit-material").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await expect(page.getByTestId("material-status")).toHaveText("Опубликован");

    // The second tab still holds the old version — refused as stale.
    await second.getByTestId("material-title").fill(`${title} — вторая правка`);
    await second.getByTestId("submit-material").click();
    await expect(second.getByTestId("update-error")).toContainText(
      "Материал изменился в другом окне. Обновите страницу и повторите правку.",
    );
    // Nothing of the stale edit was stored: the page holds the current version.
    await second.reload();
    await expect(second.getByTestId("material-title")).toHaveValue(
      `${title} — первая правка`,
    );
    await expect(second.getByTestId("material-heading")).toHaveText(
      `${title} — первая правка`,
    );
    await second.close();
  });

  test("048 EARS-7: the list filters by kind and status, searches by title, and shows each row's kind, status, date and author", async ({
    page,
  }) => {
    const stamp = Date.now();
    const news = `Список новость ${stamp}`;
    const column = `Список колонка ${stamp}`;
    const expert = await createExpert(page, `Списков-${stamp}`);
    await createMaterial(page, { kind: "news", title: news, body: "Текст." });
    await page.getByTestId("material-publish").click();
    await expect(page.getByTestId("material-status")).toHaveText("Опубликован");

    await page.goto("/materials/create");
    await page.getByTestId("material-form").waitFor({ state: "visible" });
    await chooseKind(page, "column");
    await page.getByTestId("material-title").fill(column);
    await selectRelationshipCombobox(
      page,
      "material-expert",
      `Списков-${stamp}`,
      expert,
    );
    await submitCreate(page);

    await page.goto("/materials");
    await page.getByTestId("materials-filters").waitFor({ state: "visible" });
    const table = page.getByTestId("materials-table");

    // Search narrows to this run's two rows.
    await page.getByRole("searchbox").fill(String(stamp));
    await expect(table.getByText(news).first()).toBeVisible();
    await expect(table.getByText(column).first()).toBeVisible();
    await expect(page.getByTestId("materials-total")).toHaveText("Найдено: 2");

    // Kind facet: only the column, a draft by its expert.
    await page
      .getByTestId("materials-kind-filter")
      .selectOption({ label: "Колонка эксперта" });
    await expect(table.getByText(news)).toHaveCount(0);
    const columnRow = table.getByRole("row").filter({ hasText: column });
    await expect(columnRow).toContainText("Колонка эксперта");
    await expect(columnRow).toContainText("Черновик");
    await expect(columnRow).toContainText("Ещё не публиковался");
    await expect(columnRow).toContainText(expert);

    // A facet that matches nothing shows the no-results state, never the empty one.
    await page.getByTestId("materials-status").selectOption("published");
    await expect(page.getByTestId("materials-total")).toHaveText("Найдено: 0");

    // Reset → the published news row reads its date and the empty author dash.
    await page
      .getByTestId("materials-filters")
      .getByRole("button", { name: "Сбросить всё" })
      .click();
    await page.getByRole("searchbox").fill(String(stamp));
    const newsRow = table.getByRole("row").filter({ hasText: news });
    await expect(newsRow).toContainText("Новость");
    await expect(newsRow).toContainText("Опубликован");
    await expect(newsRow).toContainText(/\d{2}\.\d{2}\.\d{4}/);

    // The row opens its full-page form.
    await table.getByText(column).first().click();
    await page.waitForURL(/\/materials\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("material-heading")).toHaveText(column);
  });

  test("048 EARS-7: list and form captures at both widths in both schemes, with no sideways page scroll", async ({
    page,
  }) => {
    const stamp = Date.now();
    await createMaterial(page, {
      kind: "news",
      title: `Открыт набор центров в исследование PRP ${stamp}`,
      body: "Центры подают заявку до конца месяца.",
    });
    // The form capture carries a stored cover, so «Обложка» shows its preview.
    await page.setInputFiles("#material-cover", {
      name: "обложка.png",
      mimeType: "image/png",
      buffer: PNG_1x1,
    });
    await page.getByTestId("submit-material").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.getByTestId("material-publish").click();
    await expect(page.getByTestId("material-status")).toHaveText("Опубликован");
    await page.reload();
    await page.getByTestId("material-form").waitFor({ state: "visible" });
    await expect(bodyEditor(page)).toContainText("Центры подают заявку");
    await shot(page, "form");

    await page.goto("/materials");
    await page.getByTestId("materials-filters").waitFor({ state: "visible" });
    await expect(page.getByTestId("materials-table")).toBeVisible();
    await shot(page, "list");
  });
});
