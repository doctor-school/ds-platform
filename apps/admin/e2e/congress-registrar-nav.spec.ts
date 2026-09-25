import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { bootstrapRegistrarAccount } from "./support/admin-session";
import {
  createPublishedEvent,
  eventSlugFromRoster,
} from "./support/congress-roster";
import { bindRegistrarToEvent } from "./support/event-grants";
import { ADMIN_ORIGIN, signInAsAdmin } from "./support/sign-in";

/**
 * 044 EARS-20 / EARS-38 — the admin navigation of a congress registrar bound to
 * one event, driven against the real admin → api → Postgres chain (V-12, V-29).
 * Two published events come from the real 007 admin form; the registrar is a real
 * Zitadel account holding `event-registrar`, bound to event A through the tech-lead
 * SQL runbook (`apps/api/src/registration/README.md`, until #2378).
 *
 * Dev-stand-gated like the rest of `apps/admin/e2e` (flows tier):
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… DATABASE_URL=… pnpm --filter @ds/admin exec playwright test \
 *     --config=playwright.flows.config.ts e2e/congress-registrar-nav.spec.ts
 *
 * `E2E_SHOT_DIR` opts into the evidence screenshots.
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOT_DIR, `${name}.png`),
    fullPage: true,
  });
}

/** Every link the admin chrome draws — the nav is the only link group in the header. */
function headerLinks(page: Page) {
  return page.locator("header a");
}

const ADMIN_SECTIONS = [
  "nav-events",
  "nav-projects",
  "nav-experts",
  "nav-partners",
  "nav-directions",
  "nav-direction-specialties",
  "nav-direction-adjacency",
  "nav-specialties",
];

test.describe.configure({ mode: "serial" });

test.describe("044 EARS-20 / EARS-38 — the registrar's admin is its event's roster", () => {
  let eventA = "";
  let eventB = "";
  /**
   * The registrar's own browser, signed in ONCE: its TOTP factor is enrolled by
   * that sign-in, and the shared helper can only answer a later challenge from a
   * secret it enrolled in the same call — so both tests drive this one session.
   */
  let deskContext: BrowserContext | undefined;
  let desk: Page;

  test.afterAll(async () => {
    await deskContext?.close();
  });

  test("044 EARS-20: a registrar bound to one event sees exactly that event's roster in the navigation", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    // The platform administrator authors both events and keeps every section.
    await signInAsAdmin(page);
    eventA = await createPublishedEvent(page, `Конгресс A ${Date.now()}`);
    eventB = await createPublishedEvent(page, `Конгресс B ${Date.now()}`);
    const slugA = await eventSlugFromRoster(page, eventA);
    await page.goto("/events");
    await expect(headerLinks(page)).toHaveCount(ADMIN_SECTIONS.length);
    for (const testId of ADMIN_SECTIONS) {
      await expect(page.getByTestId(testId)).toBeVisible();
    }
    // The administrator's roster keeps its way back to the event detail.
    await page.goto(`/events/${eventA}/roster`);
    await expect(page.getByTestId("back-to-list")).toHaveAttribute(
      "href",
      `/events/${eventA}`,
    );

    const registrar = await bootstrapRegistrarAccount(ADMIN_ORIGIN);
    await bindRegistrarToEvent(registrar.email, slugA);

    deskContext = await browser.newContext({ baseURL: ADMIN_ORIGIN });
    desk = await deskContext.newPage();
    await desk.setViewportSize({ width: 1440, height: 900 });
    // The admin-tier landing is `/events`, which a registrar may not open: the
    // chrome answers it with the refusal, and the nav still offers the roster.
    await signInAsAdmin(desk, registrar);

    // Exactly one link: the bound event's roster. No events list, no section.
    await expect(headerLinks(desk)).toHaveCount(1);
    const roster = desk.getByTestId("nav-roster");
    await expect(roster).toHaveText("Реестр участников");
    await expect(roster).toHaveAttribute("href", `/events/${eventA}/roster`);

    await roster.click();
    await desk.waitForURL(new RegExp(`/events/${eventA}/roster$`));
    await expect(desk.getByRole("heading", { level: 1 })).toHaveText(
      "Реестр участников",
    );
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 0");
    await expect(desk.getByTestId("access-refused")).toHaveCount(0);
    await expect(headerLinks(desk)).toHaveCount(1);
    // No way back to the event detail either — no event link anywhere on the page.
    await expect(desk.locator("main a")).toHaveCount(0);
    await shot(desk, "registrar-nav-roster");
  });

  test("044 EARS-38.7: every other admin route shows the refusal and the server refuses its data", async () => {
    test.setTimeout(120_000);

    for (const route of ["/events", `/events/${eventB}/roster`, "/projects"]) {
      await desk.goto(route);
      await expect(desk.getByTestId("access-refused")).toHaveText(
        "У этой учётной записи нет прав администратора.",
      );
      await expect(headerLinks(desk)).toHaveCount(1);
      if (route === "/events") await shot(desk, "registrar-refused-events");
    }

    // The drawn refusal is a projection; the server is the authority.
    const statuses = await desk.evaluate(
      async (ids) => {
        const read = async (url: string) =>
          (
            await fetch(url, {
              credentials: "include",
              headers: { accept: "application/json" },
            })
          ).status;
        return {
          list: await read("/v1/admin/events"),
          otherRoster: await read(`/v1/admin/events/${ids.b}/roster`),
          ownRoster: await read(`/v1/admin/events/${ids.a}/roster`),
        };
      },
      { a: eventA, b: eventB },
    );
    expect(statuses).toEqual({ list: 403, otherRoster: 403, ownRoster: 200 });
  });
});
