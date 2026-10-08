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
// The feed card states a playable recording with its length: the golden
// published edited cut runs 3600 s (golden dataset `pastEdited`).
const RECORDING_STATUS = "Запись · 1 ч 00 мин";
const RECORDING_CTA = "Смотреть запись";

async function findCard(page: Page, link: Locator) {
  // Generic navigation stops at DOMContentLoaded. The server-rendered feed link
  // is already live then, before its client handler exists (archive trace #2253).
  // Match the shared sign-in helper's initial client-readiness wait before clicks.
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle");
  // Reach the named event through the feed's real «Показать ещё» on either tense:
  // each activation widens the URL horizon and renders the wider reading.
  const seenHorizons = new Set<string>();
  while ((await link.count()) === 0) {
    const more = page.getByTestId("events-feed-show-more");
    await expect(more, "named golden event must be reachable").toBeVisible();
    await expect(more).toHaveAccessibleName(/^Показать ещё/);
    const horizon = await more.getAttribute("href");
    expect(horizon, "show-more link carries the wider horizon").toBeTruthy();
    expect(
      seenHorizons.has(horizon!),
      "listing show-more must widen the horizon",
    ).toBe(false);
    seenHorizons.add(horizon!);
    await more.click();
    await page.waitForURL((url) => `${url.pathname}${url.search}` === horizon);
    // The wider reading has rendered once the link no longer offers this horizon.
    await expect(more).not.toHaveAttribute("href", horizon!);
    await expect(page.locator("[data-webinar-card]").first()).toBeVisible();
  }
  await expect(link).toBeVisible();
  const card = page.locator("[data-webinar-card]", { has: link });
  await expect(card).toHaveCount(1);
  return card;
}

/** The browser's IANA zone — the viewer zone the feed re-formats into. */
async function viewerZoneOf(page: Page): Promise<string> {
  return page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/**
 * The explicit zone label of an online card (004 «Amendment — 2026-10-02»):
 * «МСК» at +03:00, otherwise «GMT±N» / «GMT±N:MM», «GMT+0» at zero.
 */
function zoneLabel(instant: Date, timeZone: string): string {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /^GMT([+-])(\d{2}):(\d{2})$/u.exec(name);
  if (!match) return "GMT+0";
  const [, sign, hh, mm] = match;
  if (sign === "+" && hh === "03" && mm === "00") return "МСК";
  const hours = Number(hh);
  if (hours === 0 && mm === "00") return "GMT+0";
  return mm === "00" ? `GMT${sign}${hours}` : `GMT${sign}${hours}:${mm}`;
}

/**
 * The golden events are online, so their cards show the start in the viewer's
 * zone with its explicit label (004 «Amendment — 2026-10-02», read by the 004
 * and 014 scenarios); a viewer in Moscow reads the Moscow date, time and «МСК».
 */
async function expectShownDateTime(
  page: Page,
  card: Locator,
  startsAt: string,
) {
  const timeZone = await viewerZoneOf(page);
  const instant = new Date(startsAt);
  const date = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "numeric",
    month: "long",
  }).format(instant);
  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
  await expect(card).toContainText(date);
  await expect(card).toContainText(time);
  await expect(card).toContainText(zoneLabel(instant, timeZone));
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
      format: "online",
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
    for (const value of [TITLE, SCHOOL, ...SPECIALTIES, SPEAKER]) {
      await expect(card).toContainText(value);
    }
    await expectShownDateTime(page, card, world.upcomingStartsAt);
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
      format: "online",
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
    // A legacy `?tab=past` address lands on the feed's canonical tense URL.
    const params = new URL(page.url()).searchParams;
    expect(params.get("tense")).toBe("past");
    expect(params.has("tab")).toBe(false);
    const tabs = page.getByTestId("events-tense-tabs");
    await expect(tabs).toBeVisible();
    await expect(
      tabs.getByRole("tab", { name: "Прошедшие", exact: true }),
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
    await expect(card).toContainText(RECORDING_STATUS);
    await expectShownDateTime(page, card, world.recordedStartsAt);
    // Archive cards group by the month of the time they show.
    const parts = new Intl.DateTimeFormat("ru-RU", {
      timeZone: await viewerZoneOf(page),
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
      name: RECORDING_CTA,
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
