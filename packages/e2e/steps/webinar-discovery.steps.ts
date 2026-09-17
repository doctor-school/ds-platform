import { expect, type Page } from "@playwright/test";
import { golden } from "@ds/db/seed/golden";

import type { HostConfig } from "../hosts.js";
import { Given, Then, When } from "./support/fixtures.js";

// Fixed golden content is asserted independently of the UI. Only the date is
// read from the slot: its seed is relative to that slot's golden-now pin.
const TITLE = "Предстоящий эфир (эталон)";
const SCHOOL = "Doctor.School";
const SPECIALTIES = ["Кардиология", "Терапия"];
const SPEAKER = "Ветров Дмитрий Аркадьевич";

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
    const link = cardLink(page, host);
    // The golden programme spans several feed pages. Reach the named event through
    // the real pagination, without substituting a convenient first card or API URL.
    const seenPages = new Set<string>();
    while ((await link.count()) === 0) {
      const address = page.url();
      expect(seenPages.has(address), "listing pagination must advance").toBe(
        false,
      );
      seenPages.add(address);
      const next = page.getByRole("button", { name: "Вперёд", exact: true });
      await expect(
        next,
        "golden upcoming event must be reachable in the listing",
      ).toBeEnabled();
      await next.click();
      await page.waitForURL((url) => url.href !== address);
      await expect(page.locator("[data-webinar-card]").first()).toBeVisible();
    }
    await expect(link).toBeVisible();
    const card = page.locator("[data-webinar-card]", { has: link });
    await expect(card).toHaveCount(1);
    for (const value of [TITLE, SCHOOL, ...SPECIALTIES, SPEAKER, "МСК"]) {
      await expect(card).toContainText(value);
    }
    const instant = new Date(world.upcomingStartsAt);
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
