import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { bootstrapAdminSession, signInAsAdmin } from "@ds/e2e/admin-events";
import { expect, request, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { Pool, type QueryResultRow } from "pg";
import { adminOrigin, test } from "../support/fixtures";

const { Given, When, Then, Before, After } = createBdd(test);
type Row = {
  id: string;
  title: string;
  slug: string;
  status: string;
  version: number;
  roles?: { id: string; title: string }[];
};
type State = {
  backgrounds: { clause: string; ids: string[] }[];
  organisations: string[];
  projects: string[];
  experts: string[];
  kinds: string[];
  operator?: { id: string; zitadel_sub: string; email: string };
  roles: Row[];
  outputKinds: Row[];
  primary?: Row;
  project?: Row;
  clinic?: Row;
  hidden?: Row;
  renamedKind?: Row;
  countBefore?: number;
  publicPartners?: unknown;
  refusal?: { status: number; body: unknown };
  editors: string[];
};
const states = new WeakMap<Page, State>();
function state(page: Page) {
  const value = states.get(page);
  if (!value) throw new Error("Registry original has not started");
  return value;
}
function operation(command: string, detail?: unknown) {
  const path = process.env.E2E_REGISTRY_CONTRACTS_LOG;
  if (!path) throw new Error("E2E_REGISTRY_CONTRACTS_LOG is required");
  appendFileSync(
    path,
    JSON.stringify({ at: new Date().toISOString(), command, detail }) + "\n",
  );
}
function developmentIssuer() {
  const issuer = process.env.IDP_ISSUER;
  if (!issuer || new URL(issuer).hostname === "id.doctor.school")
    throw new Error("Refuse production IdP cleanup");
  return issuer;
}
async function kindDetail(page: Page, id: string) {
  const book = await api<{ data: Row[] }>(
    page,
    "/v1/admin/project-output-kinds",
  );
  const row = book.data.find((r) => r.id === id);
  if (!row) throw new Error(`Output kind ${id} is absent`);
  return row;
}
async function rows<T extends QueryResultRow>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const name = process.env.E2E_REGISTRY_CONTRACTS_DATABASE;
  const url = process.env.DATABASE_URL;
  if (
    !url ||
    !name ||
    !(
      name === "ds_dev_3831" ||
      (process.env.CI === "true" && name === "ds_admin_e2e")
    ) ||
    decodeURIComponent(new URL(url).pathname.slice(1)) !== name
  )
    throw new Error(
      "Registry originals require their explicitly owned database",
    );
  operation("SQL", { database: name, sql, values });
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    expect(
      (await pool.query("SELECT current_database() AS name")).rows,
    ).toEqual([{ name }]);
    return (await pool.query<T>(sql, values)).rows;
  } finally {
    await pool.end();
  }
}
async function api<T>(
  page: Page,
  path: string,
  method = "GET",
  body?: unknown,
  version?: number,
): Promise<T> {
  const answer = await page.evaluate(
    async ({ path, method, body, version }) => {
      const headers: Record<string, string> = {};
      if (method !== "GET") {
        headers["content-type"] = "application/json";
        headers["idempotency-key"] = crypto.randomUUID();
        const csrf = document.cookie
          .split("; ")
          .find((s) => s.startsWith("__Host-ds_admin_csrf="));
        if (!csrf) throw new Error("Admin CSRF cookie is absent");
        headers["x-ds-admin-csrf"] = decodeURIComponent(
          csrf.slice(csrf.indexOf("=") + 1),
        );
        if (version !== undefined) headers["if-match"] = `"${version}"`;
      }
      const response = await fetch(path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, method, body, version },
  );
  operation(`${method} ${path}`, { status: answer.status });
  expect(answer.status, JSON.stringify(answer.body)).toBe(
    method === "POST" && !path.endsWith("/publish") ? 201 : 200,
  );
  return answer.body as T;
}
async function publish(page: Page, collection: string, row: Row) {
  const current = await api<Row>(page, `/v1/admin/${collection}/${row.id}`);
  return api<Row>(
    page,
    `/v1/admin/${collection}/${row.id}/publish`,
    "POST",
    {},
    current.version,
  );
}
async function organization(
  page: Page,
  title: string,
  roleTitles: string[],
  visible = true,
) {
  const value = state(page);
  const row = await api<Row>(page, "/v1/admin/organisations", "POST", {
    title,
    roleIds: roleTitles.map((title) => {
      const role = value.roles.find((r) => r.title === title);
      if (!role) throw new Error(`Missing active role ${title}`);
      return role.id;
    }),
    publicNameVisible: visible,
  });
  value.organisations.push(row.id);
  operation("owned organisation", { id: row.id, title });
  return publish(page, "organisations", row);
}
async function project(page: Page, title: string) {
  const row = await api<Row>(page, "/v1/admin/projects", "POST", {
    title,
    description: "Проект для проверки реестра и результатов.",
    stage: "running",
    defaultAudience: "experts",
  });
  state(page).projects.push(row.id);
  operation("owned project", { id: row.id, title });
  return row;
}
async function results(page: Page, row: Row) {
  const current = await api<Row>(page, `/v1/admin/projects/${row.id}`);
  const school = state(page).outputKinds.find((k) => k.title === "Школа")!;
  await api(
    page,
    `/v1/admin/projects/${row.id}/results`,
    "PUT",
    {
      results: [{ outputKindId: school.id, title: "Школа проекта" }],
    },
    current.version,
  );
}
async function signIn(page: Page) {
  const value = state(page);
  if (value.operator) return;
  const credentials = await bootstrapAdminSession(adminOrigin());
  operation("owned account", { email: credentials.email });
  const actors = await rows<{ id: string; zitadel_sub: string; email: string }>(
    "SELECT id,zitadel_sub,email FROM users WHERE email=$1",
    [credentials.email],
  );
  expect(actors).toHaveLength(1);
  value.operator = actors[0];
  await signInAsAdmin(page, credentials);
  await expect(page.getByTestId("nav-organisations")).toBeVisible();
  value.roles = (
    await api<{ data: Row[] }>(
      page,
      "/v1/admin/organisation-roles?status=active",
    )
  ).data;
  value.outputKinds = (
    await api<{ data: Row[] }>(
      page,
      "/v1/admin/project-output-kinds?status=active",
    )
  ).data;
}
async function count(page: Page) {
  expect(state(page).operator).toBeDefined();
  const visitor = await request.newContext({ baseURL: adminOrigin() });
  try {
    expect((await visitor.storageState()).cookies).toEqual([]);
    const response = await visitor.get("/v1/public/organisations/count");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { count: number };
    operation("anonymous GET /v1/public/organisations/count", body);
    return body.count;
  } finally {
    await visitor.dispose();
  }
}
Before(async ({ page, $tags, $testInfo }) => {
  const is030 = $tags.includes("@feature:030");
  expect($tags).toContain(is030 ? "@host:academy" : "@host:admin");
  expect($tags).not.toContain(is030 ? "@host:admin" : "@host:academy");
  $testInfo.annotations.push({
    type: "source-host",
    description: is030 ? "academy" : "admin",
  });
  states.set(page, {
    backgrounds: [],
    organisations: [],
    projects: [],
    experts: [],
    kinds: [],
    roles: [],
    outputKinds: [],
    editors: [],
  });
  await rows("SELECT 1");
  page.on("request", (r) =>
    operation(`browser ${r.method()} ${new URL(r.url()).pathname}`),
  );
});

Given(
  "the output kinds «Школа», «Конгресс», «Клуб» and «Подкаст» are active",
  async ({ page }) => {
    await signIn(page);
    const names = ["Школа", "Конгресс", "Клуб", "Подкаст"];
    const actual = await rows<Row>(
      "SELECT id,title,status FROM project_output_kinds WHERE title=ANY($1::text[]) ORDER BY title",
      [names],
    );
    expect(actual).toHaveLength(4);
    for (const row of actual) {
      expect(row.status).toBe("active");
      expect(state(page).outputKinds).toContainEqual(
        expect.objectContaining(row),
      );
    }
    state(page).backgrounds.push({
      clause: "active output kinds",
      ids: actual.map((r) => r.id),
    });
  },
);
Given(
  'the published organization "Фарма Плюс" holds the role «Инвестор»',
  async ({ page }) => {
    const org = await organization(page, "Фарма Плюс", ["Инвестор"]);
    const actual = await api<Row>(page, `/v1/admin/organisations/${org.id}`);
    expect(actual).toMatchObject({ title: "Фарма Плюс", status: "published" });
    expect(actual.roles).toContainEqual(
      expect.objectContaining({ title: "Инвестор" }),
    );
    state(page).backgrounds.push({
      clause: "Фарма Плюс — Инвестор",
      ids: [org.id, actual.roles![0].id],
    });
  },
);
Given(
  'the published organization "ЦИТО" holds the role «Клиническая площадка»',
  async ({ page }) => {
    const org = await organization(page, "ЦИТО", ["Клиническая площадка"]);
    const actual = await api<Row>(page, `/v1/admin/organisations/${org.id}`);
    expect(actual).toMatchObject({ title: "ЦИТО", status: "published" });
    expect(actual.roles).toContainEqual(
      expect.objectContaining({ title: "Клиническая площадка" }),
    );
    state(page).backgrounds.push({
      clause: "ЦИТО — Клиническая площадка",
      ids: [org.id, actual.roles![0].id],
    });
  },
);
Given(
  "a platform administrator is signed in to the admin with a second factor",
  async ({ page, $tags }) => {
    await signIn(page);
    await expect(page.getByTestId("nav-projects")).toBeVisible();
    if ($tags.includes("@feature:032"))
      state(page).backgrounds.push({
        clause: "administrator with second factor",
        ids: [state(page).operator!.id],
      });
  },
);
Given(
  "the role list holds «Инвестор», «Клиническая площадка» and «Образовательный лицензиат»",
  async ({ page }) => {
    const titles = [
      "Инвестор",
      "Клиническая площадка",
      "Образовательный лицензиат",
    ];
    const actual = await rows<Row>(
      "SELECT id,title,status FROM organisation_roles WHERE title=ANY($1::text[]) ORDER BY title",
      [titles],
    );
    expect(actual).toHaveLength(3);
    for (const role of actual) {
      expect(role.status).toBe("active");
      expect(state(page).roles).toContainEqual(expect.objectContaining(role));
    }
    state(page).backgrounds.push({
      clause: "three active organisation roles",
      ids: actual.map((r) => r.id),
    });
  },
);
Given(
  'the published partner "Фарма Плюс" is the primary partner of the project "Школа кардиологии"',
  async ({ page }) => {
    const value = state(page);
    value.primary = await organization(page, "Фарма Плюс", ["Инвестор"]);
    value.project = await project(page, "Школа кардиологии");
    const link = await api<Row>(page, "/v1/admin/project-partners", "POST", {
      projectId: value.project.id,
      partnerId: value.primary.id,
      isPrimary: true,
    });
    expect(
      await rows(
        "SELECT id,project_id,organisation_id,is_primary,status FROM project_organisations WHERE id=$1",
        [link.id],
      ),
    ).toEqual([
      {
        id: link.id,
        project_id: value.project.id,
        organisation_id: value.primary.id,
        is_primary: true,
        status: "active",
      },
    ]);
    value.backgrounds.push({
      clause: "published primary partner and project",
      ids: [value.primary.id, value.project.id, link.id],
    });
  },
);

When(
  "the administrator adds the kind «Курс» in «Виды результатов»",
  async ({ page }) => {
    const value = state(page);
    const existing = value.outputKinds.find(
      (r) =>
        r.title === "Курс" || r.title.startsWith("Курс — исходная строка "),
    );
    if (!existing)
      throw new Error(
        "Expected the committed Курс seed before fixture preparation",
      );
    value.renamedKind = existing;
    await api(
      page,
      `/v1/admin/project-output-kinds/${existing.id}`,
      "PATCH",
      { title: `Курс — исходная строка ${randomUUID()}` },
      existing.version,
    );
    const before = (
      await api<{ data: Row[] }>(page, "/v1/admin/project-output-kinds")
    ).data;
    expect(before.some((r) => r.title === "Курс")).toBe(false);
    await page.goto("/project-output-kinds/create");
    await page.getByTestId("output-kind-title").fill("Курс");
    const responsePromise = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === "/v1/admin/project-output-kinds",
    );
    await page.getByTestId("submit-output-kind").click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    const created = (await response.json()) as Row;
    value.kinds.push(created.id);
    expect(before.some((r) => r.id === created.id)).toBe(false);
    expect(
      await rows(
        "SELECT id,title,status FROM project_output_kinds WHERE id=$1",
        [created.id],
      ),
    ).toEqual([{ id: created.id, title: "Курс", status: "active" }]);
    await page.waitForURL(/\/project-output-kinds$/);
  },
);
Then("«Курс» is offered in every results editor", async ({ page }) => {
  const value = state(page);
  for (const title of ["Ортобиология", "Второй редактор результатов"]) {
    const row = await project(page, title);
    if (title === "Ортобиология") await results(page, row);
    await page.goto(`/projects/${row.id}`);
    await page.getByTestId("tab-results").click();
    await page.getByTestId("result-add").click();
    const index = title === "Ортобиология" ? 1 : 0;
    await expect(
      page
        .getByTestId(`result-kind-${index}`)
        .locator("option", { hasText: /^Курс$/ }),
    ).toHaveAttribute("value", value.kinds[0]);
    value.editors.push(row.id);
  }
  expect(new Set(value.editors).size).toBe(2);
});
When("the administrator retires the kind «Школа»", async ({ page }) => {
  const school = state(page).outputKinds.find((r) => r.title === "Школа")!;
  await page.goto(`/project-output-kinds/${school.id}`);
  const pending = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname ===
        `/v1/admin/project-output-kinds/${school.id}/retire`,
  );
  await page.getByTestId("output-kind-retire").click();
  const response = await pending;
  state(page).refusal = {
    status: response.status(),
    body: await response.json(),
  };
});
Then(
  'the retirement is refused, listing "Ортобиология" as holding it',
  async ({ page }) => {
    const value = state(page);
    expect(value.refusal).toMatchObject({
      status: 409,
      body: { errorCode: "OUTPUT_KIND_IN_USE" },
    });
    await expect(
      page
        .getByTestId("output-kind-holders")
        .getByRole("link", { name: "Ортобиология", exact: true }),
    ).toHaveAttribute("href", `/projects/${value.projects[0]}`);
    await expect(page.getByTestId("output-kind-status")).toHaveText(
      "Действует",
    );
    const school = value.outputKinds.find((r) => r.title === "Школа")!;
    expect(await kindDetail(page, school.id)).toMatchObject({
      id: school.id,
      status: "active",
      version: school.version,
    });
  },
);

Given("the public partner count is 14", async ({ page }) => {
  const initial = await count(page);
  expect(initial).toBeGreaterThanOrEqual(1);
  expect(initial).toBeLessThanOrEqual(14);
  for (let i = initial; i < 14; i++)
    await organization(page, `Организация для счётчика ${randomUUID()}`, [
      "Инвестор",
    ]);
  expect(await count(page)).toBe(14);
});
When(
  'the administrator creates the organization "Клиника Здоровье" with the roles «Клиническая площадка» and «Образовательный лицензиат»',
  async ({ page }) => {
    await page.goto("/organisations/create");
    await page.getByTestId("organisation-title").fill("Клиника Здоровье");
    for (const slug of ["clinical-base", "educational-licensee"])
      await page
        .getByTestId(`organisation-role-${slug}`)
        .locator("xpath=ancestor::label[1]")
        .click();
    const pending = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === "/v1/admin/organisations",
    );
    await page.getByTestId("submit-organisation").click();
    const response = await pending;
    expect(response.status()).toBe(201);
    const clinic = (await response.json()) as Row;
    state(page).clinic = clinic;
    state(page).organisations.push(clinic.id);
    await page.waitForURL(new RegExp(`/organisations/${clinic.id}$`));
  },
);
Then('"Клиника Здоровье" is a draft holding both roles', async ({ page }) => {
  const row = await api<Row>(
    page,
    `/v1/admin/organisations/${state(page).clinic!.id}`,
  );
  expect(row).toMatchObject({ title: "Клиника Здоровье", status: "draft" });
  expect(row.roles!.map((r) => r.title).sort()).toEqual(
    ["Клиническая площадка", "Образовательный лицензиат"].sort(),
  );
  await expect(page.getByTestId("organisation-status")).toHaveText("Черновик");
  for (const slug of ["clinical-base", "educational-licensee"])
    await expect(page.getByTestId(`organisation-role-${slug}`)).toBeChecked();
});
Then("the public partner count is still 14", async ({ page }) => {
  expect(await count(page)).toBe(14);
});
When('the administrator publishes "Клиника Здоровье"', async ({ page }) => {
  await page.getByTestId("tab-publish").click();
  const pending = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname ===
        `/v1/admin/organisations/${state(page).clinic!.id}/publish`,
  );
  await page.getByTestId("organisations-publish").click();
  expect((await pending).status()).toBe(200);
});
Then('"Клиника Здоровье" is published', async ({ page }) => {
  await expect(page.getByTestId("organisation-status")).toHaveText(
    "Опубликована",
  );
  expect(
    await api<Row>(page, `/v1/admin/organisations/${state(page).clinic!.id}`),
  ).toMatchObject({ title: "Клиника Здоровье", status: "published" });
  await page.reload();
  await expect(page.getByTestId("organisation-status")).toHaveText(
    "Опубликована",
  );
});
Then("the public partner count is 15", async ({ page }) => {
  expect(await count(page)).toBe(15);
});

Given(
  'the published organization "Скрытая Фарма" has «Показывать название публично» off',
  async ({ page }) => {
    const value = state(page);
    value.countBefore = await count(page);
    value.hidden = await organization(
      page,
      "Скрытая Фарма",
      ["Инвестор"],
      false,
    );
    expect(
      await rows(
        "SELECT id,title,status,public_name_visible FROM organisations WHERE id=$1",
        [value.hidden.id],
      ),
    ).toEqual([
      {
        id: value.hidden.id,
        title: "Скрытая Фарма",
        status: "published",
        public_name_visible: false,
      },
    ]);
  },
);
Given(
  '"Скрытая Фарма" is a partner of the project "Школа кардиологии"',
  async ({ page }) => {
    const value = state(page);
    await api(page, "/v1/admin/project-partners", "POST", {
      projectId: value.project!.id,
      partnerId: value.hidden!.id,
      isPrimary: false,
    });
    await results(page, value.project!);
    const expert = await api<Row>(page, "/v1/admin/experts", "POST", {
      familyName: "Куратор",
      givenName: "Кардиологии",
      professionalRole: "Врач",
      credentials: "Кандидат медицинских наук",
      affiliation: "Клиника кардиологии",
      bio: "Куратор образовательной программы по кардиологии.",
    });
    value.experts.push(expert.id);
    await publish(page, "experts", expert);
    await api(page, "/v1/admin/project-experts", "POST", {
      projectId: value.project!.id,
      expertId: expert.id,
      role: "curator",
    });
    await publish(page, "projects", value.project!);
  },
);
When(
  'a visitor reads the partners of "Школа кардиологии"',
  async ({ page, playwright }) => {
    const visitor = await playwright.request.newContext({
      baseURL: adminOrigin(),
    });
    try {
      const response = await visitor.get(
        `/v1/public/projects/${state(page).project!.id}/partners`,
      );
      expect(response.status()).toBe(200);
      expect((await visitor.storageState()).cookies).toEqual([]);
      state(page).publicPartners = await response.json();
      operation("anonymous project-partner read", {
        status: response.status(),
        body: state(page).publicPartners,
      });
    } finally {
      await visitor.dispose();
    }
  },
);
Then('"Скрытая Фарма" is not among them', async ({ page }) => {
  const value = state(page);
  const body = JSON.stringify(value.publicPartners);
  expect(body).not.toContain(value.hidden!.id);
  expect(body).not.toContain("Скрытая Фарма");
  expect(body).toContain(value.primary!.id);
  expect(body).toContain("Фарма Плюс");
});
Then('the public partner count includes "Скрытая Фарма"', async ({ page }) => {
  const value = state(page);
  expect(await count(page)).toBe(value.countBefore! + 1);
  const actual = await rows<{ id: string }>(
    "SELECT id FROM organisations WHERE status='published' AND deleted_at IS NULL",
  );
  expect(actual.map((r) => r.id)).toContain(value.hidden!.id);
  expect(actual.length).toBe(await count(page));
});

After(async ({ page, $testInfo, $tags }) => {
  const value = state(page);
  await $testInfo.attach("registry-contracts", {
    contentType: "application/json",
    body: JSON.stringify({
      sourceHost: $tags.includes("@feature:030") ? "academy" : "admin",
      runtime: "admin",
      backgrounds: value.backgrounds,
      editors: value.editors,
      organisations: value.organisations,
      projects: value.projects,
      publicPartners: value.publicPartners,
      refusal: value.refusal,
    }),
  });
  try {
    for (const id of value.projects) {
      await rows("DELETE FROM project_results WHERE project_id=$1", [id]);
      await rows("DELETE FROM project_experts WHERE project_id=$1", [id]);
      await rows("DELETE FROM project_organisations WHERE project_id=$1", [id]);
      await rows("DELETE FROM projects WHERE id=$1", [id]);
    }
    for (const id of value.experts)
      await rows("DELETE FROM experts WHERE id=$1", [id]);
    for (const id of value.organisations) {
      await rows(
        "DELETE FROM organisation_role_assignments WHERE organisation_id=$1",
        [id],
      );
      await rows("DELETE FROM organisations WHERE id=$1", [id]);
    }
    for (const id of value.kinds)
      await rows("DELETE FROM project_output_kinds WHERE id=$1", [id]);
    if (value.renamedKind) {
      const original = await kindDetail(page, value.renamedKind.id);
      await api(
        page,
        `/v1/admin/project-output-kinds/${original.id}`,
        "PATCH",
        { title: "Курс" },
        original.version,
      );
    }
    expect(
      await rows("SELECT id FROM projects WHERE id=ANY($1::uuid[])", [
        value.projects,
      ]),
    ).toEqual([]);
    expect(
      await rows("SELECT id FROM organisations WHERE id=ANY($1::uuid[])", [
        value.organisations,
      ]),
    ).toEqual([]);
  } finally {
    if (value.operator) {
      const issuer = developmentIssuer();
      const path = `${issuer}/v2/users/${encodeURIComponent(value.operator.zitadel_sub)}`;
      const headers = {
        authorization: `Bearer ${process.env.IDP_SERVICE_TOKEN}`,
      };
      operation("delete exact owned IdP actor", {
        id: value.operator.zitadel_sub,
      });
      expect((await fetch(path, { method: "DELETE", headers })).ok).toBe(true);
      expect([404, 410]).toContain((await fetch(path, { headers })).status);
      operation(
        "retained owned actor mirror and consent rows until branch database cleanup",
        { id: value.operator.id },
      );
    }
    states.delete(page);
  }
});
