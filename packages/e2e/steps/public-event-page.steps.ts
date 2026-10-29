import { golden } from "@ds/db/seed/golden";
import {
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";

import {
  ADMIN_ORIGIN,
  createPublishedEvent,
  eventSlugFromDetail,
  openEventLive,
  signInAsAdmin,
} from "../admin/index.js";
import type { HostConfig } from "../hosts.js";
import { redirectsBesidesSilentCheck } from "../lib/silent-check.js";
import { standHttpCredentials } from "../lib/stand-http-credentials.js";
import { originalEventPage } from "./public-event-originals.steps.js";
import {
  After,
  Before,
  Given,
  Then,
  When,
  type StepWorld,
} from "./support/fixtures.js";

type PublicLifecycle = "published" | "live" | "ended";
interface LifecycleJourney {
  page: Page;
  admin?: Page;
  event?: { id: string; slug?: string; title: string; startsAt?: string };
  state?: PublicLifecycle;
  beforeListed?: boolean;
}
const lifecycleJourneys = new WeakMap<StepWorld, LifecycleJourney>();

function lifecycleOf(world: StepWorld): LifecycleJourney {
  const journey = lifecycleJourneys.get(world);
  if (!journey) throw new Error("No owned public lifecycle journey");
  return journey;
}

Before({ tags: "@public-event-lifecycle" }, async ({ browser, world }) => {
  const credentials = standHttpCredentials();
  const context = await browser.newContext({
    baseURL: world.hostBaseUrl,
    ...(credentials ? { httpCredentials: credentials } : {}),
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
  });
  lifecycleJourneys.set(world, { page: await context.newPage() });
});

async function closeOwnEvent(journey: LifecycleJourney): Promise<void> {
  if (!journey.admin || !journey.event) return;
  const admin = journey.admin;
  await admin.goto(`/events/${journey.event.id}`);
  await expect(admin.locator('[data-testid^="state-"]')).toBeVisible();
  if (await admin.getByTestId("state-draft").isVisible()) {
    await admin.getByTestId("action-publish").click();
    await expect(admin.getByTestId("state-published")).toBeVisible();
  }
  if (await admin.getByTestId("state-published").isVisible()) {
    await openEventLive(admin);
  }
  if (await admin.getByTestId("state-live").isVisible()) {
    await admin.getByTestId("action-close").click();
    await expect(admin.getByTestId("state-ended")).toBeVisible();
  }
  if (await admin.getByTestId("state-ended").isVisible()) {
    await admin.getByTestId("action-hide").click();
  }
  await expect(admin.getByTestId("state-hidden")).toBeVisible();
}

After({ tags: "@public-event-lifecycle" }, async ({ world }) => {
  const journey = lifecycleJourneys.get(world);
  if (!journey) return;
  try {
    await closeOwnEvent(journey);
  } finally {
    await journey.admin?.context().close();
    await journey.page.context().close();
    lifecycleJourneys.delete(world);
  }
});

async function createLifecycleEvent(
  browser: Browser,
  world: StepWorld,
  state: PublicLifecycle,
): Promise<void> {
  const journey = lifecycleOf(world);
  const credentials = standHttpCredentials();
  const context = await browser.newContext({
    baseURL: ADMIN_ORIGIN,
    ...(credentials ? { httpCredentials: credentials } : {}),
    locale: "ru-RU",
  });
  const admin = await context.newPage();
  journey.admin = admin;
  await signInAsAdmin(admin);
  const title = `Жизненный цикл ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let id: string;
  try {
    id = await createPublishedEvent(admin, title, { startsInMs: 5 * 60_000 });
  } catch (error) {
    // A publish failure may follow a successful create; cleanup still owns it.
    const createdId = new URL(admin.url()).pathname.match(
      /^\/events\/([0-9a-f-]{36})$/u,
    )?.[1];
    if (createdId) journey.event = { id: createdId, title };
    throw error;
  }
  journey.event = { id, title };
  const slug = await eventSlugFromDetail(admin, id);
  journey.event.slug = slug;
  if (state !== "published") await openEventLive(admin);
  if (state === "ended") {
    await admin.getByTestId("action-close").click();
    await expect(admin.getByTestId("state-ended")).toBeVisible();
  }
  const response = await journey.page.request.get(`/v1/public/events/${slug}`);
  expect(response.status(), "owned fixture is anonymously readable").toBe(200);
  const event = await response.json();
  expect(event).toMatchObject({ id, slug, title, state });
  expect(Number.isFinite(Date.parse(event.startsAt))).toBe(true);
  journey.event.startsAt = event.startsAt;
  journey.state = state;
  world.publicEvent = { slug, title };
}

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

Given('an event in the "ended" state', async ({ browser, request, world }) => {
  if (lifecycleJourneys.has(world)) {
    await createLifecycleEvent(browser, world, "ended");
    return;
  }
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
  page: defaultPage,
  host,
  world,
}: {
  page: Page;
  host: HostConfig;
  world: StepWorld;
}) {
  if (!world.publicEvent) throw new Error("004 public event was not selected");
  const page =
    originalEventPage(world) ??
    lifecycleJourneys.get(world)?.page ??
    defaultPage;
  await page.context().clearCookies();
  const path = `${host.eventsPath}/${world.publicEvent.slug}`;
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.status(), "public event document response").toBe(200);
  expect(redirectsBesidesSilentCheck(response), "no document redirect").toEqual(
    [],
  );
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
When("any visitor opens the event page", openPublicEvent);

Given('an event in the "published" state', async ({ browser, world }) => {
  await createLifecycleEvent(browser, world, "published");
});
Given('an event in the "live" state', async ({ browser, world }) => {
  await createLifecycleEvent(browser, world, "live");
});

Then(
  "the hero badge, time plate, and CTA reflect the {string} render",
  async ({ world }, render: string) => {
    const journey = lifecycleOf(world);
    const { page, event, state } = journey;
    expect(render).toBe(state === "published" ? "upcoming" : state);
    if (!event?.startsAt || !event.slug)
      throw new Error("No public event facts");
    const instant = new Date(event.startsAt);
    const time = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      hour: "2-digit",
      minute: "2-digit",
    }).format(instant);
    const date = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "numeric",
      month: "long",
    }).format(instant);
    const hero = page.getByTestId("event-page-hero");
    const status = page.getByTestId("event-page-hero-status");
    const label =
      state === "published"
        ? /^Скоро(?: · .+)?$/u
        : state === "live"
          ? /^В эфире$/u
          : /^Эфир завершён$/u;
    await expect(status.getByText(label)).toBeVisible();
    await expect(hero).toContainText(time);
    await expect(hero).toContainText(date);
    await expect(hero).toContainText("(МСК)");
    const card = page.getByTestId("event-signup-card");
    const plate = page
      .getByTestId("event-signup-box")
      .locator(":scope > div")
      .first();
    await expect(plate).toContainText(time);
    await expect(plate).toContainText(date);
    await expect(plate).toContainText("МСК");
    if (state === "ended") {
      await expect(card).toHaveAttribute("data-cta-action", "unavailable");
      await expect(card.getByTestId("event-signup-statement")).toHaveText(
        "Участие недоступно",
      );
      await expect(card.getByTestId("event-signup-reason")).toHaveText(
        "Событие завершилось",
      );
      await expect(card.getByTestId("event-signup-cta")).toHaveCount(0);
      await expectNoParticipation({ page });
    } else {
      await expect(card).toHaveAttribute("data-cta-action", "register");
      const cta = card.getByRole("link", { name: "Участвовать", exact: true });
      await expect(cta).toHaveCount(1);
      await expect(cta).toBeVisible();
      await expect(cta).toHaveAttribute(
        "href",
        `/register?returnTo=${encodeURIComponent(`${world.host.eventsPath}/${event.slug}`)}`,
      );
    }
  },
);

Then("no signal contradicts the state machine", async ({ world }) => {
  const { page, state } = lifecycleOf(world);
  const hero = page.getByTestId("event-page-hero-status");
  for (const [other, pattern] of [
    ["published", /^Скоро(?: · .+)?$/u],
    ["live", /^В эфире$/u],
    ["ended", /^Эфир завершён$/u],
    ["hidden", /^Скрыто$/u],
  ] as const) {
    if (other !== state) await expect(hero.getByText(pattern)).toHaveCount(0);
  }
  await expect(page.getByRole("main").locator('a[href$="/room"]')).toHaveCount(
    0,
  );
  await expect(page.getByTestId("recording-plaque")).toHaveCount(
    state === "ended" ? 1 : 0,
  );
  await expect(page.getByTestId("recording-badge")).toHaveCount(
    state === "ended" ? 1 : 0,
  );
  await expect(page.getByTestId("recording-player")).toHaveCount(0);
  await expect(page.getByTestId("recording-gate")).toHaveCount(0);
});

async function upcomingIds(page: Page): Promise<string[]> {
  const response = await page.request.get(
    "/v1/public/events?timeframe=upcoming",
  );
  expect(response.status(), "anonymous upcoming read succeeds").toBe(200);
  const body = await response.json();
  expect(Array.isArray(body.data)).toBe(true);
  return body.data.map((event: { id: string }) => event.id);
}

Given(
  "an event that transitions from live to ended",
  async ({ browser, world }) => {
    await createLifecycleEvent(browser, world, "live");
    const journey = lifecycleOf(world);
    expect(
      await upcomingIds(journey.page),
      "live control is listed before closing",
    ).toContain(journey.event!.id);
    const response = await journey.page.goto(world.host.eventsPath);
    expect(response?.status()).toBe(200);
    await expect(
      journey.page.getByRole("heading", {
        level: 1,
        name: "Расписание эфиров",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      journey.page
        .locator("[data-webinar-card]")
        .getByRole("link", { name: journey.event!.title, exact: true }),
    ).toBeVisible();
    journey.beforeListed = true;
    await journey.admin!.getByTestId("action-close").click();
    await expect(journey.admin!.getByTestId("state-ended")).toBeVisible();
    journey.state = "ended";
  },
);

When("the listing is re-read", async ({ world }) => {
  const journey = lifecycleOf(world);
  expect(
    journey.beforeListed,
    "the same event was visible before the real transition",
  ).toBe(true);
  const response = await journey.page.request.get(
    `/v1/public/events/${journey.event!.slug}`,
  );
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    id: journey.event!.id,
    state: "ended",
  });
  expect(await upcomingIds(journey.page)).not.toContain(journey.event!.id);
  const document = await journey.page.reload({ waitUntil: "domcontentloaded" });
  expect(document?.status()).toBe(200);
  await expect(
    journey.page.getByRole("heading", {
      level: 1,
      name: "Расписание эфиров",
      exact: true,
    }),
  ).toBeVisible();
});

Then("that event is no longer listed", async ({ world }) => {
  const journey = lifecycleOf(world);
  await expect(
    journey.page
      .locator("[data-webinar-card]")
      .getByRole("link", { name: journey.event!.title, exact: true }),
  ).toHaveCount(0);
  await expect(
    journey.page
      .getByRole("main")
      .locator(`a[href="${world.host.eventsPath}/${journey.event!.slug}"]`),
  ).toHaveCount(0);
  await expect(journey.page.getByTestId("events-feed-error")).toHaveCount(0);
  expect(await upcomingIds(journey.page)).not.toContain(journey.event!.id);
});

Given(
  "a finished event with no published recording and no readiness date",
  async ({ browser, world }) => {
    await createLifecycleEvent(browser, world, "ended");
    const journey = lifecycleOf(world);
    const response = await journey.page.request.get(
      `/v1/public/events/${journey.event!.slug}`,
    );
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      id: journey.event!.id,
      state: "ended",
      recording: {
        state: "preparing",
        expectedBy: null,
        primaryKind: null,
        secondaryKind: null,
      },
    });
  },
);

Then(
  "the plaque renders an honest line with no fabricated timeframe",
  async ({ world }) => {
    const { page } = lifecycleOf(world);
    const plaque = page.getByTestId("recording-plaque");
    await expect(plaque).toBeVisible();
    await expect(plaque).toContainText("Запись готовится");
    await expect(plaque).toHaveText(
      /^\s*Запись\s*Запись готовится\s*Монтируем запись — она появится на этой странице, как только будет готова\.\s*$/u,
    );
    await expect(page.getByTestId("recording-plaque-date")).toHaveCount(0);
    await expect(plaque).not.toContainText("до ");
    await expect(plaque).not.toContainText(/\d|≈/u);
    await expect(plaque.locator("a, button, iframe, video")).toHaveCount(0);
    await expect(page.getByTestId("recording-player")).toHaveCount(0);
    await expect(page.getByTestId("recording-gate")).toHaveCount(0);
    await expect(page.getByTestId("recording-spoiler")).toHaveCount(0);
  },
);

Then(
  "the program section renders without a download affordance",
  async ({ page }) => {
    const section = page.getByTestId("event-programme");
    await expect(section).toBeVisible();
    await expect(section.getByText("Программа", { exact: true })).toBeVisible();
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
  const main = page.getByRole("main");
  await expect(main).toBeVisible();
  const participationLinks = main.locator(
    'a[href]:not([data-testid="recording-gate-signup"])',
  );
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
    page
      .getByRole("main")
      .getByText(
        /^Мероприятие скрыто — участие в нём больше не предлагается$/u,
      ),
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
