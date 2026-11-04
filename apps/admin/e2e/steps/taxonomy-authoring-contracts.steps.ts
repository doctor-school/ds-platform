import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { Pool } from "pg";

import {
  Before,
  Given,
  Then,
  When,
  test,
  type AdminWorld,
} from "../support/fixtures";
import { chooseProjectStage } from "../support/event-classification";

type Row = {
  id: string;
  version: number;
  slug: string;
  user_id?: string | null;
};
type State = {
  prefix: string;
  email?: string;
  userId?: string;
  kind?: Row;
  project?: Row;
  standalone?: Row;
  owner?: Row;
  before?: unknown[];
  stale?: Page;
  refusals: { status: number; errorCode: string }[];
};
const states = new WeakMap<AdminWorld, State>();
function state(world: AdminWorld): State {
  let value = states.get(world);
  if (!value) {
    value = { prefix: `Authoring R ${randomUUID()}`, refusals: [] };
    states.set(world, value);
  }
  return value;
}
function operation(op: string, detail?: unknown): void {
  const file = process.env.E2E_TAXONOMY_AUTHORING_LOG;
  if (file)
    appendFileSync(
      file,
      JSON.stringify({ at: new Date().toISOString(), op, detail }) + "\n",
    );
}

// Observe the real fixture from its FIRST registration, without recording
// request bodies, credentials, cookies or response payloads. A grant can only
// target an exact email/subject created by this scenario.
const originalFetch = globalThis.fetch;
Before(
  { tags: "@taxonomy-authoring-contracts" },
  async ({ context, page, world }) => {
    const startedAt = Date.now();
    const issuer = process.env.IDP_ISSUER?.replace(/\/$/u, "");
    const project = process.env.IDP_PROJECT_ID;
    if (!issuer || !project || !process.env.IDP_SERVICE_TOKEN)
      throw new Error("The real Admin fixture requires the configured IdP");
    const headers = {
      authorization: `Bearer ${process.env.IDP_SERVICE_TOKEN}`,
      "content-type": "application/json",
    };
    async function observed(
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      operation("Node request", {
        method: init?.method ?? "GET",
        path: url.pathname,
      });
      const response = await originalFetch(input, init);
      operation("Node response", {
        method: init?.method ?? "GET",
        path: url.pathname,
        status: response.status,
      });
      return response;
    }
    const rolesPath = `${issuer}/management/v1/projects/${project}/roles/_search`;
    async function sharedRole() {
      const response = await observed(rolesPath, {
        method: "POST",
        headers,
        body: "{}",
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        result: {
          key: string;
          details: { creationDate: string; changeDate: string };
        }[];
      };
      const role = body.result.find((row) => row.key === "platform_admin");
      expect(role).toBeTruthy();
      expect(Date.parse(role!.details.creationDate)).toBeLessThan(startedAt);
      expect(Date.parse(role!.details.changeDate)).toBeLessThan(startedAt);
      return role;
    }
    const retainedRole = await sharedRole();
    operation("shared role before fixture", retainedRole);
    const emails = new Set<string>();
    const subjects = new Set<string>();
    globalThis.fetch = async (input, init) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined;
      const granting = /\/users\/([^/]+)\/grants(?:\/[^/]+)?$/u.exec(
        url.pathname,
      );
      if (granting && ["PUT", "POST"].includes(init?.method ?? "GET")) {
        expect(subjects.has(granting[1])).toBe(true);
        operation("owned grant target verified", { subject: granting[1] });
      }
      if (url.pathname === "/v1/auth/register")
        operation("owned account attempt", { email: body?.email });
      const response = await observed(input, init);
      if (url.pathname === "/v1/auth/register") {
        expect(response.ok).toBe(true);
        const email = body?.email as string;
        expect(email).toMatch(/^admin-\d+-[a-z0-9]+@ds\.test$/u);
        emails.add(email);
        state(world).email = email;
        operation("owned account created", {
          email,
          createdAfter: new Date(startedAt).toISOString(),
        });
      }
      if (url.pathname === "/management/v1/users/_search" && response.ok) {
        const result = (await response.clone().json()) as {
          result?: { id: string }[];
        };
        for (const { id } of result.result ?? []) {
          const detail = await observed(`${issuer}/v2/users/${id}`, {
            headers,
          });
          expect(detail.status).toBe(200);
          const { user } = (await detail.json()) as {
            user: {
              userId: string;
              human: { email: { email: string } };
              details: { creationDate: string };
            };
          };
          expect(user.userId).toBe(id);
          expect(emails.has(user.human.email.email)).toBe(true);
          expect(Date.parse(user.details.creationDate)).toBeGreaterThanOrEqual(
            startedAt,
          );
          subjects.add(id);
          operation("owned account verified before grant", {
            subject: id,
            email: user.human.email.email,
            createdAt: user.details.creationDate,
          });
        }
      }
      if (
        url.pathname === `/management/v1/projects/${project}/roles` &&
        init?.method === "POST"
      ) {
        // The canonical fixture's ensure must observe an existing shared role.
        expect(response.status).toBe(409);
        expect(await sharedRole()).toEqual(retainedRole);
        operation("shared role unchanged after ensure", retainedRole);
      }
      return response;
    };
    function observePage(target: Page) {
      target.on("request", (request) =>
        operation("browser request", {
          method: request.method(),
          path: new URL(request.url()).pathname,
        }),
      );
      target.on("response", (response) =>
        operation("browser response", {
          method: response.request().method(),
          path: new URL(response.url()).pathname,
          status: response.status(),
        }),
      );
    }
    observePage(page);
    context.on("page", observePage);
  },
);
const { After } = createBdd(test);
After({ tags: "@taxonomy-authoring-contracts" }, async () => {
  globalThis.fetch = originalFetch;
});

async function rows(sql: string, values: unknown[]): Promise<{ row: Row }[]> {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL must select the Admin database under test");
  operation("SELECT retained authoring rows", { sql, values });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    return (await pool.query(sql, values)).rows;
  } finally {
    await pool.end();
  }
}
async function authoredRows(
  world: AdminWorld,
  kind: "event_kinds" | "projects" | "experts",
) {
  const field = kind === "experts" ? "family_name" : "title";
  return rows(
    `SELECT to_jsonb(t) AS row FROM ${kind} t WHERE ${field} LIKE $1 ORDER BY id`,
    [`${state(world).prefix}%`],
  );
}
async function created(
  page: Page,
  resource: string,
  submit: string,
): Promise<Row> {
  const pending = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/v1/admin/${resource}`,
  );
  await page.getByTestId(submit).click();
  const response = await pending;
  expect(response.status()).toBe(201);
  const row = (await response.json()) as Row;
  operation("owned taxonomy row", { resource, id: row.id });
  await page.waitForURL(new RegExp(`/${resource}/${row.id}$`, "u"));
  return row;
}
async function refuse(
  page: Page,
  world: AdminWorld,
  resource: string,
  body: Record<string, unknown>,
  current?: Row,
) {
  const result = await page.evaluate(
    async ({ resource, body, current }) => {
      const csrf = /(?:^|; )__Host-ds_admin_csrf=([^;]*)/u.exec(
        document.cookie,
      )?.[1];
      if (!csrf) throw new Error("No real Admin CSRF cookie");
      const response = await fetch(
        `/v1/admin/${resource}${current ? `/${current.id}` : ""}`,
        {
          method: current ? "PATCH" : "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-ds-admin-csrf": decodeURIComponent(csrf),
            "idempotency-key": crypto.randomUUID(),
            ...(current ? { "if-match": `W/"${current.version}"` } : {}),
          },
          body: JSON.stringify(body),
        },
      );
      const problem = (await response.json()) as { errorCode: string };
      return { status: response.status, errorCode: problem.errorCode };
    },
    { resource, body, current },
  );
  expect(result).toEqual({ status: 400, errorCode: "VALIDATION_FAILED" });
  state(world).refusals.push(result);
}
async function noSlugEditor(page: Page) {
  await expect(
    page.locator(
      'input[name*="slug" i],input[id*="slug" i],textarea[name*="slug" i]',
    ),
  ).toHaveCount(0);
}

When(
  "the admin submits an event-kind mutation carrying a slug",
  async ({ page, world }) => {
    const current = state(world);
    await page.goto("/event-kinds/create");
    await expect(page.getByTestId("event-kind-form")).toBeVisible();
    await noSlugEditor(page);
    await page.getByTestId("event-kind-title").fill(`${current.prefix} kind`);
    await page
      .getByTestId("event-kind-format-online")
      .locator("xpath=ancestor::label[1]")
      .click();
    current.kind = await created(page, "event-kinds", "submit-event-kind");
    expect(current.kind.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    expect(current.kind.slug).not.toMatch(/^[0-9a-f-]{36}$/u);
    await noSlugEditor(page);
    current.before = await authoredRows(world, "event_kinds");
    expect(current.before).toHaveLength(1);
    expect(current.before).toMatchObject([
      {
        row: {
          id: current.kind.id,
          slug: current.kind.slug,
          status: "draft",
          version: 1,
        },
      },
    ]);
    await refuse(page, world, "event-kinds", {
      title: `${current.prefix} refused`,
      allowedFormats: ["online"],
      slug: "authored-slug",
    });
    expect(await authoredRows(world, "event_kinds")).toEqual(current.before);
    await refuse(
      page,
      world,
      "event-kinds",
      { title: `${current.prefix} losing edit`, slug: "authored-edit" },
      current.kind,
    );
  },
);
Then("the mutation is rejected", async ({ page, world }) => {
  const current = state(world);
  expect(current.refusals).toHaveLength(2);
  expect(await authoredRows(world, "event_kinds")).toEqual(current.before);
  await page.reload();
  await expect(page.getByTestId("event-kind-title")).toHaveValue(
    `${current.prefix} kind`,
  );
  await noSlugEditor(page);
});

When(
  "the admin saves a project with no default audience",
  async ({ page, world }) => {
    const current = state(world);
    await page.goto("/projects/create");
    await expect(page.getByTestId("project-form")).toBeVisible();
    await page.locator("#title").fill(`${current.prefix} project`);
    await page
      .locator("#description")
      .fill("Описание проекта для проверки обязательной аудитории.");
    const audience = page.getByTestId("project-default-audience");
    await expect(audience).toHaveValue("");
    const writes: string[] = [];
    const observe = (request: import("@playwright/test").Request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/v1/admin/projects"
      )
        writes.push(request.url());
    };
    page.on("request", observe);
    try {
      await page.getByTestId("submit-project").click();
      await expect(audience).toHaveAttribute("aria-invalid", "true");
      const describedBy = await audience.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      const alert = page.locator(
        describedBy!
          .split(/\s+/u)
          .map((id) => `[id="${id}"][role="alert"]`)
          .join(","),
      );
      await expect(alert).toBeVisible();
      await expect(alert).toContainText("Обязательное поле.");
      await expect(page).toHaveURL(/\/projects\/create$/u);
      expect(writes).toEqual([]);
      expect(await authoredRows(world, "projects")).toEqual([]);
    } finally {
      page.off("request", observe);
    }
    await audience.selectOption("doctors");
    // 030 EARS-1: «Проект идёт» owes no «Что происходит сейчас».
    await chooseProjectStage(page);
    current.project = await created(page, "projects", "submit-project");
    current.before = await authoredRows(world, "projects");
    expect(current.before).toHaveLength(1);
    expect(current.before).toMatchObject([
      {
        row: {
          id: current.project.id,
          default_audience: "doctors",
          status: "draft",
          version: 1,
        },
      },
    ]);
    await refuse(page, world, "projects", {
      kind: "school",
      title: `${current.prefix} refused`,
    });
    expect(await authoredRows(world, "projects")).toEqual(current.before);
    // A partial update may omit an unchanged default; explicitly removing it is
    // the invalid write. The accepted row and version must remain byte-for-byte.
    await refuse(
      page,
      world,
      "projects",
      { defaultAudience: null },
      current.project,
    );
  },
);
Then("the project contract rejects the write", async ({ page, world }) => {
  const current = state(world);
  expect(current.refusals).toHaveLength(2);
  expect(await authoredRows(world, "projects")).toEqual(current.before);
  await page.reload();
  await expect(page.getByTestId("project-default-audience")).toHaveValue(
    "doctors",
  );
});

Given("one existing User is unlinked", async ({ world }) => {
  const current = state(world);
  expect(current.email).toBeTruthy();
  const users = await rows(
    "SELECT to_jsonb(u) AS row FROM users u WHERE email=$1",
    [current.email],
  );
  expect(users).toHaveLength(1);
  current.userId = users[0].row.id;
  expect(
    await rows("SELECT to_jsonb(e) AS row FROM experts e WHERE user_id=$1", [
      current.userId,
    ]),
  ).toEqual([]);
});
async function openExpert(page: Page, family: string) {
  await page.goto("/experts/create");
  await expect(
    page.getByRole("combobox", { name: "Пользователь" }),
  ).toBeEnabled();
  await page.getByTestId("expert-family-name").fill(family);
  await page.getByTestId("expert-given-name").fill("Иван");
}
async function selectUser(page: Page, email: string) {
  await page.getByRole("combobox", { name: "Пользователь" }).click();
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "Поиск пользователя" })
    .fill(email);
  await page.getByText(email, { exact: true }).click();
  await expect(page.getByTestId("expert-user-unlink")).toBeVisible();
}
When("CreateExpert is called without a User", async ({ page, world }) => {
  const current = state(world);
  await openExpert(page, `${current.prefix} standalone`);
  await expect(
    page.getByRole("combobox", { name: "Пользователь" }),
  ).toContainText("Без учётной записи");
  current.standalone = await created(page, "experts", "submit-expert");
});
Then("one standalone Expert is created", async ({ world }) => {
  const current = state(world);
  const result = await authoredRows(world, "experts");
  expect(result).toHaveLength(1);
  expect(result[0].row).toMatchObject({
    id: current.standalone!.id,
    user_id: null,
    status: "draft",
    version: 1,
  });
});
When(
  "CreateExpert or LinkExpertUser is called with that unlinked User",
  async ({ page, context, world }) => {
    const current = state(world);
    await openExpert(page, `${current.prefix} owner`);
    current.stale = await context.newPage();
    await openExpert(current.stale, `${current.prefix} losing owner`);
    await selectUser(page, current.email!);
    await selectUser(current.stale, current.email!);
    current.owner = await created(page, "experts", "submit-expert");
  },
);
Then(
  "one Expert references that User through the same command model",
  async ({ page, world }) => {
    const current = state(world);
    const owners = await rows(
      "SELECT to_jsonb(e) AS row FROM experts e WHERE user_id=$1",
      [current.userId],
    );
    expect(owners).toHaveLength(1);
    expect(owners[0].row).toMatchObject({
      id: current.owner!.id,
      user_id: current.userId,
      version: 1,
    });
    const standalone = await rows(
      "SELECT to_jsonb(e) AS row FROM experts e WHERE id=$1",
      [current.standalone!.id],
    );
    expect(standalone).toHaveLength(1);
    expect(standalone[0].row).toMatchObject({
      id: current.standalone!.id,
      user_id: null,
      version: 1,
    });
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Пользователь" }),
    ).toContainText(current.email!);
    current.before = await authoredRows(world, "experts");
    expect(current.before).toHaveLength(2);
  },
);
Then(
  "a second ownership attempt is refused with 409 USER_EXPERT_CONFLICT",
  async ({ world }) => {
    const current = state(world);
    const stale = current.stale!;
    try {
      const pending = stale.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/v1/admin/experts",
      );
      await stale.getByTestId("submit-expert").click();
      const response = await pending;
      expect(response.status()).toBe(409);
      expect(await response.json()).toMatchObject({
        errorCode: "USER_EXPERT_CONFLICT",
      });
      await expect(stale.getByTestId("create-error")).toContainText(
        "Этот пользователь уже связан с другим экспертом. Ничего не изменилось — обновите страницу и выберите другого.",
      );
      await expect(stale).toHaveURL(/\/experts\/create$/u);
      expect(await authoredRows(world, "experts")).toEqual(current.before);
      const owners = await rows(
        "SELECT to_jsonb(e) AS row FROM experts e WHERE user_id=$1",
        [current.userId],
      );
      expect(owners).toHaveLength(1);
      expect(owners[0].row.id).toBe(current.owner!.id);
    } finally {
      await stale.close();
    }
  },
);
