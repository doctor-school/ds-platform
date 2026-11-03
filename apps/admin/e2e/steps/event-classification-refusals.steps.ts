import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";
import { Pool } from "pg";

import {
  Before,
  Given,
  Then,
  When,
  type AdminWorld,
} from "../support/fixtures";

type Kind = { id: string; title: string; allowed_formats: string[] };
type Refusal = {
  status: number;
  errorCode?: string;
  paths: (string | number)[][];
};
type State = {
  prefix: string;
  eventId?: string;
  kind?: Kind;
  before?: unknown[];
  refused: Refusal[];
  field?: string;
};
const states = new WeakMap<AdminWorld, State>();
function state(world: AdminWorld): State {
  let value = states.get(world);
  if (!value) {
    value = { prefix: `Classification refusal ${randomUUID()}`, refused: [] };
    states.set(world, value);
  }
  return value;
}
function operation(op: string, detail?: unknown): void {
  const file = process.env.E2E_CLASSIFICATION_REFUSALS_LOG;
  if (file)
    appendFileSync(
      file,
      JSON.stringify({ at: new Date().toISOString(), op, detail }) + "\n",
    );
}
Before({ tags: "@event-classification-refusals" }, async ({ page }) => {
  page.on("request", (request) => {
    const url = new URL(request.url());
    operation(`browser ${request.method()} ${url.origin}${url.pathname}`);
  });
});

async function retained(sql: string, values: unknown[]): Promise<unknown[]> {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL must select the Admin database under test");
  operation("SELECT classification rows", { sql, values });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    return (await pool.query(sql, values)).rows;
  } finally {
    await pool.end();
  }
}
async function publishedKind(world: AdminWorld, title: string): Promise<Kind> {
  const rows = (await retained(
    "SELECT id,title,allowed_formats FROM event_kinds WHERE title=$1 AND status=$2 AND deleted_at IS NULL",
    [title, "published"],
  )) as Kind[];
  expect(rows).toHaveLength(1);
  state(world).kind = rows[0];
  return rows[0];
}
async function fillBasics(page: Page, title: string): Promise<void> {
  await page.goto("/events/create");
  await expect(page.getByTestId("event-form")).toBeVisible();
  await page.locator("#title").fill(title);
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
}
async function rejectEmptyControl(
  page: Page,
  control: "event-kind" | "event-audience" | "event-participation-format",
): Promise<void> {
  const writes: string[] = [];
  const observe = (request: import("@playwright/test").Request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/v1/admin/events"
    )
      writes.push(request.url());
  };
  page.on("request", observe);
  try {
    await page.getByTestId("submit-event").click();
    await expect(page.getByTestId(control)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(
      page.getByText("Обязательное поле.", { exact: true }).first(),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/events\/create$/u);
    expect(writes).toEqual([]);
  } finally {
    page.off("request", observe);
  }
}
async function saveAccepted(page: Page, world: AdminWorld): Promise<void> {
  const committed = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/v1/admin/events",
  );
  await page.getByTestId("submit-event").click();
  const response = await committed;
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  state(world).eventId = id;
  operation("owned event", { id });
  await page.waitForURL(new RegExp(`/events/${id}$`, "u"));
  state(world).before = await eventRows(world);
  expect(state(world).before).toHaveLength(1);
}
async function eventRows(world: AdminWorld): Promise<unknown[]> {
  return retained(
    "SELECT to_jsonb(events) AS row FROM events WHERE title LIKE $1 ORDER BY id",
    [`${state(world).prefix}%`],
  );
}
async function submit(
  page: Page,
  world: AdminWorld,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): Promise<void> {
  const current = state(world);
  const path = `/v1/admin/events${method === "PATCH" ? `/${current.eventId}` : ""}`;
  operation(`${method} classification refusal`, { path });
  const answer = await page.evaluate(
    async ({ method, path, body }) => {
      const match = /(?:^|; )__Host-ds_admin_csrf=([^;]*)/u.exec(
        document.cookie,
      );
      if (!match?.[1]) throw new Error("No Admin CSRF cookie available");
      const form = new FormData();
      form.append("payload", JSON.stringify(body));
      const response = await fetch(path, {
        method,
        credentials: "include",
        headers: { "x-ds-admin-csrf": decodeURIComponent(match[1]) },
        body: form,
      });
      const problem = (await response.json()) as {
        errorCode?: string;
        issues?: { path: (string | number)[] }[];
      };
      return {
        status: response.status,
        errorCode: problem.errorCode,
        paths: (problem.issues ?? []).map((issue) => issue.path),
      };
    },
    { method, path, body },
  );
  current.refused.push(answer);
  expect(answer.status).toBe(400);
  expect(answer.errorCode).toBe("VALIDATION_FAILED");
  expect(answer.paths).toContainEqual([current.field!]);
  expect(await eventRows(world)).toEqual(current.before);
}
function payload(world: AdminWorld): Record<string, unknown> {
  const current = state(world);
  return {
    title: `${current.prefix} rejected ${randomUUID()}`,
    school: "Кардиология",
    startsAtMsk: new Date(Date.now() + 7 * 86_400_000 + 10_800_000)
      .toISOString()
      .slice(0, 16),
    durationMin: 90,
    specialties: ["cardiology"],
    kindId: current.kind!.id,
    participationFormat: "online",
    audience: "doctors",
  };
}
async function createKind(page: Page, title: string): Promise<string> {
  await page.goto("/event-kinds/create");
  await page.getByTestId("event-kind-title").fill(title);
  await page
    .getByTestId("event-kind-format-online")
    .locator("xpath=ancestor::label[1]")
    .click();
  await page.getByTestId("submit-event-kind").click();
  await page.waitForURL(/\/event-kinds\/[0-9a-f-]{36}$/u);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  operation("owned event kind", { id });
  return id;
}

When(
  "the admin saves an event with no kind, an unknown kind or a retired kind",
  async ({ page, world }) => {
    const current = state(world);
    const kind = await publishedKind(world, "Вебинар");
    await fillBasics(page, `${current.prefix} accepted`);
    await page.getByTestId("event-audience").selectOption("doctors");
    await expect(page.getByTestId("event-participation-format")).toBeDisabled();
    await rejectEmptyControl(page, "event-kind");
    expect(await eventRows(world)).toEqual([]);
    await page.getByTestId("event-kind").selectOption(kind.id);
    await expect(page.getByTestId("event-participation-format")).toHaveValue(
      "online",
    );
    await saveAccepted(page, world);
    const draft = await createKind(page, `${current.prefix} draft kind`);
    const retired = await createKind(page, `${current.prefix} retired kind`);
    await page.getByTestId("event-kind-publish").click();
    await expect(page.getByTestId("event-kind-status")).toHaveText(
      "Опубликовано",
    );
    await page.getByTestId("event-kind-retire").click();
    await expect(page.getByTestId("event-kind-retire-impact")).toBeVisible();
    const completed = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/v1/admin/event-kinds/${retired}/retire`,
    );
    await page.getByTestId("event-kind-retire-submit").click();
    const response = await completed;
    expect(response.status()).toBe(200);
    expect(response.request().headers()["lifecycle-impact-token"]).toBeTruthy();
    expect(response.request().headers()["if-match"]).toBeTruthy();
    await expect(page.getByTestId("event-kind-status")).toHaveText(
      "Снято с публикации",
    );
    await page.goto("/events/create");
    await expect(
      page.getByTestId("event-kind").locator(`option[value="${kind.id}"]`),
    ).toBeAttached();
    for (const id of [draft, retired])
      await expect(
        page.getByTestId("event-kind").locator(`option[value="${id}"]`),
      ).toHaveCount(0);
    current.field = "kindId";
    const { kindId: _omitted, ...missing } = payload(world);
    await submit(page, world, "POST", missing);
    await submit(page, world, "PATCH", { kindId: null });
    for (const kindId of [randomUUID(), draft, retired]) {
      await submit(page, world, "POST", { ...payload(world), kindId });
      await submit(page, world, "PATCH", { kindId });
    }
  },
);
Given(
  "the published kind «Конгресс» allows the formats offline and hybrid",
  async ({ world }) => {
    const kind = await publishedKind(world, "Конгресс");
    expect(kind.allowed_formats).toEqual(["offline", "hybrid"]);
  },
);
When(
  "the admin saves an event of kind «Конгресс» with the format online",
  async ({ page, world }) => {
    const current = state(world);
    await fillBasics(page, `${current.prefix} accepted`);
    await page.getByTestId("event-kind").selectOption(current.kind!.id);
    await page.getByTestId("event-audience").selectOption("doctors");
    const formats = page.getByTestId("event-participation-format");
    await expect(formats.locator('option[value="online"]')).toHaveCount(0);
    await expect(formats.locator("option")).toHaveText([
      /.+/,
      "Очно",
      "Очно и онлайн",
    ]);
    await rejectEmptyControl(page, "event-participation-format");
    expect(await eventRows(world)).toEqual([]);
    await formats.selectOption("offline");
    await saveAccepted(page, world);
    current.field = "participationFormat";
    await submit(page, world, "POST", payload(world));
    await submit(page, world, "PATCH", { participationFormat: "online" });
  },
);
When(
  "the admin saves an event with no audience or an unknown audience",
  async ({ page, world }) => {
    const current = state(world);
    const kind = await publishedKind(world, "Вебинар");
    await fillBasics(page, `${current.prefix} accepted`);
    await page.getByTestId("event-kind").selectOption(kind.id);
    await expect(page.getByTestId("event-audience")).toHaveValue("");
    expect(
      await page
        .getByTestId("event-audience")
        .locator("option")
        .evaluateAll((options) =>
          options.map((option) => (option as HTMLOptionElement).value),
        ),
    ).toEqual(["", "doctors", "experts"]);
    await rejectEmptyControl(page, "event-audience");
    expect(await eventRows(world)).toEqual([]);
    await page.getByTestId("event-audience").selectOption("doctors");
    await saveAccepted(page, world);
    current.field = "audience";
    const { audience: _omitted, ...missing } = payload(world);
    await submit(page, world, "POST", missing);
    await submit(page, world, "POST", {
      ...payload(world),
      audience: "pharma",
    });
    await submit(page, world, "PATCH", { audience: null });
    await submit(page, world, "PATCH", { audience: "pharma" });
  },
);
async function expectRefused(page: Page, world: AdminWorld): Promise<void> {
  const current = state(world);
  expect(current.refused.length).toBeGreaterThan(0);
  for (const refusal of current.refused) {
    expect(refusal.status).toBe(400);
    expect(refusal.paths).toContainEqual([current.field!]);
  }
  expect(await eventRows(world)).toEqual(current.before);
  await page.goto(`/events/${current.eventId}`);
  await expect(page.getByTestId("event-kind")).toHaveValue(current.kind!.id);
  await expect(page.getByTestId("event-audience")).toHaveValue("doctors");
  await expect(page.getByTestId("event-participation-format")).toHaveValue(
    current.field === "participationFormat" ? "offline" : "online",
  );
}
Then("the event contract rejects the write", async ({ page, world }) => {
  await expectRefused(page, world);
});
Then(
  "the event contract rejects the write with a field error on the format",
  async ({ page, world }) => {
    expect(state(world).field).toBe("participationFormat");
    await expectRefused(page, world);
  },
);
