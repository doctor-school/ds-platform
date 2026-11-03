import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

import { standHttpCredentials } from "@ds/e2e/stand-http-credentials";
import { PublicEventKindListSchema } from "@ds/schemas";
import { expect, request, type Page } from "@playwright/test";
import { Pool } from "pg";

import {
  Before,
  Given,
  Then,
  When,
  type AdminWorld,
} from "../support/fixtures";
import { selectRelationshipCombobox } from "../support/relationship-combobox";

type Kind = { id: string; slug: string; title: string };
type State = {
  kind?: Kind;
  eventIds: string[];
  project?: { id: string; title: string };
  publicKinds?: Kind[];
};
const states = new WeakMap<AdminWorld, State>();
function state(world: AdminWorld): State {
  let value = states.get(world);
  if (!value) {
    value = { eventIds: [] };
    states.set(world, value);
  }
  return value;
}
function kind(world: AdminWorld): Kind {
  const value = state(world).kind;
  if (!value) throw new Error("No scenario-owned event kind selected");
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
Before({ tags: "@event-classification-lifecycle" }, async ({ page }) => {
  page.on("request", (read) => {
    const url = new URL(read.url());
    operation(`browser ${read.method()} ${url.origin}${url.pathname}`);
  });
});

async function retained(sql: string, values: unknown[]) {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL must select the Admin database under test");
  operation(`SELECT retained classification rows: ${sql}`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    return (await pool.query(sql, values)).rows;
  } finally {
    await pool.end();
  }
}
async function webinar(world: AdminWorld): Promise<void> {
  const rows = await retained(
    "SELECT id,slug,title FROM event_kinds WHERE title=$1 AND status=$2 AND deleted_at IS NULL",
    ["Вебинар", "published"],
  );
  expect(rows).toHaveLength(1);
  state(world).kind = rows[0] as Kind;
}
async function fillEvent(page: Page, world: AdminWorld): Promise<void> {
  await page.goto("/events/create");
  await expect(page.getByTestId("event-form")).toBeVisible();
  await page.locator("#title").fill(`Classification ${randomUUID()}`);
  await page.locator("#school").fill("Кардиология");
  await page.locator("#specialties").fill("cardiology");
  await page
    .locator("#startsAtMsk")
    .fill(
      new Date(Date.now() + 7 * 86_400_000 + 10_800_000)
        .toISOString()
        .slice(0, 16),
    );
  await page.locator("#durationMin").fill("90");
  await page.getByTestId("event-kind").selectOption(kind(world).id);
  await page.getByTestId("event-participation-format").selectOption("online");
}
async function saveEvent(page: Page, world: AdminWorld): Promise<void> {
  await page.getByTestId("submit-event").click();
  await page.waitForURL(/\/events\/[0-9a-f-]{36}$/u);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  state(world).eventIds.push(id);
  operation(`owned event ${id}`);
  await expect(page.getByTestId("event-kind")).toHaveValue(kind(world).id);
}

When(
  "the admin creates an event with the published kind «Вебинар» and the format online",
  async ({ page, world }) => {
    await webinar(world);
    await fillEvent(page, world);
    await page.getByTestId("event-audience").selectOption("doctors");
    await saveEvent(page, world);
  },
);
Then("the event references exactly that kind", async ({ page, world }) => {
  const id = state(world).eventIds[0];
  expect(
    await retained(
      "SELECT kind_id,participation_format FROM events WHERE id=$1",
      [id],
    ),
  ).toEqual([{ kind_id: kind(world).id, participation_format: "online" }]);
  await page.reload();
  await expect(page.getByTestId("event-kind")).toHaveValue(kind(world).id);
  await expect(page.getByTestId("event-participation-format")).toHaveValue(
    "online",
  );
});

Given(
  "the admin retires a kind through the signed lifecycle-impact preview",
  async ({ page, world }) => {
    const title = `Retained kind ${randomUUID()}`;
    await page.goto("/event-kinds/create");
    await page.getByTestId("event-kind-title").fill(title);
    await page
      .getByTestId("event-kind-format-online")
      .locator("xpath=ancestor::label[1]")
      .click();
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/admin/event-kinds",
    );
    await page.getByTestId("submit-event-kind").click();
    const response = await created;
    expect(response.status()).toBe(201);
    const authored = (await response.json()) as Kind;
    state(world).kind = {
      id: authored.id,
      slug: authored.slug,
      title: authored.title,
    };
    operation(`owned event kind ${authored.id}`);
    await page.waitForURL(new RegExp(`/event-kinds/${authored.id}$`, "u"));
    await page.getByTestId("event-kind-publish").click();
    await expect(page.getByTestId("event-kind-status")).toHaveText(
      "Опубликовано",
    );
    await fillEvent(page, world);
    await page.getByTestId("event-audience").selectOption("doctors");
    await saveEvent(page, world);
    await page.goto(`/event-kinds/${authored.id}`);
    await page.getByTestId("event-kind-retire").click();
    await expect(page.getByTestId("event-kind-retire-impact")).toBeVisible();
    await expect(page.getByTestId("event-kind-retire-submit")).toBeEnabled();
    const retired = page.waitForResponse(
      (answer) =>
        answer.request().method() === "POST" &&
        new URL(answer.url()).pathname ===
          `/v1/admin/event-kinds/${authored.id}/retire`,
    );
    await page.getByTestId("event-kind-retire-submit").click();
    const answer = await retired;
    expect(answer.status()).toBe(200);
    const headers = answer.request().headers();
    expect(headers["lifecycle-impact-token"]).toBeTruthy();
    expect(headers["if-match"]).toBeTruthy();
    await expect(page.getByTestId("event-kind-status")).toHaveText(
      "Снято с публикации",
    );
  },
);
When(
  "the public kind list and the event-form kind selector are read",
  async ({ page, world }) => {
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
      state(world).publicKinds = PublicEventKindListSchema.parse(
        await response.json(),
      ).data;
      expect(
        (await api.storageState()).cookies.filter(
          (cookie) => cookie.name !== "ds_stage_gate",
        ),
      ).toEqual([]);
    } finally {
      await api.dispose();
    }
    await page.goto("/events/create");
    await expect(page.getByTestId("event-form")).toBeVisible();
    await expect(
      page
        .getByTestId("event-kind")
        .locator('option[value="00460046-0000-4000-8000-000000000001"]'),
    ).toBeAttached();
  },
);
Then(
  "the public kind list still names the retired kind as id, slug and title",
  async ({ world }) => {
    expect(
      state(world).publicKinds?.filter((row) => row.id === kind(world).id),
    ).toEqual([kind(world)]);
  },
);
Then(
  "the event-form kind selector no longer offers it",
  async ({ page, world }) => {
    await expect(
      page
        .getByTestId("event-kind")
        .locator(`option[value="${kind(world).id}"]`),
    ).toHaveCount(0);
  },
);
Then(
  "the events that carry it keep their kind reference",
  async ({ world }) => {
    const ids = state(world).eventIds;
    expect(ids).toHaveLength(1);
    expect(
      await retained("SELECT id,kind_id FROM events WHERE id=ANY($1::uuid[])", [
        ids,
      ]),
    ).toEqual([{ id: ids[0], kind_id: kind(world).id }]);
    expect(
      await retained("SELECT status FROM event_kinds WHERE id=$1", [
        kind(world).id,
      ]),
    ).toEqual([{ status: "retired" }]);
  },
);

Given(
  "a published project with the default audience experts",
  async ({ page, world }) => {
    const title = `Published experts project ${randomUUID()}`;
    await page.goto("/projects/create");
    await expect(page.getByTestId("project-form")).toBeVisible();
    await page.locator("#title").fill(title);
    await page.locator("#description").fill("Scenario-owned published project");
    await page.getByTestId("project-default-audience").selectOption("experts");
    await page.getByTestId("submit-project").click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/u);
    const id = new URL(page.url()).pathname.split("/").pop()!;
    state(world).project = { id, title };
    operation(`owned project ${id}`);
    await page.goto("/experts/create");
    for (const [field, value] of Object.entries({
      "family-name": `Кураторов${Date.now()}`,
      "given-name": "Иван",
      patronymic: "Сергеевич",
      "professional-role": "Ревматолог",
      credentials: "Д. м. н.",
      affiliation: "НИИ ревматологии",
      bio: "Двадцать лет клинической практики и преподавания.",
    }))
      await page.getByTestId(`expert-${field}`).fill(value);
    await page.getByTestId("submit-expert").click();
    await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/u);
    const expertId = new URL(page.url()).pathname.split("/").pop()!;
    operation(`owned expert ${expertId}`);
    await page.getByTestId("tab-publish").click();
    await page.getByTestId("experts-publish").click();
    await expect(page.getByTestId("expert-status")).toHaveText("Опубликован");
    await page.getByTestId("tab-projects").click();
    await selectRelationshipCombobox(
      page,
      "project-expert-link-combobox",
      title,
      title,
    );
    await page.getByTestId("project-expert-link-role").selectOption("curator");
    await page.getByTestId("project-expert-link-submit").click();
    await expect(page.getByTestId("project-experts-notice")).toBeVisible();
    await page.goto(`/projects/${id}`);
    await page.getByTestId("tab-publish").click();
    await page.getByTestId("projects-publish").click();
    await expect(page.getByTestId("project-status")).toHaveText("Опубликован");
    expect(
      await retained(
        "SELECT status,default_audience FROM projects WHERE id=$1",
        [id],
      ),
    ).toEqual([{ status: "published", default_audience: "experts" }]);
    expect(
      await retained(
        "SELECT id FROM project_experts WHERE project_id=$1 AND expert_id=$2 AND role=$3 AND status=$4",
        [id, expertId, "curator", "active"],
      ),
    ).toHaveLength(1);
  },
);
When(
  "the admin creates an event linked to that project",
  async ({ page, world }) => {
    const project = state(world).project;
    if (!project) throw new Error("No scenario-owned published project");
    await webinar(world);
    await fillEvent(page, world);
    await selectRelationshipCombobox(
      page,
      "event-project-combobox",
      project.title,
      project.title,
    );
  },
);
Then("the event form shows the audience experts", async ({ page }) => {
  await expect(page.getByTestId("event-audience")).toHaveValue("experts");
});
When(
  "the admin changes the audience to doctors and saves",
  async ({ page, world }) => {
    await page.getByTestId("event-audience").selectOption("doctors");
    await saveEvent(page, world);
  },
);
Then(
  "the event is stored with the audience doctors",
  async ({ page, world }) => {
    const id = state(world).eventIds[0];
    expect(
      await retained("SELECT audience FROM events WHERE id=$1", [id]),
    ).toEqual([{ audience: "doctors" }]);
    expect(
      await retained(
        "SELECT id FROM event_projects WHERE event_id=$1 AND project_id=$2 AND status=$3",
        [id, state(world).project!.id, "active"],
      ),
    ).toHaveLength(1);
    await page.reload();
    await expect(page.getByTestId("event-audience")).toHaveValue("doctors");
  },
);
