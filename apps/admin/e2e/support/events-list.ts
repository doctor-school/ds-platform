import { chooseEventClassification } from "@ds/e2e/admin-events";
import { expect, type Locator, type Page } from "@playwright/test";
import { visible } from "./visible";

/**
 * 007 EARS-14 — handles on the admin event list (`app/events/page.tsx`, the
 * `AdminDataList` composition). The list sorts newest start date first and
 * holds its view in the address, so a spec reaches one event by NARROWING the
 * list to it (`?q=<slug>`, the slug is unique) rather than by walking pages of
 * a shared stand whose order depends on everyone else's events.
 */

/** The title handles of the rows the operator SEES (the table ≥ md, the cards below). */
export function visibleEventRows(page: Page): Locator {
  return visible(page.locator('[data-testid^="event-row-"]'));
}

/**
 * The GET the list screen makes, to read what it answered. With `q`, only the
 * read narrowed by exactly that search: a read of the page left behind (the
 * sign-in landing on the list) may still be in flight when the address changes.
 */
export function eventsListAnswer(page: Page, q?: string) {
  return page.waitForResponse((answer) => {
    const url = new URL(answer.url());
    return (
      answer.request().method() === "GET" &&
      url.pathname === "/v1/admin/events" &&
      (q === undefined || url.searchParams.get("q") === q)
    );
  });
}

/**
 * A `GET` on the admin's same-origin `/v1/*` proxy as the signed-in operator,
 * made from the page: the session cookie is `__Host-` (Secure), which the
 * browser sends to an `http://localhost` stand and `page.request` does not.
 */
export async function adminRead<T>(page: Page, path: string): Promise<T> {
  const answer = await page.evaluate(async (url) => {
    const response = await fetch(url, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    return { status: response.status, body: await response.text() };
  }, path);
  expect(answer.status, `GET ${path}: ${answer.body}`).toBe(200);
  return JSON.parse(answer.body) as T;
}

/**
 * Open the list narrowed to one event and return the visible table row of it.
 * The slug is read from the event's own admin read on the signed-in session.
 */
export async function eventListRow(
  page: Page,
  eventId: string,
): Promise<Locator> {
  const { slug } = await adminRead<{ slug: string }>(
    page,
    `/v1/admin/events/${eventId}`,
  );
  await page.goto(`/events?q=${encodeURIComponent(slug)}`);
  const row = page
    .getByRole("row")
    .filter({ has: page.getByTestId(`event-row-${eventId}`) });
  await expect(row).toBeVisible();
  return row;
}

/**
 * The id of the listed event titled exactly `title`, read off the list
 * narrowed by that title; `null` when the list holds none.
 */
export async function eventIdByTitle(
  page: Page,
  title: string,
): Promise<string | null> {
  const listed = eventsListAnswer(page, title);
  await page.goto(`/events?q=${encodeURIComponent(title)}`);
  // The answer names the event; its rendered row is then awaited, never
  // counted at the instant the answer lands (React has not drawn it yet).
  const body = (await (await listed).json()) as {
    data: { id: string; title: string }[];
  };
  const match = body.data.find((event) => event.title === title);
  if (!match) return null;
  await expect(visible(page.getByTestId(`event-row-${match.id}`))).toHaveText(
    title,
  );
  return match.id;
}

/** The id of the newest listed event, or `null` on an empty list. */
export async function anyListedEventId(page: Page): Promise<string | null> {
  const listed = eventsListAnswer(page);
  await page.goto("/events");
  const body = (await (await listed).json()) as { data: { id: string }[] };
  if (body.data.length === 0) return null;
  const id = body.data[0]!.id;
  await expect(visible(page.getByTestId(`event-row-${id}`))).toBeVisible();
  return id;
}

/** One event a list run authors for itself. */
export interface EventListSeed {
  key: "htn" | "back" | "dm" | "af" | "migraine";
  title: string;
  school: string;
  startsAtMsk: string;
  publish: boolean;
}

/**
 * Five events a list run authors for itself, every one in a school carrying
 * the run `marker`, so `?q=<marker>` (the search covers the school) narrows the
 * list to exactly them on a shared stand. Their start dates span four months
 * and they are in two states, so each sort column orders them differently:
 *
 *   date ↓   htn · migraine · dm · back · af
 *   title ↑  htn · back · migraine · dm · af   (А → Я)
 *   school ↑ af · htn · back · migraine · dm   (the date ↑ inside a school)
 *   state ↑  af · back · migraine · dm · htn   (drafts, then published; date ↑)
 */
export function eventListSeeds(marker: string): EventListSeed[] {
  return [
    {
      key: "htn",
      title: "Артериальная гипертензия: новые клинические рекомендации",
      school: `Кардиология ${marker}`,
      startsAtMsk: "2027-03-12T19:00",
      publish: true,
    },
    {
      key: "back",
      title: "Боль в спине: красные флаги на приёме терапевта",
      school: `Неврология ${marker}`,
      startsAtMsk: "2027-01-20T18:00",
      publish: false,
    },
    {
      key: "dm",
      title: "Сахарный диабет 2 типа: интенсификация терапии",
      school: `Эндокринология ${marker}`,
      startsAtMsk: "2027-02-05T19:00",
      publish: true,
    },
    {
      key: "af",
      title: "Фибрилляция предсердий у пожилых пациентов",
      school: `Кардиология ${marker}`,
      startsAtMsk: "2026-12-10T19:00",
      publish: false,
    },
    {
      key: "migraine",
      title: "Мигрень: профилактика приступов",
      school: `Неврология ${marker}`,
      startsAtMsk: "2027-02-26T17:00",
      publish: false,
    },
  ];
}

/** Author one seed through the admin create form, publishing it when asked; returns its id. */
export async function seedListEvent(
  page: Page,
  seed: EventListSeed,
): Promise<string> {
  await page.goto("/events/create");
  await expect(page.getByTestId("event-form")).toBeVisible();
  await page.locator("#title").fill(seed.title);
  await page.locator("#school").fill(seed.school);
  await page.locator("#startsAtMsk").fill(seed.startsAtMsk);
  await page.locator("#durationMin").fill("90");
  await page.getByTestId("program-pdf").setInputFiles({
    name: "program.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF"),
  });
  await chooseEventClassification(page);
  await page.getByTestId("submit-event").click();
  await page.waitForURL(/\/events\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  const id = page.url().split("/").pop()!;
  if (seed.publish) {
    await page.getByTestId("action-publish").click();
    await expect(page.getByTestId("state-published")).toBeVisible();
  }
  return id;
}

/** The visible rows, in order, are exactly these seeds. */
export async function expectListRows(
  page: Page,
  seeds: EventListSeed[],
  keys: EventListSeed["key"][],
): Promise<void> {
  await expect(visibleEventRows(page)).toHaveText(
    keys.map((key) => seeds.find((seed) => seed.key === key)!.title),
  );
}

/** The address without the origin, the query decoded. */
export function listAddress(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${decodeURIComponent(url.search)}`;
}

/** A sort header's button, by the column's header text. */
export function sortHeader(page: Page, name: string): Locator {
  return page.getByRole("columnheader", { name }).getByRole("button");
}
