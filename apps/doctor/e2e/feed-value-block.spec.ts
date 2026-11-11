import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * 018 EARS-7 (#1502) — «Зачем это мне» on the specialty feed, backend-free: the
 * envelope comes from the events tier's stand-in
 * (`e2e/support/doctor-events-api.mjs`), which carries the same editorial
 * copy the api serves; the api side is
 * `apps/api/test/storefront/specialty-feed.e2e-spec.ts`.
 *
 * LD-9: the page names nobody who finances the learning — checked on the whole
 * visible text of the feed page at both breakpoints in both themes. The doctor
 * theme is class-based and read from `localStorage["ds-theme"]` before paint,
 * so the theme is set by init script, not by `colorScheme`.
 */
const FEED = "/feed/travmatologiya-i-ortopediya";

const ITEMS = [
  ["Новая специальность", "Школа ведёт в новый трек — например, ортобиологию."],
  [
    "Международная стажировка",
    "Лучшие участники школ едут на клинические базы.",
  ],
  ["Наставничество у эксперта", "Разбор ваших случаев с автором школы."],
  ["Документ по итогам курса", "Сертификат — за полное прохождение курса."],
] as const;

/** LD-9 / R:113 — wording that names or implies a financier of the learning. */
const PARTNER_WORDING = /партн[её]р/i;
const PAYER_WORDING = [
  /оплачива/i,
  PARTNER_WORDING,
  /за сч[её]т/i,
  /инвестор/i,
  /спонсор/i,
  /трудоустройств/i,
];

async function openFeed(page: Page, theme: "light" | "dark") {
  await page.addInitScript((value: string) => {
    window.localStorage.setItem("ds-theme", value);
  }, theme);
  await page.goto(FEED);
  await page.getByTestId("specialty-feed-value").waitFor();
  await expect(page.locator("html")).toHaveClass(
    theme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/,
  );
}

test("EARS-7: the value block renders its four items and ends on them", async ({
  page,
}) => {
  await openFeed(page, "light");
  const block = page.getByTestId("specialty-feed-value");
  await expect(
    block.getByRole("heading", { level: 2, name: "Зачем это мне" }),
  ).toBeVisible();
  await expect(block).toContainText("Ценность");

  const items = block.getByTestId("specialty-feed-value-item");
  await expect(items).toHaveCount(4);
  for (const [index, [title, body]] of ITEMS.entries()) {
    await expect(
      items.nth(index).getByRole("heading", { level: 3, name: title }),
    ).toBeVisible();
    await expect(items.nth(index)).toContainText(body);
  }

  // The block ends on the item list: no closing strip is built (LD-9).
  const text = (await block.innerText()).trim();
  expect(text.endsWith(ITEMS[3]![1])).toBe(true);
});

test("EARS-7: the value block sits right after the events block", async ({
  page,
}) => {
  await openFeed(page, "light");
  const slots = page.locator("[data-feed-block-slot]");
  const kinds = await slots.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-feed-block-slot")),
  );
  expect(kinds.indexOf("value")).toBe(kinds.indexOf("events") + 1);
});

for (const width of [1440, 390]) {
  for (const theme of ["light", "dark"] as const) {
    test(`EARS-7: no visible text of the feed page names who finances the learning · ${width} · ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openFeed(page, theme);
      await expect(page.getByTestId("specialty-feed-value-item")).toHaveCount(
        4,
      );
      // The feature's own text (poster band + every block): no payer wording.
      const feed = await page.getByTestId("specialty-feed").innerText();
      for (const banned of PAYER_WORDING) {
        expect(feed, String(banned)).not.toMatch(banned);
      }
      // The whole page, 017's shell included: its footer names partners as an
      // audience («Экспертам и партнёрам»), which is not a financing statement,
      // so the page-wide pass checks every payer stem except that word.
      const page_ = await page.locator("body").innerText();
      for (const banned of PAYER_WORDING.filter((w) => w !== PARTNER_WORDING)) {
        expect(page_, String(banned)).not.toMatch(banned);
      }
      expect(page_).not.toMatch(/оплачивают партн[её]ры платформы/i);
    });
  }
}

test("EARS-7: the feed route is axe-clean with the value block", async ({
  page,
}) => {
  await openFeed(page, "light");
  // Scoped to the feed, as the events block's axe check is: the shell's own
  // chrome carries its own axe coverage (`e2e/a11y-axe.e2e.spec.ts`).
  for (const theme of ["light", "dark"] as const) {
    if (theme === "dark") await openFeed(page, "dark");
    const results = await new AxeBuilder({ page })
      .include('[data-testid="specialty-feed"]')
      .analyze();
    expect(
      results.violations.map(
        (v) =>
          `${theme} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
      ),
    ).toEqual([]);
  }
});
