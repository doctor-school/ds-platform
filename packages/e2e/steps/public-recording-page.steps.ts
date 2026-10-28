import { golden, isGoldenUuid } from "@ds/db/seed/golden";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { Given, Then, When, type StepWorld } from "./support/fixtures.js";

type Speaker = {
  source: string;
  expertId: string;
  expertSlug: string;
  name: string;
  credentials: string;
  photoUrl: string | null;
  role: string;
};
type Recording = {
  state: string;
  primaryKind: string | null;
  secondaryKind: string | null;
  posterUrl: string | null;
  durationSec: number | null;
  expectedBy: string | null;
};
type Event = {
  id: string;
  slug: string;
  title: string;
  state: string;
  school: string;
  startsAt: string;
  durationMin: number;
  description: string;
  specialties: string[];
  speakers: Speaker[];
  partners: { label: string }[];
  programPdfUrl?: string;
  format: "online" | "offline" | "hybrid";
  recording: Recording;
  links: { school?: { label: string; href: string } };
};
type Candidate = Pick<Event, "id" | "slug" | "state" | "recording">;

function selected(world: StepWorld) {
  if (!world.publicEvent)
    throw new Error("014 public event has not been selected");
  return world.publicEvent;
}
async function readEvent(
  request: APIRequestContext,
  slug: string,
): Promise<Event> {
  const response = await request.get(`/v1/public/events/${slug}`);
  expect(response.status(), "public event read without a visitor account").toBe(
    200,
  );
  const event = (await response.json()) as Event;
  expect(event.slug).toBe(slug);
  expect(isGoldenUuid(event.id), "real golden event identity").toBe(true);
  expect(event.state).toBe("ended");
  expect(event.title).toMatch(/\S/u);
  return event;
}
async function pastCandidates(
  request: APIRequestContext,
): Promise<Candidate[]> {
  const response = await request.get(
    "/v1/public/events?timeframe=past&limit=50",
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { data: Candidate[] };
  expect(Array.isArray(body.data), "bounded public past envelope").toBe(true);
  expect(body.data.length).toBeGreaterThan(0);
  expect(body.data.length).toBeLessThanOrEqual(50);
  return body.data.filter(
    (entry) => isGoldenUuid(entry.id) && entry.state === "ended",
  );
}
function remember(world: StepWorld, event: Event) {
  world.publicEvent = { slug: event.slug, title: event.title };
}
function semanticSpeaker(speaker: Speaker) {
  return {
    source: speaker.source,
    expertId: speaker.expertId,
    expertSlug: speaker.expertSlug,
    name: speaker.name,
    credentials: speaker.credentials,
    role: speaker.role,
    // Signed query parameters change between reads; the public object identity does not.
    photoPath:
      speaker.photoUrl === null ? null : new URL(speaker.photoUrl).pathname,
  };
}
function expectCanonical(speakers: Speaker[]) {
  expect(
    speakers.length,
    "genuine order control needs multiple speakers",
  ).toBeGreaterThanOrEqual(2);
  expect(new Set(speakers.map((speaker) => speaker.expertId)).size).toBe(
    speakers.length,
  );
  for (const speaker of speakers) {
    expect(speaker.source).toBe("expert");
    expect(isGoldenUuid(speaker.expertId)).toBe(true);
    for (const value of [
      speaker.expertSlug,
      speaker.name,
      speaker.credentials,
      speaker.role,
    ])
      expect(value).toMatch(/\S/u);
  }
}
async function projectedSpeakers(request: APIRequestContext, slug: string) {
  const response = await request.get(`/v1/public/events/${slug}/speakers`);
  expect(
    response.status(),
    "standalone canonical public speaker projection",
  ).toBe(200);
  const speakers = (await response.json()) as Speaker[];
  expectCanonical(speakers);
  return speakers;
}
async function expectSpeakerCards(page: Page, speakers: Speaker[]) {
  const cards = page.getByTestId("event-speaker-card");
  await expect(cards).toHaveCount(speakers.length);
  for (const [index, speaker] of speakers.entries()) {
    const card = cards.nth(index);
    await expect(card).toBeVisible();
    await expect(card).toContainText(speaker.name);
    await expect(card).toContainText(speaker.credentials);
    await expect(card).toContainText(speaker.role);
  }
}
async function serverText(
  page: Page,
  request: APIRequestContext,
  path: string,
) {
  const response = await request.get(path);
  expect(response.status(), "public server-rendered document").toBe(200);
  const markup = await response.text();
  // Exclude serialized RSC data: only actual server-rendered markup counts as content.
  return page.evaluate((html) => {
    const document = new DOMParser().parseFromString(html, "text/html");
    document
      .querySelectorAll("script, style")
      .forEach((element) => element.remove());
    return (document.body.textContent ?? "").replace(/\s+/gu, " ");
  }, markup);
}

Given(
  "the public recording page is read without a visitor account",
  async ({ page }) => {
    await page.context().clearCookies();
  },
);

Given(
  "the golden ended event has a published edited recording",
  async ({ request, world }) => {
    const event = await readEvent(
      request,
      golden.events.pastWithRecording.slug,
    );
    expect(event.id).toBe(golden.events.pastWithRecording.id);
    expect(event.speakers.length).toBeGreaterThan(0);
    expect(event.specialties.length).toBeGreaterThan(0);
    expect(event.description).toMatch(/\S/u);
    expect(event.recording.state).toBe("montage");
    expect(event.recording.primaryKind).toBe("edited");
    expect(event.recording.secondaryKind).toBeNull();
    expect(event.recording.durationSec).toBe(3600);
    expect(Object.keys(event.recording).sort()).toEqual(
      [
        "state",
        "primaryKind",
        "secondaryKind",
        "posterUrl",
        "durationSec",
        "expectedBy",
      ].sort(),
    );
    remember(world, event);
  },
);

When(
  "the guest opens that public recording event page",
  async ({ page, host, world }) => {
    const event = selected(world);
    const path = `${host.eventsPath}/${event.slug}`;
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    expect(
      response?.request().redirectedFrom(),
      "canonical public route stays in place",
    ).toBeNull();
    await expect(page).toHaveURL((url) => url.pathname === path);
    await expect(
      page.getByRole("heading", { level: 1, name: event.title, exact: true }),
    ).toBeVisible();
  },
);

Then(
  "the complete public event projection and recording signal are server-rendered",
  async ({ page, request, host, world }) => {
    const event = await readEvent(request, selected(world).slug);
    const hero = page.getByTestId("event-page-hero");
    const body = page.getByRole("main");
    const school = event.links.school?.label ?? event.school;
    await expect(hero).toContainText(school);
    await expect(hero).toContainText(`${event.durationMin} минут`);
    for (const specialty of event.specialties)
      await expect(hero).toContainText(specialty);
    await expect(page.getByTestId("event-about")).toContainText(
      event.description,
    );
    await expectSpeakerCards(page, event.speakers);
    for (const partner of event.partners)
      await expect(page.getByTestId("event-partners")).toContainText(
        partner.label,
      );
    if (event.partners.length === 0)
      await expect(page.getByTestId("event-partners")).toHaveCount(0);
    const instant = new Date(event.startsAt);
    const zone =
      event.format === "offline"
        ? "Europe/Moscow"
        : await page.evaluate(
            () => Intl.DateTimeFormat().resolvedOptions().timeZone,
          );
    const date = new Intl.DateTimeFormat("ru-RU", {
      timeZone: zone,
      day: "numeric",
      month: "long",
    }).format(instant);
    const time = new Intl.DateTimeFormat("ru-RU", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(instant);
    await expect(hero).toContainText(date);
    await expect(hero).toContainText(time);
    await expect(page.getByTestId("recording-badge")).toHaveText(
      "Запись доступна",
    );
    await expect(page.getByTestId("recording-meta")).toHaveCount(0);
    const gate = page.getByTestId("player-card").getByTestId("recording-gate");
    await expect(gate).toBeVisible();
    await expect(gate).toContainText("Монтаж");
    const programme = page.getByTestId("event-programme");
    await expect(programme).toBeVisible();
    if (event.programPdfUrl) {
      const download = programme.getByRole("link");
      await expect(download).toHaveCount(1);
      expect(
        new URL((await download.getAttribute("href"))!, page.url()).pathname,
      ).toBe(new URL(event.programPdfUrl).pathname);
    } else {
      await expect(
        programme.getByTestId("event-programme-statement"),
      ).toHaveText(/\S/u);
      await expect(programme.getByRole("link")).toHaveCount(0);
    }
    const htmlText = await serverText(
      page,
      request,
      `${host.eventsPath}/${event.slug}`,
    );
    const moscowDate = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "numeric",
      month: "long",
    }).format(instant);
    const moscowTime = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(instant);
    for (const value of [
      event.title,
      school,
      event.description,
      ...event.specialties,
      ...event.speakers.flatMap((speaker) => [
        speaker.name,
        speaker.credentials,
      ]),
      ...event.partners.map((partner) => partner.label),
      moscowDate,
      moscowTime,
      "МСК",
      `${event.durationMin} минут`,
      "Запись доступна",
    ]) {
      expect(
        htmlText,
        "field is real server markup, not serialized page data",
      ).toContain(value.replace(/\s+/gu, " "));
    }
    await expect(
      body.getByText("О чём событие", { exact: true }),
    ).toBeVisible();
  },
);

Then(
  "the page has no participation action or archive-only mirror route",
  async ({ page, request, host, world }) => {
    await expect(
      page.getByRole("link", { name: "Участвовать", exact: true }),
    ).toHaveCount(0);
    const slug = selected(world).slug;
    for (const mirror of [
      `/archive/${slug}`,
      `${host.eventsPath}/${slug}/archive`,
      `${host.eventsPath}/${slug}/recording`,
    ]) {
      const response = await request.get(mirror);
      expect(response.status(), "no alternate post-live route").toBe(404);
    }
    await expect(page).toHaveURL(
      (url) => url.pathname === `${host.eventsPath}/${slug}`,
    );
  },
);

Given(
  "a real golden ended event has an operator-set readiness day and no published recording",
  async ({ request, world }) => {
    const candidate = (await pastCandidates(request)).find(
      (entry) =>
        entry.recording.state === "preparing" &&
        entry.recording.expectedBy !== null,
    );
    expect(
      candidate,
      "dated preparing fixture exists in bounded public past data",
    ).toBeDefined();
    const event = await readEvent(request, candidate!.slug);
    expect(event.id).toBe(candidate!.id);
    expect(event.recording.state).toBe("preparing");
    expect(event.recording.primaryKind).toBeNull();
    expect(event.recording.secondaryKind).toBeNull();
    expect(event.recording.expectedBy).toBe(candidate!.recording.expectedBy);
    expect(event.recording.expectedBy).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    remember(world, event);
  },
);

Then(
  "the preparing plaque occupies the player position with that exact readiness day",
  async ({ page, request, world }) => {
    const event = await readEvent(request, selected(world).slug);
    const day = new Date(`${event.recording.expectedBy}T12:00:00Z`);
    const date = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
      ...(day.getUTCFullYear() === new Date().getUTCFullYear()
        ? {}
        : { year: "numeric" as const }),
    })
      .format(day)
      .replace(/\s*г\.$/u, "");
    const card = page.getByTestId("player-card");
    const plaque = card.getByTestId("recording-plaque");
    await expect(plaque).toBeVisible();
    await expect(plaque).toContainText("Запись готовится");
    await expect(plaque.getByTestId("recording-plaque-date")).toHaveText(
      `до ${date}`,
    );
    await expect(plaque).toContainText(
      `опубликуем на этой странице до ${date}`,
    );
    await expect(card.getByTestId("recording-gate")).toHaveCount(0);
  },
);

Then(
  "no empty player, reminder action or invented readiness estimate is rendered",
  async ({ page }) => {
    await expect(page.locator("iframe, video")).toHaveCount(0);
    await expect(page.getByText(/Напомнить/iu)).toHaveCount(0);
    await expect(page.getByText(/≈\s*\d+\s*дн/iu)).toHaveCount(0);
    await expect(
      page.getByTestId("recording-plaque").getByRole("button"),
    ).toHaveCount(0);
  },
);

Given(
  "a real golden ended event has at least two distinct canonical speakers",
  async ({ request, world }) => {
    for (const candidate of (await pastCandidates(request))
      .filter((entry) => entry.recording.state !== "preparing")
      .slice(0, 20)) {
      const event = await readEvent(request, candidate.slug);
      if (event.speakers.length < 2) continue;
      expectCanonical(event.speakers);
      remember(world, event);
      return;
    }
    throw new Error(
      "No real multi-speaker golden ended control in the bounded public past data",
    );
  },
);

Then(
  "the public event speakers match the independent canonical projection in relation order",
  async ({ request, world }) => {
    const event = await readEvent(request, selected(world).slug);
    const canonical = await projectedSpeakers(request, event.slug);
    expect(event.speakers.map(semanticSpeaker)).toEqual(
      canonical.map(semanticSpeaker),
    );
  },
);

Then(
  "the rendered speaker cards preserve that exact count, order and credentials",
  async ({ page, request, world }) => {
    const canonical = await projectedSpeakers(request, selected(world).slug);
    await expectSpeakerCards(page, canonical);
  },
);
