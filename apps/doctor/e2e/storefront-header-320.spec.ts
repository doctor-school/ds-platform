import { test, expect, type Page } from "@playwright/test";

/**
 * 008 EARS-11 · 017 EARS-1 — the shared storefront header (`@ds/storefront-shell`)
 * keeps the whole document inside a 320 px phone (#3629).
 *
 * The header is defined ONCE for both storefronts (ADR-0013 A1); the Academy
 * twin of this whole-page check is `apps/portal/e2e/education-index-demo.spec.ts`
 * (390/360/320). The overflow showed only on the ubuntu runner, whose Linux
 * Chromium draws «Войти / Регистрация» a few px wider than Windows — so CI is
 * the real proof here, and the box metrics are printed to the test log for the
 * PR record.
 */

type Box = { left: number; right: number; top: number; width: number };

async function headerMetrics(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null): Box | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, width: r.width };
    };
    const header = document.querySelector('[data-testid="storefront-header"]');
    const cluster = document.querySelector('[data-testid="shell-auth-cluster"]');
    const chip = cluster?.querySelector("a") ?? null;
    // The signed-in doctor-storefront chip is the same `chip` button carrying
    // «Личный кабинет»; this CI double has no session, so the log records both
    // labels' text advance in the chip's own computed font for the PR record.
    const ctx = document.createElement("canvas").getContext("2d");
    const font = chip ? getComputedStyle(chip).font : "";
    if (ctx) ctx.font = font;
    const advance = (s: string) => (ctx ? ctx.measureText(s).width : -1);
    return {
      font,
      guestText: advance("Войти / Регистрация"),
      signedInText: advance("Личный кабинет"),
      innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      header: box(header),
      logo: box(document.querySelector('[data-testid="storefront-logo"]')),
      right: box(cluster?.parentElement ?? null),
      toggle: box(document.querySelector('[data-testid="theme-toggle"]')),
      chip: box(chip),
      chipText: (chip?.textContent ?? "").trim(),
      menu: box(
        document.querySelector('[data-testid="shell-mobile-menu"] summary'),
      ),
    };
  });
}

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

test.describe("#3629 storefront header · 320 phone (doctor storefront)", () => {
  test.use({ viewport: { width: 320, height: 800 } });

  test("008 EARS-11: at 320 the guest header keeps the page from scrolling sideways, every control kept", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/", { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);

    const metrics = await headerMetrics(page);
    console.log(`#3629 metrics 320 guest: ${JSON.stringify(metrics)}`);

    // Every control of the right cluster stays, label and order intact.
    await expect(page.getByTestId("theme-toggle")).toBeVisible();
    await expect(page.getByTestId("shell-login")).toHaveText(
      "Войти / Регистрация",
    );
    await expect(page.getByTestId("shell-mobile-menu")).toBeVisible();

    expect(
      metrics.scrollWidth,
      `elements past the 320 edge:\n${(await pastTheEdge(page)).join("\n")}`,
    ).toBeLessThanOrEqual(metrics.innerWidth);
  });

  test("008 EARS-11: at 320 the ≡ menu opens inside the viewport", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/", { waitUntil: "networkidle" });
    const menu = page.getByTestId("shell-mobile-menu");
    await menu.locator("summary").click();
    const nav = page.getByTestId("shell-nav-mobile");
    await expect(nav).toBeVisible();
    const box = await nav.boundingBox();
    expect(box, "the ≡ menu has a box").not.toBeNull();
    expect(box!.x, "≡ menu left edge").toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, "≡ menu right edge").toBeLessThanOrEqual(320);
  });
});
