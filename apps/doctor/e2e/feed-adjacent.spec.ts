import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * 018 EARS-8 (#1503) — «Смежные области», the last block of the specialty feed.
 *
 * Two runs of the same spec:
 *  - the events route tier (`playwright.events.config.ts`, CI): the upstream is
 *    the stand-in `e2e/support/doctor-events-api.mjs`, whose fixture specialty
 *    reaches the two catalog entries and every other specialty reaches none;
 *    `POST /__e2e/specialty-feed { adjacentFailing }` fails the block's read.
 *  - the real stand (`playwright.feed-live.config.ts`): a production build of
 *    the doctor app against the real api and Postgres, where the entries come
 *    from managed `direction_specialties` / `direction_adjacency` rows.
 *
 * ENV SET for the real stand (all of them, or the config refuses to run):
 * E2E_DOCTOR_URL — the production-build doctor origin, built with the real api.
 * E2E_FEED_ADJACENT_CODE — a specialty whose managed rows reach adjacent ones.
 * E2E_FEED_ADJACENT_EXPECT — JSON `[[code, name], …]`, the entries in order.
 * E2E_FEED_ADJACENT_EMPTY_CODE — a specialty with no adjacency row.
 * No request interception and no fixture writes happen in live mode; the
 * failed-read retry is driven on the route tier only.
 *
 * With `FEED_EVIDENCE_DIR` set, the four parity renders are captured there.
 */
const live = process.env.E2E_FEED_ADJACENT_REAL === "1";
const API = `http://127.0.0.1:${process.env.DOCTOR_EVENTS_FAKE_API_PORT ?? 3214}`;
const CODE = live
  ? process.env.E2E_FEED_ADJACENT_CODE!
  : "travmatologiya-i-ortopediya";
const EMPTY_CODE = live
  ? process.env.E2E_FEED_ADJACENT_EMPTY_CODE!
  : "kardiologiya";
const EXPECTED: [string, string][] = live
  ? JSON.parse(process.env.E2E_FEED_ADJACENT_EXPECT!)
  : [
      ["kardiologiya", "Кардиология"],
      ["nevrologiya", "Неврология"],
    ];
const FEED = `/feed/${encodeURIComponent(CODE)}`;
const EVIDENCE = process.env.FEED_EVIDENCE_DIR;

async function failAdjacent(request: APIRequestContext, failing: boolean) {
  await request.post(`${API}/__e2e/specialty-feed`, {
    data: { adjacentFailing: failing },
  });
}

async function openFeed(page: Page, path: string, theme: "light" | "dark") {
  await page.addInitScript((value: string) => {
    window.localStorage.setItem("ds-theme", value);
  }, theme);
  await page.goto(path);
  await page.getByTestId("specialty-feed-adjacent").waitFor();
  await expect(page.locator("html")).toHaveClass(
    theme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/,
  );
}

if (!live) {
  test.afterEach(async ({ request }) => {
    await failAdjacent(request, false);
  });
}

test("018 EARS-8: the adjacent areas are their own block, the last block of the feed", async ({
  page,
}) => {
  await openFeed(page, FEED, "light");
  const kinds = await page
    .locator("[data-feed-block-slot]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-feed-block-slot")),
    );
  expect(kinds.at(-1)).toBe("adjacent");
  expect(kinds.filter((kind) => kind === "adjacent")).toHaveLength(1);
  const block = page.getByTestId("specialty-feed-adjacent");
  await expect(block).toContainText("Не только ваша специальность");
  await expect(
    block.getByRole("heading", { level: 2, name: "Смежные области" }),
  ).toBeVisible();
});

test("018 EARS-8: the chips are the adjacent specialties of the managed rows, each linking into that specialty's feed", async ({
  page,
}) => {
  await openFeed(page, FEED, "light");
  const chips = page.getByTestId("specialty-feed-adjacent-item");
  await expect(chips).toHaveCount(EXPECTED.length);
  for (const [index, [code, name]] of EXPECTED.entries()) {
    await expect(chips.nth(index)).toHaveText(name);
    await expect(chips.nth(index)).toHaveAttribute(
      "href",
      `/feed/${encodeURIComponent(code)}`,
    );
  }
  // No lesson counter and no promise that adjacent content enters this feed.
  const text = await page.getByTestId("specialty-feed-adjacent").innerText();
  expect(text).not.toMatch(/урок/i);
  expect(text).not.toMatch(/попадают в эту же ленту/i);
});

test("018 EARS-8: following a chip opens that specialty's own feed", async ({
  page,
}) => {
  await openFeed(page, FEED, "light");
  const [code, name] = EXPECTED[0]!;
  await page.getByTestId("specialty-feed-adjacent-item").first().click();
  await expect(page).toHaveURL(new RegExp(`/feed/${encodeURIComponent(code)}$`));
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
});

test("018 EARS-8: a specialty with no adjacency row keeps the block in place and says so", async ({
  page,
}) => {
  await openFeed(page, `/feed/${encodeURIComponent(EMPTY_CODE)}`, "light");
  const block = page.getByTestId("specialty-feed-adjacent");
  await expect(block.getByTestId("specialty-feed-adjacent-empty")).toHaveText(
    "Для этой специальности смежные области пока не указаны.",
  );
  await expect(block.getByTestId("specialty-feed-adjacent-item")).toHaveCount(0);
});

test("018 EARS-8: no adjacent item appears inside the events or value blocks", async ({
  page,
}) => {
  await openFeed(page, FEED, "light");
  await expect(page.getByTestId("specialty-feed-adjacent-item")).toHaveCount(
    EXPECTED.length,
  );
  for (const kind of ["events", "value"]) {
    const block = page.locator(`[data-feed-block-slot="${kind}"]`);
    await expect(
      block.locator('[data-testid="specialty-feed-adjacent-item"]'),
    ).toHaveCount(0);
    for (const [code] of EXPECTED) {
      await expect(
        block.locator(`a[href="/feed/${encodeURIComponent(code)}"]`),
      ).toHaveCount(0);
    }
  }
});

test("018 EARS-8: a failed read is the block's own error, and «Повторить» re-runs only this block", async ({
  page,
  request,
}) => {
  test.skip(live, "the failed read is driven on the route tier's stand-in");
  await failAdjacent(request, true);
  await openFeed(page, FEED, "light");
  const block = page.getByTestId("specialty-feed-adjacent");
  await expect(block.getByTestId("specialty-feed-adjacent-error")).toContainText(
    "Не удалось загрузить смежные области",
  );
  // The siblings render as usual.
  await expect(page.getByTestId("specialty-feed-value")).toBeVisible();
  await expect(page.getByTestId("specialty-feed-events")).toBeVisible();

  await failAdjacent(request, false);
  const reads: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "GET" && req.resourceType() === "document")
      reads.push(req.url());
  });
  await block.getByRole("button", { name: "Повторить" }).click();
  await expect(block.getByTestId("specialty-feed-adjacent-item")).toHaveCount(
    EXPECTED.length,
  );
  // No navigation: the block was replaced in place.
  expect(reads).toEqual([]);
});

test("018 EARS-8: the feed is axe-clean with the adjacent block", async ({
  page,
}) => {
  for (const theme of ["light", "dark"] as const) {
    await openFeed(page, FEED, theme);
    const results = await new AxeBuilder({ page })
      .include('[data-testid="specialty-feed-adjacent"]')
      .analyze();
    expect(
      results.violations.map(
        (v) =>
          `${theme} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
      ),
    ).toEqual([]);
  }
});

for (const width of [1440, 390]) {
  for (const theme of ["light", "dark"] as const) {
    test(`018 EARS-8: the block renders without overflow · ${width} · ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openFeed(page, FEED, theme);
      const block = page.getByTestId("specialty-feed-adjacent");
      await expect(block.getByTestId("specialty-feed-adjacent-item")).toHaveCount(
        EXPECTED.length,
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      if (EVIDENCE) {
        await block.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `${EVIDENCE}/ev1503-feed-adjacent-${width}-${theme}.png`,
          fullPage: true,
        });
      }
    });
  }
}
