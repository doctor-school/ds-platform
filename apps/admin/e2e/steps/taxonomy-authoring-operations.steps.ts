import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

import { standHttpCredentials } from "@ds/e2e/stand-http-credentials";
import { expect, request, type Page, type Response } from "@playwright/test";
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
import { selectRelationshipCombobox } from "../support/relationship-combobox";
import {
  cleanupInventory,
  mediaObservation,
  type Cleanup,
} from "../support/media-observation";

type Project = { id: string; title: string };
type State = {
  eventId?: string;
  projects: Project[];
  lifecycle?: { events: unknown[]; projects: unknown[] };
  forward?: string[];
  reverse?: string[][];
  media?: {
    project: Project;
    keys: string[];
    commits: { ref: string | null; version: number; jobs: Cleanup[] }[];
  };
  prefix?: string;
};
const states = new WeakMap<AdminWorld, State>();
function state(world: AdminWorld): State {
  let value = states.get(world);
  if (!value) {
    value = { projects: [] };
    states.set(world, value);
  }
  return value;
}
function operation(op: string, detail?: unknown): void {
  const file = process.env.E2E_TAXONOMY_AUTHORING_LOG;
  if (file)
    appendFileSync(
      file,
      JSON.stringify({
        at: new Date().toISOString(),
        op,
        ...(detail ? { detail } : {}),
      }) + "\n",
    );
}
const originalFetch = globalThis.fetch;
Before({ tags: "@taxonomy-authoring-operations" }, async ({ page }) => {
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
      if (body.email) operation("owned account", { email: body.email });
    }
    return originalFetch(input, init);
  };
  page.on("request", (read) => {
    const url = new URL(read.url());
    operation(`browser ${read.method()} ${url.origin}${url.pathname}`);
  });
});
const { After } = createBdd(test);
After({ tags: "@taxonomy-authoring-operations" }, async ({ world }) => {
  if (world.email) operation("owned account", { email: world.email });
  globalThis.fetch = originalFetch;
});

async function retained(sql: string, values: unknown[]) {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL must select the Admin database under test");
  operation(`SELECT ${sql}`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    return (await pool.query(sql, values)).rows;
  } finally {
    await pool.end();
  }
}
function mutation(
  page: Page,
  method: string,
  path: string,
  expected?: Record<string, string>,
): Promise<Response> {
  return page.waitForResponse((answer) => {
    if (
      answer.request().method() !== method ||
      new URL(answer.url()).pathname !== path
    )
      return false;
    if (!expected) return true;
    const body = answer.request().postDataJSON() as Record<string, string>;
    return Object.entries(expected).every(
      ([key, value]) => body[key] === value,
    );
  });
}
async function createProject(page: Page, title: string): Promise<Project> {
  await page.goto("/projects/create");
  await expect(page.getByTestId("project-form")).toBeVisible();
  await page.locator("#title").fill(title);
  await page
    .locator("#description")
    .fill("Образовательная программа для врачей.");
  await page.getByTestId("project-default-audience").selectOption("doctors");
  // 030 EARS-1: «Проект идёт» owes no «Что происходит сейчас».
  await chooseProjectStage(page);
  const committed = mutation(page, "POST", "/v1/admin/projects");
  await page.getByTestId("submit-project").click();
  const answer = await committed;
  expect(answer.status()).toBe(201);
  const authored = (await answer.json()) as Project;
  operation("owned project", { id: authored.id });
  await page.waitForURL(new RegExp(`/projects/${authored.id}$`, "u"));
  return { id: authored.id, title };
}
async function publishedExpert(page: Page): Promise<string> {
  await page.goto("/experts/create");
  for (const [field, value] of Object.entries({
    "family-name": `Связанов${Date.now()}`,
    "given-name": "Иван",
    patronymic: "Сергеевич",
    "professional-role": "Ревматолог",
    credentials: "Д. м. н.",
    affiliation: "НИИ ревматологии",
    bio: "Двадцать лет клинической практики и преподавания.",
  }))
    await page.getByTestId(`expert-${field}`).fill(value);
  const created = mutation(page, "POST", "/v1/admin/experts");
  await page.getByTestId("submit-expert").click();
  const answer = await created;
  expect(answer.status()).toBe(201);
  const { id } = (await answer.json()) as { id: string };
  operation("owned expert", { id });
  await page.waitForURL(new RegExp(`/experts/${id}$`, "u"));
  await page.getByTestId("tab-publish").click();
  const published = mutation(page, "POST", `/v1/admin/experts/${id}/publish`);
  await page.getByTestId("experts-publish").click();
  expect((await published).status()).toBe(200);
  await expect(page.getByTestId("expert-status")).toHaveText("Опубликован");
  return id;
}
async function lifecycle(world: AdminWorld) {
  const current = state(world);
  return {
    events: await retained(
      "SELECT id,state,record_status FROM events WHERE id=$1",
      [current.eventId],
    ),
    projects: await retained(
      "SELECT id,status,deleted_at,first_published_at FROM projects WHERE id=ANY($1::uuid[]) ORDER BY id",
      [current.projects.map((p) => p.id)],
    ),
  };
}
Given(
  "one public event and two published projects",
  async ({ page, world }) => {
    const current = state(world);
    for (const suffix of ["A", "B"])
      current.projects.push(
        await createProject(page, `Связи ${suffix} ${randomUUID()}`),
      );
    const expertId = await publishedExpert(page);
    for (const project of current.projects) {
      await page.goto(`/experts/${expertId}`);
      await page.getByTestId("tab-projects").click();
      await selectRelationshipCombobox(
        page,
        "project-expert-link-combobox",
        project.title,
        project.title,
      );
      await page
        .getByTestId("project-expert-link-role")
        .selectOption("curator");
      const linked = mutation(page, "POST", "/v1/admin/project-experts", {
        projectId: project.id,
        expertId,
      });
      await page.getByTestId("project-expert-link-submit").click();
      const answer = await linked;
      expect(answer.status()).toBeLessThan(300);
      operation("owned project expert", {
        id: ((await answer.json()) as { id: string }).id,
        projectId: project.id,
        expertId,
      });
      await page.goto(`/projects/${project.id}`);
      // 030 EARS-6: a published project holds at least one result.
      await page.getByTestId("tab-results").click();
      await page.getByTestId("result-add").click();
      await page.getByTestId("result-kind-0").selectOption({ label: "Клуб" });
      await page.getByTestId("result-title-0").fill(project.title);
      await page.getByTestId("results-save").click();
      await expect(page.getByTestId("results-saved")).toBeVisible();
      await page.getByTestId("tab-publish").click();
      const published = mutation(
        page,
        "POST",
        `/v1/admin/projects/${project.id}/publish`,
      );
      await page.getByTestId("projects-publish").click();
      expect((await published).status()).toBe(200);
      await expect(page.getByTestId("project-status")).toHaveText(
        "Опубликован",
      );
    }
    const kinds = await retained(
      "SELECT id FROM event_kinds WHERE title=$1 AND status=$2 AND deleted_at IS NULL",
      ["Вебинар", "published"],
    );
    expect(kinds).toHaveLength(1);
    await page.goto("/events/create");
    await expect(page.getByTestId("event-form")).toBeVisible();
    await page.locator("#title").fill(`Событие связей ${randomUUID()}`);
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
    await page.getByTestId("event-kind").selectOption(kinds[0]!.id as string);
    await page.getByTestId("event-audience").selectOption("doctors");
    const created = mutation(page, "POST", "/v1/admin/events");
    await page.getByTestId("submit-event").click();
    const answer = await created;
    expect(answer.status()).toBe(201);
    const { id } = (await answer.json()) as { id: string };
    current.eventId = id;
    operation("owned event", { id });
    await page.waitForURL(new RegExp(`/events/${id}$`, "u"));
    const published = mutation(page, "POST", `/v1/admin/events/${id}/publish`);
    await page.getByTestId("action-publish").click();
    expect((await published).status()).toBe(200);
    await expect(page.getByTestId("state-published")).toBeVisible();
    expect(
      await retained("SELECT id FROM event_projects WHERE event_id=$1", [id]),
    ).toEqual([]);
    current.lifecycle = await lifecycle(world);
  },
);
When(
  "the operator creates an active event_projects link for each project",
  async ({ page, world }) => {
    const current = state(world);
    await page.getByTestId("tab-projects").click();
    await expect(page.getByTestId("event-project-link-submit")).toBeDisabled();
    for (const project of current.projects) {
      await selectRelationshipCombobox(
        page,
        "event-project-link-combobox",
        project.title,
        project.title,
      );
      const committed = mutation(page, "POST", "/v1/admin/event-projects", {
        eventId: current.eventId!,
        projectId: project.id,
      });
      await page.getByTestId("event-project-link-submit").click();
      const answer = await committed;
      expect(answer.status()).toBeLessThan(300);
      const join = (await answer.json()) as { id: string; status: string };
      expect(join.status).toBe("active");
      operation("owned event project", {
        id: join.id,
        eventId: current.eventId,
        projectId: project.id,
      });
      await expect(
        page.getByTestId(`event-project-row-${join.id}`),
      ).toBeVisible();
    }
    expect(
      await retained(
        "SELECT project_id FROM event_projects WHERE event_id=$1 AND status=$2 AND deleted_at IS NULL ORDER BY project_id",
        [current.eventId, "active"],
      ),
    ).toEqual(
      current.projects
        .map((p) => ({ project_id: p.id }))
        .sort((a, b) => a.project_id.localeCompare(b.project_id)),
    );
  },
);
async function publicIds(path: string): Promise<string[]> {
  const origin = process.env.E2E_API_URL;
  if (!origin) throw new Error("E2E_API_URL must select the API under test");
  const credentials = standHttpCredentials();
  const api = await request.newContext({
    baseURL: origin,
    ...(credentials ? { httpCredentials: credentials } : {}),
    storageState: { cookies: [], origins: [] },
  });
  try {
    operation(`GET anonymous ${path}`);
    const answer = await api.get(path);
    expect(answer.status()).toBe(200);
    const body = (await answer.json()) as { data: { id: string }[] };
    expect(
      (await api.storageState()).cookies.filter(
        (c) => c.name !== "ds_stage_gate",
      ),
    ).toEqual([]);
    return body.data.map((row) => row.id);
  } finally {
    await api.dispose();
  }
}
Then("the event-to-projects read returns both projects", async ({ world }) => {
  const current = state(world);
  current.forward = await publicIds(
    `/v1/public/events/${current.eventId}/projects`,
  );
  expect(current.forward.sort()).toEqual(
    current.projects.map((p) => p.id).sort(),
  );
});
Then(
  "each project-to-events read returns the same event",
  async ({ world }) => {
    const current = state(world);
    current.reverse = [];
    for (const project of current.projects) {
      const ids = await publicIds(`/v1/public/projects/${project.id}/events`);
      expect(ids).toEqual([current.eventId]);
      current.reverse.push(ids);
    }
  },
);
Then("no event or project lifecycle state changes", async ({ world }) => {
  expect(await lifecycle(world)).toEqual(state(world).lifecycle);
});

const IMAGES = [
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
];
async function mediaRead<T>(read: (pool: Pool) => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL must select the Admin database under test");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    return await read(pool);
  } finally {
    await pool.end();
  }
}
async function mediaSnapshot(
  project: Project,
  jobIds: string[],
  beforeJobIds: string[] | null = null,
) {
  const snapshot = await mediaRead((pool) =>
    mediaObservation(pool, project.id, jobIds, beforeJobIds, operation),
  );
  operation("owned media jobs", { projectId: project.id, jobs: snapshot.jobs });
  return snapshot;
}
async function upload(
  page: Page,
  project: Project,
  image: number,
  jobIds: string[] = [],
) {
  await page.setInputFiles("#cover", {
    name: `изображение-${image}.png`,
    mimeType: "image/png",
    buffer: Buffer.from(IMAGES[image]!, "base64"),
  });
  const beforeJobIds = await mediaRead((pool) =>
    cleanupInventory(pool, operation),
  );
  const committed = mutation(page, "PATCH", `/v1/admin/projects/${project.id}`);
  await page.getByTestId("submit-project").click();
  const answer = await committed;
  expect(answer.status()).toBe(200);
  expect(answer.request().headers()["content-type"]).toContain(
    "multipart/form-data",
  );
  const snapshot = await mediaSnapshot(project, jobIds, beforeJobIds);
  expect(snapshot.ref).toBeTruthy();
  operation("owned media object", { projectId: project.id, key: snapshot.ref });
  await page.reload();
  await expect(page.getByAltText("Обложка проекта")).toBeVisible();
  return snapshot;
}
Given("an entity has an uploaded image", async ({ page, world }) => {
  const project = await createProject(page, `Обложка ${randomUUID()}`);
  const initial = await upload(page, project, 0);
  expect(initial.jobs).toEqual([]);
  state(world).media = { project, keys: [initial.ref!], commits: [initial] };
});
When("the operator replaces and then removes it", async ({ page, world }) => {
  const media = state(world).media!;
  const replacement = await upload(page, media.project, 1);
  media.keys.push(replacement.ref!);
  media.commits.push(replacement);
  expect(replacement.ref).not.toBe(media.keys[0]);
  expect(replacement.jobs).toHaveLength(1);
  const jobIds = replacement.jobs.map((job) => job.id);
  const beforeJobIds = await mediaRead((pool) =>
    cleanupInventory(pool, operation),
  );
  await page.getByRole("button", { name: "убрать", exact: true }).click();
  const committed = mutation(
    page,
    "PATCH",
    `/v1/admin/projects/${media.project.id}`,
  );
  await page.getByTestId("submit-project").click();
  const answer = await committed;
  expect(answer.status()).toBe(200);
  expect(answer.request().postDataJSON()).toMatchObject({
    mediaAction: "clear",
  });
  const cleared = await mediaSnapshot(media.project, jobIds, beforeJobIds);
  expect(cleared.jobs.filter((job) => !jobIds.includes(job.id))).toHaveLength(
    1,
  );
  media.commits.push(cleared);
  await page.reload();
  await expect(page.getByAltText("Обложка проекта")).toHaveCount(0);
});
Then(
  "each committed change updates the media reference atomically",
  async ({ world }) => {
    const media = state(world).media!;
    expect(media.commits.map((c) => c.ref)).toEqual([...media.keys, null]);
    expect(media.commits.map((c) => c.version)).toEqual([
      media.commits[0]!.version,
      media.commits[0]!.version + 1,
      media.commits[0]!.version + 2,
    ]);
    expect(media.commits[1]!.jobs.map((j) => j.cleanup_kind)).toEqual([
      "replace",
    ]);
    expect(media.commits[2]!.jobs.map((j) => j.cleanup_kind)).toEqual([
      "replace",
      "clear",
    ]);
  },
);
Then("cleanup is retained for each superseded object", async ({ world }) => {
  const media = state(world).media!;
  const current = await mediaSnapshot(
    media.project,
    media.commits[2]!.jobs.map((job) => job.id),
  );
  expect(current.ref).toBeNull();
  expect(current.jobs).toHaveLength(2);
  for (const [index, job] of current.jobs.entries()) {
    const committed = media.commits[index + 1]!.jobs[index]!;
    expect(job.id).toBe(committed.id);
    expect(job.cleanup_kind).toBe(index === 0 ? "replace" : "clear");
    expect(job).toMatchObject({ entity_kind: "project", slot: "cover" });
    if (job.status === "active") {
      expect(job.object_key).toBe(media.keys[index]);
      expect(job.entity_id).toBe(media.project.id);
    } else {
      expect(job).toMatchObject({
        status: "expired",
        execution_state: "completed",
        object_key: null,
        entity_id: null,
      });
    }
  }
});

async function createListExpert(page: Page, familyName: string): Promise<void> {
  operation("POST owned fixture /v1/admin/experts");
  const answer = await page.evaluate(async (familyName) => {
    const csrf = decodeURIComponent(
      document.cookie.match(/(?:^|; )__Host-ds_admin_csrf=([^;]*)/)?.[1] ?? "",
    );
    const res = await fetch("/v1/admin/experts", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
        "x-ds-admin-csrf": csrf,
      },
      body: JSON.stringify({
        familyName,
        givenName: "Иван",
        patronymic: "Сергеевич",
      }),
    });
    return { status: res.status, body: (await res.json()) as { id: string } };
  }, familyName);
  expect(answer.status).toBe(201);
  operation("owned expert", { id: answer.body.id });
}
When(
  "the operator types search and selects two filters",
  async ({ page, world }) => {
    const current = state(world);
    current.prefix = `Список${Date.now()}`;
    for (let i = 0; i < 21; i++)
      await createListExpert(
        page,
        `${current.prefix}-${String(i).padStart(2, "0")}`,
      );
    await page.goto("/experts");
    const search = page.getByRole("searchbox", { name: "Поиск" });
    await search.fill(current.prefix);
    await expect(page.getByTestId("experts-total")).toContainText("21");
    const statusApplied = page.waitForResponse((answer) => {
      const url = new URL(answer.url());
      return (
        answer.request().method() === "GET" &&
        url.pathname === "/v1/admin/experts" &&
        url.searchParams.get("q") === current.prefix &&
        url.searchParams.get("status") === "draft"
      );
    });
    await page.getByTestId("experts-status").selectOption("draft");
    expect((await statusApplied).status()).toBe(200);
    const retainedApplied = page.waitForResponse((answer) => {
      const url = new URL(answer.url());
      return (
        answer.request().method() === "GET" &&
        url.pathname === "/v1/admin/experts" &&
        url.searchParams.get("q") === current.prefix &&
        url.searchParams.get("status") === "draft" &&
        url.searchParams.get("includeRetired") === "true"
      );
    });
    await page
      .getByTestId("experts-include-retired")
      .locator("xpath=ancestor::label[1]")
      .click();
    expect((await retainedApplied).status()).toBe(200);
  },
);
Then("results update without Enter or Apply", async ({ page, world }) => {
  await expect(page.getByTestId("experts-total")).toContainText("21");
  await expect(page.locator("tbody tr")).toHaveCount(20);
  await expect(page.locator("tbody")).toContainText(state(world).prefix!);
  await expect(
    page.getByRole("button", { name: /^(Применить|Apply)$/u }),
  ).toHaveCount(0);
});
Then("pagination remains available", async ({ page }) => {
  const next = page.getByRole("button", { name: "Вперёд", exact: true });
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.getByTestId("experts-page").first()).toHaveText(
    "Страница 2 из 2",
  );
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(next).toHaveCount(0);
});
Then("both active values render as chips", async ({ page }) => {
  const chips = page.getByTestId("experts-filters");
  await expect(chips).toContainText("Черновик");
  await expect(chips).toContainText("снятые");
});
Then("Reset all clears them", async ({ page }) => {
  await page
    .getByTestId("experts-filters")
    .getByRole("button", { name: "Сбросить всё", exact: true })
    .click();
  await expect(page.getByRole("searchbox", { name: "Поиск" })).toHaveValue("");
  await expect(page.getByTestId("experts-status")).toHaveValue("");
  await expect(page.getByTestId("experts-include-retired")).not.toBeChecked();
  await expect(page.getByText("Выбрано:", { exact: false })).toHaveCount(0);
  await expect(page.getByTestId("experts-page").first()).toContainText(
    "Страница 1",
  );
});
Then("no action with no possible effect is enabled", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "Назад", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Сбросить всё", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^(Применить|Apply)$/u }),
  ).toHaveCount(0);
});
