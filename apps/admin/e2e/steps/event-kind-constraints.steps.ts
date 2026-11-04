import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

import { chooseProjectStage } from "../support/event-classification";
import { selectRelationshipCombobox } from "../support/relationship-combobox";
import {
  Before,
  Given,
  Then,
  When,
  type AdminWorld,
} from "../support/fixtures";

type Format = "online" | "offline" | "hybrid";
type Event = { id: string; title: string };
type State = { kindId?: string; events: Event[]; projectId?: string };
const states = new WeakMap<AdminWorld, State>();
function state(world: AdminWorld): State {
  let value = states.get(world);
  if (!value) {
    value = { events: [] };
    states.set(world, value);
  }
  return value;
}
function kindId(world: AdminWorld): string {
  const id = state(world).kindId;
  if (!id) throw new Error("No scenario-owned kind was authored");
  return id;
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
Before({ tags: "@event-kind-constraints" }, async ({ page }) => {
  page.on("request", (request) => {
    const url = new URL(request.url());
    operation(`browser ${request.method()} ${url.origin}${url.pathname}`);
  });
});

async function chooseFormats(page: Page, formats: Format[]): Promise<void> {
  for (const format of ["online", "offline", "hybrid"] as const) {
    const control = page.getByTestId(`event-kind-format-${format}`);
    if ((await control.isChecked()) !== formats.includes(format))
      await control.locator("xpath=ancestor::label[1]").click();
  }
}
async function expectFormats(page: Page, formats: Format[]): Promise<void> {
  for (const format of ["online", "offline", "hybrid"] as const) {
    const control = page.getByTestId(`event-kind-format-${format}`);
    if (formats.includes(format)) await expect(control).toBeChecked();
    else await expect(control).not.toBeChecked();
  }
}
async function createKind(page: Page, world: AdminWorld): Promise<void> {
  await page.goto("/event-kinds/create");
  await page.getByTestId("event-kind-title").fill("Встреча клуба");
  await chooseFormats(page, ["online", "offline", "hybrid"]);
  await page.getByTestId("submit-event-kind").click();
  await page.waitForURL(/\/event-kinds\/[0-9a-f-]{36}$/u);
  state(world).kindId = new URL(page.url()).pathname.split("/").pop()!;
  operation(`owned event kind ${kindId(world)}`);
  await expect(page.getByTestId("event-kind-title")).toHaveValue(
    "Встреча клуба",
  );
  await page.getByTestId("event-kind-publish").click();
  await expect(page.getByTestId("event-kind-status")).toHaveText(
    "Опубликовано",
  );
}
async function createEvent(
  page: Page,
  world: AdminWorld,
  format: Format,
  projectTitle?: string,
): Promise<void> {
  const title = `N conflict ${randomUUID()}`;
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
  await page.getByTestId("event-kind").selectOption(kindId(world));
  await page.getByTestId("event-participation-format").selectOption(format);
  await page.getByTestId("event-audience").selectOption("doctors");
  if (projectTitle)
    await selectRelationshipCombobox(
      page,
      "event-project-combobox",
      projectTitle,
      projectTitle,
    );
  await page.getByTestId("submit-event").click();
  await page.waitForURL(/\/events\/[0-9a-f-]{36}$/u);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  state(world).events.push({ id, title });
  operation(`owned event ${id}`);
  await expect(page.getByTestId("event-kind")).toHaveValue(kindId(world));
  await expect(page.getByTestId("event-participation-format")).toHaveValue(
    format,
  );
}

Given(
  "an event of kind «Встреча клуба» with the format online",
  async ({ page, world }) => {
    await createKind(page, world);
    await createEvent(page, world, "online");
  },
);
Given(
  "seven events of kind «Встреча клуба» with the format hybrid",
  async ({ page, world }) => {
    await createKind(page, world);
    for (let index = 0; index < 7; index++)
      await createEvent(page, world, "hybrid");
    expect(state(world).events).toHaveLength(7);
  },
);
When(
  "the admin narrows «Встреча клуба» to allow only the formats offline and hybrid",
  async ({ page, world }) => {
    await page.goto(`/event-kinds/${kindId(world)}`);
    await chooseFormats(page, ["offline", "hybrid"]);
    await page.getByTestId("submit-event-kind").click();
  },
);
When(
  "the admin narrows «Встреча клуба» to allow only the formats online and offline",
  async ({ page, world }) => {
    await page.goto(`/event-kinds/${kindId(world)}`);
    await chooseFormats(page, ["online", "offline"]);
    await page.getByTestId("submit-event-kind").click();
  },
);
Then(
  "the kind edit is rejected with a field error on the allowed formats that states one conflicting event and names it",
  async ({ page, world }) => {
    await expect(page.getByTestId("update-error")).toContainText(
      "Нельзя убрать формат: его использует 1 мероприятие этого типа.",
    );
    const event = state(world).events[0];
    const links = page.getByTestId("narrow-refused-events").getByRole("link");
    await expect(links).toHaveCount(1);
    await expect(links).toHaveText(event.title);
    await expect(links).toHaveAttribute("href", `/events/${event.id}`);
    await expect(page.getByTestId("narrow-refused-more")).toHaveCount(0);
  },
);
Then(
  "«Встреча клуба» still allows the formats online, offline and hybrid",
  async ({ page }) => {
    await page.reload();
    await expectFormats(page, ["online", "offline", "hybrid"]);
  },
);
When(
  "the admin changes the event's format to offline and saves",
  async ({ page, world }) => {
    await page.goto(`/events/${state(world).events[0].id}`);
    await page
      .getByTestId("event-participation-format")
      .selectOption("offline");
    await page.getByTestId("submit-event").click();
    await expect(page.getByTestId("edit-ok")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("event-participation-format")).toHaveValue(
      "offline",
    );
  },
);
Then(
  "the kind is stored with the formats offline and hybrid",
  async ({ page, world }) => {
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("event-kind-title")).toHaveValue(
      "Встреча клуба",
    );
    await expect(page).toHaveURL(
      new RegExp(`/event-kinds/${kindId(world)}$`, "u"),
    );
    await expectFormats(page, ["offline", "hybrid"]);
  },
);
Then(
  "the kind edit is rejected with a field error on the allowed formats that states seven conflicting events",
  async ({ page }) => {
    await expect(page.getByTestId("update-error")).toContainText(
      "Нельзя убрать формат: его используют 7 мероприятий этого типа.",
    );
  },
);
Then(
  "the refusal names five of those events, each linking to its admin event page",
  async ({ page, world }) => {
    const links = page.getByTestId("narrow-refused-events").getByRole("link");
    await expect(links).toHaveCount(5);
    const named = await links.evaluateAll((elements) =>
      elements.map((element) => ({
        title: element.textContent,
        href: element.getAttribute("href"),
      })),
    );
    expect(new Set(named.map((event) => event.href)).size).toBe(5);
    for (const event of named)
      expect(
        state(world).events.map((owned) => ({
          title: owned.title,
          href: `/events/${owned.id}`,
        })),
      ).toContainEqual(event);
  },
);
Then("the refusal says two more events conflict", async ({ page }) => {
  await expect(page.getByTestId("narrow-refused-more")).toHaveText("и ещё 2");
});

Given(
  "an event with the audience doctors linked to a project with the default audience doctors",
  async ({ page, world }) => {
    const title = `N doctors project ${randomUUID()}`;
    await page.goto("/projects/create");
    await expect(page.getByTestId("project-form")).toBeVisible();
    await page.locator("#title").fill(title);
    await page.locator("#description").fill("Scenario-owned audience project");
    await page.getByTestId("project-default-audience").selectOption("doctors");
    await chooseProjectStage(page);
    await page.getByTestId("submit-project").click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/u);
    state(world).projectId = new URL(page.url()).pathname.split("/").pop()!;
    operation(`owned project ${state(world).projectId}`);
    await page.reload();
    await expect(page.getByTestId("project-default-audience")).toHaveValue(
      "doctors",
    );
    await createKind(page, world);
    await createEvent(page, world, "online", title);
    await page.reload();
    await expect(page.getByTestId("event-audience")).toHaveValue("doctors");
    await page.getByTestId("tab-projects").click();
    const projects = page.getByTestId("event-projects-panel");
    await expect(projects.getByText(title, { exact: true })).toBeVisible();
    await expect(
      projects.locator('[data-testid^="event-project-row-"]'),
    ).toHaveCount(1);
  },
);
When(
  "the admin changes the project default audience to experts",
  async ({ page, world }) => {
    const id = state(world).projectId;
    if (!id) throw new Error("No scenario-owned project was authored");
    await page.goto(`/projects/${id}`);
    await page.getByTestId("project-default-audience").selectOption("experts");
    await page.getByTestId("submit-project").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("project-default-audience")).toHaveValue(
      "experts",
    );
  },
);
Then("the event keeps the audience doctors", async ({ page, world }) => {
  await page.goto(`/events/${state(world).events[0].id}`);
  await expect(page.getByTestId("event-audience")).toHaveValue("doctors");
});
