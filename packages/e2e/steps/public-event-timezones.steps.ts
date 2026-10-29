import { golden, isGoldenUuid } from "@ds/db/seed/golden";
import {
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { baseUrlFor } from "../hosts.js";
import { reachFeedCard } from "../lib/feed-card.js";
import { redirectsBesidesSilentCheck } from "../lib/silent-check.js";
import { standHttpCredentials } from "../lib/stand-http-credentials.js";
import {
  After,
  Given,
  Then,
  When,
  type StepWorld,
} from "./support/fixtures.js";

type PublicEvent = {
  id: string;
  slug: string;
  title: string;
  state: string;
  format: string;
  startsAt: string;
  durationMin: number;
};
type Rect = { x: number; y: number; width: number; height: number };
type Snapshot = { hero: Rect; signup: Rect };
type State = {
  event: PublicEvent;
  zone?: string;
  context?: BrowserContext;
  page?: Page;
  release?: () => void;
  baseline?: Snapshot;
};
const states = new WeakMap<StepWorld, State>();
const MOSCOW = "Europe/Moscow";

function state(world: StepWorld): State {
  const value = states.get(world);
  if (!value) throw new Error("004 timezone event was not selected");
  return value;
}

async function read<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path);
  expect(response.status(), path).toBe(200);
  return response.json() as Promise<T>;
}

function validate(event: PublicEvent, format: "online" | "offline"): void {
  expect(isGoldenUuid(event.id), "published identity is golden").toBe(true);
  expect(event.slug).toMatch(/^golden-/u);
  expect(event.title.trim()).not.toBe("");
  expect(event.state).toBe("published");
  expect(event.format).toBe(format);
  expect(Number.isFinite(Date.parse(event.startsAt))).toBe(true);
  expect(
    Date.parse(event.startsAt),
    "fixture is still upcoming",
  ).toBeGreaterThan(Date.now());
  expect(event.durationMin).toBeGreaterThan(0);
}

function expected(event: PublicEvent, zone: string) {
  const instant = new Date(event.startsAt);
  const options = { timeZone: zone };
  const time = new Intl.DateTimeFormat("ru-RU", {
    ...options,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
  const date = new Intl.DateTimeFormat("ru-RU", {
    ...options,
    day: "numeric",
    month: "long",
  }).format(instant);
  const weekday = new Intl.DateTimeFormat("ru-RU", {
    ...options,
    weekday: "long",
  }).format(instant);
  const label =
    zone === MOSCOW
      ? "МСК"
      : new Intl.DateTimeFormat("en-US", {
          ...options,
          timeZoneName: "shortOffset",
        })
          .formatToParts(instant)
          .find((part) => part.type === "timeZoneName")!.value;
  return { time, date, weekday, label };
}

async function assertPageTime(page: Page, event: PublicEvent, zone: string) {
  const value = expected(event, zone);
  await expect(page.getByTestId("event-page-hero")).toContainText(
    `${value.date}, ${value.time} (${value.label}) · ${event.durationMin} минут`,
  );
  const signup = page
    .getByTestId("event-signup-box")
    .locator(":scope > div")
    .first();
  await expect(signup.locator(":scope > span").first()).toHaveText(value.time);
  await expect(signup).toContainText(value.date);
  await expect(signup).toContainText(`${value.weekday} · ${value.label}`);
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    function rect(id: string) {
      const element = document.querySelector(`[data-testid="${id}"]`);
      if (!element) throw new Error(`missing geometry target ${id}`);
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }
    return { hero: rect("event-page-hero"), signup: rect("event-signup-box") };
  });
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

Given(
  "the published golden online event has a valid start instant",
  async ({ request, world }) => {
    const event = await read<PublicEvent>(
      request,
      `/v1/public/events/${golden.events.upcoming.slug}`,
    );
    expect(event).toMatchObject(golden.events.upcoming);
    validate(event, "online");
    states.set(world, { event });
  },
);

Given(
  "a real published golden offline event has a valid future start instant",
  async ({ request, world }) => {
    const listing = await read<{ data: PublicEvent[] }>(
      request,
      "/v1/public/events?timeframe=upcoming",
    );
    const selected = listing.data.find(
      (event) =>
        isGoldenUuid(event.id) &&
        event.slug.startsWith("golden-volume-event-") &&
        event.format === "offline" &&
        event.state === "published" &&
        Date.parse(event.startsAt) > Date.now(),
    );
    expect(
      selected,
      "real upcoming listing contains a published golden offline event",
    ).toBeDefined();
    const event = await read<PublicEvent>(
      request,
      `/v1/public/events/${selected!.slug}`,
    );
    validate(event, "offline");
    expect(event).toMatchObject({
      id: selected!.id,
      slug: selected!.slug,
      title: selected!.title,
      startsAt: selected!.startsAt,
      format: selected!.format,
      state: selected!.state,
    });
    states.set(world, { event });
  },
);

Given(
  "the public event viewer's browser timezone is {string}",
  async ({ world }, zone: string) => {
    expect([MOSCOW, "Asia/Yekaterinburg"]).toContain(zone);
    state(world).zone = zone;
  },
);

When(
  "the viewer opens the real event page with hydration held",
  async ({ browser, host, world }) => {
    const s = state(world);
    if (!s.zone) throw new Error("004 viewer timezone not selected");
    const credentials = standHttpCredentials();
    s.context = await browser.newContext({
      baseURL: baseUrlFor(host),
      timezoneId: s.zone,
      viewport: { width: 1440, height: 1000 },
      colorScheme: "light",
      serviceWorkers: "block",
      ...(credentials ? { httpCredentials: credentials } : {}),
    });
    s.page = await s.context.newPage();
    const page = s.page;
    await page.addInitScript(() => {
      const observation = {
        shifts: [] as number[],
        supported:
          PerformanceObserver.supportedEntryTypes.includes("layout-shift"),
      };
      Object.assign(window, { publicEventTimezoneObservation: observation });
      if (observation.supported) {
        new PerformanceObserver((list) => {
          for (const item of list.getEntries()) {
            const shift = item as PerformanceEntry & {
              value: number;
              sources?: { node?: Node }[];
            };
            if (
              shift.sources?.some(
                ({ node }) =>
                  node !== undefined &&
                  Array.from(
                    document.querySelectorAll(
                      '[data-testid="event-page-hero"], [data-testid="event-signup-box"]',
                    ),
                  ).some((root) => root.contains(node) || node.contains(root)),
              )
            ) {
              observation.shifts.push(shift.value);
            }
          }
        }).observe({ type: "layout-shift", buffered: true });
      }
    });
    let held = 0;
    const gate = new Promise<void>((resolve) => {
      s.release = resolve;
    });
    await page.route("**/_next/static/**", async (route) => {
      if (route.request().resourceType() === "script") {
        held++;
        await gate;
      }
      await route.continue();
    });
    const path = `${host.eventsPath}/${s.event.slug}`;
    const response = await page.goto(path, { waitUntil: "commit" });
    expect(response?.status()).toBe(200);
    // 003 EARS-63: a signed-out first visit round-trips the silent check back
    // to this very address; only a redirect away from the page is a failure.
    expect(redirectsBesidesSilentCheck(response)).toEqual([]);
    // The predicate URL matcher waits for load, which the held scripts prevent.
    // Assert the committed document and actual browser address before hydration.
    const origin = new URL(baseUrlFor(host)).origin;
    expect(new URL(response!.url()).origin).toBe(origin);
    expect(new URL(response!.url()).pathname).toBe(path);
    expect(new URL(page.url()).origin).toBe(origin);
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(
      page.getByRole("heading", { level: 1, name: s.event.title, exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("event-signup-box")).toBeVisible();
    await expect
      .poll(() => held, {
        message: "real hydration scripts are held before SSR observation",
      })
      .toBeGreaterThan(0);
    expect(
      await page.evaluate(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      ),
    ).toBe(s.zone);
  },
);

Then(
  "the server-rendered hero and signup show the independently expected Moscow date and time",
  async ({ world }) => {
    const s = state(world);
    await assertPageTime(s.page!, s.event, MOSCOW);
    await settle(s.page!);
    s.baseline = await snapshot(s.page!);
    await s.page!.evaluate(() => {
      const observation = (
        window as unknown as {
          publicEventTimezoneObservation: {
            shifts: number[];
            supported: boolean;
          };
        }
      ).publicEventTimezoneObservation;
      if (!observation.supported)
        throw new Error("layout-shift observation unavailable");
      observation.shifts.length = 0;
    });
  },
);

async function hydrate(world: StepWorld, viewerTime: boolean) {
  const s = state(world);
  const page = s.page!;
  if (!s.release || !s.baseline || !s.zone)
    throw new Error("004 SSR observation incomplete");
  s.release();
  await page.waitForLoadState("networkidle");
  // A real interaction proves the client actually mounted even in Moscow,
  // where the expected time text deliberately remains identical to the SSR.
  const toggle = page.getByTestId("theme-toggle");
  await toggle.click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/u);
  await toggle.click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/u);
  await assertPageTime(page, s.event, viewerTime ? s.zone : MOSCOW);
  await settle(page);
  const after = await snapshot(page);
  for (const part of ["hero", "signup"] as const) {
    for (const axis of ["x", "y", "width", "height"] as const) {
      expect(
        Math.abs(after[part][axis] - s.baseline[part][axis]),
        `${part}.${axis} across actual hydration`,
      ).toBeLessThanOrEqual(0.5);
    }
  }
  const shifts = await page.evaluate(
    () =>
      (
        window as unknown as {
          publicEventTimezoneObservation: { shifts: number[] };
        }
      ).publicEventTimezoneObservation.shifts,
  );
  expect(shifts, "no observed hydration shift sourced in hero/signup").toEqual(
    [],
  );
}

Then(
  "after real hydration the hero and signup show the independently expected viewer date and time without a layout shift",
  async ({ world }) => {
    expect(state(world).zone).toBe("Asia/Yekaterinburg");
    expect(expected(state(world).event, MOSCOW).time).not.toBe(
      expected(state(world).event, state(world).zone!).time,
    );
    await hydrate(world, true);
  },
);

Then(
  "after real hydration the hero and signup keep the independently expected Moscow date and time",
  async ({ world }) => {
    await hydrate(world, false);
  },
);

Then(
  "the same offline event's real listing card keeps the independently expected Moscow date and time",
  async ({ host, world }) => {
    const s = state(world);
    const page = s.page!;
    expect(s.event.format).toBe("offline");
    const response = await page.goto(host.eventsPath);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL((url) => url.pathname === host.eventsPath);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Расписание эфиров",
        exact: true,
      }),
    ).toBeVisible();
    const link = page.getByRole("link", { name: s.event.title, exact: true });
    const card = await reachFeedCard(page, link);
    const value = expected(s.event, MOSCOW);
    await expect(card.locator("[data-time-plate]")).toContainText(value.time);
    await expect(card.locator("[data-time-plate]")).toContainText(value.date);
    await expect(card.locator("[data-time-plate]")).toContainText("МСК");
    await expect(card.locator("[data-time-plate]")).not.toContainText("GMT+5");
    await expect(card.locator("[data-event-format-label]")).toHaveText(
      /офлайн/iu,
    );
    await expect(link).toHaveAttribute(
      "href",
      `${host.eventsPath}/${s.event.slug}`,
    );
  },
);

After({ tags: "@public-event-timezones" }, async ({ world }) => {
  const s = states.get(world);
  s?.release?.();
  await s?.context?.close();
  states.delete(world);
});
