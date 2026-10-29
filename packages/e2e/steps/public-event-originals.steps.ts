import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

import {
  ADMIN_ORIGIN,
  chooseEventClassification,
  signInAsAdmin,
} from "../admin/index.js";
import { baseUrlFor, HOSTS, type HostConfig } from "../hosts.js";
import { redirectsBesidesSilentCheck } from "../lib/silent-check.js";
import { standHttpCredentials } from "../lib/stand-http-credentials.js";
import {
  After,
  Before,
  Given,
  Then,
  When,
  type StepWorld,
} from "./support/fixtures.js";

type Event = {
  id: string;
  slug: string;
  title: string;
  school: string;
  description: string;
  startsAt: string;
  programPdfRef: string;
  specialties: string[];
  partnerRef: string;
};
type Journey = {
  page: Page;
  admin?: Page;
  expert?: { id: string; name: string; credentials: string };
  events: Event[];
  selected?: Event;
  published?: Event;
  responses: { page: Page; document: string; rsc: string; api: string }[];
};
const journeys = new WeakMap<StepWorld, Journey>();
function credentialOptions() {
  const httpCredentials = standHttpCredentials();
  return httpCredentials ? { httpCredentials } : {};
}
function journey(world: StepWorld): Journey {
  const value = journeys.get(world);
  if (!value) throw new Error("No owned public-event original journey");
  return value;
}
export function originalEventPage(world: StepWorld): Page | undefined {
  return journeys.get(world)?.page;
}

Before({ tags: "@public-event-originals" }, async ({ browser, world }) => {
  const context = await browser.newContext({
    baseURL: world.hostBaseUrl,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    ...credentialOptions(),
  });
  journeys.set(world, {
    page: await context.newPage(),
    events: [],
    responses: [],
  });
});

After({ tags: "@public-event-originals" }, async ({ world, $testInfo }) => {
  const state = journeys.get(world);
  if (!state) return;
  try {
    if (state.admin) {
      for (const event of state.events) {
        await state.admin.goto(`/events/${event.id}`);
        await expect(
          state.admin.locator('[data-testid^="state-"]'),
        ).toBeVisible();
        for (const [from, action, to] of [
          ["draft", "publish", "published"],
          ["published", "open", "live"],
          ["live", "close", "ended"],
          ["ended", "hide", "hidden"],
        ]) {
          if (await state.admin.getByTestId(`state-${from}`).isVisible()) {
            await state.admin.getByTestId(`action-${action}`).click();
            await expect(state.admin.getByTestId(`state-${to}`)).toBeVisible();
          }
        }
        await expect(state.admin.getByTestId("state-hidden")).toBeVisible();
      }
      await $testInfo.attach("owned-event-cleanup", {
        contentType: "application/json",
        body: JSON.stringify({
          events: state.events.map(({ id }) => ({ id, state: "hidden" })),
          retainedExpert: state.expert?.id,
        }),
      });
    }
  } finally {
    await Promise.all(
      state.responses.map(({ page }) => page.context().close()),
    );
    await state.admin?.context().close();
    await state.page.context().close();
    journeys.delete(world);
  }
});

async function author(world: StepWorld): Promise<Page> {
  const state = journey(world);
  if (state.admin) return state.admin;
  const context = await state.page
    .context()
    .browser()!
    .newContext({
      baseURL: ADMIN_ORIGIN,
      locale: "ru-RU",
      ...credentialOptions(),
    });
  const admin = await context.newPage();
  state.admin = admin;
  await signInAsAdmin(admin);
  const family = `Оригинал-${randomUUID().slice(0, 8)}`;
  const credentials = "Кандидат медицинских наук";
  await admin.goto("/experts/create");
  await admin.getByTestId("expert-family-name").fill(family);
  await admin.getByTestId("expert-given-name").fill("Анна");
  await admin.getByTestId("expert-patronymic").fill("Ильинична");
  await admin.getByTestId("expert-credentials").fill(credentials);
  await admin.locator("#professionalRole").fill("Врач-кардиолог");
  await admin.locator("#affiliation").fill("Клинический учебный центр");
  await admin
    .locator("#bio")
    .fill("Разбирает клинические случаи и ведёт образовательные эфиры.");
  await admin.getByTestId("submit-expert").click();
  await admin.waitForURL(/\/experts\/[0-9a-f-]{36}$/u);
  state.expert = {
    id: admin.url().split("/").pop()!,
    name: `${family} Анна Ильинична`,
    credentials,
  };
  await admin.getByTestId("tab-publish").click();
  await admin.getByTestId("experts-publish").click();
  await expect(admin.getByTestId("expert-status")).toHaveText("Опубликован");
  return admin;
}

async function createEvent(
  world: StepWorld,
  lifecycle: "draft" | "published" | "ended",
  title?: string,
): Promise<Event> {
  const state = journey(world);
  const admin = await author(world);
  const token = randomUUID().slice(0, 8);
  await admin.goto("/events/create");
  await admin.locator("#title").fill(title ?? `Полная проекция ${token}`);
  await admin.locator("#school").fill(`Клиническая школа ${token}`);
  const starts = new Date(Date.now() + 5 * 60_000 + 3 * 3_600_000)
    .toISOString()
    .slice(0, 16);
  await admin.locator("#startsAtMsk").fill(starts);
  await admin.locator("#durationMin").fill("90");
  await admin
    .locator("#description")
    .fill(`Разбор клинических решений ${token}`);
  await admin.locator("#specialties").fill("Кардиология, Терапия");
  await admin.locator("#partnerRef").fill(`Партнёр ${token}`);
  await admin.locator("#venue").fill("Москва, учебный центр");
  await admin.getByTestId("program-pdf").setInputFiles({
    name: `program-${token}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF"),
  });
  await chooseEventClassification(admin, {
    audience: lifecycle === "draft" ? "doctors" : "experts",
  });
  await admin.getByTestId("submit-event").click();
  await admin.waitForURL(/\/events\/[0-9a-f-]{36}$/u);
  const id = admin.url().split("/").pop()!;
  // Track the created identity before linking/publishing so failed setup is still cleaned.
  const event = { id } as Event;
  state.events.push(event);
  const detail = await admin.evaluate(async (eventId) => {
    const response = await fetch(`/v1/admin/events/${eventId}`);
    return { status: response.status, body: await response.json() };
  }, id);
  expect(detail.status).toBe(200);
  Object.assign(event, detail.body);
  expect(event.programPdfRef).toMatch(/\.pdf$/u);
  await admin.getByTestId("tab-experts").click();
  await admin.getByTestId("event-expert-add").click();
  const trigger = admin.locator("#event-expert-combobox");
  await trigger.click();
  const panel = admin.locator(
    `[id="${await trigger.getAttribute("aria-controls")}"]`,
  );
  await panel.getByRole("combobox").fill(state.expert!.name.split(" ")[0]!);
  await panel.getByText(state.expert!.name, { exact: true }).click();
  await admin.getByTestId("event-expert-add-role").fill("Докладчик");
  await admin.getByTestId("event-expert-add-position").fill("1");
  await admin.getByTestId("event-expert-add-submit").click();
  await expect(admin.getByTestId("event-experts-notice")).toContainText(
    "Эксперт привязан",
  );
  if (lifecycle !== "draft") {
    await admin.goto(`/events/${id}`);
    await admin.getByTestId("action-publish").click();
    await expect(admin.getByTestId("state-published")).toBeVisible();
    if (lifecycle === "ended") {
      await admin.getByTestId("action-open").click();
      await expect(admin.getByTestId("state-live")).toBeVisible();
      await admin.getByTestId("action-close").click();
      await expect(admin.getByTestId("state-ended")).toBeVisible();
    }
    const read = await state.page.request.get(
      `/v1/public/events/${event.slug}`,
    );
    expect(read.status()).toBe(200);
    expect(await read.json()).toMatchObject({
      id,
      title: event.title,
      state: lifecycle,
      speakers: [
        expect.objectContaining({
          expertId: state.expert!.id,
          name: state.expert!.name,
          credentials: state.expert!.credentials,
        }),
      ],
    });
  }
  return event;
}

Given(
  "a published event with speakers, specialties, partners, and a program PDF",
  async ({ world }) => {
    const event = await createEvent(world, "published");
    journey(world).selected = event;
    world.publicEvent = { slug: event.slug, title: event.title };
  },
);

async function completeProjection(world: StepWorld): Promise<void> {
  const state = journey(world),
    event = state.selected;
  if (!event || !state.expert) throw new Error("No full projection fixture");
  const main = state.page.getByRole("main");
  for (const text of [
    event.title,
    event.school,
    event.description,
    ...event.specialties,
    event.partnerRef,
    state.expert.name,
    state.expert.credentials,
  ]) {
    await expect(main).toContainText(text);
  }
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
  await expect(state.page.getByTestId("event-page-hero")).toContainText(time);
  await expect(state.page.getByTestId("event-page-hero")).toContainText(date);
  await expect(state.page.getByTestId("event-page-hero")).toContainText("МСК");
}
async function downloadPdf(world: StepWorld): Promise<void> {
  const page = journey(world).page;
  const link = page.getByRole("main").getByRole("link", { name: /программ/iu });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toBeTruthy();
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("pdf");
  expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
}
Then(
  /^the page shows the title, school\/series, start date and start time labeled МСК, description, speakers with credentials, target specialty chips, and backing partners$/u,
  async ({ world }) => completeProjection(world),
);
Then("a downloadable program PDF link is present", async ({ world }) =>
  downloadPdf(world),
);

Given(
  "a finished event with no feature 012 taxonomy links",
  async ({ world }) => {
    const state = journey(world);
    state.selected = await createEvent(world, "ended");
    const response = await state.page.request.get(
      `/v1/public/events/${state.selected.slug}/projects`,
    );
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ data: [] });
    const links = await state.admin!.evaluate(async (id) => {
      const response = await fetch(
        `/v1/admin/event-projects?eventId=${id}&includeRetired=true`,
      );
      return { status: response.status, body: await response.json() };
    }, state.selected.id);
    expect(links.status).toBe(200);
    expect(links.body).toMatchObject({ data: [] });
  },
);
When("any visitor opens its post-live page", async ({ world, host }) => {
  const state = journey(world);
  const response = await state.page.goto(
    `${host.eventsPath}/${state.selected!.slug}`,
  );
  expect(response?.status()).toBe(200);
  await expect(state.page.getByTestId("event-page-hero-status")).toContainText(
    "Эфир завершён",
  );
});
Then(
  "the page renders complete against the feature 004 projection",
  async ({ world }) => {
    await completeProjection(world);
    await downloadPdf(world);
  },
);
Then(
  "the project and topic blocks are absent rather than empty, stubbed or promised as coming soon",
  async ({ world }) => {
    const main = journey(world).page.getByRole("main");
    await expect(
      main.locator('[data-testid*="project"], [data-testid*="topic"]'),
    ).toHaveCount(0);
    await expect(
      main.getByRole("heading", { name: /проект|темы|topics|projects/iu }),
    ).toHaveCount(0);
    await expect(
      main.locator('a[href*="/projects/"], a[href*="/topics/"]'),
    ).toHaveCount(0);
    await expect(main).not.toContainText(
      /скоро появ|в разработке|coming soon/iu,
    );
  },
);

Given(
  "the event «Закрытый разбор клинических случаев» is in the draft lifecycle state",
  async ({ world }) => {
    const state = journey(world);
    state.selected = await createEvent(
      world,
      "draft",
      "Закрытый разбор клинических случаев",
    );
    state.published = await createEvent(world, "published");
  },
);

async function requestDraft(world: StepWorld, host: HostConfig): Promise<void> {
  const state = journey(world);
  const context = await state.page
    .context()
    .browser()!
    .newContext({
      baseURL: baseUrlFor(host),
      locale: "ru-RU",
      timezoneId: "Europe/Moscow",
      ...credentialOptions(),
    });
  const page = await context.newPage();
  const record = { page, document: "", rsc: "", api: "" };
  state.responses.push(record);
  const draft = state.selected!,
    published = state.published!;
  const unknownSlug = `unknown-${randomUUID()}`;
  const draftApi = await context.request.get(`/v1/public/events/${draft.slug}`);
  const unknownApi = await context.request.get(
    `/v1/public/events/${unknownSlug}`,
  );
  expect(draftApi.status()).toBe(404);
  expect(unknownApi.status()).toBe(404);
  expect(await draftApi.json()).toEqual(await unknownApi.json());
  record.api = await draftApi.text();
  for (const header of ["content-type", "cache-control"]) {
    expect(draftApi.headers()[header]).toBe(unknownApi.headers()[header]);
  }
  const positive = await context.request.get(
    `${host.eventsPath}/${published.slug}`,
  );
  expect(positive.status()).toBe(200);
  const positiveBody = await positive.text();
  for (const marker of [
    published.title,
    published.description,
    published.programPdfRef,
    state.expert!.name,
    published.startsAt.slice(0, 10),
  ])
    expect(positiveBody).toContain(marker);
  const path = `${host.eventsPath}/${draft.slug}`;
  const document = await context.request.get(path);
  const unknown = await context.request.get(
    `${host.eventsPath}/${unknownSlug}`,
  );
  expect([200, 404]).toContain(document.status());
  expect(document.status()).toBe(unknown.status());
  record.document = await document.text();
  const headers = { RSC: "1", "Next-Router-Prefetch": "1" };
  const rsc = await context.request.get(path, { headers });
  const unknownRsc = await context.request.get(
    `${host.eventsPath}/${unknownSlug}`,
    { headers },
  );
  expect([200, 404]).toContain(rsc.status());
  expect(rsc.status()).toBe(unknownRsc.status());
  record.rsc = await rsc.text();
  const notFound: string[] = [];
  for (const slug of [draft.slug, unknownSlug]) {
    const response = await page.goto(`${host.eventsPath}/${slug}`);
    expect(redirectsBesidesSilentCheck(response)).toEqual([]);
    await expect(page).toHaveURL(
      (url) => url.pathname === `${host.eventsPath}/${slug}`,
    );
    await expect(
      page.getByRole("heading", { name: "404", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('meta[name="robots"][content*="noindex"]').first(),
    ).toHaveAttribute("content", /noindex/u);
    notFound.push(await page.getByRole("main").innerText());
  }
  expect(notFound[0]).toMatch(/\S/u);
  expect(notFound[0]).toBe(notFound[1]);
}
When(
  "any visitor requests that event by its slug on doctor.school",
  async ({ world }) => requestDraft(world, HOSTS.doctor),
);
When(
  "any visitor requests that same event by its slug on academy.doctor.school",
  async ({ world }) => requestDraft(world, HOSTS.academy),
);
Then(
  "the response is not-found and is indistinguishable from a non-existent event",
  async ({ world }) => {
    const record = journey(world).responses.at(-1);
    expect(record?.api).toMatch(/event not found/u);
    await expect(
      record!.page.getByRole("heading", { name: "404", exact: true }),
    ).toBeVisible();
  },
);
Then(
  "no title, description, programme, speaker or date of the draft event appears in either response body",
  async ({ world }) => {
    const state = journey(world),
      draft = state.selected!;
    expect(state.responses).toHaveLength(2);
    for (const response of state.responses) {
      for (const marker of [
        draft.title,
        draft.description,
        draft.programPdfRef,
        state.expert!.name,
        draft.startsAt,
        draft.startsAt.slice(0, 10),
      ]) {
        expect(response.document).not.toContain(marker);
        expect(response.rsc).not.toContain(marker);
        expect(response.api).not.toContain(marker);
      }
    }
  },
);
