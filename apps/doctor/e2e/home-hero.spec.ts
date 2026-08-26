import { test, expect, type Page } from "@playwright/test";

/**
 * 017 EARS-2 — the home hero and the four scale counters, in a real browser.
 *
 * This tier proves what only a rendered page can: that the hero copy is server
 * markup independent of the statistics read, that ONE request feeds all four
 * counters, and that each of the four `dataState` renders of 017-design §6 row 1
 * is reachable — including the two that a server-rendered fetch could never
 * show, the skeleton and an error that leaves the hero standing.
 *
 * The read is mocked at the network boundary (`page.route`) rather than seeded
 * in a database: the CI Playwright config for this app is backend-free by design
 * (`playwright.ci.config.ts`), and the api side of the contract is covered one
 * tier down by `apps/api/test/storefront/statistics.e2e-spec.ts`. What is under
 * test here is the storefront's rendering of the contract, not the contract.
 */
const STATISTICS = "**/v1/public/statistics";

const COMPUTED_AT = "2026-08-26T09:00:00.000Z";

/** Everything 017 forbids on any of its surfaces (EARS-2). */
const COMMERCIAL =
  /₽|руб\.|рублей|корзин|подписк|оплат|тариф|прайс|спонсор|финансир|за счёт/i;

async function serveStatistics(
  page: Page,
  body: Record<string, unknown>,
  counter?: { calls: number },
) {
  await page.route(STATISTICS, async (route) => {
    if (counter) counter.calls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

test.describe("017 EARS-2: home hero and the four scale counters", () => {
  test("017 EARS-2.1: the hero renders the canvas copy and the goal VERBATIM, with no marker", async ({
    page,
  }) => {
    await serveStatistics(page, {
      doctors: 12400,
      specialties: 118,
      lessons: 340,
      eventsPerYear: 86,
      computedAt: COMPUTED_AT,
    });
    await page.goto("/");

    const hero = page.getByTestId("storefront-hero");
    await expect(hero).toBeVisible();
    await expect(hero.getByText("Медицинская образовательная платформа")).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Doctor.School — бесплатное образование для врачей",
      }),
    ).toBeVisible();
    await expect(hero.getByText("Обучение бесплатно.")).toBeVisible();

    const goal = page.getByTestId("hero-goal");
    await expect(goal).toHaveText(
      "Создаём бесплатное децентрализованное медицинское образование",
    );
    // No gloss and no «готовится» marker anywhere beside it.
    await expect(page.locator("body")).not.toContainText(/готовится|скоро/i);
  });

  test("017 EARS-2.2: обычно — four counters render from ONE computed read exposing computedAt", async ({
    page,
  }) => {
    const counter = { calls: 0 };
    await serveStatistics(
      page,
      {
        doctors: 12400,
        specialties: 118,
        lessons: 340,
        eventsPerYear: 86,
        computedAt: COMPUTED_AT,
      },
      counter,
    );
    await page.goto("/");

    const counters = page.getByTestId("hero-counters");
    await expect(counters).toHaveAttribute("data-state", "ready");
    await expect(counters).toHaveAttribute("data-computed-at", COMPUTED_AT);
    for (const key of ["doctors", "specialties", "lessons", "eventsPerYear"]) {
      await expect(page.getByTestId(`hero-counter-${key}`)).toBeVisible();
    }
    await expect(page.getByTestId("hero-counter-doctors")).toContainText(
      /12\s400/,
    );
    await expect(page.getByTestId("hero-counter-doctors")).toContainText(
      "врачей уже с нами",
    );
    // ONE read behind all four counters (LD-3), never one request per counter.
    expect(counter.calls).toBe(1);
  });

  test("017 EARS-2.3: пусто — a counter with no source is OMITTED and its neighbours render", async ({
    page,
  }) => {
    // The live shape today: `lessons` has no source on the platform, so the key
    // is absent from every real response.
    await serveStatistics(page, {
      doctors: 12400,
      specialties: 118,
      eventsPerYear: 86,
      computedAt: COMPUTED_AT,
    });
    await page.goto("/");

    await expect(page.getByTestId("hero-counters")).toHaveAttribute(
      "data-state",
      "ready",
    );
    await expect(page.getByTestId("hero-counter-lessons")).toHaveCount(0);
    await expect(page.getByTestId("hero-counters")).not.toContainText("уроков");
    await expect(page.getByTestId("hero-counter-doctors")).toBeVisible();
    await expect(page.getByTestId("hero-counter-eventsPerYear")).toBeVisible();
  });

  test("017 EARS-2.7: the band paints NO empty tile when a counter is omitted, at either breakpoint", async ({
    page,
  }) => {
    // The production shape: three counters, because `lessons` has no source.
    await serveStatistics(page, {
      doctors: 12400,
      specialties: 118,
      eventsPerYear: 86,
      computedAt: COMPUTED_AT,
    });

    for (const size of [
      { width: 1280, height: 900 },
      { width: 720, height: 900 },
    ]) {
      await page.setViewportSize(size);
      await page.goto("/");

      const band = page.getByTestId("hero-counters");
      const cells = band.locator("[data-testid^='hero-counter-']");
      await expect(cells).toHaveCount(3);

      // The cells must COVER the band: any uncovered strip is the container's
      // hairline background showing through as a pale empty tile on the navy
      // hero — exactly what a fixed 4-track grid produces with 3 counters.
      const bandBox = (await band.boundingBox())!;
      const boxes = await cells.evaluateAll((nodes) =>
        nodes.map((n) => n.getBoundingClientRect()),
      );
      const covered = boxes.reduce((sum, b) => sum + b.width * b.height, 0);
      const bandArea = bandBox.width * bandBox.height;
      // Seams (2px gaps) and the 2px border are the only uncovered pixels.
      expect(
        covered / bandArea,
        `cells cover the band at ${size.width}px`,
      ).toBeGreaterThan(0.95);
    }
  });

  test("017 EARS-2.4: ошибка — the counters are omitted and the hero copy stays intact", async ({
    page,
  }) => {
    await page.route(STATISTICS, (route) => route.abort("failed"));
    await page.goto("/");

    await expect(page.getByTestId("hero-counters")).toHaveCount(0);
    // The hero itself never depended on the read.
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Doctor.School — бесплатное образование для врачей",
      }),
    ).toBeVisible();
    await expect(page.getByTestId("hero-goal")).toBeVisible();
    // Nothing explains the failure to the doctor and nothing shows a zero.
    await expect(page.getByTestId("storefront-hero")).not.toContainText(
      /ошибк|не удалось|0/i,
    );
  });

  test("017 EARS-2.5: загрузка — a skeleton stands in, with no label and no number, and it resolves", async ({
    page,
  }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(STATISTICS, async (route) => {
      await held;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ doctors: 12400, computedAt: COMPUTED_AT }),
      });
    });
    await page.goto("/");

    const counters = page.getByTestId("hero-counters");
    await expect(counters).toHaveAttribute("data-state", "loading");
    await expect(counters).not.toContainText("врачей уже с нами");
    await expect(counters).not.toContainText("0");

    // Not an unresolving spinner: the skeleton is replaced by the real render.
    release();
    await expect(counters).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("hero-counter-doctors")).toBeVisible();
  });

  test("017 EARS-2.6: no price, cart, subscription, payment or financing statement on the page", async ({
    page,
  }) => {
    await serveStatistics(page, {
      doctors: 12400,
      specialties: 118,
      eventsPerYear: 86,
      computedAt: COMPUTED_AT,
    });
    await page.goto("/");

    await expect(page.locator("body")).not.toContainText(COMMERCIAL);
    // …and no payment affordance hiding behind a control label.
    await expect(
      page.getByRole("button", { name: /купить|оплатить|подписаться|корзина/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: /купить|оплатить|подписаться|корзина/i }),
    ).toHaveCount(0);
  });
});
