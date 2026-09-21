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

function relationshipRestore(world: {
  projectRelationshipRestore?: {
    projectTitle: string;
    projectUrl: string;
    expertName: string;
    expertUrl: string;
    rowId?: string;
  };
}) {
  if (!world.projectRelationshipRestore) {
    throw new Error("Project relationship restore journey was not authored");
  }
  return world.projectRelationshipRestore;
}

function restoredRowId(
  world: Parameters<typeof relationshipRestore>[0],
): string {
  const rowId = relationshipRestore(world).rowId;
  if (!rowId) throw new Error("Project relationship identity was not recorded");
  return rowId;
}

function curatorRestoreConflict(world: {
  projectCuratorRestoreConflict?: {
    projectTitle: string;
    projectUrl: string;
    retiredExpertName: string;
    retiredExpertUrl: string;
    incumbentExpertName: string;
    retiredRowId?: string;
  };
}) {
  if (!world.projectCuratorRestoreConflict) {
    throw new Error("Occupied curator restoration journey was not authored");
  }
  return world.projectCuratorRestoreConflict;
}

function retiredCuratorRowId(
  world: Parameters<typeof curatorRestoreConflict>[0],
): string {
  const rowId = curatorRestoreConflict(world).retiredRowId;
  if (!rowId)
    throw new Error("Retired curator relationship identity was not recorded");
  return rowId;
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

When(
  "the operator creates a draft project and draft Expert for relationship restoration",
  async ({ page, world }) => {
    const stamp = Date.now();
    const projectTitle = `Возврат проект ${stamp}`;
    const projectUrl = await createProject(page, projectTitle);
    const expertName = await createExpert(
      page,
      `Сидоров-${stamp}`,
      "Возврат",
      "Ильич",
    );
    const expertUrl = page.url();
    world.projectRelationshipRestore = {
      projectTitle,
      projectUrl,
      expertName,
      expertUrl,
    };
    await openExpertsTab(page, projectUrl);
  },
);

When(
  "the operator links that Expert to the project as a member",
  async ({ page, world }) => {
    await linkSelectedExpert(
      page,
      relationshipRestore(world).expertName,
      "member",
    );
  },
);

Then(
  "the project roster shows that member and records the relationship identity",
  async ({ page, world }) => {
    const state = relationshipRestore(world);
    const row = page
      .getByTestId(/^project-expert-row-[0-9a-f-]{36}$/)
      .filter({ hasText: state.expertName });
    await expect(row).toContainText("Участник");
    const testId = await row.getAttribute("data-testid");
    if (!testId) throw new Error("Project relationship row has no test id");
    state.rowId = testId.replace("project-expert-row-", "");
  },
);

When(
  "the operator retires that project Expert relationship",
  async ({ page, world }) => {
    await page
      .getByTestId(`project-expert-retire-${restoredRowId(world)}`)
      .click();
  },
);

Then(
  "the active project roster is empty and the retired relationship is hidden",
  async ({ page }) => {
    await expect(page.getByTestId("project-experts-notice")).toContainText(
      "Связь снята.",
    );
    await expect(page.getByTestId("project-experts-empty")).toBeVisible();
    await expect(page.getByTestId("project-experts-retired")).toHaveCount(0);
  },
);

When(
  "the operator reveals retired project Expert relationships",
  async ({ page }) => {
    await page
      .getByTestId("project-experts-show-retired")
      .locator("xpath=ancestor::label[1]")
      .click();
  },
);

Then(
  "that retired relationship appears with the same identity",
  async ({ page, world }) => {
    const state = relationshipRestore(world);
    await expect(page.getByTestId("project-experts-retired")).toContainText(
      state.expertName,
    );
    await expect(
      page.getByTestId(`project-expert-row-${restoredRowId(world)}`),
    ).toBeVisible();
  },
);

When(
  "the operator restores that project Expert relationship",
  async ({ page, world }) => {
    await page
      .getByTestId(`project-expert-restore-${restoredRowId(world)}`)
      .click();
  },
);

Then(
  "the active relationship returns with the same identity",
  async ({ page, world }) => {
    await expect(page.getByTestId("project-experts-notice")).toContainText(
      "Связь возвращена.",
    );
    await expect(
      page.getByTestId(`project-expert-row-${restoredRowId(world)}`),
    ).toBeVisible();
  },
);

When("the operator opens the Expert's projects", async ({ page, world }) => {
  await page.goto(relationshipRestore(world).expertUrl);
  await page.getByTestId("tab-projects").click();
  await page.getByTestId("project-experts-panel").waitFor({ state: "visible" });
});

Then(
  "the restored project appears as a member relationship with Expert-side authoring available",
  async ({ page, world }) => {
    const state = relationshipRestore(world);
    const row = page.getByTestId(`project-expert-row-${restoredRowId(world)}`);
    await expect(row).toContainText(state.projectTitle);
    await expect(row).toContainText("Участник");
    await expect(page.getByTestId("project-expert-link-form")).toBeVisible();
    await expect(page.getByTestId("project-curator-replace-form")).toHaveCount(
      0,
    );
  },
);

When(
  "the operator creates a draft project and two draft Experts for an occupied curator restoration",
  async ({ page, world }) => {
    const stamp = Date.now();
    const projectTitle = `Возврат куратора ${stamp}`;
    const projectUrl = await createProject(page, projectTitle);
    const retiredExpertName = await createExpert(
      page,
      `Старый-${stamp}`,
      "Куратор",
      "Ильич",
    );
    const retiredExpertUrl = page.url();
    const incumbentExpertName = await createExpert(
      page,
      `Новый-${stamp}`,
      "Куратор",
      "Ильич",
    );
    world.projectCuratorRestoreConflict = {
      projectTitle,
      projectUrl,
      retiredExpertName,
      retiredExpertUrl,
      incumbentExpertName,
    };
    await openExpertsTab(page, projectUrl);
  },
);

When(
  "the operator links the first Expert as curator and records that relationship identity",
  async ({ page, world }) => {
    const state = curatorRestoreConflict(world);
    await linkSelectedExpert(page, state.retiredExpertName, "curator");
    const row = page
      .getByTestId(/^project-expert-row-[0-9a-f-]{36}$/)
      .filter({ hasText: state.retiredExpertName });
    await expect(row).toContainText("Куратор");
    const testId = await row.getAttribute("data-testid");
    if (!testId) throw new Error("Curator relationship row has no test id");
    state.retiredRowId = testId.replace("project-expert-row-", "");
  },
);

When(
  "the operator retires that curator relationship",
  async ({ page, world }) => {
    await page
      .getByTestId(`project-expert-retire-${retiredCuratorRowId(world)}`)
      .click();
    await expect(page.getByTestId("project-experts-notice")).toContainText(
      "Связь снята.",
    );
  },
);

When(
  "the operator assigns the second Expert as curator",
  async ({ page, world }) => {
    await linkSelectedExpert(
      page,
      curatorRestoreConflict(world).incumbentExpertName,
      "curator",
    );
  },
);

Then(
  "the project roster shows only the second Expert as active curator",
  async ({ page, world }) => {
    const state = curatorRestoreConflict(world);
    const rows = page.getByTestId(/^project-expert-row-[0-9a-f-]{36}$/);
    await expect(rows).toHaveCount(1);
    await expect(
      rows.filter({ hasText: state.incumbentExpertName }),
    ).toContainText("Куратор");
    await expect(rows.filter({ hasText: state.retiredExpertName })).toHaveCount(
      0,
    );
  },
);

When(
  "the operator opens the first Expert's projects",
  async ({ page, world }) => {
    await page.goto(curatorRestoreConflict(world).retiredExpertUrl);
    await page.getByTestId("tab-projects").click();
    await page
      .getByTestId("project-experts-panel")
      .waitFor({ state: "visible" });
  },
);

Then(
  "the retired curator relationship keeps the recorded identity",
  async ({ page, world }) => {
    const state = curatorRestoreConflict(world);
    const row = page.getByTestId(
      `project-expert-row-${retiredCuratorRowId(world)}`,
    );
    await expect(row).toContainText(state.projectTitle);
    await expect(row).toContainText("Куратор");
  },
);

Then(
  "restoring that curator relationship is unavailable while the seat is occupied",
  async ({ page, world }) => {
    await expect(
      page.getByTestId(`project-expert-restore-${retiredCuratorRowId(world)}`),
    ).toBeDisabled();
  },
);

Then(
  "the Admin directs the operator to replace the current curator",
  async ({ page, world }) => {
    await expect(
      page.getByTestId(
        `project-expert-row-seat-taken-${retiredCuratorRowId(world)}`,
      ),
    ).toContainText("Заменить куратора");
  },
);
