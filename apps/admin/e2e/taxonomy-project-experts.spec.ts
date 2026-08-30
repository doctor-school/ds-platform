import { expect, test, type Page } from "@playwright/test";
import { bootstrapAdminSession } from "./support/admin-session";
import { totpCode } from "./support/totp";

/**
 * 012 EARS-9 (#1291), browser half — the REAL Refine → NestJS → Postgres path for
 * the project↔expert relationship editor and the curator seat.
 *
 * `apps/api/test/taxonomy/project-experts.e2e-spec.ts` proves the contract at the
 * API. This proves the OPERATOR-facing arc, which no API test can: that the panel
 * REFUSES to offer a second curator instead of letting the operator discover the
 * 409, that «Заменить куратора» is the way through and does the demote+promote as
 * ONE act, that the same panel authors from either endpoint, and that a retired
 * link comes back as the SAME row.
 *
 * Dev-stand-gated + MANUAL like every other `apps/admin/e2e` flow spec. Run
 * against a booted admin + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3201 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     e2e/taxonomy-project-experts.spec.ts --config=playwright.flows.config.ts
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

/** A draft expert authored through the current structured-name form. */
async function createExpert(
  page: Page,
  familyName: string,
  givenName: string,
  patronymic: string,
): Promise<{ name: string; url: string }> {
  await page.goto("/experts/create");
  await page.getByTestId("expert-family-name").fill(familyName);
  await page.getByTestId("expert-given-name").fill(givenName);
  await page.getByTestId("expert-patronymic").fill(patronymic);
  await page.getByTestId("submit-expert").click();
  await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return {
    name: `${familyName} ${givenName} ${patronymic}`,
    url: page.url(),
  };
}

/** Open the «Эксперты» tab of a project detail and wait for the panel. */
async function openExpertsTab(page: Page, projectUrl: string): Promise<void> {
  await page.goto(projectUrl);
  await page.getByTestId("tab-experts").click();
  await page.getByTestId("project-experts-panel").waitFor({ state: "visible" });
}

/** Link one expert to the open project with the given role. */
async function linkExpert(
  page: Page,
  expertName: string,
  role: "curator" | "member",
): Promise<void> {
  // The API narrows by a recognizable name token; the option label remains the
  // authoritative structured full name selected below.
  await page
    .getByTestId("project-expert-link-search")
    .fill(expertName.split(" ")[0]!);
  await page
    .getByTestId("project-expert-link-select")
    .selectOption({ label: expertName });
  await page.getByTestId("project-expert-link-role").selectOption(role);
  await page.getByTestId("project-expert-link-submit").click();
  await expect(page.getByTestId("project-experts-notice")).toContainText(
    "Эксперт добавлен в проект.",
  );
}

test.describe.configure({ mode: "serial" });

test.describe("012 EARS-9 — project↔expert relationships in the live admin", () => {
  test("EARS-22: an operator authors a project↔expert link from the expert endpoint through the same relationship panel", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    const stamp = Date.now();
    const expert = await createExpert(
      page,
      `Обратный-${stamp}`,
      "Эксперт",
      "Ильич",
    );
    const project = await createProject(
      page,
      `Обратный экспертный проект ${stamp}`,
    );

    await page.goto(expert.url);
    await page.getByTestId("tab-projects").click();
    await page.getByTestId("project-expert-link-search").fill(project.title);
    await page
      .getByTestId("project-expert-link-select")
      .selectOption({ label: project.title });
    await page.getByTestId("project-expert-link-role").selectOption("member");
    await page.getByTestId("project-expert-link-submit").click();

    await expect(page.getByTestId("project-experts-notice")).toContainText(
      "Эксперт добавлен в проект.",
    );
    await expect(page.getByTestId("project-experts-panel")).toContainText(
      project.title,
    );
  });

  test("EARS-22: the expert endpoint withholds curator when the selected project already has one", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    const stamp = Date.now();
    const project = await createProject(
      page,
      `Занятый куратор проект ${stamp}`,
    );
    const incumbent = await createExpert(
      page,
      `Иванов-${stamp}`,
      "Текущий",
      "Куратор",
    );
    const candidate = await createExpert(
      page,
      `Петров-${stamp}`,
      "Новый",
      "Эксперт",
    );
    await openExpertsTab(page, project.url);
    await linkExpert(page, incumbent.name, "curator");

    await page.goto(candidate.url);
    await page.getByTestId("tab-projects").click();
    await page.getByTestId("project-expert-link-search").fill(project.title);
    await page
      .getByTestId("project-expert-link-select")
      .selectOption({ label: project.title });

    await expect(
      page
        .getByTestId("project-expert-link-role")
        .locator('option[value="curator"]'),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("project-expert-link-seat-taken"),
    ).toContainText("Заменить куратора");
    await page.getByTestId("project-expert-link-submit").click();
    await expect(page.getByTestId("project-experts-notice")).toContainText(
      "Эксперт добавлен в проект.",
    );
    const reverseRow = page
      .getByTestId("project-experts-panel")
      .locator('[data-testid^="project-expert-row-"]')
      .filter({ hasText: project.title });
    const reverseRowId = (await reverseRow.getAttribute(
      "data-testid",
    ))!.replace("project-expert-row-", "");
    await expect(
      page.getByTestId(`project-expert-role-curator-${reverseRowId}`),
    ).toBeDisabled();
    await expect(
      page.getByTestId(`project-expert-row-seat-taken-${reverseRowId}`),
    ).toContainText("Заменить куратора");
  });

  test("EARS-22: the expert endpoint blocks restoring a retired curator while another row holds the seat", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    const stamp = Date.now();
    const project = await createProject(page, `Возврат куратора ${stamp}`);
    const retired = await createExpert(
      page,
      `Старый-${stamp}`,
      "Куратор",
      "Ильич",
    );
    const incumbent = await createExpert(
      page,
      `Новый-${stamp}`,
      "Куратор",
      "Ильич",
    );
    await openExpertsTab(page, project.url);
    await linkExpert(page, retired.name, "curator");
    const retiredRow = page
      .getByTestId("project-experts-panel")
      .locator('[data-testid^="project-expert-row-"]')
      .filter({ hasText: retired.name });
    const retiredRowId = (await retiredRow.getAttribute(
      "data-testid",
    ))!.replace("project-expert-row-", "");
    await page.getByTestId(`project-expert-retire-${retiredRowId}`).click();
    await linkExpert(page, incumbent.name, "curator");

    await page.goto(retired.url);
    await page.getByTestId("tab-projects").click();
    await page
      .getByTestId("project-experts-show-retired")
      .locator("xpath=ancestor::label[1]")
      .click();
    await expect(
      page.getByTestId(`project-expert-restore-${retiredRowId}`),
    ).toBeDisabled();
    await expect(
      page.getByTestId(`project-expert-row-seat-taken-${retiredRowId}`),
    ).toContainText("Заменить куратора");
  });

  test("012 EARS-9: an operator composes a project roster, and the curator seat can only be moved by the atomic replace", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    const stamp = Date.now();
    const project = await createProject(page, `Роль проект ${stamp}`);
    const curator = await createExpert(
      page,
      `Иванов-${stamp}`,
      "Куратор",
      "Петрович",
    );
    const member = await createExpert(
      page,
      `Петров-${stamp}`,
      "Участник",
      "Иванович",
    );

    // ── The tab starts empty and says the no-delete rule out loud ──────────
    await openExpertsTab(page, project.url);
    await expect(page.getByTestId("project-experts-empty")).toBeVisible();
    await expect(page.getByTestId("project-experts-panel")).toContainText(
      "Связи не удаляются",
    );

    // ── The first curator is an ordinary link: the seat is free ────────────
    // The search narrows SERVER-SIDE (`?q=`), so the option list is the API's
    // answer, not a client-side filter over one page of rows.
    await linkExpert(page, curator.name, "curator");
    await expect(page.getByTestId("project-experts-panel")).toContainText(
      curator.name,
    );
    await expect(page.getByTestId("project-experts-panel")).toContainText(
      "Куратор",
    );

    // ── The seat is now taken, and the panel REFUSES to offer a second one ──
    // This is the assertion the API test cannot make: the operator is told what
    // to do instead («Заменить куратора»), rather than being allowed to send a
    // request whose only possible answer is 409.
    await page
      .getByTestId("project-expert-link-search")
      .fill(member.name.split(" ")[0]!);
    await page
      .getByTestId("project-expert-link-select")
      .selectOption({ label: member.name });
    await expect(
      page
        .getByTestId("project-expert-link-role")
        .locator('option[value="curator"]'),
    ).toBeDisabled();
    await expect(
      page.getByTestId("project-expert-link-seat-taken"),
    ).toContainText("Заменить куратора");
    await page.getByTestId("project-expert-link-role").selectOption("member");
    await page.getByTestId("project-expert-link-submit").click();
    await expect(page.getByTestId("project-experts-notice")).toContainText(
      "Эксперт добавлен в проект.",
    );

    // The per-row promotion is disabled for the same reason, on the same fact.
    const memberRow = page
      .getByTestId("project-experts-panel")
      .locator('[data-testid^="project-expert-row-"]')
      .filter({ hasText: member.name });
    await expect(
      memberRow.locator('[data-testid^="project-expert-role-curator-"]'),
    ).toBeDisabled();

    // ── «Заменить куратора» — ONE act, both roles move ─────────────────────
    await expect(
      page.getByTestId("project-curator-replace-form"),
    ).toContainText(curator.name);
    await page
      .getByTestId("project-curator-replace-select")
      .selectOption({ label: member.name });
    await page.getByTestId("project-curator-replace-submit").click();
    await expect(page.getByTestId("project-experts-notice")).toContainText(
      "Куратор заменён.",
    );

    // The former curator is now a member and the former member is the curator —
    // read back off the RENDERED rows, not off the request we sent.
    await expect(
      page
        .getByTestId("project-experts-panel")
        .locator('[data-testid^="project-expert-row-"]')
        .filter({ hasText: curator.name }),
    ).toContainText("Участник");
    await expect(
      page
        .getByTestId("project-experts-panel")
        .locator('[data-testid^="project-expert-row-"]')
        .filter({ hasText: member.name }),
    ).toContainText("Куратор");
  });

  test("012 EARS-9: a retired link comes back as the SAME row, and the expert detail reads the relation", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    const stamp = Date.now();
    const project = await createProject(page, `Возврат проект ${stamp}`);
    const expert = await createExpert(
      page,
      `Сидоров-${stamp}`,
      "Возврат",
      "Ильич",
    );

    await openExpertsTab(page, project.url);
    await linkExpert(page, expert.name, "member");

    const row = page
      .getByTestId("project-experts-panel")
      .locator('[data-testid^="project-expert-row-"]')
      .filter({ hasText: expert.name });
    const rowId = (await row.getAttribute("data-testid"))!.replace(
      "project-expert-row-",
      "",
    );

    // ── Retire: the row leaves the active list but not the system ──────────
    await page.getByTestId(`project-expert-retire-${rowId}`).click();
    await expect(page.getByTestId("project-experts-notice")).toContainText(
      "Связь снята.",
    );
    await expect(page.getByTestId("project-experts-empty")).toBeVisible();

    // ── Restore: the SAME id comes back, which is what "не удаляются" means ─
    await page
      .getByTestId("project-experts-show-retired")
      .locator("xpath=ancestor::label[1]")
      .click();
    await expect(page.getByTestId("project-experts-retired")).toContainText(
      expert.name,
    );
    await page.getByTestId(`project-expert-restore-${rowId}`).click();
    await expect(page.getByTestId("project-experts-notice")).toContainText(
      "Связь возвращена.",
    );
    await expect(page.getByTestId(`project-expert-row-${rowId}`)).toBeVisible();

    // ── The expert side reads the same fact and keeps authoring available ──
    await page.goto(expert.url);
    await page.getByTestId("tab-projects").click();
    await page
      .getByTestId("project-experts-panel")
      .waitFor({ state: "visible" });
    await expect(page.getByTestId("project-experts-panel")).toContainText(
      project.title,
    );
    await expect(page.getByTestId("project-expert-link-form")).toBeVisible();
    await expect(page.getByTestId("project-curator-replace-form")).toHaveCount(
      0,
    );
  });
});
