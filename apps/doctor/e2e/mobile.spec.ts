import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * 017 EARS-14 (#1489) — the mobile-breakpoint parity and `playwright-axe` sweep
 * over the RELEASE-1 storefront surfaces: the shell header and its action
 * cluster (#1478), the specialty catalog with its search field and expand
 * control (#1481), the collapsed chosen row with «сменить» (#1482) and the hero
 * counters band (#1480).
 *
 * Deliberately NOT swept here, each carrying its own parity obligation inside
 * its own Issue when it lands: the nearest-events block with the compact
 * calendar (#1485), «Что исследовать» (LD-8 deferred, #1486), the leaderboard
 * (wave 2, #1487) and the marketing routes (#1488). The other doctor routes
 * (`/events`, `/documents`, `/login`, `/register`, `/account`) belong to 019 /
 * 028 / 021 / 003 and are scanned by their own specs; the 017-owned route in
 * release 1 is `/`, where the shell renders alongside the catalog and the hero.
 *
 * The tier is backend-free by design (`playwright.ci.config.ts`, `next start`
 * on the built app), so the storefront is mocked at the network boundary
 * exactly like `specialty-catalog.spec.ts` and `specialty-memory.spec.ts` —
 * that is what makes the `обычно` render and the collapsed row reachable with
 * no api. Behaviour on the contract is what is under test; the contract itself
 * is asserted one tier down at the api.
 *
 * The helpers below are transcribed from `e2e/events-mobile.spec.ts` (019
 * EARS-13): duplicating them is the recorded precedent for this tier — the two
 * specs cover different features and must stay independently readable.
 */
const BOOK_ROUTE = "**/v1/public/specialties";
const FREQUENT_ROUTE = "**/v1/public/specialties/frequent";
const SEARCH_ROUTE = "**/v1/public/specialties/search*";
const CHOICE_ROUTE = "**/v1/public/specialty-choice";
const STATISTICS_ROUTE = "**/v1/public/statistics";

function ref(index: number, name: string, isOther = false) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    code: `code-${index}`,
    name,
    isOther,
  };
}

const ENTRIES = [
  ref(1, "Кардиология"),
  ref(2, "Детская кардиология"),
  ref(3, "Неврология"),
  ref(4, "Травматология и ортопедия"),
  ref(5, "Бактериология (сохраняется до 1 сентября 2028 г.)"),
  ref(6, "Другое", true),
];
const FREQUENT = [ENTRIES[0]!, ENTRIES[2]!, ENTRIES[3]!];
const BOOK = { entries: ENTRIES, total: ENTRIES.length };

/** The production shape of the statistics read the hero's counters hang on. */
const STATISTICS_BODY = {
  doctors: 12400,
  specialties: 118,
  eventsPerYear: 86,
  computedAt: "2026-08-26T09:00:00.000Z",
};

interface ChoiceStore {
  /** The remembered entry id, or `null` for «nothing chosen yet». */
  remembered: string | null;
  /** Every reference the storefront submitted, in order. */
  submitted: string[];
}

async function serveStorefront(page: Page): Promise<ChoiceStore> {
  const store: ChoiceStore = { remembered: null, submitted: [] };

  await page.route(STATISTICS_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(STATISTICS_BODY),
    }),
  );

  // The choice read/write pair. GET answers what the store holds — resolved back
  // to the book entry, exactly as the api does — and POST records it.
  await page.route(CHOICE_ROUTE, async (route) => {
    const request = route.request();

    if (request.method() === "POST") {
      const body = request.postDataJSON() as { specialty?: string };
      const reference = body?.specialty ?? "";
      store.submitted.push(reference);
      const chosen = ENTRIES.find(
        (candidate) =>
          candidate.id === reference || candidate.code === reference,
      );
      if (!chosen) {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            status: 422,
            title: "not in book",
            errorCode: "SPECIALTY_NOT_IN_BOOK",
            traceId: "t",
          }),
        });
        return;
      }
      store.remembered = chosen.id;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ specialty: chosen, storedIn: "session" }),
      });
      return;
    }

    const entry = ENTRIES.find((candidate) => candidate.id === store.remembered);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        entry
          ? { specialty: entry, storedIn: "session" }
          : { specialty: null, storedIn: "none" },
      ),
    });
  });

  await page.route(SEARCH_ROUTE, async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") ?? "";
    const fold = (value: string) =>
      value.normalize("NFC").toLowerCase().replace(/ё/g, "е").trim();
    const found = ENTRIES.filter((entry) =>
      fold(entry.name).includes(fold(query)),
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ query, entries: found, total: found.length }),
    });
  });

  await page.route(FREQUENT_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: FREQUENT }),
    }),
  );

  await page.route(BOOK_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(BOOK),
    }),
  );

  return store;
}

async function keyboardReach(page: Page, target: Locator) {
  for (let index = 0; index < 100; index++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((node) => node === document.activeElement))
      return;
  }
  await expect(target, "control must be reachable with Tab").toBeFocused();
}

async function visibleFocus(target: Locator) {
  await expect(target).toBeFocused();
  expect(await target.evaluate((node) => node.matches(":focus-visible"))).toBe(
    true,
  );
  expect(
    await target.evaluate((node) => {
      const style = getComputedStyle(node);
      return (
        style.boxShadow !== "none" ||
        (style.outlineStyle !== "none" &&
          Number.parseFloat(style.outlineWidth) > 0)
      );
    }),
    "keyboard focus must have a rendered indicator",
  ).toBe(true);
}

/**
 * Open the storefront root in the requested theme, served. The dark theme is
 * CLASS-based on this host, so it is reached through the header toggle —
 * Playwright colorScheme emulation is a no-op here.
 */
async function present(page: Page, theme: "light" | "dark") {
  await serveStorefront(page);
  await page.goto("/");
  const toggle = page.getByTestId("theme-toggle");
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-pressed")) !== String(theme === "dark"))
    await toggle.click();
  await expect(toggle).toHaveAttribute(
    "aria-pressed",
    String(theme === "dark"),
  );
  // Scan and drive the RESOLVED page, never whatever was on screen first.
  await expect(page.getByTestId("hero-counters")).toHaveAttribute(
    "data-state",
    "ready",
  );
  await expect(page.getByTestId("specialty-catalog")).toHaveAttribute(
    "data-state",
    "open",
  );
}

/** The shell chrome the action cluster and the logo live in (#1478). */
async function expectShell(page: Page) {
  await expect(page.getByTestId("storefront-header")).toBeVisible();
  await expect(page.getByTestId("storefront-logo")).toBeVisible();
  await expect(page.getByTestId("shell-action-cluster")).toBeVisible();
}

/** No composition may push the document wider than the viewport it renders in. */
async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.clientWidth),
    "document must fill the viewport width",
  ).toBe(page.viewportSize()!.width);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
    "page must not overflow horizontally",
  ).toBeLessThanOrEqual(1);
}

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * The full-page axe scan plus the exactly-one-non-empty-h1 sentinel: the axe
 * rule page-has-heading-one asserts only «at least one», and a page that
 * rendered nothing would otherwise be trivially clean. No rule is allowlisted
 * and no node excluded — a violation is a defect in the surface, not the scan.
 */
async function expectAxeClean(page: Page, render: string) {
  const h1 = page.locator("h1");
  await expect(h1, `h1 count on / (${render})`).toHaveCount(1);
  await expect(h1, `h1 text on / (${render})`).not.toHaveText(/^\s*$/);

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    results.violations.map(({ id, impact, help, nodes }) => ({
      id,
      impact,
      help,
      nodes: nodes.map(({ target, failureSummary }) => ({
        target,
        failureSummary,
      })),
    })),
    `full-page axe on / (${render}), including contrast`,
  ).toEqual([]);
}

/** Drive the catalog from the open render to the collapsed chosen row. */
async function chooseCardiology(page: Page) {
  await page.getByRole("button", { name: "Кардиология", exact: true }).click();
  await expect(page.getByTestId("specialty-catalog")).toHaveAttribute(
    "data-state",
    "chosen",
  );
  await expect(page.getByTestId("specialty-chosen")).toHaveText("Кардиология");
  await expect(page.getByTestId("specialty-change")).toBeVisible();
}

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

test.describe("017 EARS-14.1: the mobile composition is operable (#1489)", () => {
  test.use({ viewport: MOBILE });

  for (const theme of ["light", "dark"] as const) {
    test(`017 EARS-14.1: at 390px in the ${theme} theme the shell, the catalog and the collapsed row render and stay operable`, async ({
      page,
    }) => {
      await present(page, theme);

      await expectShell(page);
      await expectNoHorizontalOverflow(page);

      // The catalog in its «обычно» render: the labelled field, the frequent
      // set, and the expand control bound to the SERVED total.
      const catalog = page.getByTestId("specialty-catalog");
      const field = page.getByRole("searchbox", {
        name: "Поиск специальности",
      });
      await expect(field).toBeVisible();
      const entries = page.getByTestId("specialty-entry");
      await expect(entries).toHaveCount(FREQUENT.length);
      const expand = page.getByTestId("specialty-expand");
      await expect(expand).toHaveText(`Показать весь список — ${BOOK.total}`);

      // Typing narrows the set — the field is live, not decoration.
      await field.fill("Невро");
      await expect(catalog).toHaveAttribute("data-state", "filtered");
      await expect(entries).toHaveCount(1);
      await expect(entries.first()).toHaveText("Неврология");

      await field.fill("");
      await expect(catalog).toHaveAttribute("data-state", "open");
      await expect(entries).toHaveCount(FREQUENT.length);

      // The expand control grows the set to the whole book.
      await expand.click();
      await expect(catalog).toHaveAttribute("data-state", "expanded");
      await expect(entries).toHaveCount(BOOK.total);
      await expectNoHorizontalOverflow(page);

      // Choosing collapses to the row; «сменить» brings the catalog back.
      await chooseCardiology(page);
      await expect(page.getByTestId("specialty-search")).toHaveCount(0);
      await expect(entries).toHaveCount(0);
      await expectShell(page);
      await expectNoHorizontalOverflow(page);

      await page.getByTestId("specialty-change").click();
      await expect(catalog).toHaveAttribute("data-state", "open");
      await expect(field).toBeVisible();
      await expect(entries).toHaveCount(FREQUENT.length);
      await expect(expand).toHaveText(`Показать весь список — ${BOOK.total}`);
      await expectNoHorizontalOverflow(page);
    });
  }
});

for (const [label, viewport] of [
  ["390", MOBILE],
  ["1280", DESKTOP],
] as const) {
  test.describe(`017 EARS-14.2: the axe bar at ${label}px (#1489)`, () => {
    test.use({ viewport });

    for (const theme of ["light", "dark"] as const) {
      test(`017 EARS-14.2: at ${label}px in the ${theme} theme the open catalog and the collapsed row both pass WCAG 2 A/AA and 2.1 A/AA`, async ({
        page,
      }) => {
        await present(page, theme);
        await expectShell(page);
        await expectAxeClean(page, `${label}px ${theme}, open catalog`);

        await chooseCardiology(page);
        await expectAxeClean(page, `${label}px ${theme}, collapsed row`);
      });
    }
  });
}

test.describe("017 EARS-14.3: labelled controls and keyboard reach (#1489)", () => {
  test.use({ viewport: MOBILE });

  for (const theme of ["light", "dark"] as const) {
    test(`017 EARS-14.3: in the ${theme} theme every catalog control is a named interactive element the keyboard reaches with a visible focus ring`, async ({
      page,
    }) => {
      await present(page, theme);

      const field = page.getByRole("searchbox", {
        name: "Поиск специальности",
      });
      await expect(field).toHaveAccessibleName("Поиск специальности");

      // Every entry and the expand control are real buttons carrying a name —
      // not a div wearing a click handler.
      const entries = page.getByTestId("specialty-entry");
      await expect(entries).toHaveCount(FREQUENT.length);
      for (const entry of await entries.all()) {
        expect(await entry.evaluate((node) => node.tagName.toLowerCase())).toBe(
          "button",
        );
        await expect(entry).toHaveAccessibleName(/\S/);
      }
      const expand = page.getByTestId("specialty-expand");
      expect(await expand.evaluate((node) => node.tagName.toLowerCase())).toBe(
        "button",
      );
      await expect(expand).toHaveAccessibleName(/\S/);

      // A single forward Tab run, in DOM order: the action cluster, then the
      // field, then the first entry, then the expand control.
      const clusterLink = page
        .getByTestId("shell-action-cluster")
        .getByRole("link")
        .first();
      await expect(clusterLink).toHaveAccessibleName(/\S/);
      for (const target of [clusterLink, field, entries.first(), expand]) {
        await keyboardReach(page, target);
        await visibleFocus(target);
      }

      // And after a choice the keyboard reaches «сменить» the same way.
      await chooseCardiology(page);
      const change = page.getByTestId("specialty-change");
      await expect(change).toHaveAccessibleName(/\S/);
      await keyboardReach(page, change);
      await visibleFocus(change);
    });
  }
});
