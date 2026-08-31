import { expect, test, type Page } from "@playwright/test";
import {
  bootstrapAdminSession,
  bootstrapDoctorSession,
  type BootstrapResult,
} from "./support/admin-session";
import { totpCode } from "./support/totp";
import { visible } from "./support/visible";

/**
 * 012 EARS-19/20/23 — real Refine → NestJS → Postgres expert authoring, plus the
 * block-tier expert LIST (#1297): instant search and facets, a removable applied
 * chip with one «Сбросить всё», and a pager whose non-actionable control is
 * disabled rather than dead.
 * Manual dev-stand flow; no mocked directory or mutation response is used.
 */
const ORIGIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3200";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

async function signInAsAdmin(
  page: Page,
  credentials?: BootstrapResult,
): Promise<void> {
  const { email, password } =
    credentials ?? (await bootstrapAdminSession(ORIGIN));
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

async function openExpertCreate(page: Page): Promise<void> {
  await page.goto("/experts/create");
  await page.waitForURL(/\/experts\/create$/);
  await expect(
    page.getByRole("combobox", { name: "Пользователь" }),
  ).toBeEnabled({ timeout: 20_000 });
}

async function selectUser(page: Page, identifier: string): Promise<void> {
  await page.getByRole("combobox", { name: "Пользователь" }).click();
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "Поиск пользователя" })
    .fill(identifier);
  await page.getByText(identifier, { exact: true }).click();
}

async function fillRequiredNames(
  page: Page,
  familyName: string,
  givenName = "Иван",
  patronymic = "Сергеевич",
): Promise<void> {
  await page.getByTestId("expert-family-name").fill(familyName);
  await page.getByTestId("expert-given-name").fill(givenName);
  await page.getByTestId("expert-patronymic").fill(patronymic);
}

test.describe.configure({ mode: "serial" });

test.describe("012 EARS-19/20 — Expert authoring", () => {
  test("EARS-20: structured names reject and accept, slug stays server-owned, and the generated public link copies", async ({
    page,
    context,
  }) => {
    await signInAsAdmin(page);
    await openExpertCreate(page);

    // Reject every changed free-text kind: both required boxes and the shared
    // 80-character name-part bound render RU inline before a request leaves.
    await page.getByTestId("submit-expert").click();
    await expect(page.getByText("Обязательное поле.")).toHaveCount(2);
    await fillRequiredNames(
      page,
      "Я".repeat(81),
      "И".repeat(81),
      "О".repeat(81),
    );
    await page.getByTestId("submit-expert").click();
    await expect(
      page.getByText("Слишком длинное значение — сократите текст."),
    ).toHaveCount(3);

    // Accept Cyrillic names (no mask), optional patronymic, and a standalone
    // Expert: the closed User selector remains deliberately empty.
    const familyName = `Петров-${Date.now()}`;
    await fillRequiredNames(page, familyName, "Иван", "Сергеевич");
    await expect(page.getByTestId("expert-slug")).toHaveCount(0);
    await expect(page.getByTestId("expert-public-link-note")).toContainText(
      "Адрес сгенерирует сервер",
    );
    await page.getByTestId("submit-expert").click();
    await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    await expect(page.getByTestId("expert-heading")).toContainText(familyName);
    await expect(page.getByTestId("expert-status")).toHaveText("Черновик");
    await expect(page.getByTestId("expert-initials")).toHaveText("ПИ");
    await expect(page.getByTestId("expert-slug")).toHaveCount(0);
    const publicUrl = await page.getByTestId("expert-public-link").innerText();
    expect(publicUrl).toMatch(
      /^https:\/\/academy\.doctor\.school\/experts\/petrov-/,
    );

    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: ORIGIN,
    });
    await page.getByTestId("expert-copy-public-link").click();
    await expect(page.getByTestId("expert-copy-public-link")).toHaveText(
      "Ссылка скопирована",
    );
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(publicUrl);

    // Latin is equally valid free name text, and the retained MediaDropzone still
    // rejects a non-image in the browser.
    await page.getByTestId("expert-family-name").fill("Petrov-Smirnov");
    await page.getByTestId("submit-expert").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.setInputFiles("#photo", {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });
    await expect(page.getByTestId("expert-photo-error")).toBeVisible();
    await page.setInputFiles("#photo", {
      name: "photo.png",
      mimeType: "image/png",
      buffer: PNG_1x1,
    });
    await expect(page.getByAltText("Фото эксперта")).toBeVisible();
  });

  test("EARS-23: the expert list applies search and facets instantly, and one control undoes them", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    // A row the search can actually find — created through the real form, so
    // this asserts the list against a record the API just produced.
    await openExpertCreate(page);
    const familyName = `Списочный-${Date.now()}`;
    await fillRequiredNames(page, familyName);
    await page.getByTestId("submit-expert").click();
    await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    // ── Reach the list through the chrome, not by typing a URL ─────────────
    await page.getByTestId("nav-experts").click();
    await page.waitForURL(/\/experts$/, { timeout: 20_000 });
    await expect(page.getByTestId("experts-filters")).toBeVisible();
    // The retired-rows toggle is OFF by default (Stage-A answer 4).
    await expect(page.getByTestId("experts-include-retired")).not.toBeChecked();
    // EARS-16: single-action list ⇒ the ROW is the action, so no «Действия».
    await expect(
      page.getByRole("columnheader", { name: "Действия" }),
    ).toHaveCount(0);

    // ── EARS-23: typing IS the gesture — no Enter, no «Применить» ──────────
    await page.getByRole("searchbox", { name: "Поиск" }).fill(familyName);
    await expect(
      page.getByRole("button", { name: "Применить", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId("experts-table")).toContainText(familyName);
    await expect(page.getByText("Выбрано:", { exact: false })).toBeVisible();
    await expect(page.getByTestId("experts-total")).toBeVisible();

    // ── EARS-23: the state facet applies on change, not on submit ──────────
    await page.getByTestId("experts-status").selectOption("published");
    // The draft just created leaves the result set the moment the facet moves.
    await expect(page.getByTestId("experts-table")).not.toContainText(
      familyName,
    );

    // ── EARS-23: ONE control clears the whole applied set ─────────────────
    // Exactly one in the toolbar. (The empty state, when the facet leaves no
    // rows, offers the same reset as its own way out — that is the way OUT of
    // an empty result, not a second toolbar control.)
    const expertsResetAll = page
      .getByTestId("experts-filters")
      .getByRole("button", { name: "Сбросить всё" });
    await expect(expertsResetAll).toHaveCount(1);
    await expertsResetAll.click();
    await expect(page.getByText("Выбрано:", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("searchbox", { name: "Поиск" })).toHaveValue(
      "",
    );
    await expect(page.getByTestId("experts-status")).toHaveValue("");

    // ── EARS-23: no dead-end pager ─────────────────────────────────────────
    // The DS `Pagination` block omits «Назад» on the first page and the whole
    // pager while there is a single page, rather than rendering a focusable
    // control that does nothing.
    await expect(
      page.getByRole("button", { name: "Назад", exact: true }),
    ).toHaveCount(0);

    // ── EARS-16: the whole ROW opens the record ───────────────────────────
    await page.getByRole("searchbox", { name: "Поиск" }).fill(familyName);
    await visible(
      page.getByTestId("experts-table").getByText(familyName, { exact: false }),
    ).click();
    await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(page.getByTestId("expert-heading")).toContainText(familyName);
  });

  test("EARS-19: an existing User links explicitly, duplicate ownership returns RU 409, and unlink persists", async ({
    page,
    context,
  }) => {
    const candidate = await bootstrapDoctorSession(ORIGIN);
    const admin = await bootstrapAdminSession(ORIGIN);
    await signInAsAdmin(page, admin);

    // Closing an already-empty server-backed selector repeats the empty query.
    // It must remain the settled no-User value instead of entering a loading
    // state that no changed query can complete (#1626).
    await openExpertCreate(page);
    const emptyUserSelector = page.getByRole("combobox", {
      name: "Пользователь",
    });
    await emptyUserSelector.click();
    await page.keyboard.press("Escape");
    await expect(emptyUserSelector).toContainText("Без учётной записи");
    await expect(emptyUserSelector).toBeEnabled();

    // Open two forms before either mutation: both receive the same eligible User.
    // The second becomes intentionally stale after the first link and exercises
    // the real transaction-level duplicate-owner refusal.
    const stalePage = await context.newPage();
    await openExpertCreate(stalePage);

    await fillRequiredNames(page, `Связанный-${Date.now()}`);
    await selectUser(page, candidate.email);
    await expect(page.getByTestId("expert-user-unlink")).toBeVisible();
    await fillRequiredNames(
      stalePage,
      `Конфликт-${Date.now()}`,
      "Мария",
      "Ивановна",
    );
    await selectUser(stalePage, candidate.email);

    await page.getByTestId("submit-expert").click();
    await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await stalePage.getByTestId("submit-expert").click();
    await expect(stalePage.getByTestId("create-error")).toContainText(
      "Этот пользователь уже связан с другим экспертом. Ничего не изменилось — обновите страницу и выберите другого.",
    );
    await expect(stalePage).toHaveURL(/\/experts\/create$/);

    await page.getByTestId("expert-user-unlink").click();
    await expect(page.getByTestId("expert-user-unlink")).toHaveCount(0);
    await page.getByTestId("submit-expert").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Пользователь" }),
    ).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByTestId("expert-user-unlink")).toHaveCount(0);
  });

  test("EARS-23: the operator explicitly loads page 2 and selects its eligible User", async ({
    page,
  }) => {
    const searchPrefix = `page-${Date.now()}`;
    const candidates = await Promise.all(
      Array.from({ length: 26 }, () =>
        bootstrapDoctorSession(ORIGIN, searchPrefix),
      ),
    );
    const candidateEmails = candidates.map((candidate) => candidate.email);
    await signInAsAdmin(page);
    await openExpertCreate(page);

    const selector = page.getByRole("combobox", { name: "Пользователь" });
    await selector.click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("combobox", { name: "Поиск пользователя" })
      .fill(searchPrefix);
    const loadMore = page.getByRole("button", {
      name: "Загрузить ещё пользователей",
    });
    await expect(loadMore).toBeVisible({ timeout: 20_000 });

    // The page-2 candidate is READ OFF page 1 rather than predicted from a
    // client-side sort (#1669). The picker orders by `displayName → identifier →
    // id` under the database's own collation; the spec used to guess the last
    // row by `Array.sort(localeCompare)`, which disagrees with that collation on
    // the hyphens these generated addresses are full of, so the "candidate" it
    // named was frequently already on page 1 and the assertion that it appears
    // after «Загрузить ещё» could never pass. Whichever seeded address page 1
    // did NOT render is, by definition, behind the pagination — that is the
    // subject, and it is exact regardless of how the server sorts.
    const pageOneRendering = await dialog.innerText();
    const pageTwoCandidate = candidateEmails.find(
      (email) => !pageOneRendering.includes(email),
    );
    if (!pageTwoCandidate) {
      throw new Error(
        "every seeded candidate rendered on page 1 — the seed no longer exceeds one picker page",
      );
    }
    await expect(page.getByText(pageTwoCandidate, { exact: true })).toHaveCount(
      0,
    );

    await loadMore.click();
    await expect(
      page.getByText(pageTwoCandidate, { exact: true }),
    ).toBeVisible();
    await page.getByText(pageTwoCandidate, { exact: true }).click();
    await expect(page.getByTestId("expert-user-unlink")).toBeVisible();
    await expect(selector).toContainText(pageTwoCandidate);

    await fillRequiredNames(page, `Страница-${Date.now()}`);
    await page.getByTestId("submit-expert").click();
    await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: /Пользователь/ }),
    ).toContainText(pageTwoCandidate, { timeout: 20_000 });
  });

  /**
   * 012 EARS-5 (#1287), expert half — the REFUSE-then-accept arc, which is the
   * one an operator actually meets: a card is created from names alone, and the
   * public projection needs four more fields (012-design §5.2 —
   * `professionalRole`, `credentials`, `affiliation`, `bio`).
   *
   * The refusal leg is the point of this spec. The server answers
   * `PUBLISH_REQUIREMENTS_NOT_MET`, and what must reach the screen is the RU
   * sentence NAMING the missing fields and where to fill them — never the wire
   * code, and never the generic «проверьте поля», which would send the operator
   * hunting through a form where nothing is wrong, only empty. The card must
   * still be a draft afterwards: a refused publish changes nothing.
   */
  test("012 EARS-5: an incomplete expert is refused with the RU sentence naming what is missing, and publishes once it is complete", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    // ── A card with names and nothing else: valid to CREATE, not to publish ──
    const familyName = `Публикационов-${Date.now()}`;
    await openExpertCreate(page);
    await fillRequiredNames(page, familyName);
    await page.getByTestId("submit-expert").click();
    await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const detailUrl = page.url();
    await expect(page.getByTestId("expert-status")).toHaveText("Черновик");

    // ── Refuse: the sentence names the fields, and the state does not move ───
    await page.getByTestId("tab-publish").click();
    await expect(page.getByTestId("experts-publish")).toBeVisible();
    await page.getByTestId("experts-publish").click();
    const refusal = page.getByTestId("publish-error");
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText("должность");
    await expect(refusal).toContainText("биография");
    // No wire code ever reaches the operator.
    await expect(refusal).not.toContainText("PUBLISH_REQUIREMENTS_NOT_MET");
    // Nothing changed: still a draft, still offering the same command.
    await expect(page.getByTestId("expert-status")).toHaveText("Черновик");
    await expect(page.getByTestId("experts-publish")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("expert-status")).toHaveText("Черновик");

    // ── Complete the public projection on «Основное», then publish ───────────
    await page.getByTestId("tab-main").click();
    await page.getByTestId("expert-professional-role").fill("Кардиолог");
    await page.getByTestId("expert-credentials").fill("К. м. н.");
    await page
      .getByTestId("expert-affiliation")
      .fill("НМИЦ кардиологии им. акад. Е. И. Чазова");
    await page
      .getByTestId("expert-bio")
      .fill("Ведёт приём и обучает ординаторов более пятнадцати лет.");
    await page.getByTestId("submit-expert").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();

    await page.getByTestId("tab-publish").click();
    await page.getByTestId("experts-publish").click();
    await expect(page.getByTestId("publish-notice")).toBeVisible();
    await expect(page.getByTestId("expert-status")).toHaveText("Опубликован");
    await expect(page.getByTestId("experts-publish")).toHaveCount(0);
    // The SAME record: publishing does not re-create the card or move its address.
    expect(page.url()).toBe(detailUrl);
  });
});
