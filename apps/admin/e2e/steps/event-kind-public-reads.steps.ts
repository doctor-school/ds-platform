import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

import { bootstrapAdminSession, signInAsAdmin } from "@ds/e2e/admin-events";
import { standHttpCredentials } from "@ds/e2e/stand-http-credentials";
import { PublicEventKindListSchema } from "@ds/schemas";
import { expect, request, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { Pool } from "pg";

import {
  adminOrigin,
  Given,
  When,
  Then,
  test,
  type AdminWorld,
} from "../support/fixtures";
import { visible } from "../support/visible";

type Kind = {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "published";
  allowedFormats: string[];
};
type PublicKind = Pick<Kind, "id" | "slug" | "title">;
const states = new WeakMap<
  AdminWorld,
  { kind?: Kind; publicKinds?: PublicKind[] }
>();
function state(world: AdminWorld) {
  let current = states.get(world);
  if (!current) {
    current = {};
    states.set(world, current);
  }
  return current;
}
function kind(world: AdminWorld): Kind {
  const value = state(world).kind;
  if (!value) throw new Error("No event kind was authored through the Admin");
  return value;
}
function operation(op: string): void {
  const file =
    process.env.E2E_EVENT_KIND_LOG ?? process.env.E2E_CANONICAL_EXPERT_LOG;
  if (file)
    appendFileSync(
      file,
      JSON.stringify({ at: new Date().toISOString(), op }) + "\n",
    );
}
const { Before } = createBdd(test);
Before({ tags: "@event-kind-public-reads" }, async ({ page }) => {
  page.on("request", (read) => {
    const url = new URL(read.url());
    operation(`browser ${read.method()} ${url.origin}${url.pathname}`);
  });
});

async function signIn(page: Page) {
  operation("bootstrap standard owned Admin business-test account");
  const credentials = await bootstrapAdminSession(adminOrigin());
  operation(`owned fixture account ${credentials.email}`);
  await signInAsAdmin(page, credentials);
  await expect(page.getByTestId("create-event")).toBeVisible();
}
Given("a platform_admin signed in to the admin", async ({ page }) => {
  await signIn(page);
});

async function createKind(page: Page, world: AdminWorld, title: string) {
  await page.goto("/event-kinds/create");
  await page.getByTestId("event-kind-title").fill(title);
  for (const format of ["online", "hybrid"])
    await page
      .getByTestId(`event-kind-format-${format}`)
      .locator("xpath=ancestor::label[1]")
      .click();
  const created = page.waitForResponse(
    (answer) =>
      answer.request().method() === "POST" &&
      new URL(answer.url()).pathname === "/v1/admin/event-kinds",
  );
  await page.getByTestId("submit-event-kind").click();
  const response = await created;
  expect(response.status()).toBe(201);
  const payload = response.request().postDataJSON();
  expect(payload).toEqual({ title, allowedFormats: ["online", "hybrid"] });
  const authored: Kind = await response.json();
  expect(authored).toMatchObject({
    title,
    status: "draft",
    allowedFormats: ["online", "hybrid"],
  });
  expect(authored.id).toMatch(/^[0-9a-f-]{36}$/u);
  expect(authored.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  expect(authored.slug).not.toMatch(/^[0-9a-f-]{36}$/u);
  state(world).kind = authored;
  operation(`owned event kind ${authored.id}`);
  await page.waitForURL(new RegExp(`/event-kinds/${authored.id}$`, "u"));
  await expect(page.getByTestId("event-kind-heading")).toHaveText(title);
  await expect(page.getByTestId("event-kind-status")).toHaveText("Черновик");
}
async function publishKind(page: Page, world: AdminWorld) {
  const authored = kind(world);
  const published = page.waitForResponse(
    (answer) =>
      answer.request().method() === "POST" &&
      new URL(answer.url()).pathname ===
        `/v1/admin/event-kinds/${authored.id}/publish`,
  );
  await page.getByTestId("event-kind-publish").click();
  const response = await published;
  expect(response.status()).toBe(200);
  const detail: Kind = await response.json();
  expect(detail).toMatchObject({
    id: authored.id,
    title: authored.title,
    slug: authored.slug,
    allowedFormats: authored.allowedFormats,
    status: "published",
  });
  state(world).kind = detail;
  await expect(page.getByTestId("event-kind-status")).toHaveText(
    "Опубликовано",
  );
}
When(
  "the admin creates the event kind «Круглый стол» allowing the formats online and hybrid and publishes it",
  async ({ page, world }) => {
    await createKind(page, world, "Круглый стол");
    await publishKind(page, world);
  },
);
Given("the admin publishes a new event kind", async ({ page, world }) => {
  await signIn(page);
  await createKind(page, world, `Новый вид ${randomUUID()}`);
  await publishKind(page, world);
});
Given(
  "the admin creates an event kind and leaves it a draft",
  async ({ page, world }) => {
    await signIn(page);
    await createKind(page, world, `Черновик вида ${randomUUID()}`);
  },
);

async function retainedKind(world: AdminWorld) {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL must point at the Admin database under test");
  operation(`SELECT retained event_kinds row ${kind(world).id}`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const rows = await pool.query(
      "SELECT row_to_json(k) AS row FROM event_kinds k WHERE id = $1",
      [kind(world).id],
    );
    expect(rows.rows).toHaveLength(1);
    return rows.rows[0].row;
  } finally {
    await pool.end();
  }
}
Then(
  "one retained event_kinds row exists with a system-generated slug and the allowed formats online and hybrid",
  async ({ world }) => {
    const authored = kind(world);
    expect(await retainedKind(world)).toMatchObject({
      id: authored.id,
      title: "Круглый стол",
      slug: authored.slug,
      status: "published",
      allowed_formats: ["online", "hybrid"],
      first_published_at: expect.any(String),
      deleted_at: null,
    });
    expect(authored.slug).toMatch(/^kruglyy-stol(?:-\d+)?$/u);
  },
);
Then("the row carries no storefront attribute", async ({ world }) => {
  const row = await retainedKind(world);
  expect(Object.keys(row).sort()).toEqual([
    "allowed_formats",
    "created_at",
    "deleted_at",
    "first_published_at",
    "id",
    "slug",
    "status",
    "title",
    "updated_at",
    "version",
  ]);
  expect(kind(world)).not.toHaveProperty("storefront");
  expect(kind(world)).not.toHaveProperty("audience");
});
Then(
  "the same row renders on the event-kind list and detail",
  async ({ page, world }) => {
    const authored = kind(world);
    await page.reload();
    await expect(page.getByTestId("event-kind-title")).toHaveValue(
      authored.title,
    );
    await expect(page.getByTestId("event-kind-status")).toHaveText(
      "Опубликовано",
    );
    for (const format of ["online", "hybrid"])
      await expect(
        page.getByTestId(`event-kind-format-${format}`),
      ).toBeChecked();
    await expect(
      page.getByTestId("event-kind-format-offline"),
    ).not.toBeChecked();
    await page.getByTestId("back-to-list").click();
    await expect(visible(page.getByTestId(`row-${authored.id}`))).toHaveText(
      authored.title,
    );
    await visible(
      page.locator(`a[href="/event-kinds/${authored.id}"]`),
    ).click();
    await expect(page).toHaveURL(
      new RegExp(`/event-kinds/${authored.id}$`, "u"),
    );
    await expect(page.getByTestId("event-kind-heading")).toHaveText(
      authored.title,
    );
  },
);

When("the public kind list is read", async ({ world }) => {
  const origin = process.env.E2E_API_URL;
  if (!origin) throw new Error("E2E_API_URL must select the API under test");
  const credentials = standHttpCredentials();
  const api = await request.newContext({
    baseURL: origin,
    ...(credentials ? { httpCredentials: credentials } : {}),
    storageState: { cookies: [], origins: [] },
  });
  try {
    operation("GET anonymous /v1/public/event-kinds");
    const response = await api.get("/v1/public/event-kinds");
    expect(response.status()).toBe(200);
    const body = PublicEventKindListSchema.parse(await response.json());
    state(world).publicKinds = body.data;
    expect(
      (await api.storageState()).cookies
        .map((cookie) => cookie.name)
        .filter((name) => name !== "ds_stage_gate"),
    ).toEqual([]);
  } finally {
    await api.dispose();
  }
});
Then("the new kind is listed as id, slug and title", async ({ world }) => {
  const authored = kind(world);
  const matches = state(world).publicKinds?.filter(
    (row) => row.id === authored.id,
  );
  expect(matches).toEqual([
    { id: authored.id, slug: authored.slug, title: authored.title },
  ]);
});
Then("the draft kind is not listed", async ({ page, world }) => {
  const authored = kind(world);
  await page.reload();
  await expect(page.getByTestId("event-kind-status")).toHaveText("Черновик");
  expect(await retainedKind(world)).toMatchObject({
    id: authored.id,
    title: authored.title,
    status: "draft",
    first_published_at: null,
  });
  expect(state(world).publicKinds).toBeDefined();
  expect(
    state(world).publicKinds!.some(
      (row) => row.id === authored.id || row.slug === authored.slug,
    ),
  ).toBe(false);
});
