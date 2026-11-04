import { test, expect, type Page } from "@playwright/test";

/**
 * 008 EARS-11 · 017 EARS-1 / EARS-14 — the shared storefront header
 * (`@ds/storefront-shell`) in the canvas mobile composition on small phones
 * (#3629).
 *
 * Canvas `design-source/ds-shell.dc.html` lines 41-58: below `layout` the bar is
 * ONE row — wordmark · ☾ · ≡ — and the auth primary («Войти / Регистрация») is
 * the LAST item INSIDE the `≡` menu (line 53), not a chip in the bar. Carrying
 * the chip in the bar is what pushed a 320 phone sideways on the ubuntu runner,
 * whose Linux Chromium draws the label a few px wider than Windows — so CI is
 * the real proof here.
 *
 * The header is defined ONCE for both storefronts (ADR-0013 A1); the Academy
 * twin of the whole-page check is `apps/portal/e2e/education-index-demo.spec.ts`
 * (390/360/320).
 */

/** Every box of the document that ends past the viewport's right edge. */
async function pastTheEdge(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.right > innerWidth + 0.5)
      .map(({ element, box }) => {
        const label =
          element.getAttribute("data-testid") ??
          (element.textContent ?? "").trim().slice(0, 40);
        return `${element.tagName.toLowerCase()} «${label}» right=${box.right.toFixed(1)}`;
      }),
  );
}

/** The vertical centre of a control, for the one-row check. */
async function middle(page: Page, testId: string, inner?: string) {
  const locator = inner
    ? page.getByTestId(testId).locator(inner)
    : page.getByTestId(testId);
  const box = await locator.boundingBox();
  expect(box, `${testId} has a box`).not.toBeNull();
  return box!.y + box!.height / 2;
}

for (const width of [320, 390]) {
  test.describe(`#3629 storefront header · ${width} phone (doctor storefront)`, () => {
    test.use({ viewport: { width, height: 800 } });

    test(`017 EARS-14: at ${width} the guest bar is one row — wordmark · ☾ · ≡ — and the page never scrolls sideways`, async ({
      page,
      context,
    }) => {
      await context.clearCookies();
      await page.goto("/", { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);

      // The three bar controls share one row (canvas line 42).
      const logo = await middle(page, "storefront-logo");
      for (const [id, inner] of [
        ["theme-toggle", undefined],
        ["shell-mobile-menu", "summary"],
      ] as const) {
        expect(
          Math.abs((await middle(page, id, inner)) - logo),
          `${id} sits on the wordmark's row`,
        ).toBeLessThanOrEqual(1);
      }
      // The primary is not in the bar: it waits inside the closed `≡` menu.
      await expect(page.getByTestId("shell-login")).toBeHidden();
      await expect(page.getByTestId("shell-auth-cluster")).toHaveCount(1);

      const scroll = await page.evaluate(() => ({
        innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(
        scroll.scrollWidth,
        `elements past the ${width} edge:\n${(await pastTheEdge(page)).join("\n")}`,
      ).toBeLessThanOrEqual(scroll.innerWidth);
    });

    test(`017 EARS-14: at ${width} the ≡ menu opens inside the viewport with the primary as its last item`, async ({
      page,
      context,
    }) => {
      await context.clearCookies();
      await page.goto("/", { waitUntil: "networkidle" });
      await page.getByTestId("shell-mobile-menu").locator("summary").click();

      const panel = page.getByTestId("shell-mobile-panel");
      await expect(panel).toBeVisible();
      const box = (await panel.boundingBox())!;
      expect(box.x, "≡ menu left edge").toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, "≡ menu right edge").toBeLessThanOrEqual(width);

      // The nav rows first, the primary last (canvas lines 47-53).
      const rows = (await page.getByTestId("shell-nav-mobile").boundingBox())!;
      const login = page.getByTestId("shell-login");
      await expect(login).toBeVisible();
      await expect(login).toHaveText("Войти / Регистрация");
      const chip = (await login.boundingBox())!;
      expect(chip.y).toBeGreaterThanOrEqual(rows.y + rows.height);
      expect(chip.x + chip.width).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        "the open menu keeps the page inside the phone",
      ).toBeLessThanOrEqual(width);
    });
  });
}

test("017 EARS-1: a ≡ menu left open on a phone dissolves into the desktop bar at layout (#3629)", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByTestId("shell-mobile-menu").locator("summary").click();
  await expect(page.getByTestId("shell-login")).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  // The one cluster is back in the bar: the chip sits on the theme control's
  // row, after it, and the dropdown's rows are gone.
  await expect(page.getByTestId("shell-nav-mobile")).toBeHidden();
  const toggle = (await page.getByTestId("theme-toggle").boundingBox())!;
  const chip = (await page.getByTestId("shell-login").boundingBox())!;
  expect(
    Math.abs(chip.y + chip.height / 2 - (toggle.y + toggle.height / 2)),
  ).toBeLessThanOrEqual(1);
  expect(chip.x).toBeGreaterThan(toggle.x + toggle.width);
});
