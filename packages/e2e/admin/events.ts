import { Buffer } from "node:buffer";
import { expect, type Page } from "@playwright/test";
import { chooseEventClassification } from "./event-classification";

/**
 * The admin event writers, through the PRODUCTION screens only — no database
 * access, no fixture endpoint. The event is created through the real 007 admin
 * form and moved along its lifecycle through the 007 lifecycle bar, so a spec
 * that needs a published or `live` event gets one the platform itself produced.
 *
 * Shared by the admin flow specs and the storefront e2e suites (#2751): a
 * storefront spec that needs an event in a given state drives these on the
 * admin origin in its own browser context (`signInAsAdmin`) instead of leaning
 * on a fixed seed whose wall clock drifts out of the state it was seeded in.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A `datetime-local` value for the МСК wall clock `offsetMs` from now. */
function mskInput(offsetMs: number): string {
  return new Date(Date.now() + offsetMs + 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
}

/**
 * A real, PUBLISHED event through the admin create form + lifecycle bar; returns
 * its id. The page must already be signed in on the admin origin.
 *
 * @param options.startsInMs When the event starts, relative to now (default: a
 *   week ahead). A spec that opens the event `live` passes a start inside the
 *   air window, e.g. a few minutes ahead.
 */
export async function createPublishedEvent(
  page: Page,
  title: string,
  options: { startsInMs?: number } = {},
): Promise<string> {
  await page.goto("/events/create");
  await expect(page.getByTestId("event-form")).toBeVisible();
  await page.locator("#title").fill(title);
  await page.locator("#school").fill("Кардиология");
  await page
    .locator("#startsAtMsk")
    .fill(mskInput(options.startsInMs ?? 7 * DAY_MS));
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

  await page.getByTestId("action-publish").click();
  await expect(page.getByTestId("state-published")).toBeVisible({
    timeout: 20_000,
  });
  return id;
}

/**
 * 007 `open` — take the PUBLISHED event the page is on to `live` through the
 * lifecycle bar (published → live).
 */
export async function openEventLive(page: Page): Promise<void> {
  await page.getByTestId("action-open").click();
  await expect(page.getByTestId("state-live")).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * The event's public slug, read from the admin event detail (007 `GET
 * /v1/admin/events/:id`) with the signed-in admin's session. Any event kind —
 * the roster read below answers only for an event the congress roster can
 * serve (event days set).
 */
export async function eventSlugFromDetail(
  page: Page,
  eventId: string,
): Promise<string> {
  const read = await page.evaluate(async (id) => {
    const res = await fetch(`/v1/admin/events/${id}`, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    return {
      status: res.status,
      slug: res.ok ? ((await res.json()) as { slug: string }).slug : "",
    };
  }, eventId);
  expect(read.status, "admin event detail").toBe(200);
  return read.slug;
}

/**
 * The event's public slug, read from the roster route itself with the signed-in
 * admin's session (the registration endpoint addresses an event by slug).
 */
export async function eventSlugFromRoster(
  page: Page,
  eventId: string,
): Promise<string> {
  // In-page, like the admin's own data provider: the browser's request carries
  // the same session and device headers the signed-in UI does.
  const read = await page.evaluate(async (id) => {
    const res = await fetch(`/v1/admin/events/${id}/roster`, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    return {
      status: res.status,
      slug: res.ok
        ? ((await res.json()) as { event: { slug: string } }).event.slug
        : "",
    };
  }, eventId);
  expect(read.status, "roster route for the admin").toBe(200);
  return read.slug;
}
