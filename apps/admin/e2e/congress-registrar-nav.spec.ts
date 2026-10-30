import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  ADMIN_ORIGIN,
  bootstrapRegistrarAccount,
  bootstrapRegistrarCommitteeAccount,
  createPublishedEvent,
  eventSlugFromRoster,
  signInAsAdmin,
} from "@ds/e2e/admin-events";
import {
  bindCommitteeToEvent,
  bindRegistrarToEvent,
} from "./support/event-grants";

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
 * `E2E_SHOT_DIR` opts into the evidence screenshots: the approved-non-canvas
 * `responsive-web` set of the registrar shell (desktop/mobile × light/dark, dark
 * = `prefers-color-scheme: dark` emulation) and the refusal state.
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
  "nav-organisations",
  "nav-organisation-roles",
  "nav-event-kinds",
  "nav-directions",
  "nav-direction-specialties",
  "nav-direction-adjacency",
  "nav-specialties",
  "nav-access",
];

test.describe.configure({ mode: "serial" });

test.describe("044 EARS-20 / EARS-38 — the registrar's admin is its event's roster", () => {
  let eventA = "";
  let eventB = "";
  let slugA = "";
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
    slugA = await eventSlugFromRoster(page, eventA);
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
    // Every sign-in lands on `/events`, which a registrar may not open: with one
    // link to its name, the chrome sends it straight to that roster.
    await signInAsAdmin(desk, registrar);
    await desk.waitForURL(new RegExp(`/events/${eventA}/roster$`));

    // Exactly one link: the bound event's roster. No events list, no section.
    await expect(headerLinks(desk)).toHaveCount(1);
    const roster = desk.getByTestId("nav-roster");
    await expect(roster).toHaveText("Реестр участников");
    await expect(roster).toHaveAttribute("href", `/events/${eventA}/roster`);

    await expect(desk.getByRole("heading", { level: 1 })).toHaveText(
      "Реестр участников",
    );
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 0");
    await expect(desk.getByTestId("access-refused")).toHaveCount(0);
    await expect(headerLinks(desk)).toHaveCount(1);
    // No way back to the event detail either — no event link anywhere on the page.
    await expect(desk.locator("main a")).toHaveCount(0);

    // The `responsive-web` evidence set of the approved shell state.
    for (const { name, width, height } of [
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ]) {
      await desk.setViewportSize({ width, height });
      for (const colorScheme of ["light", "dark"] as const) {
        await desk.emulateMedia({ colorScheme });
        await expect(headerLinks(desk)).toHaveCount(1);
        await shot(desk, `registrar-nav-${name}-${colorScheme}`);
      }
    }
    await desk.emulateMedia({ colorScheme: "light" });
    await desk.setViewportSize({ width: 1440, height: 900 });
  });

  test("044 EARS-38.7: every other admin route shows the refusal and the server refuses its data", async () => {
    test.setTimeout(120_000);

    // The admin landings are not a refusal for a one-link principal: they lead
    // to its roster (EARS-20), however they are reached.
    for (const landing of ["/", "/events"]) {
      await desk.goto(landing);
      await desk.waitForURL(new RegExp(`/events/${eventA}/roster$`));
      await expect(desk.getByTestId("access-refused")).toHaveCount(0);
    }

    // Any other route reached directly keeps the refusal.
    for (const route of [
      `/events/${eventB}/roster`,
      `/events/${eventB}`,
      "/projects",
    ]) {
      await desk.goto(route);
      await expect(desk.getByTestId("access-refused")).toHaveText(
        "У этой учётной записи нет прав администратора.",
      );
      await expect(headerLinks(desk)).toHaveCount(1);
      expect(new URL(desk.url()).pathname).toBe(route);
      if (route === "/projects") await shot(desk, "registrar-refusal");
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

  test("044 EARS-20: a registrar who also sits on the event's programme committee lands on the roster first", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    // A real account holding both roles, each bound to event A (#3098).
    const staff = await bootstrapRegistrarCommitteeAccount(ADMIN_ORIGIN);
    await bindRegistrarToEvent(staff.email, slugA);
    await bindCommitteeToEvent(staff.email, slugA);

    const context = await browser.newContext({ baseURL: ADMIN_ORIGIN });
    try {
      const both = await context.newPage();
      await both.setViewportSize({ width: 1440, height: 900 });
      // The sign-in lands on `/events`, which neither role may open: the chrome
      // sends it to the first link of its navigation — the roster.
      await signInAsAdmin(both, staff);
      await both.waitForURL(new RegExp(`/events/${eventA}/roster$`));
      await expect(both.getByTestId("access-refused")).toHaveCount(0);

      // Two links, roster first: «Реестр участников», then «Заявки».
      await expect(headerLinks(both)).toHaveCount(2);
      await expect(headerLinks(both)).toHaveText([
        "Реестр участников",
        "Заявки",
      ]);
      await expect(both.getByTestId("nav-roster")).toHaveAttribute(
        "href",
        `/events/${eventA}/roster`,
      );
      await expect(both.getByTestId("nav-submissions")).toHaveAttribute(
        "href",
        `/events/${eventA}/submissions`,
      );
      await expect(both.getByRole("heading", { level: 1 })).toHaveText(
        "Реестр участников",
      );
      await expect(both.getByTestId("roster-total")).toHaveText("Найдено: 0");

      for (const { name, width, height } of [
        { name: "desktop", width: 1440, height: 900 },
        { name: "mobile", width: 390, height: 844 },
      ]) {
        await both.setViewportSize({ width, height });
        for (const colorScheme of ["light", "dark"] as const) {
          await both.emulateMedia({ colorScheme });
          await expect(headerLinks(both)).toHaveCount(2);
          await shot(both, `dual-role-landing-${name}-${colorScheme}`);
        }
      }
      await both.emulateMedia({ colorScheme: "light" });
      await both.setViewportSize({ width: 1440, height: 900 });

      // Every admin landing leads to the roster, however it is reached.
      for (const landing of ["/", "/events"]) {
        await both.goto(landing);
        await both.waitForURL(new RegExp(`/events/${eventA}/roster$`));
        await expect(both.getByTestId("access-refused")).toHaveCount(0);
      }

      // «Заявки» opens the event's submissions registry.
      await both.getByTestId("nav-submissions").click();
      await both.waitForURL(new RegExp(`/events/${eventA}/submissions$`));
      await expect(both.getByTestId("access-refused")).toHaveCount(0);
      await expect(both.getByTestId("submissions-total")).toBeVisible();

      // A direct navigation elsewhere keeps the refusal (EARS-38.7).
      await both.goto(`/events/${eventB}/roster`);
      await expect(both.getByTestId("access-refused")).toHaveText(
        "У этой учётной записи нет прав администратора.",
      );
    } finally {
      await context.close();
    }
  });
});
