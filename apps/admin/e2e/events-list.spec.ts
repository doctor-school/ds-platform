import { signInAsAdmin } from "@ds/e2e/admin-events";
import { expect, test, type Page } from "@playwright/test";
import {
  eventListSeeds,
  expectListRows,
  listAddress as address,
  seedListEvent,
  sortHeader,
  visibleEventRows,
  type EventListSeed,
} from "./support/events-list";
import { evidenceShot } from "./support/evidence-shot";

/**
 * 007 EARS-14 (#4305) — the admin event list on the real stack: it opens newest
 * start date first, sorts by each of its four columns in both directions (a
 * third header click returns to the date order), narrows by the search, the
 * state and a Moscow-day period — each composing with the others — shows every
 * applied facet as a removable chip beside «Сбросить всё», keeps the whole view
 * in the address across a reload and Back / Forward from the event its row
 * opens, and below `md` renders record cards with the same sort as a
 * «Сортировка» select.
 *
 * The run seeds its own five events through the admin create form, every one in
 * a school carrying the run marker, and narrows the list to them by that marker
 * (`?q=<marker>` — the search covers the school), so the orders it asserts do
 * not depend on whatever else the shared stand holds. Their dates span four
 * months and two states, so every sort column reorders them.
 *
 * Dev-stand-gated like the rest of `apps/admin/e2e`: a booted admin app + api
 * (`playwright.flows.config.ts`). `E2E_SHOT_DIR` opts into the PR evidence
 * screenshots; unset, the spec still asserts.
 */
const RUN = Date.now().toString(36);
const SEEDS = eventListSeeds(RUN);
const titleOf = (key: EventListSeed["key"]) =>
  SEEDS.find((seed) => seed.key === key)!.title;

/** The visible rows, in order, are exactly these events. */
const expectRows = (page: Page, keys: EventListSeed["key"][]) =>
  expectListRows(page, SEEDS, keys);

const filters = (page: Page) => page.getByTestId("events-filters");

test.describe("007 EARS-14 — the admin event list sorts by date and filters", () => {
  test("007 EARS-14: date-desc default, every column sort, the filters with chips, the address across a reload and Back / Forward, the row link and the phone cards", async ({
    page,
  }) => {
    test.setTimeout(360_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAsAdmin(page);
    const ids = new Map<EventListSeed["key"], string>();
    for (const seed of SEEDS)
      ids.set(seed.key, await seedListEvent(page, seed));
    const narrowed = `/events?q=${RUN}`;

    await test.step("the list opens newest start date first, the default order out of the address", async () => {
      await page.goto(narrowed);
      await expectRows(page, ["htn", "migraine", "dm", "back", "af"]);
      expect(address(page)).toBe(narrowed);
      await expect(filters(page).getByRole("searchbox")).toHaveValue(RUN);
      await expect(
        page.getByRole("columnheader", { name: "Дата и время (МСК)" }),
      ).toHaveAttribute("aria-sort", "descending");
      await evidenceShot(page, "events-list-seeded");
    });

    await test.step("the date header toggles ascending and back to the default", async () => {
      await sortHeader(page, "Дата и время (МСК)").click();
      await expect(page).toHaveURL(/sort=startsAt&dir=asc/);
      await expectRows(page, ["af", "back", "dm", "migraine", "htn"]);
      await sortHeader(page, "Дата и время (МСК)").click();
      await expect.poll(() => address(page)).toBe(narrowed);
      await expectRows(page, ["htn", "migraine", "dm", "back", "af"]);
    });

    await test.step("the title sorts under the Russian collation both ways, a third click returns to the date order", async () => {
      await sortHeader(page, "Название").click();
      await expect(page).toHaveURL(/sort=title&dir=asc/);
      await expectRows(page, ["htn", "back", "migraine", "dm", "af"]);
      await sortHeader(page, "Название").click();
      await expect(page).toHaveURL(/sort=title&dir=desc/);
      await expectRows(page, ["af", "dm", "migraine", "back", "htn"]);
      await sortHeader(page, "Название").click();
      await expect.poll(() => address(page)).toBe(narrowed);
      await expectRows(page, ["htn", "migraine", "dm", "back", "af"]);
    });

    await test.step("the school groups by the Russian collation, the date deciding inside a school", async () => {
      await sortHeader(page, "Школа / серия").click();
      await expect(page).toHaveURL(/sort=school&dir=asc/);
      await expectRows(page, ["af", "htn", "back", "migraine", "dm"]);
      await sortHeader(page, "Школа / серия").click();
      await expect(page).toHaveURL(/sort=school&dir=desc/);
      await expectRows(page, ["dm", "migraine", "back", "htn", "af"]);
    });

    await test.step("the state orders by the lifecycle — drafts before published — both ways", async () => {
      await sortHeader(page, "Статус").click();
      await expect(page).toHaveURL(/sort=state&dir=asc/);
      await expectRows(page, ["af", "back", "migraine", "dm", "htn"]);
      await sortHeader(page, "Статус").click();
      await expect(page).toHaveURL(/sort=state&dir=desc/);
      await expectRows(page, ["htn", "dm", "migraine", "back", "af"]);
      await sortHeader(page, "Статус").click();
      await expect.poll(() => address(page)).toBe(narrowed);
    });

    await test.step("a sort change returns to page 1", async () => {
      // Waits for the page-2 read itself: a read of the previous step may
      // still be in flight when the address changes.
      const secondPage = page.waitForResponse(
        (answer) =>
          new URL(answer.url()).pathname === "/v1/admin/events" &&
          new URL(answer.url()).searchParams.get("page") === "2",
      );
      await page.goto(`${narrowed}&page=2`);
      expect((await secondPage).ok()).toBe(true);
      await sortHeader(page, "Название").click();
      await expect(page).toHaveURL(/sort=title&dir=asc/);
      expect(address(page)).not.toContain("page=");
      await expectRows(page, ["htn", "back", "migraine", "dm", "af"]);
      await page.goto(narrowed);
    });

    await test.step("the state facet narrows instantly, as a chip", async () => {
      // The facet is named as its column is (007 EARS-14).
      await expect(filters(page).getByLabel("Статус")).toHaveAttribute(
        "data-testid",
        "events-status",
      );
      await filters(page)
        .getByTestId("events-status")
        .selectOption("published");
      await expect(page).toHaveURL(/state=published/);
      await expectRows(page, ["htn", "dm"]);
      await expect(
        filters(page).getByRole("button", {
          name: "Убрать фильтр: Опубликовано",
        }),
      ).toBeVisible();
      await filters(page)
        .getByRole("button", { name: "Убрать фильтр: Опубликовано" })
        .click();
      await expect.poll(() => address(page)).toBe(narrowed);
      await expectRows(page, ["htn", "migraine", "dm", "back", "af"]);
    });

    await test.step("the Moscow-day period narrows inclusively and composes with the state", async () => {
      await page.getByTestId("events-period-from").fill("2027-01-01");
      await page.getByTestId("events-period-to").fill("2027-02-28");
      await expect(page).toHaveURL(/startsFrom=2027-01-01&startsTo=2027-02-28/);
      await expectRows(page, ["migraine", "dm", "back"]);
      await expect(
        filters(page).getByRole("button", {
          name: "Убрать фильтр: Дата проведения: 01.01.2027 – 28.02.2027",
        }),
      ).toBeVisible();
      await filters(page)
        .getByTestId("events-status")
        .selectOption("published");
      await expectRows(page, ["dm"]);
      await evidenceShot(page, "events-list-filtered");
    });

    await test.step("a reload reopens the same view from the address", async () => {
      const before = address(page);
      await page.reload();
      expect(address(page)).toBe(before);
      await expectRows(page, ["dm"]);
      await expect(page.getByTestId("events-period-from")).toHaveValue(
        "2027-01-01",
      );
      await expect(page.getByTestId("events-period-to")).toHaveValue(
        "2027-02-28",
      );
      await expect(filters(page).getByTestId("events-status")).toHaveValue(
        "published",
      );
    });

    await test.step("«Сбросить всё» clears the search, the state and the period at once", async () => {
      await filters(page).getByRole("button", { name: "Сбросить всё" }).click();
      await expect.poll(() => address(page)).toBe("/events");
      await expect(filters(page).getByRole("searchbox")).toHaveValue("");
      await expect(page.getByTestId("events-period-from")).toHaveValue("");
      await expect(
        filters(page).getByRole("button", { name: /^Убрать фильтр/ }),
      ).toHaveCount(0);
    });

    await test.step("the search narrows by the school and composes with the sort", async () => {
      await filters(page).getByRole("searchbox").fill(`Неврология ${RUN}`);
      await expectRows(page, ["migraine", "back"]);
      await sortHeader(page, "Название").click();
      await expectRows(page, ["back", "migraine"]);
      await expect(page).toHaveURL(/sort=title&dir=asc/);
      await page.goto(narrowed);
    });

    await test.step("a «по» before the «с» is refused in place and never applied", async () => {
      await page.getByTestId("events-period-from").fill("2027-02-01");
      await expect(page).toHaveURL(/startsFrom=2027-02-01/);
      await page.getByTestId("events-period-to").fill("2027-01-15");
      await expect(page.getByTestId("events-period-inverted")).toHaveText(
        /Дата «по» раньше даты «с»/,
      );
      await expect(page.getByTestId("events-period-to")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(address(page)).not.toContain("startsTo");
      await expectRows(page, ["htn", "migraine", "dm"]);
      await evidenceShot(page, "events-list-period-inverted");
      await page.goto(narrowed);
    });

    await test.step("the row opens the event, and Back / Forward keep the view in the address", async () => {
      await sortHeader(page, "Название").click();
      await expect(page).toHaveURL(/sort=title&dir=asc/);
      await filters(page)
        .getByTestId("events-status")
        .selectOption("published");
      await expect(page).toHaveURL(/state=published/);
      await expectRows(page, ["htn", "dm"]);
      const view = address(page);
      const event = new RegExp(`/events/${ids.get("dm")}$`);
      await visibleEventRows(page)
        .filter({ hasText: titleOf("dm") })
        .click();
      await page.waitForURL(event);
      await expect(page.getByTestId("event-form")).toBeVisible();

      await page.goBack();
      await expect.poll(() => address(page)).toBe(view);
      await expectRows(page, ["htn", "dm"]);
      await expect(filters(page).getByTestId("events-status")).toHaveValue(
        "published",
      );
      await expect(
        page.getByRole("columnheader", { name: "Название" }),
      ).toHaveAttribute("aria-sort", "ascending");

      await page.goForward();
      await page.waitForURL(event);
      await expect(page.getByTestId("event-form")).toBeVisible();
      await page.goBack();
      await expect.poll(() => address(page)).toBe(view);
      await expectRows(page, ["htn", "dm"]);
    });

    await test.step("below md the rows are record cards with the sort as a «Сортировка» select", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(narrowed);
      await expect(page.getByRole("table")).toBeHidden();
      await expectRows(page, ["htn", "migraine", "dm", "back", "af"]);
      const select = page.getByLabel("Сортировка");
      await expect(select).toHaveValue("startsAt:desc");
      await select.selectOption({ label: "Название — от А до Я" });
      await expect(page).toHaveURL(/sort=title&dir=asc/);
      await expectRows(page, ["htn", "back", "migraine", "dm", "af"]);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBe(0);
    });
  });
});
