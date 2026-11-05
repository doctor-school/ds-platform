import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

import { bootstrapAdminSession, signInAsAdmin } from "@ds/e2e/admin-events";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { Pool, type QueryResultRow } from "pg";

import { adminOrigin, test, type AdminWorld } from "../support/fixtures";
import { selectRelationshipCombobox } from "../support/relationship-combobox";

const { Given, When, Then, Before, After } = createBdd(test);
type Actor = { id: string; zitadel_sub: string };
type Material = { id: string; title: string; status: string; version: number };
type State = {
  actors: Actor[];
  contexts: BrowserContext[];
  material?: Material;
  second?: Page;
  firstTitle?: string;
  before?: { id: string }[];
  refusedTitle?: string;
  staleVersion?: string;
  auditIds?: string[];
};
const states = new WeakMap<AdminWorld, State>();
function state(world: AdminWorld): State {
  const current = states.get(world);
  if (!current) throw new Error("Material authoring scenario has not started");
  return current;
}
function operation(op: string, detail?: unknown): void {
  const file = process.env.E2E_MATERIAL_ADMIN_LOG;
  if (!file)
    throw new Error("E2E_MATERIAL_ADMIN_LOG must name the operation log");
  appendFileSync(
    file,
    JSON.stringify({ at: new Date().toISOString(), op, detail }) + "\n",
  );
}
async function rows<T extends QueryResultRow>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const database = process.env.E2E_MATERIAL_ADMIN_DATABASE;
  const connection = process.env.DATABASE_URL;
  if (
    !database ||
    !connection ||
    !(
      /^ds_dev_\d+$/u.test(database) ||
      (process.env.CI === "true" && database === "ds_admin_e2e")
    ) ||
    decodeURIComponent(new URL(connection).pathname.slice(1)) !== database
  )
    throw new Error("Material authoring requires an explicitly owned database");
  operation("SQL", { sql, values });
  const pool = new Pool({ connectionString: connection, max: 1 });
  try {
    const binding = await pool.query("SELECT current_database() AS name");
    expect(binding.rows).toEqual([{ name: database }]);
    return (await pool.query<T>(sql, values)).rows;
  } finally {
    await pool.end();
  }
}
function observe(page: Page): void {
  page.on("request", (request) => {
    const url = new URL(request.url());
    operation(`browser ${request.method()} ${url.origin}${url.pathname}`);
  });
}
const originalFetch = globalThis.fetch;
Before({ tags: "@material-admin-authoring" }, async ({ page, world }) => {
  states.set(world, { actors: [], contexts: [] });
  await rows("SELECT 1");
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    operation(`${init?.method ?? "GET"} ${url.origin}${url.pathname}`);
    if (url.pathname.endsWith("/register") && typeof init?.body === "string") {
      const body = JSON.parse(init.body) as { email?: string };
      if (body.email)
        operation("owned account registration", { email: body.email });
    }
    return originalFetch(input, init);
  };
  observe(page);
});
After({ tags: "@material-admin-authoring" }, async ({ world }) => {
  globalThis.fetch = originalFetch;
  for (const context of state(world).contexts) await context.close();
});
async function signIn(page: Page, world: AdminWorld): Promise<void> {
  const credentials = await bootstrapAdminSession(adminOrigin());
  operation("owned account", { email: credentials.email });
  await signInAsAdmin(page, credentials);
  const actors = await rows<Actor>(
    "SELECT id,zitadel_sub FROM users WHERE email=$1",
    [credentials.email],
  );
  expect(actors).toHaveLength(1);
  expect(actors[0].zitadel_sub).toBeTruthy();
  state(world).actors.push(actors[0]);
  operation("owned actor", { email: credentials.email, ...actors[0] });
  await expect(page.getByTestId("nav-materials")).toBeVisible();
}

// The source Background is executed on the real Admin before each original.
Given(
  "the published expert {string} is in the experts directory",
  async ({ page, world }, name: string) => {
    await signIn(page, world);
    const existing = await rows<{ id: string; status: string }>(
      "SELECT id,status FROM experts WHERE family_name=$1 AND given_name=$2 AND patronymic=$3",
      ["Страхов", "Михаил", "Андреевич"],
    );
    expect(name).toBe("Страхов Михаил Андреевич");
    if (existing.length) {
      expect(existing).toHaveLength(1);
      expect(existing[0].status).toBe("published");
      return;
    }
    await page.goto("/experts/create");
    await page.getByTestId("expert-family-name").fill("Страхов");
    await page.getByTestId("expert-given-name").fill("Михаил");
    await page.getByTestId("expert-patronymic").fill("Андреевич");
    await page.getByTestId("expert-professional-role").fill("Травматолог");
    await page.getByTestId("expert-credentials").fill("К. м. н.");
    await page
      .getByTestId("expert-affiliation")
      .fill("ЦИТО им. Н. Н. Приорова");
    await page
      .getByTestId("expert-bio")
      .fill("Занимается ортобиологией и обучает врачей.");
    await page.getByTestId("submit-expert").click();
    await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/u);
    operation("owned expert", {
      id: new URL(page.url()).pathname.split("/").pop(),
      name,
    });
    await page.getByTestId("tab-publish").click();
    await page.getByTestId("experts-publish").click();
    await expect(page.getByTestId("expert-status")).toHaveText("Опубликован");
  },
);
Given(
  "a platform administrator is signed in to the admin with a second factor",
  async ({ page }) => {
    await expect(page.getByTestId("nav-materials")).toBeVisible();
  },
);

async function createMaterial(
  page: Page,
  title: string,
  kind: "news" | "column",
): Promise<Material> {
  await page.goto("/materials/create");
  await expect(page.getByTestId("material-form")).toBeVisible();
  await page
    .getByTestId(`material-kind-${kind}`)
    .locator("xpath=ancestor::label[1]")
    .click();
  await page.getByTestId("material-title").fill(title);
  if (kind === "column")
    await selectRelationshipCombobox(
      page,
      "material-expert",
      "Страхов",
      "Страхов Михаил Андреевич",
    );
  const editor = page
    .getByTestId("material-body")
    .locator('[contenteditable="true"]');
  await editor.fill("Материал о практическом применении ортобиологии.");
  const created = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/v1/admin/materials",
  );
  await page.getByTestId("submit-material").click();
  const response = await created;
  expect(response.status()).toBe(201);
  const material = (await response.json()) as Material;
  operation("owned material", { id: material.id, title, kind });
  await page.waitForURL(new RegExp(`/materials/${material.id}$`, "u"));
  await expect(page.getByTestId("material-heading")).toHaveText(title);
  return material;
}
async function news(page: Page, title: string): Promise<Material> {
  const material = await createMaterial(page, title, "news");
  await page.getByTestId("material-publish").click();
  await expect(page.getByTestId("material-status")).toHaveText("Опубликован");
  return material;
}
When(
  "the administrator saves a material of kind «Колонка эксперта» with no expert chosen",
  async ({ page, world }) => {
    const current = state(world);
    current.before = await rows<{ id: string }>(
      "SELECT id FROM materials ORDER BY id",
    );
    current.refusedTitle = `Колонка без эксперта ${randomUUID()}`;
    await page.goto("/materials/create");
    await expect(page.getByTestId("material-form")).toBeVisible();
    await page
      .getByTestId("material-kind-column")
      .locator("xpath=ancestor::label[1]")
      .click();
    await expect(page.getByTestId("material-author-line")).toHaveCount(0);
    await page.getByTestId("material-title").fill(current.refusedTitle);
    await page.getByTestId("submit-material").click();
  },
);
Then(
  "the save is refused with a field error on the expert",
  async ({ page }) => {
    await expect(
      page.locator("#material-expert").locator("xpath=.."),
    ).toContainText("Выберите эксперта — колонка выходит от его имени.");
    await expect(
      page.getByText("Выберите эксперта — колонка выходит от его имени."),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/materials\/create$/u);
  },
);
Then("no material is created", async ({ world }) => {
  const current = state(world);
  expect(await rows("SELECT id FROM materials ORDER BY id")).toEqual(
    current.before,
  );
  expect(
    await rows("SELECT id FROM materials WHERE title=$1", [
      current.refusedTitle,
    ]),
  ).toEqual([]);
});
Given(
  "two administrators have the news item {string} open",
  async ({ page, browser, world }, title: string) => {
    const current = state(world);
    current.material = await news(page, title);
    const secondContext = await browser.newContext({
      baseURL: adminOrigin(),
      locale: "ru-RU",
    });
    current.contexts.push(secondContext);
    const second = await secondContext.newPage();
    observe(second);
    await signIn(second, world);
    expect(current.actors).toHaveLength(2);
    expect(new Set(current.actors.map((actor) => actor.id)).size).toBe(2);
    expect(new Set(current.actors.map((actor) => actor.zitadel_sub)).size).toBe(
      2,
    );
    expect(page.context()).not.toBe(secondContext);
    const path = `/v1/admin/materials/${current.material.id}`;
    const versions = [];
    for (const operator of [page, second]) {
      const read = operator.waitForResponse(
        (r) =>
          r.request().method() === "GET" && new URL(r.url()).pathname === path,
      );
      await operator.goto(`/materials/${current.material.id}`);
      const answer = await read;
      expect(answer.status()).toBe(200);
      versions.push(answer.headers().etag);
      await expect(operator.getByTestId("material-title")).toHaveValue(title);
    }
    expect(versions[0]).toMatch(/^W\/"\d+"$/u);
    expect(versions[1]).toBe(versions[0]);
    current.staleVersion = versions[0];
    current.second = second;
    current.auditIds = (
      await rows<{ id: string }>(
        "SELECT id FROM audit_ledger WHERE event_type='data.materials.update' AND metadata->'pk'->>'id'=$1",
        [current.material.id],
      )
    ).map((audit) => audit.id);
  },
);
When(
  "the first saves a change and the second then saves another change",
  async ({ page, world }) => {
    const current = state(world);
    current.firstTitle = `${current.material!.title} — первая правка`;
    for (const [operator, title, status] of [
      [page, current.firstTitle, 200],
      [current.second!, `${current.material!.title} — вторая правка`, 412],
    ] as const) {
      await operator.getByTestId("material-title").fill(title);
      const saved = operator.waitForResponse(
        (r) =>
          r.request().method() === "PATCH" &&
          new URL(r.url()).pathname ===
            `/v1/admin/materials/${current.material!.id}`,
      );
      await operator.getByTestId("submit-material").click();
      const response = await saved;
      expect(response.request().headers()["if-match"]).toBe(
        current.staleVersion,
      );
      expect(response.status()).toBe(status);
      operation("material edit response", {
        id: current.material!.id,
        status,
        ifMatch: current.staleVersion,
      });
      if (status === 200)
        await expect(operator.getByTestId("update-saved")).toBeVisible();
    }
  },
);
Then(
  "the second save is refused as stale with the reload notice",
  async ({ world }) => {
    await expect(
      state(world).second!.getByTestId("update-error"),
    ).toContainText(
      "Материал изменился в другом окне. Обновите страницу и повторите правку.",
    );
  },
);
Then("the material keeps the first change", async ({ world }) => {
  const current = state(world);
  const stored = await rows<{ title: string }>(
    "SELECT title FROM materials WHERE id=$1",
    [current.material!.id],
  );
  expect(stored).toEqual([{ title: current.firstTitle }]);
  const audits = await rows<{ id: string; subject_id: string }>(
    "SELECT id,subject_id FROM audit_ledger WHERE event_type='data.materials.update' AND metadata->'pk'->>'id'=$1 ORDER BY created_at,id",
    [current.material!.id],
  );
  expect(
    audits
      .filter((audit) => !current.auditIds!.includes(audit.id))
      .map((audit) => ({ subject_id: audit.subject_id })),
  ).toEqual([{ subject_id: current.actors[0].zitadel_sub }]);
  await current.second!.reload();
  await expect(current.second!.getByTestId("material-title")).toHaveValue(
    current.firstTitle!,
  );
  await expect(current.second!.getByTestId("material-heading")).toHaveText(
    current.firstTitle!,
  );
});
Given(
  "the published news item {string} and the draft column {string}",
  async ({ page, world }, newsTitle: string, columnTitle: string) => {
    await news(page, newsTitle);
    state(world).material = await createMaterial(page, columnTitle, "column");
    await expect(page.getByTestId("material-status")).toHaveText("Черновик");
  },
);
When(
  "the administrator filters «Материалы» by «Колонка эксперта»",
  async ({ page }) => {
    await page.goto("/materials");
    const filtered = page.waitForResponse(
      (r) =>
        r.request().method() === "GET" &&
        new URL(r.url()).pathname === "/v1/admin/materials" &&
        new URL(r.url()).searchParams.get("kind") === "column",
    );
    await page
      .getByTestId("materials-kind-filter")
      .selectOption({ label: "Колонка эксперта" });
    expect((await filtered).status()).toBe(200);
  },
);
Then(
  "the list shows {string} with the status «Черновик»",
  async ({ page }, title: string) => {
    const row = page
      .getByTestId("materials-table")
      .getByRole("row")
      .filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Колонка эксперта");
    await expect(row).toContainText("Черновик");
    await expect(row).toContainText("Ещё не публиковался");
    await expect(row).toContainText("Страхов Михаил Андреевич");
  },
);
Then("the list does not show {string}", async ({ page }, title: string) => {
  await expect(
    page.getByTestId("materials-table").getByText(title, { exact: true }),
  ).toHaveCount(0);
});
