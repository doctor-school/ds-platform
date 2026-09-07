import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * 019 EARS-13 (#1528): existing R1 feed, cards, live strip and desktop month.
 * Deferred filter mounting / calendar page / past / mine are owned by R1.1.
 *
 * ENV SET for playwright.events-live.config.ts (real API + branch DB):
 * E2E_DOCTOR_URL — production-build doctor origin, built with the real API.
 * E2E_EVENTS_LOADED_PATH — /events query serving cards AND a further horizon.
 * E2E_EVENTS_EMPTY_PATH — /events query serving no cards.
 * E2E_EVENTS_EXPECT_LIVE — present | absent. Run BOTH real lifecycle phases.
 * No request interception or fixture writes occur in live mode. The lead seeds
 * and changes the real event lifecycle between runs; the default route tier
 * instead uses its existing upstream double, never as real-stack evidence.
 */
const live = process.env.E2E_EVENTS_REAL_STAND === "1";
const api = `http://127.0.0.1:${process.env.DOCTOR_EVENTS_FAKE_API_PORT ?? 3214}`;
const loadedPath = process.env.E2E_EVENTS_LOADED_PATH ?? "/events";
const emptyPath =
  process.env.E2E_EVENTS_EMPTY_PATH ?? "/events?from=2026-10-01&to=2026-10-15";
const phases = live
  ? [process.env.E2E_EVENTS_EXPECT_LIVE!]
  : ["absent", "present"];

async function keyboardReach(page: Page, target: Locator) {
  for (let index = 0; index < 100; index++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((node) => node === document.activeElement))
      return;
  }
  await expect(target, "control must be reachable with Tab").toBeFocused();
}

async function visibleFocus(target: Locator, pseudo?: string) {
  await expect(target).toBeFocused();
  expect(await target.evaluate((node) => node.matches(":focus-visible"))).toBe(
    true,
  );
  expect(
    await target.evaluate((node, pseudoElement) => {
      const style = getComputedStyle(node, pseudoElement);
      return (
        style.boxShadow !== "none" ||
        (style.outlineStyle !== "none" &&
          Number.parseFloat(style.outlineWidth) > 0)
      );
    }, pseudo),
    "keyboard focus must have a rendered indicator",
  ).toBe(true);
}

async function presentation(page: Page, theme: "light" | "dark", path: string) {
  await page.goto(path);
  const toggle = page.getByTestId("theme-toggle");
  await expect(toggle).toBeVisible();
  if (
    (await toggle.getAttribute("aria-pressed")) !== String(theme === "dark")
  ) {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute(
    "aria-pressed",
    String(theme === "dark"),
  );
  await expect(page.locator("[data-events-feed]")).toBeVisible();
}

async function accessiblePage(page: Page) {
  await expect(
    page.getByRole("heading", { level: 1, name: "События", exact: true }),
  ).toHaveCount(1);
  expect(
    await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    })),
  ).toEqual(expect.objectContaining({ width: page.viewportSize()!.width }));
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
    "page must not overflow horizontally",
  ).toBeLessThanOrEqual(1);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.map(({ target, failureSummary }) => ({
        target,
        failureSummary,
      })),
    })),
    "full-page axe, including contrast",
  ).toEqual([]);
}

for (const width of [390, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`${width} ${theme}`, () => {
      test.use({ viewport: { width, height: 900 } });
      for (const phase of phases) {
        for (const state of ["loaded", "empty"] as const) {
          test(`EARS-13: ${state} feed with live ${phase} is operable and accessible`, async ({
            page,
            request,
          }, testInfo) => {
            if (!live) {
              const response = await request.post(`${api}/__e2e/live`, {
                data: {
                  scenario: phase === "present" ? "unregistered" : "none",
                },
              });
              expect(response.ok()).toBe(true);
            }
            await presentation(
              page,
              theme,
              state === "loaded" ? loadedPath : emptyPath,
            );
            const cards = page.locator("[data-webinar-card]");
            if (state === "loaded") {
              expect(await cards.count()).toBeGreaterThan(0);
              for (const card of await cards.all()) {
                const title = card
                  .getByRole("heading", { level: 3 })
                  .getByRole("link");
                await expect(title).toHaveAttribute(
                  "href",
                  /^\/events\/[^/?#]+$/,
                );
                await expect(title).toHaveAccessibleName(/\S/);
                await expect(title).toBeVisible();
              }
            } else {
              await expect(cards).toHaveCount(0);
              await expect(
                page.getByText("На выбранном отрезке событий нет", {
                  exact: true,
                }),
              ).toBeVisible();
            }
            const block = page.getByTestId("events-live-block");
            if (phase === "present") {
              await expect(block).toBeVisible();
              await expect(block.getByRole("status")).toHaveText("Идёт сейчас");
              const action = block.getByTestId("live-event-strip-action");
              await expect(action).toHaveAccessibleName(
                "Открыть страницу события",
              );
              await expect(action).toHaveAttribute(
                "href",
                /^\/events\/[^/?#]+$/,
              );
            } else {
              await expect(block).toHaveCount(0);
            }
            await accessiblePage(page);
            await testInfo.attach("presentation", {
              body: await page.screenshot({ fullPage: true }),
              contentType: "image/png",
            });
            if (state === "loaded") {
              // A real keyboard path, including the stretched title's own focus ring.
              await page.reload();
              const title = cards
                .first()
                .getByRole("heading", { level: 3 })
                .getByRole("link");
              await keyboardReach(page, title);
              await visibleFocus(title, "::after");
              const more = page.getByTestId("events-feed-show-more");
              await expect(more).toBeVisible();
              const before = await cards.count();
              const href = await more.getAttribute("href");
              await keyboardReach(page, more);
              await visibleFocus(more);
              await page.keyboard.press("Enter");
              await expect(page).toHaveURL(new URL(href!, page.url()).href);
              await expect.poll(() => cards.count()).toBeGreaterThan(before);
            }
          });
        }
      }
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`EARS-13: desktop month day and month navigation work with keyboard (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await presentation(page, theme, loadedPath);
    const calendar = page.locator("[data-events-month]");
    const day = calendar.locator("button:enabled").first();
    const month = await calendar.getAttribute("data-month");
    const number = (await day.textContent())!.trim();
    await page.reload();
    await keyboardReach(page, day);
    await visibleFocus(day);
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(
      new RegExp(`day=${month}-${number.padStart(2, "0")}`),
    );
    await expect(day).toHaveAttribute("aria-pressed", "true");
    for (const control of ["events-month-next", "events-month-prev"]) {
      await page.reload();
      const link = page.getByTestId(control);
      const href = await link.getAttribute("href");
      await keyboardReach(page, link);
      await visibleFocus(link);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new URL(href!, page.url()).href);
      await expect(calendar).toHaveAttribute(
        "data-month",
        new URL(page.url()).searchParams.get("month")!,
      );
    }
  });
}
