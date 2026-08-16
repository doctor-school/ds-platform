import { expect, test, type Locator, type Page } from "@playwright/test";

const ROUTE = "/demos/academy-home";

async function styleSignature(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return [
      style.backgroundColor,
      style.boxShadow,
      style.transform,
      style.outlineColor,
      style.outlineStyle,
      style.outlineWidth,
    ].join("|");
  });
}

async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press("Tab");
    if (
      await target.evaluate((element) => element === document.activeElement)
    ) {
      return;
    }
  }
  throw new Error(
    "Academy-home CTA was not reachable in the first 20 tab stops",
  );
}

test.describe("#1302 static Academy-home demo", () => {
  test("renders the approved variant V composition in deterministic order without data requests", async ({
    page,
  }) => {
    const dataRequests: string[] = [];
    page.on("request", (request) => {
      if (["fetch", "xhr"].includes(request.resourceType())) {
        dataRequests.push(request.url());
      }
    });

    const response = await page.goto(ROUTE);
    expect(response?.status(), "the dedicated demo route must exist").toBe(200);

    const main = page.getByRole("main");
    await expect(main).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Учитесь у практиков — бесплатно",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Постройте репутацию в экспертной среде",
      }),
    ).toBeVisible();

    await expect
      .poll(() =>
        main
          .locator(":scope > [data-academy-section]")
          .evaluateAll((sections) =>
            sections.map((section) =>
              section.getAttribute("data-academy-section"),
            ),
          ),
      )
      .toEqual([
        "events",
        "what",
        "why",
        "projects",
        "experts",
        "partner-value",
        "formats",
        "lead-demo",
      ]);

    await expect(page.locator("[data-webinar-card]")).toHaveCount(3);
    await expect(
      page.getByRole("heading", {
        name: "Пластика ахиллова сухожилия: разбор клинических случаев",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "СИБР и СРК: что нового в 2026 году" }),
    ).toBeVisible();
    const pastWebinar = page.locator('[data-webinar-state="past"]');
    await expect(pastWebinar).toContainText(
      "ХСН с сохранной фракцией выброса: амбулаторное ведение",
    );
    expect(
      Number(
        await pastWebinar.evaluate((node) => getComputedStyle(node).opacity),
      ),
    ).toBeLessThan(1);

    await expect(page.getByTestId("academy-expert-card")).toHaveCount(4);
    await expect(
      page.getByRole("heading", { name: "Эксперты, которые ведут за собой" }),
    ).toBeVisible();
    await expect(
      page.getByText("Кто стоит за брендом", { exact: true }),
    ).toBeVisible();

    expect(dataRequests).toEqual([]);
  });

  test("uses desktop anchors, an honest disabled mobile menu, and the global theme toggle", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(ROUTE);

    const desktopNav = page.getByRole("navigation", {
      name: "Основная навигация",
    });
    await expect(desktopNav).toBeVisible();
    await expect(
      desktopNav.getByRole("link", { name: "Эфиры" }),
    ).toHaveAttribute("href", "#events");
    await expect(
      page.getByRole("button", { name: "Меню пока недоступно в демо" }),
    ).toBeHidden();

    const themeToggle = page.getByRole("button", {
      name: /Switch to (dark|light) theme/,
    });
    await expect(themeToggle).toBeVisible();

    const footer = page.getByRole("contentinfo");
    const colorLogo = footer.locator('img[src="/brand/logo.svg"]');
    const whiteLogo = footer.locator('img[src="/brand/logo-white.svg"]');
    await footer.scrollIntoViewIfNeeded();
    await expect(colorLogo).toBeVisible();
    await expect(whiteLogo).toBeHidden();

    await themeToggle.click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(colorLogo).toBeHidden();
    await expect(whiteLogo).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(desktopNav).toBeHidden();
    const mobileMenu = page.getByRole("button", {
      name: "Меню пока недоступно в демо",
    });
    await expect(mobileMenu).toBeVisible();
    await expect(mobileMenu).toBeDisabled();
  });

  test("keeps the lead area visibly demo-only and impossible to submit", async ({
    page,
  }) => {
    await page.goto(`${ROUTE}#partner-form`);

    await expect(page.locator("#partner-form form")).toHaveCount(0);
    const fieldset = page.locator("#partner-form fieldset");
    await expect(fieldset).toHaveAttribute("disabled", "");
    await expect(fieldset).toContainText("Демо: данные не отправляются");
    await expect(fieldset.getByLabel("Имя")).toBeDisabled();
    await expect(fieldset.getByLabel("Роль")).toHaveValue("Выберите роль");
    await expect(
      fieldset.getByRole("button", { name: "Обсудить партнёрство" }),
    ).toBeDisabled();
    await expect(
      page.getByText("Заявка отправлена", { exact: true }),
    ).toHaveCount(0);
  });

  test("primary CTA exposes hover, keyboard-focus, and active deltas", async ({
    page,
  }) => {
    await page.goto(ROUTE);
    const cta = page.getByRole("link", { name: "Смотреть эфиры →" }).first();
    await expect(cta).toBeVisible();

    await page.mouse.move(0, 0);
    const rest = await styleSignature(cta);
    await cta.hover();
    await expect.poll(() => styleSignature(cta)).not.toBe(rest);
    const hovered = await styleSignature(cta);

    const box = await cta.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    const active = await styleSignature(cta);
    await page.mouse.up();
    expect(active).not.toBe(hovered);

    await page.reload();
    await page.mouse.move(0, 0);
    const unfocused = await styleSignature(cta);
    await page.getByRole("link", { name: "Doctor.School — наверх" }).focus();
    await tabTo(page, cta);
    await expect(cta).toBeFocused();
    expect(await styleSignature(cta)).not.toBe(unfocused);
  });
});
