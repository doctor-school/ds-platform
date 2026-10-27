import { golden } from "@ds/db/seed/golden";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import type { HostConfig } from "../hosts.js";
import { Given, Then, When, type StepWorld } from "./support/fixtures.js";

async function readPublicEvent(
  request: APIRequestContext,
  world: StepWorld,
  fixture: { id: string; slug: string },
  state: "published" | "ended" | "hidden",
  title: string,
) {
  const response = await request.get(`/v1/public/events/${fixture.slug}`);
  expect(
    response.status(),
    "public fixture is reachable without a session",
  ).toBe(200);
  const event = await response.json();
  expect(event).toMatchObject({ ...fixture, state, title });
  world.publicEvent = { slug: fixture.slug, title };
  return event;
}

Given(
  "a published event that has no program PDF",
  async ({ request, world }) => {
    const event = await readPublicEvent(
      request,
      world,
      golden.events.upcoming,
      "published",
      "Предстоящий эфир (эталон)",
    );
    expect(event, "the fixture must actually have no PDF").not.toHaveProperty(
      "programPdfUrl",
    );
  },
);

Given('an event in the "ended" state', async ({ request, world }) => {
  await readPublicEvent(
    request,
    world,
    golden.events.pastWithRecording,
    "ended",
    "Прошедший эфир с записью (эталон)",
  );
});

Given(
  "a hidden event whose direct link was previously distributed",
  async ({ request, world }) => {
    await readPublicEvent(
      request,
      world,
      golden.events.hidden,
      "hidden",
      "Скрытый эфир (эталон)",
    );
  },
);

async function openPublicEvent({
  page,
  host,
  world,
}: {
  page: Page;
  host: HostConfig;
  world: StepWorld;
}) {
  if (!world.publicEvent) throw new Error("004 public event was not selected");
  await page.context().clearCookies();
  const path = `${host.eventsPath}/${world.publicEvent.slug}`;
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.status(), "public event document response").toBe(200);
  expect(
    response?.request().redirectedFrom(),
    "no document redirect",
  ).toBeNull();
  await expect(page).toHaveURL((url) => url.pathname === path);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: world.publicEvent.title,
      exact: true,
    }),
  ).toBeVisible();
}

When("a visitor opens the event page", openPublicEvent);
When("a visitor opens that link", openPublicEvent);

Then(
  "the program section renders without a download affordance",
  async ({ page }) => {
    const section = page.getByTestId("event-programme");
    await expect(section).toBeVisible();
    await expect(
      section.getByRole("heading", { name: "Программа", exact: true }),
    ).toBeVisible();
    const statement = section.getByTestId("event-programme-statement");
    await expect(statement).toBeVisible();
    await expect(statement).toHaveText(/\S/u);
    await expect(section.getByRole("link")).toHaveCount(0);
    await expect(section.getByRole("button")).toHaveCount(0);
  },
);

Then("no broken or empty PDF link is shown", async ({ page }) => {
  await expect(
    page.getByRole("link", { name: /скачать.*программ|программ.*pdf/iu }),
  ).toHaveCount(0);
  await expect(page.getByTestId("event-programme").locator("a")).toHaveCount(0);
  await expect(page.locator('a[href*=".pdf"], a[download]')).toHaveCount(0);
});

Then("the page states the broadcast has ended", async ({ page }) => {
  await expect(
    page.getByText("Эфир завершён", { exact: true }).first(),
  ).toBeVisible();
});

async function expectNoParticipation({ page }: { page: Page }) {
  await expect(
    page.getByRole("link", {
      name: /^(Участвовать|Записаться|Смотреть эфир)$/u,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /^(Участвовать|Записаться|Смотреть эфир)$/u,
    }),
  ).toHaveCount(0);
  // 004 EARS-4/5 exclude participation; 014's recording-account entry remains valid.
  const participationLinks = page
    .getByRole("main")
    .locator('a[href]:not([data-testid="recording-gate-signup"])');
  const destinations = await participationLinks.evaluateAll((links) =>
    links.map((link) => new URL((link as HTMLAnchorElement).href).pathname),
  );
  expect(
    destinations.filter(
      (path) =>
        path === "/register" ||
        /\/(?:webinars|events)\/[^/]+\/(?:room|register)\/?$/u.test(path),
    ),
  ).toEqual([]);
}

Then(
  "no participation CTA links to a room or registration",
  expectNoParticipation,
);
Then("no participation CTA is shown", expectNoParticipation);

Then('a public "Мероприятие скрыто" notice is rendered', async ({ page }) => {
  await expect(page.getByText("Скрыто", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("Мероприятие скрыто", { exact: true }).first(),
  ).toBeVisible();
});

Then(
  "the response is neither a 404 nor a redirect to the listing",
  async ({ page, host, world }) => {
    if (!world.publicEvent)
      throw new Error("004 hidden event was not selected");
    await expect(page).toHaveURL(
      (url) => url.pathname === `${host.eventsPath}/${world.publicEvent!.slug}`,
    );
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: world.publicEvent.title,
        exact: true,
      }),
    ).toBeVisible();
  },
);
