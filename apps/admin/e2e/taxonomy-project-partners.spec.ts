import { expect, test, type Page } from "@playwright/test";
import { bootstrapAdminSession } from "./support/admin-session";
import { totpCode } from "./support/totp";

/**
 * 012 EARS-10 (#1292), browser half — the REAL Refine → NestJS → Postgres path
 * for the project↔partner relationship editor and the «основной партнёр» flag.
 *
 * `apps/api/test/taxonomy/project-partners.e2e-spec.ts` proves the contract at
 * the API. This proves the OPERATOR-facing arc: that the panel never offers a
 * second primary (the flag is CLEARED and then SET, two visible audited acts, not
 * one control that silently demotes a sponsor), that the refusal — when it is
 * reached — says which fact is in the way instead of the generic «такая связь уже
 * есть», and that the same panel authors the relation from either endpoint.
 *
 * Dev-stand-gated + MANUAL like every other `apps/admin/e2e` flow spec. Run
 * against a booted admin + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3201 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     e2e/taxonomy-project-partners.spec.ts --config=playwright.flows.config.ts
 */
const ORIGIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3200";

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

/** A real project row; returns its title and detail URL. */
async function createProject(
  page: Page,
  title: string,
): Promise<{ title: string; url: string }> {
  await page.goto("/projects/create");
  await page.getByTestId("project-form").waitFor({ state: "visible" });
  await page.locator("#title").fill(title);
  await page.locator("#description").fill("Описание для проверки связей.");
  await page.getByTestId("submit-project").click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return { title, url: page.url() };
}

/** A draft partner — the title is the only value the create form demands. */
async function createPartner(
  page: Page,
  title: string,
): Promise<{ title: string; url: string }> {
  await page.goto("/partners/create");
  await page.getByTestId("partner-title").fill(title);
  await page.getByTestId("submit-partner").click();
  await page.waitForURL(/\/partners\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return { title, url: page.url() };
}

/** Open the «Партнёры» tab of a project detail and wait for the panel. */
async function openPartnersTab(page: Page, projectUrl: string): Promise<void> {
  await page.goto(projectUrl);
  await page.getByTestId("tab-partners").click();
  await page
    .getByTestId("project-partners-panel")
    .waitFor({ state: "visible" });
}

/** Link one partner to the open project; `primary` uses the create-form flag. */
async function linkPartner(
  page: Page,
  partnerTitle: string,
  primary: boolean,
): Promise<void> {
  await page.getByTestId("project-partner-link-search").fill(partnerTitle);
  await page
    .getByTestId("project-partner-link-select")
    .selectOption({ label: partnerTitle });
  if (primary) {
    await page
      .getByTestId("project-partner-link-primary")
      .locator("xpath=ancestor::label[1]")
      .click();
  }
  await page.getByTestId("project-partner-link-submit").click();
  await expect(page.getByTestId("project-partners-notice")).toContainText(
    "Партнёр добавлен к проекту.",
  );
}

test.describe.configure({ mode: "serial" });

test.describe("012 EARS-10 — project↔partner relationships in the live admin", () => {
  test("EARS-22: an operator authors a project↔partner link from the partner endpoint through the same relationship panel", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    const stamp = Date.now();
    const partner = await createPartner(page, `Обратный партнёр ${stamp}`);
    const project = await createProject(
      page,
      `Обратный партнёрский проект ${stamp}`,
    );

    await page.goto(partner.url);
    await page.getByTestId("tab-projects").click();
    await page.getByTestId("project-partner-link-search").fill(project.title);
    await page
      .getByTestId("project-partner-link-select")
      .selectOption({ label: project.title });
    await page.getByTestId("project-partner-link-submit").click();

    await expect(page.getByTestId("project-partners-notice")).toContainText(
      "Партнёр добавлен к проекту.",
    );
    await expect(page.getByTestId("project-partners-panel")).toContainText(
      project.title,
    );
  });

  test("EARS-22: the partner endpoint withholds primary when the selected project already has one", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    const stamp = Date.now();
    const project = await createProject(
      page,
      `Занятый партнёр проект ${stamp}`,
    );
    const incumbent = await createPartner(page, `Основной Фармаком ${stamp}`);
    const candidate = await createPartner(page, `Новый Биотек ${stamp}`);
    await openPartnersTab(page, project.url);
    await linkPartner(page, incumbent.title, true);

    await page.goto(candidate.url);
    await page.getByTestId("tab-projects").click();
    await page.getByTestId("project-partner-link-search").fill(project.title);
    await page
      .getByTestId("project-partner-link-select")
      .selectOption({ label: project.title });

    await expect(
      page.getByTestId("project-partner-link-primary-taken"),
    ).toContainText("Сначала снимите отметку");
    await expect(page.getByTestId("project-partner-link-primary")).toHaveCount(
      0,
    );
    await page.getByTestId("project-partner-link-submit").click();
    await expect(page.getByTestId("project-partners-notice")).toContainText(
      "Партнёр добавлен к проекту.",
    );
    const reverseRow = page
      .getByTestId("project-partners-panel")
      .locator('[data-testid^="project-partner-row-"]')
      .filter({ hasText: project.title });
    const reverseRowId = (await reverseRow.getAttribute(
      "data-testid",
    ))!.replace("project-partner-row-", "");
    await expect(
      page.getByTestId(`project-partner-primary-toggle-${reverseRowId}`),
    ).toBeDisabled();
    await expect(
      page.getByTestId(`project-partner-row-primary-taken-${reverseRowId}`),
    ).toContainText("Сначала снимите отметку");
  });

  test("EARS-22: the partner endpoint blocks restoring a retired primary while another row holds the flag", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    const stamp = Date.now();
    const project = await createProject(page, `Возврат основного ${stamp}`);
    const retired = await createPartner(page, `Старый основной ${stamp}`);
    const incumbent = await createPartner(page, `Новый основной ${stamp}`);
    await openPartnersTab(page, project.url);
    await linkPartner(page, retired.title, true);
    const retiredRow = page
      .getByTestId("project-partners-panel")
      .locator('[data-testid^="project-partner-row-"]')
      .filter({ hasText: retired.title });
    const retiredRowId = (await retiredRow.getAttribute(
      "data-testid",
    ))!.replace("project-partner-row-", "");
    await page.getByTestId(`project-partner-retire-${retiredRowId}`).click();
    await linkPartner(page, incumbent.title, true);

    await page.goto(retired.url);
    await page.getByTestId("tab-projects").click();
    await page
      .getByTestId("project-partners-show-retired")
      .locator("xpath=ancestor::label[1]")
      .click();
    await expect(
      page.getByTestId(`project-partner-restore-${retiredRowId}`),
    ).toBeDisabled();
    await expect(
      page.getByTestId(`project-partner-row-primary-taken-${retiredRowId}`),
    ).toContainText("Сначала снимите отметку");
  });

  test("012 EARS-10: the primary flag is cleared before it is moved, and the panel never offers a second primary", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    const stamp = Date.now();
    const project = await createProject(page, `Партнёры проект ${stamp}`);
    const first = await createPartner(page, `Основной Фармаком ${stamp}`);
    const second = await createPartner(page, `Второй Медтех ${stamp}`);

    // ── The tab starts empty and says the no-delete rule out loud ──────────
    await openPartnersTab(page, project.url);
    await expect(page.getByTestId("project-partners-empty")).toBeVisible();
    await expect(page.getByTestId("project-partners-panel")).toContainText(
      "Связи не удаляются",
    );

    // ── The first partner is added AS primary in one act ───────────────────
    await linkPartner(page, first.title, true);
    const firstRow = page
      .getByTestId("project-partners-panel")
      .locator('[data-testid^="project-partner-row-"]')
      .filter({ hasText: first.title });
    await expect(firstRow).toContainText("Основной");

    // ── The flag is now taken: the create form withholds it entirely ───────
    // The hint names the way through («сначала снимите отметку»), so the operator
    // is never sent at a request whose only possible answer is 409.
    await expect(
      page.getByTestId("project-partner-link-primary-taken"),
    ).toContainText("Сначала снимите отметку");
    await expect(page.getByTestId("project-partner-link-primary")).toHaveCount(
      0,
    );

    await linkPartner(page, second.title, false);
    const secondRow = page
      .getByTestId("project-partners-panel")
      .locator('[data-testid^="project-partner-row-"]')
      .filter({ hasText: second.title });
    const secondId = (await secondRow.getAttribute("data-testid"))!.replace(
      "project-partner-row-",
      "",
    );
    // …and so does the per-row control, on the same fact.
    await expect(
      page.getByTestId(`project-partner-primary-toggle-${secondId}`),
    ).toBeDisabled();

    // ── Clear, then set: two visible acts, each its own audited edit ───────
    const firstId = (await firstRow.getAttribute("data-testid"))!.replace(
      "project-partner-row-",
      "",
    );
    await page.getByTestId(`project-partner-primary-toggle-${firstId}`).click();
    await expect(page.getByTestId("project-partners-notice")).toContainText(
      "Отметка «основной» снята.",
    );
    await page
      .getByTestId(`project-partner-primary-toggle-${secondId}`)
      .click();
    await expect(page.getByTestId("project-partners-notice")).toContainText(
      "Партнёр отмечен основным.",
    );
    await expect(
      secondRow.getByTestId(`project-partner-primary-${secondId}`),
    ).toBeVisible();
    await expect(
      firstRow.getByTestId(`project-partner-primary-${firstId}`),
    ).toHaveCount(0);
  });

  test("012 EARS-10: a retired link comes back as the SAME row, and the partner detail reads the relation", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    const stamp = Date.now();
    const project = await createProject(page, `Возврат партнёры ${stamp}`);
    const partner = await createPartner(page, `Возврат Биотек ${stamp}`);

    await openPartnersTab(page, project.url);
    await linkPartner(page, partner.title, false);

    const row = page
      .getByTestId("project-partners-panel")
      .locator('[data-testid^="project-partner-row-"]')
      .filter({ hasText: partner.title });
    const rowId = (await row.getAttribute("data-testid"))!.replace(
      "project-partner-row-",
      "",
    );

    // ── Retire: the row leaves the active list but not the system ──────────
    await page.getByTestId(`project-partner-retire-${rowId}`).click();
    await expect(page.getByTestId("project-partners-notice")).toContainText(
      "Связь снята.",
    );
    await expect(page.getByTestId("project-partners-empty")).toBeVisible();

    // ── Restore: the SAME id comes back ────────────────────────────────────
    await page
      .getByTestId("project-partners-show-retired")
      .locator("xpath=ancestor::label[1]")
      .click();
    await expect(page.getByTestId("project-partners-retired")).toContainText(
      partner.title,
    );
    await page.getByTestId(`project-partner-restore-${rowId}`).click();
    await expect(page.getByTestId("project-partners-notice")).toContainText(
      "Связь возвращена.",
    );
    await expect(
      page.getByTestId(`project-partner-row-${rowId}`),
    ).toBeVisible();

    // ── The partner side reads the same fact and keeps authoring available ─
    await page.goto(partner.url);
    await page.getByTestId("tab-projects").click();
    await page
      .getByTestId("project-partners-panel")
      .waitFor({ state: "visible" });
    await expect(page.getByTestId("project-partners-panel")).toContainText(
      project.title,
    );
    await expect(page.getByTestId("project-partner-link-form")).toBeVisible();
  });
});
