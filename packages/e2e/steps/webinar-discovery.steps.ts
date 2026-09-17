import { expect, type Locator, type Page } from "@playwright/test";
import { golden } from "@ds/db/seed/golden";

import type { HostConfig } from "../hosts.js";
import { Given, Then, When } from "./support/fixtures.js";

// Fixed golden content is asserted independently of the UI. Only the date is
// read from the slot: its seed is relative to that slot's golden-now pin.
const TITLE = "Предстоящий эфир (эталон)";
const SCHOOL = "Doctor.School";
const SPECIALTIES = ["Кардиология", "Терапия"];
const SPEAKER = "Ветров Дмитрий Аркадьевич";
const RECORDED_TITLE = "Прошедший эфир с записью (эталон)";

async function findCard(page: Page, link: Locator) {
  // Reach the named event through real pagination on either listing.
  const seenPages = new Set<string>();
  while ((await link.count()) === 0) {
    const address = page.url();
    expect(seenPages.has(address), "listing pagination must advance").toBe(
      false,
    );
    seenPages.add(address);
    const next = page.getByRole("button", { name: "Вперёд", exact: true });
    await expect(next, "named golden event must be reachable").toBeEnabled();
    await next.click();
    await page.waitForURL((url) => url.href !== address);
    await expect(page.locator("[data-webinar-card]").first()).toBeVisible();
  }
  await expect(link).toBeVisible();
  const card = page.locator("[data-webinar-card]", { has: link });
  await expect(card).toHaveCount(1);
  return card;
}

async function expectMoscowDateTime(card: Locator, startsAt: string) {
  const instant = new Date(startsAt);
  const date = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
  }).format(instant);
  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
  }).format(instant);
  await expect(card).toContainText(date);
  await expect(card).toContainText(time);
  await expect(card).toContainText("МСК");
}

function recordedPath(host: HostConfig): string {
  return `${host.eventsPath}/${golden.events.pastWithRecording.slug}`;
}

function recordedLink(page: Page, host: HostConfig) {
  return page
    .getByRole("link", { name: RECORDED_TITLE, exact: true })
    .and(page.locator(`a[href="${recordedPath(host)}"]`));
}

function eventPath(host: HostConfig): string {
  return `${host.eventsPath}/${golden.events.upcoming.slug}`;
}

function cardLink(page: Page, host: HostConfig) {
  return page
    .getByRole("link", { name: TITLE, exact: true })
    .and(page.locator(`a[href="${eventPath(host)}"]`));
}

Given(
  "the golden upcoming broadcast is publicly readable",
  async ({ request, world }) => {
    const response = await request.get(
      `/v1/public/events/${golden.events.upcoming.slug}`,
    );
    expect(response.status(), "cookie-free public golden event read").toBe(200);
    const event = await response.json();
    expect(event).toMatchObject({
      id: golden.events.upcoming.id,
      slug: golden.events.upcoming.slug,
      title: TITLE,
      school: SCHOOL,
      state: "published",
      specialties: SPECIALTIES,
    });
    expect(typeof event.startsAt).toBe("string");
    expect(
      Date.parse(event.startsAt),
      "golden event is still upcoming",
    ).toBeGreaterThan(Date.now());
    world.upcomingStartsAt = event.startsAt;
  },
);

Then(
  "the public listing is server-rendered with heading {string}",
  async ({ page, request, host }, heading: string) => {
    expect(new URL(page.url()).pathname).toBe(host.eventsPath);
    const response = await request.get(host.eventsPath);
    expect(response.status(), "cookie-free public listing response").toBe(200);
    expect(
      await response.text(),
      "schedule heading in server-rendered HTML",
    ).toContain(heading);
    await expect(
      page.getByRole("heading", { level: 1, name: heading, exact: true }),
    ).toBeVisible();
  },
);

Then(
  "the golden upcoming card shows its title, school, specialties, speaker and Moscow date and time",
  async ({ page, host, world }) => {
    if (!world.upcomingStartsAt)
      throw new Error("The golden event was not read before its card");
    const card = await findCard(page, cardLink(page, host));
    for (const value of [TITLE, SCHOOL, ...SPECIALTIES, SPEAKER, "МСК"]) {
      await expect(card).toContainText(value);
    }
    await expectMoscowDateTime(card, world.upcomingStartsAt);
  },
);

Given(
  "the golden recorded broadcast is publicly readable",
  async ({ request, world }) => {
    const response = await request.get(
      `/v1/public/events/${golden.events.pastWithRecording.slug}`,
    );
    expect(response.status(), "cookie-free public recorded event read").toBe(
      200,
    );
    const event = await response.json();
    expect(event).toMatchObject({
      id: golden.events.pastWithRecording.id,
      slug: golden.events.pastWithRecording.slug,
      title: RECORDED_TITLE,
      state: "ended",
      recording: { state: "montage", primaryKind: "edited" },
    });
    expect(typeof event.startsAt).toBe("string");
    expect(
      Date.parse(event.startsAt),
      "golden recorded event is in the past",
    ).toBeLessThan(Date.now());
    world.recordedStartsAt = event.startsAt;
  },
);

Then(
  "the public archive is selected without week or month controls",
  async ({ page, host }) => {
    expect(new URL(page.url()).pathname).toBe(host.eventsPath);
    expect(new URL(page.url()).searchParams.get("tab")).toBe("past");
    await expect(page.getByTestId("event-list-tabs")).toBeVisible();
    await expect(
      page.getByRole("tab", { name: /Архив записей · \d+/ }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("week-toolbar")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Неделя", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Месяц", exact: true }),
    ).toHaveCount(0);
  },
);

Then(
  "the golden recorded card shows its title, Moscow date and time and recording status in its month group",
  async ({ page, host, world }) => {
    if (!world.recordedStartsAt)
      throw new Error("The recorded golden event was not read before its card");
    const card = await findCard(page, recordedLink(page, host));
    await expect(card).toContainText(RECORDED_TITLE);
    await expect(card).toContainText("Запись · монтаж");
    await expectMoscowDateTime(card, world.recordedStartsAt);
    const parts = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      month: "long",
      year: "numeric",
    }).formatToParts(new Date(world.recordedStartsAt));
    const month = parts.find((part) => part.type === "month")!.value;
    const year = parts.find((part) => part.type === "year")!.value;
    const group = page.locator('section[id^="day-"]', { has: card });
    const labels = group.getByText(new RegExp(`^${month} ${year}$`, "i"));
    // Both responsive labels remain; CSS chooses the visible one.
    await expect(labels).toHaveCount(2);
    await expect(labels.filter({ visible: true })).toHaveCount(1);
  },
);

When(
  "the visitor activates the golden recorded card's recording link",
  async ({ page, host }) => {
    const card = page.locator("[data-webinar-card]", {
      has: recordedLink(page, host),
    });
    const cta = card.getByRole("link", {
      name: "Смотреть запись ↗",
      exact: true,
    });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", recordedPath(host));
    await cta.click();
  },
);

Then(
  "the visitor lands on the recorded event page showing its matching title",
  async ({ page, host }) => {
    await expect(page).toHaveURL((url) => url.pathname === recordedPath(host));
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: RECORDED_TITLE,
        exact: true,
      }),
    ).toBeVisible();
  },
);

When(
  "the visitor activates the golden upcoming card",
  async ({ page, host }) => {
    await cardLink(page, host).click();
  },
);

Then(
  "the visitor lands on the golden event page showing its matching title",
  async ({ page, host }) => {
    await page.waitForURL((url) => url.pathname === eventPath(host));
    expect(new URL(page.url()).pathname).toBe(eventPath(host));
    await expect(
      page.getByRole("heading", { level: 1, name: TITLE, exact: true }),
    ).toBeVisible();
  },
);
