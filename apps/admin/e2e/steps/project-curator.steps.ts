import { expect, type Page } from "@playwright/test";
import { Then, When } from "../support/fixtures";
import { selectRelationshipCombobox } from "../support/relationship-combobox";

async function createProject(page: Page, title: string): Promise<string> {
  await page.goto("/projects/create");
  await page.getByTestId("project-form").waitFor({ state: "visible" });
  await page.locator("#title").fill(title);
  await page.locator("#description").fill("Описание для проверки связей.");
  await page.getByTestId("submit-project").click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return page.url();
}

async function createExpert(
  page: Page,
  familyName: string,
  givenName: string,
  patronymic: string,
): Promise<string> {
  await page.goto("/experts/create");
  await page.getByTestId("expert-family-name").fill(familyName);
  await page.getByTestId("expert-given-name").fill(givenName);
  await page.getByTestId("expert-patronymic").fill(patronymic);
  await page.getByTestId("submit-expert").click();
  await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return `${familyName} ${givenName} ${patronymic}`;
}

async function openExpertsTab(page: Page, projectUrl: string): Promise<void> {
  await page.goto(projectUrl);
  await page.getByTestId("tab-experts").click();
  await page.getByTestId("project-experts-panel").waitFor({ state: "visible" });
}

async function linkSelectedExpert(
  page: Page,
  expertName: string,
  role: "curator" | "member",
): Promise<void> {
  await selectRelationshipCombobox(
    page,
    "project-expert-link-combobox",
    expertName.split(" ")[0]!,
    expertName,
  );
  await page.getByTestId("project-expert-link-role").selectOption(role);
  await page.getByTestId("project-expert-link-submit").click();
  await expect(page.getByTestId("project-experts-notice")).toContainText(
    "Эксперт добавлен в проект.",
  );
}

function roster(world: {
  projectRoster?: {
    projectUrl: string;
    curatorName: string;
    memberName: string;
  };
}) {
  if (!world.projectRoster) throw new Error("Project roster was not authored");
  return world.projectRoster;
}

When(
  "the operator creates a draft project and two draft Experts for its roster",
  async ({ page, world }) => {
    const stamp = Date.now();
    const projectUrl = await createProject(page, `Роль проект ${stamp}`);
    const curatorName = await createExpert(
      page,
      `Иванов-${stamp}`,
      "Куратор",
      "Петрович",
    );
    const memberName = await createExpert(
      page,
      `Петров-${stamp}`,
      "Участник",
      "Иванович",
    );
    world.projectRoster = { projectUrl, curatorName, memberName };
    await openExpertsTab(page, projectUrl);
  },
);

Then(
  "the project's Expert roster is empty and explains that links are retained",
  async ({ page }) => {
    await expect(page.getByTestId("project-experts-empty")).toBeVisible();
    await expect(page.getByTestId("project-experts-panel")).toContainText(
      "Связи не удаляются",
    );
  },
);

When(
  "the operator assigns the first Expert as curator",
  async ({ page, world }) => {
    await linkSelectedExpert(page, roster(world).curatorName, "curator");
  },
);

Then(
  "that Expert appears as the project's curator",
  async ({ page, world }) => {
    const { curatorName } = roster(world);
    const curatorRow = page
      .getByTestId("project-experts-panel")
      .locator('[data-testid^="project-expert-row-"]')
      .filter({ hasText: curatorName });
    await expect(curatorRow).toContainText("Куратор");
  },
);

When(
  "the operator selects the second Expert while the curator seat is occupied",
  async ({ page, world }) => {
    const { memberName } = roster(world);
    await selectRelationshipCombobox(
      page,
      "project-expert-link-combobox",
      memberName.split(" ")[0]!,
      memberName,
    );
  },
);

Then(
  "a second curator role is unavailable and the Admin directs the operator to replace the curator",
  async ({ page }) => {
    await expect(
      page
        .getByTestId("project-expert-link-role")
        .locator('option[value="curator"]'),
    ).toBeDisabled();
    await expect(
      page.getByTestId("project-expert-link-seat-taken"),
    ).toContainText("Заменить куратора");
  },
);

When("the operator adds the second Expert as a member", async ({ page }) => {
  await page.getByTestId("project-expert-link-role").selectOption("member");
  await page.getByTestId("project-expert-link-submit").click();
  await expect(page.getByTestId("project-experts-notice")).toContainText(
    "Эксперт добавлен в проект.",
  );
});

Then(
  "direct promotion of that member to curator is unavailable",
  async ({ page, world }) => {
    const { memberName } = roster(world);
    const memberRow = page
      .getByTestId("project-experts-panel")
      .locator('[data-testid^="project-expert-row-"]')
      .filter({ hasText: memberName });
    await expect(
      memberRow.locator('[data-testid^="project-expert-role-curator-"]'),
    ).toBeDisabled();
  },
);

When(
  "the operator replaces the curator with that member",
  async ({ page, world }) => {
    const { curatorName, memberName } = roster(world);
    await expect(
      page.getByTestId("project-curator-replace-form"),
    ).toContainText(curatorName);
    await page
      .getByTestId("project-curator-replace-select")
      .selectOption({ label: memberName });
    await page.getByTestId("project-curator-replace-submit").click();
    await expect(page.getByTestId("project-experts-notice")).toContainText(
      "Куратор заменён.",
    );
  },
);

Then(
  "the replacement Expert is the only curator and the former curator remains a member",
  async ({ page, world }) => {
    const { curatorName, memberName } = roster(world);
    const rows = page.getByTestId(/^project-expert-row-[0-9a-f-]{36}$/);
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: curatorName })).toContainText(
      "Участник",
    );
    await expect(rows.filter({ hasText: memberName })).toContainText("Куратор");
  },
);
