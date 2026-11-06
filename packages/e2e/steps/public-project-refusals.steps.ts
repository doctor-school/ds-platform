import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Given, When, Then, After } from "./support/fixtures.js";
import { createProjectRefusalFixture } from "../lib/project-refusal-fixture.js";
import { createReadonlyOperator } from "../lib/public-readonly-fixture.js";
import { signInAsAdmin } from "../admin/sign-in.js";
import {
  feedEntryLog,
  verifyOwnedFeedEntryListeners,
} from "../lib/feed-entry.js";
import { publicProjectRefusalTitles } from "../lib/host-tags.js";
import { projectRefusalBackgrounds } from "../lib/project-refusals-report.js";
import {
  expectStorefrontNotFound,
  maskNotFoundVariant,
} from "../lib/not-found-page.js";

type State = {
  fixture: Awaited<ReturnType<typeof createProjectRefusalFixture>>;
  operator?: Awaited<ReturnType<typeof createReadonlyOperator>>;
  admin?: Page;
  backgrounds: { group: string; ids: string[] }[];
  before?: unknown;
  refusal?: {
    status: number;
    body: { errorCode?: string; errors?: { path: string }[] };
    method: string;
    path: string;
    headers: Record<string, string>;
  };
  doctor?: {
    origin: string;
    path: string;
    status: number;
    unknownStatus?: number;
  };
};
const states = new WeakMap<Page, State>();
function state(page: Page) {
  const value = states.get(page);
  if (!value) throw new Error("030 Background did not run");
  return value;
}
async function read<T>(page: Page, path: string): Promise<T> {
  const result = await page.evaluate(async (path) => {
    const response = await fetch(path);
    return { status: response.status, body: await response.json() };
  }, path);
  expect(result.status, path).toBe(200);
  feedEntryLog({
    command: "normal authenticated browser read",
    path,
    status: result.status,
  });
  return result.body as T;
}
async function results(page: Page) {
  const value = state(page);
  const actual = await read(
    value.admin!,
    `/v1/admin/projects/${value.fixture.project}/results`,
  );
  const persisted = (
    await value.fixture.query(
      "SELECT id,output_kind_id,position,title,description,storefront_url FROM project_results WHERE project_id=$1 ORDER BY position",
      [value.fixture.project],
    )
  ).rows;
  return { actual, persisted };
}
async function refusal(
  page: Page,
  method: string,
  path: string,
  click: () => Promise<void>,
) {
  const admin = state(page).admin!;
  const pending = admin.waitForResponse(
    (response) =>
      response.request().method() === method &&
      new URL(response.url()).pathname === path,
  );
  await click();
  const response = await pending;
  const allHeaders = await response.request().allHeaders();
  const headers = Object.fromEntries(
    ["origin", "if-match", "idempotency-key"].map((key) => [
      key,
      allHeaders[key] ?? "",
    ]),
  );
  expect(headers.origin).toBe(new URL(process.env.E2E_ADMIN_URL!).origin);
  expect(headers["if-match"]).toBeTruthy();
  expect(headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  state(page).refusal = {
    status: response.status(),
    body: await response.json(),
    method,
    path,
    headers,
  };
}

Given(
  "the output kinds «Школа», «Конгресс», «Клуб» and «Подкаст» are active",
  async ({ page, browser, host }) => {
    expect(host.id).toBe("academy");
    verifyOwnedFeedEntryListeners();
    const fixture = await createProjectRefusalFixture();
    const value: State = { fixture, backgrounds: [] };
    states.set(page, value);
    value.operator = await createReadonlyOperator(3826);
    const context = await browser.newContext({
      baseURL: process.env.E2E_ADMIN_URL!,
      locale: "ru-RU",
    });
    value.admin = await context.newPage();
    await signInAsAdmin(value.admin, value.operator.credentials);
    const book = await read<{
      data: { id: string; title: string; status: string }[];
    }>(value.admin, "/v1/admin/project-output-kinds?status=active");
    const persisted = (
      await fixture.query(
        "SELECT id,title,status FROM project_output_kinds WHERE title=ANY($1::text[]) ORDER BY title",
        [["Школа", "Конгресс", "Клуб", "Подкаст"]],
      )
    ).rows as { id: string; title: string; status: string }[];
    expect(persisted).toHaveLength(4);
    for (const row of persisted) {
      expect(row.status).toBe("active");
      expect(book.data).toContainEqual(expect.objectContaining(row));
    }
    value.backgrounds.push({
      group: projectRefusalBackgrounds[0],
      ids: persisted.map((row) => row.id),
    });
  },
);

async function organization(page: Page, index: number) {
  const value = state(page),
    org = value.fixture.organisations[index]!;
  const rows = (
    await value.fixture.query(
      "SELECT o.id,o.title,o.status,r.id AS role_id,r.title AS role_title,r.status AS role_status FROM organisations o JOIN organisation_role_assignments a ON a.organisation_id=o.id JOIN organisation_roles r ON r.id=a.role_id WHERE o.id=$1",
      [org.id],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: org.id,
    title: org.title,
    status: "published",
    role_title: org.role,
    role_status: "active",
  });
  const actual = await read<{
    id: string;
    title: string;
    status: string;
    roles: { id: string; title: string }[];
  }>(value.admin!, `/v1/admin/organisations/${org.id}`);
  expect(actual).toMatchObject({
    id: org.id,
    title: org.title,
    status: "published",
  });
  expect(actual.roles).toContainEqual(
    expect.objectContaining({ id: rows[0].role_id, title: org.role }),
  );
  value.backgrounds.push({
    group: projectRefusalBackgrounds[index + 1]!,
    ids: [org.id, rows[0].role_id],
  });
}
Given(
  'the published organization "Фарма Плюс" holds the role «Инвестор»',
  async ({ page }) => {
    await organization(page, 0);
  },
);
Given(
  'the published organization "ЦИТО" holds the role «Клиническая площадка»',
  async ({ page }) => {
    await organization(page, 1);
  },
);

Given(
  "a platform administrator is signed in to the admin with a second factor",
  async ({ page }) => {
    await expect(state(page).admin!).toHaveURL(/\/events$/);
    expect(state(page).backgrounds).toHaveLength(3);
  },
);
Given(
  'the draft project "Педиатрия" has a title, a description, a curator and no result',
  async ({ page }) => {
    const value = state(page);
    const project = await value.fixture.createProject("Педиатрия", false);
    expect(project).toMatchObject({
      title: "Педиатрия",
      status: "draft",
      version: 1,
    });
    const curators = (
      await value.fixture.query(
        "SELECT pe.id,e.id AS expert_id,e.status FROM project_experts pe JOIN experts e ON e.id=pe.expert_id WHERE pe.project_id=$1 AND pe.role='curator' AND pe.status='active'",
        [value.fixture.project],
      )
    ).rows;
    expect(curators).toEqual([
      {
        id: value.fixture.curator,
        expert_id: value.fixture.expert,
        status: "published",
      },
    ]);
    await value.admin!.goto(`/projects/${value.fixture.project}`);
    await expect(value.admin!.getByTestId("project-title")).toHaveValue(
      "Педиатрия",
    );
    await expect(value.admin!.getByTestId("project-description")).toHaveValue(
      project.description,
    );
    value.before = await results(page);
    expect((value.before as { persisted: unknown[] }).persisted).toEqual([]);
  },
);
When('the administrator publishes "Педиатрия"', async ({ page }) => {
  const value = state(page);
  await value.admin!.getByTestId("tab-publish").click();
  await refusal(
    page,
    "POST",
    `/v1/admin/projects/${value.fixture.project}/publish`,
    () => value.admin!.getByTestId("projects-publish").click(),
  );
});
Then(
  "the publish is refused with a field error on the results",
  async ({ page }) => {
    const value = state(page);
    expect(value.refusal!.status).toBe(409);
    expect(value.refusal!.body.errorCode).toBe("PUBLISH_REQUIREMENTS_NOT_MET");
    expect(value.refusal!.body.errors).toEqual([
      expect.objectContaining({ path: "results" }),
    ]);
    await expect(value.admin!.getByTestId("publish-error")).toContainText(
      "Проект пока нельзя опубликовать — ничего не изменилось.",
    );
    await expect(
      value.admin!.getByTestId("publish-blocker-results"),
    ).toHaveText("Хотя бы один результат — вкладка «Результаты»");
    await expect(
      value.admin!.getByTestId("publish-blockers").getByRole("listitem"),
    ).toHaveCount(1);
  },
);
Then('"Педиатрия" stays a draft', async ({ page }) => {
  const value = state(page);
  const actual = await read(
    value.admin!,
    `/v1/admin/projects/${value.fixture.project}`,
  );
  expect(actual).toMatchObject({
    id: value.fixture.project,
    title: "Педиатрия",
    status: "draft",
    version: 1,
  });
  expect(
    (
      await value.fixture.query(
        "SELECT id,title,status,version,first_published_at FROM projects WHERE id=$1",
        [value.fixture.project],
      )
    ).rows,
  ).toEqual([
    {
      id: value.fixture.project,
      title: "Педиатрия",
      status: "draft",
      version: 1,
      first_published_at: null,
    },
  ]);
  expect(await results(page)).toEqual(value.before);
  await value.admin!.reload();
  await expect(value.admin!.getByTestId("project-status")).toHaveText(
    "Черновик",
  );
});
When(
  /^the administrator saves a result of "Ортобиология" with the link "https:\/\/example\.com\/school"$/,
  async ({ page }) => {
    const value = state(page);
    await value.fixture.createProject("Ортобиология", true);
    await value.admin!.goto(`/projects/${value.fixture.project}`);
    await value.admin!.getByTestId("tab-results").click();
    await expect(value.admin!.getByTestId("result-title-0")).toHaveValue(
      "Результат 1",
    );
    await expect(value.admin!.getByTestId("result-title-1")).toHaveValue(
      "Результат 2",
    );
    value.before = await results(page);
    await value
      .admin!.getByTestId("result-url-0")
      .fill("https://example.com/school");
    await refusal(
      page,
      "PUT",
      `/v1/admin/projects/${value.fixture.project}/results`,
      () => value.admin!.getByTestId("results-save").click(),
    );
  },
);
Then("the save is refused with a field error on the link", async ({ page }) => {
  const value = state(page);
  expect(value.refusal!.status).toBe(400);
  expect(value.refusal!.body.errorCode).toBe("VALIDATION_FAILED");
  expect(value.refusal!.body.errors).toEqual([
    expect.objectContaining({ path: "results.0.storefrontUrl" }),
  ]);
  await expect(value.admin!.getByTestId("result-url-0")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(
    value.admin!.getByText(
      "Ссылка должна вести на doctor.school и начинаться с https://.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(value.admin!.getByTestId("results-error")).toContainText(
    "Не удалось сохранить результаты. Ничего не изменилось",
  );
});
Then('the results of "Ортобиология" are unchanged', async ({ page }) => {
  const value = state(page);
  expect(await results(page)).toEqual(value.before);
  await value.admin!.reload();
  await value.admin!.getByTestId("tab-results").click();
  await expect(value.admin!.getByTestId("result-url-0")).toHaveValue("");
  await expect(value.admin!.getByTestId("result-title-0")).toHaveValue(
    "Результат 1",
  );
  await expect(value.admin!.getByTestId("result-title-1")).toHaveValue(
    "Результат 2",
  );
});
When(/^a doctor opens "\/projects" on doctor\.school$/, async ({ page, host }) => {
  expect(host.id).toBe("academy");
  const origin = new URL(process.env.E2E_DOCTOR_URL!).origin;
  const response = await page.goto(`${origin}/projects`);
  state(page).doctor = {
    origin,
    path: "/projects",
    status: response!.status(),
  };
  expect(response!.status()).toBe(404);
  await expect(page).toHaveURL(`${origin}/projects`);
});
Then("the doctor storefront's not-found page is shown", async ({ page }) => {
  const value = state(page);
  const target = maskNotFoundVariant(await page.locator("body").innerText());
  await expectStorefrontNotFound(
    page,
    `${value.doctor!.origin}/projects`,
    "guest",
  );
  await expect(
    page.locator(
      '[data-testid*="project-card"], [data-testid*="projects-catalog"], article',
    ),
  ).toHaveCount(0);
  await expectStorefrontNotFound(
    page,
    `${value.doctor!.origin}/missing-project-${randomUUID()}`,
    "guest",
  );
  value.doctor!.unknownStatus = 404;
  expect(maskNotFoundVariant(await page.locator("body").innerText())).toBe(
    target,
  );
});

After(async ({ page, $testInfo }) => {
  if (
    !publicProjectRefusalTitles.some(
      (title) =>
        $testInfo.title === title || $testInfo.title.startsWith(title + " @"),
    )
  )
    return;
  const value = states.get(page);
  try {
    await $testInfo.attach("project-refusals", {
      body: JSON.stringify({
        backgrounds: value?.backgrounds,
        project: value?.fixture.project,
        before: value?.before,
        refusal: value?.refusal,
        doctor: value?.doctor,
      }),
      contentType: "application/json",
    });
  } finally {
    try {
      await value?.admin?.context().close();
      if (value?.operator) {
        await value.operator.cleanup();
        await value.fixture.query("DELETE FROM users WHERE email=$1", [
          value.operator.credentials.email,
        ]);
        expect(
          (
            await value.fixture.query("SELECT id FROM users WHERE email=$1", [
              value.operator.credentials.email,
            ])
          ).rows,
        ).toEqual([]);
      }
    } finally {
      await value?.fixture.cleanup();
      states.delete(page);
    }
  }
});
