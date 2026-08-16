import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const SECTION_ORDER = [
  "what",
  "experts",
  "events",
  "why",
  "projects",
  "partner-value",
  "formats",
  "lead-demo",
] as const;

const EXPERT_PORTRAITS = [
  "eduard-ildarkhanov.webp",
  "maksim-strakhov.webp",
  "timofey-gaev.webp",
  "evgeniy-konstantinov.webp",
  "nikolay-zagorodniy.webp",
  "anatoliy-bondarev.webp",
] as const;

const PROJECTS = [
  {
    title: "Синергизм вместо конкуренции в фарме (возможен ли?)",
    href: "https://academy.doctor.school/webinars/event-70d250b9",
  },
  {
    title: "B2B — стейкхолдеры реальных решений",
    href: "https://rutube.ru/video/a682bead10b37ce96beef4f3a6d59b08/?r=wd",
  },
] as const;

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.describe("Feature 013 — static public Academy home", () => {
  test("EARS-1: when a visitor requests public /, portal shall render the exact static Academy home", async ({
    page,
  }) => {
    const dynamicRequests: string[] = [];
    page.on("request", (request) => {
      if (["fetch", "xhr"].includes(request.resourceType())) {
        dynamicRequests.push(request.url());
      }
    });

    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Создаем будущее медицинского образования вместе",
    );
    await expect
      .poll(() =>
        page
          .getByRole("main")
          .locator(":scope > [data-academy-section]")
          .evaluateAll((sections) =>
            sections.map((section) =>
              section.getAttribute("data-academy-section"),
            ),
          ),
      )
      .toEqual(SECTION_ORDER);
    await expect(page.locator("header")).toHaveCount(1);
    await expect(page.getByTestId("shell-logo")).toHaveCount(0);
    await expect(page.getByRole("contentinfo")).toBeVisible();
    expect(dynamicRequests).toEqual([]);
  });

  test("EARS-2: page shall render six supplied portraits and the approved repeated Project and Events rows", async ({
    page,
  }) => {
    await page.goto("/");

    const experts = page.locator('[data-academy-section="experts"]');
    const projectBlock = experts.getByTestId("academy-expert-project");
    const expertGrid = experts.getByTestId("academy-expert-grid");
    await expect
      .poll(() =>
        experts
          .locator(
            '[data-testid="academy-expert-project"], [data-testid="academy-expert-grid"]',
          )
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute("data-testid")),
          ),
      )
      .toEqual(["academy-expert-project", "academy-expert-grid"]);

    const portraits = expertGrid.locator("img");
    await expect(portraits).toHaveCount(6);
    for (const [index, filename] of EXPERT_PORTRAITS.entries()) {
      await expect(portraits.nth(index)).toHaveAttribute("src", new RegExp(filename));
    }

    const projectLinks = projectBlock
      .getByTestId("academy-project-list")
      .getByRole("link");
    const eventLinks = page
      .locator('[data-academy-section="events"]')
      .locator("[data-webinar-card]")
      .getByRole("link");
    await expect(projectLinks).toHaveCount(2);
    await expect(eventLinks).toHaveCount(2);
    for (const [index, project] of PROJECTS.entries()) {
      const projectLink = projectLinks.nth(index);
      await expect(projectLink).toContainText(project.title);
      await expect(projectLink).toHaveAttribute("href", project.href);
      await expect(projectLink).toHaveAttribute("target", "_blank");
      await expect(projectLink).toHaveAttribute("rel", "noopener noreferrer");

      const eventLink = eventLinks.nth(index);
      await expect(eventLink).toContainText(project.title);
      await expect(eventLink).toHaveAttribute("href", project.href);
    }
    await expect(
      page.getByRole("link", { name: "Политика конфиденциальности" }),
    ).toHaveAttribute("href", "https://doctor.school/index/privacy-pay");
    for (const inventedMetric of [
      "38 направлений",
      "12 клубов",
      "24 выпуска",
      "6 треков",
    ]) {
      await expect(page.getByText(inventedMetric, { exact: true })).toHaveCount(0);
    }
  });

  test("EARS-3: while the form follow-up is absent, partnership preview shall remain disabled and send no request", async ({
    page,
  }) => {
    const mutationRequests: string[] = [];
    page.on("request", (request) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        mutationRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    await page.goto("/#partner-form");
    const storageBefore = await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }));
    const section = page.locator("#partner-form");
    await expect(section.locator("form")).toHaveCount(0);
    const fieldset = section.locator("fieldset");
    await expect(fieldset).toHaveAttribute("disabled", "");
    await expect(fieldset).toContainText("Демо: данные не отправляются");
    await expect(fieldset.getByLabel("Имя")).toBeDisabled();
    const button = fieldset.getByRole("button", {
      name: "Обсудить партнёрство",
    });
    await expect(button).toHaveAttribute("type", "button");
    await expect(button).toBeDisabled();

    await button.dispatchEvent("click");
    await fieldset.getByLabel("Имя").dispatchEvent("input");
    await page.waitForTimeout(100);

    expect(mutationRequests).toEqual([]);
    expect(
      await page.evaluate(() => ({
        local: { ...localStorage },
        session: { ...sessionStorage },
      })),
    ).toEqual(storageBefore);
  });

  test("EARS-4: static page shall remain readable at desktop and mobile in light and dark themes and pass axe", async ({
    page,
  }) => {
    const presentations = [
      { name: "desktop-light", width: 1440, height: 900, theme: "light" },
      { name: "desktop-dark", width: 1440, height: 900, theme: "dark" },
      { name: "mobile-light", width: 390, height: 844, theme: "light" },
      { name: "mobile-dark", width: 390, height: 844, theme: "dark" },
    ] as const;

    for (const presentation of presentations) {
      await test.step(presentation.name, async () => {
        await page.setViewportSize({
          width: presentation.width,
          height: presentation.height,
        });
        await page.emulateMedia({ colorScheme: presentation.theme });
        await page.goto("/");
        await page.evaluate((theme) => {
          document.documentElement.classList.toggle("dark", theme === "dark");
        }, presentation.theme);

        await expect(page.getByRole("main")).toBeVisible();
        await expect(page.getByRole("contentinfo")).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);

        const results = await new AxeBuilder({ page })
          .withTags(WCAG_TAGS)
          .exclude('[data-testid="academy-footer-wordmark"]')
          .analyze();
        const seriousViolations = results.violations
          .filter(
            (violation) =>
              violation.impact === "serious" || violation.impact === "critical",
          )
          .map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            nodes: violation.nodes.flatMap((node) => node.target),
          }));
        expect(
          seriousViolations,
          `axe serious/critical violations on ${presentation.name}`,
        ).toEqual([]);
      });
    }
  });

  test("parallel chrome keeps the existing app-shell header on non-root routes", async ({
    page,
  }) => {
    await page.route("**/v1/auth/session", (route) =>
      route.fulfill({ status: 401, body: "" }),
    );
    await page.route("**/v1/me/profile", (route) => route.abort());

    await page.goto("/account");

    await expect(page.getByTestId("shell-logo")).toBeVisible();
    await expect(page.locator("header")).toHaveCount(1);
  });
});
