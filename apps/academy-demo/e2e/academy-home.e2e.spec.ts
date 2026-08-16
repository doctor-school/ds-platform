import { expect, test, type Locator, type Page } from "@playwright/test";

const ROUTE = "/";

const HERO_HEADING = "Создаем будущее медицинского образования вместе";
const HERO_BODY =
  "Академия Doctor School объединяет экспертов, индустрию и образовательные инициативы для совместного создания новых специальностей, школ и стандартов медицины.";
const PLATFORM_COPY = [
  "Академия представляет собой масштабную идеологию, в центре которой — врач и пациент. Участие в проектах Академии — это возможность для корпораций реализовать важнейшую социальную миссию.",
  "Инвестируя во врачей и открытую базу знаний, партнеры напрямую повышают свой корпоративный ESG-рейтинг и укрепляют безупречную репутацию среди медицинского сообщества.",
] as const;
const STAGE_B_EXPERTS = [
  {
    name: "Эдуард Ильдарханов",
    photo: "/experts/eduard-ildarkhanov.webp",
    signature: [
      "архитектор смыслов, основатель BBM Academy и Doctor School",
    ],
  },
  {
    name: "Максим Алексеевич Страхов",
    photo: "/experts/maksim-strakhov.webp",
    signature: [
      "к. м. н., доцент кафедры травматологии-ортопедии и военно-полевой хирургии РНИМУ им. Н. И. Пирогова, доцент кафедры травматологии и ортопедии АПО ФНКЦ ФМБА России",
    ],
  },
  {
    name: "Тимофей Гаев",
    photo: "/experts/timofey-gaev.webp",
    signature: [
      "кандидат медицинских наук, главный врач профессионального баскетбольного клуба ЦСКА Москва, ведущий специалист Центра спортивной медицины и реабилитации Sport Fizio Life, врач спортивной медицины, травматолог-ортопед, старший преподаватель кафедры травматологии и ортопедии Академии постдипломного образования ФГБУ ФНКЦ ФМБА России",
    ],
  },
  {
    name: "Евгений Константинов",
    photo: "/experts/evgeniy-konstantinov.webp",
    signature: [
      "независимый эксперт-консультант фармацевтического маркетинга, инженер-конструктор построения рынков и стратегического управления мнениями",
    ],
  },
  {
    name: "Загородний Николай Васильевич",
    photo: "/experts/nikolay-zagorodniy.webp",
    signature: [
      "Автор более 800 научных и печатных работ, 16 монографий, 34 учебно-методических пособий.",
      "Под его руководством защищено 19 докторских и 54 кандидатские диссертации.",
    ],
  },
  {
    name: "Бондарев Анатолий",
    photo: "/experts/anatoliy-bondarev.webp",
    signature: [
      "новатор, директор по маркетингу Панбиофарм, независимый эксперт по созданию и управлению фармацевтическими рынками",
    ],
  },
] as const;
const STAGE_B_PROJECTS = [
  {
    title: "Синергизм вместо конкуренции в фарме (возможен ли?)",
    href: "https://academy.doctor.school/webinars/event-70d250b9",
    meta: "16 августа · Эдуард Ильдарханов, Анатолий Бондарев и Тимофей Гаев · 180 мин",
  },
  {
    title: "B2B — стейкхолдеры реальных решений",
    href: "https://rutube.ru/video/a682bead10b37ce96beef4f3a6d59b08/?r=wd",
    meta: "18 июля · Эдуард Ильдарханов и Евгений Константинов · 120 мин",
  },
] as const;

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
    await page.setViewportSize({ width: 1440, height: 900 });
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
    const pageHeading = page.getByRole("heading", { level: 1 });
    await expect(pageHeading).toHaveCount(1);
    await expect(pageHeading).toHaveText(HERO_HEADING);
    await expect(page.getByText("Учитесь у практиков — бесплатно")).toHaveCount(
      0,
    );
    await expect(page.getByText(HERO_BODY, { exact: true })).toBeVisible();

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
        "what",
        "experts",
        "events",
        "why",
        "projects",
        "partner-value",
        "formats",
        "lead-demo",
      ]);

    const events = main.locator('[data-academy-section="events"]');
    const webinarCards = events.locator("[data-webinar-card]");
    await expect(webinarCards).toHaveCount(2);
    for (const project of STAGE_B_PROJECTS) {
      await expect(
        events.getByRole("heading", { name: project.title, exact: true }),
      ).toHaveCount(1);
      await expect(
        events.getByRole("link", { name: project.title, exact: true }),
      ).toHaveAttribute("href", project.href);
    }
    const pastWebinar = events.locator('[data-webinar-state="past"]');
    await expect(pastWebinar).toContainText(
      "B2B — стейкхолдеры реальных решений",
    );
    expect(
      Number(
        await pastWebinar.evaluate((node) => getComputedStyle(node).opacity),
      ),
    ).toBeLessThan(1);

    const platform = main.locator('[data-academy-section="what"]');
    await expect(
      platform.getByRole("heading", { name: "Что такое Doctor.School" }),
    ).toBeVisible();
    await expect(
      platform.getByTestId("academy-platform-intro").locator("p"),
    ).toHaveText([...PLATFORM_COPY]);

    const experts = main.locator('[data-academy-section="experts"]');
    await expect(
      experts.getByRole("heading", { name: "Объединение лидеров и экспертов" }),
    ).toBeVisible();
    await expect(
      experts.getByText(
        "Площадка объединяет фаундеров, приглашенных экспертов и лидеров мнений.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(experts.getByText("Люди", { exact: true })).toBeVisible();
    const projectBlock = experts.getByTestId("academy-expert-project");
    await expect(
      projectBlock.getByText("Проект", { exact: true }),
    ).toBeVisible();
    await expect(
      projectBlock.getByText(
        "Серия откровенных разговоров с лидерами рынка о будущем медицинского образования. Участие в проекте дает экспертам возможность публично транслировать свои ценности, давать живую обратную связь и выстраивать прочную нейронную связь с брендом и аудиторией.",
        { exact: true },
      ),
    ).toBeVisible();
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
    const expertCards = experts.getByTestId("academy-expert-card");
    await expect(expertCards).toHaveCount(6);
    for (const expert of STAGE_B_EXPERTS) {
      const card = expertCards.filter({ hasText: expert.name });
      await expect(card).toHaveCount(1);
      await expect(
        card.getByTestId("academy-expert-copy").locator(":scope > *"),
      ).toHaveText([expert.name, ...expert.signature]);
    }

    const expertPhotos = experts.locator("img");
    await expect(expertPhotos).toHaveCount(6);
    for (const [index, expert] of STAGE_B_EXPERTS.entries()) {
      const photo = expertPhotos.nth(index);
      await expect(photo).toHaveAttribute("alt", expert.name);
      expect(
        decodeURIComponent((await photo.getAttribute("src")) ?? ""),
      ).toContain(expert.photo);
      await photo.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          photo.evaluate(
            (image) =>
              image instanceof HTMLImageElement &&
              image.complete &&
              image.naturalWidth > 0 &&
              image.naturalHeight > 0,
          ),
        )
        .toBe(true);
    }
    const bondarevCard = expertCards.filter({
      hasText: "Бондарев Анатолий",
    });
    await expect(bondarevCard.locator("img")).toHaveCount(1);
    await expect(
      bondarevCard.getByText("фото ожидается", { exact: true }),
    ).toHaveCount(0);

    await expect(expertGrid.getByTestId("academy-expert-card")).toHaveCount(6);

    const projectLinks = experts
      .getByTestId("academy-project-list")
      .getByRole("link");
    await expect(projectLinks).toHaveCount(2);
    for (const [index, project] of STAGE_B_PROJECTS.entries()) {
      const link = projectLinks.nth(index);
      await expect(link.getByText(project.title, { exact: true })).toBeVisible();
      await expect(link.getByText(project.meta, { exact: true })).toBeVisible();
      await expect(link).toHaveAttribute("href", project.href);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /noopener/);
      await expect(link).toHaveAttribute("rel", /noreferrer/);
    }

    const projects = main.locator('[data-academy-section="projects"]');
    for (const falseMetric of [
      "38 направлений",
      "12 клубов",
      "24 выпуска",
      "6 треков",
    ]) {
      await expect(projects.getByText(falseMetric, { exact: true })).toHaveCount(
        0,
      );
    }
    await expect(
      projects.getByText("Методология", { exact: true }),
    ).toBeVisible();

    const wordmark = page.getByTestId("academy-footer-wordmark");
    await wordmark.scrollIntoViewIfNeeded();
    await expect(wordmark.locator("xpath=..")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    const wordmarkBox = await wordmark.boundingBox();
    expect(wordmarkBox).not.toBeNull();
    expect(wordmarkBox!.width).toBeGreaterThan(1440 * 0.8);
    expect(wordmarkBox!.height).toBeGreaterThan(150);
    const wordmarkInk = await wordmark.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--color-hairline)";
      document.body.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return { actual: getComputedStyle(element).color, expected };
    });
    expect(wordmarkInk.actual).toBe(wordmarkInk.expected);

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
    await expect(desktopNav.getByRole("link")).toHaveCount(3);
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
    await page.mouse.move(0, 0);
    const themeRest = await styleSignature(themeToggle);
    await themeToggle.hover();
    await expect.poll(() => styleSignature(themeToggle)).not.toBe(themeRest);
    const themeHover = await styleSignature(themeToggle);
    const themeBox = await themeToggle.boundingBox();
    expect(themeBox).not.toBeNull();
    await page.mouse.move(
      themeBox!.x + themeBox!.width / 2,
      themeBox!.y + themeBox!.height / 2,
    );
    await page.mouse.down();
    const themeActive = await styleSignature(themeToggle);
    await page.mouse.move(0, 0);
    await page.mouse.up();
    expect(themeActive).not.toBe(themeHover);

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

    await footer.scrollIntoViewIfNeeded();
    const mobileWordmark = page.getByTestId("academy-footer-wordmark");
    const mobileInkBox = await mobileWordmark.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const bounds = range.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        width: bounds.width,
      };
    });
    expect(mobileInkBox.left).toBeGreaterThanOrEqual(0);
    expect(mobileInkBox.right).toBeLessThanOrEqual(390);
    expect(
      Math.min(mobileInkBox.left, 390 - mobileInkBox.right),
    ).toBeGreaterThanOrEqual(8);
    expect(mobileInkBox.width).toBeGreaterThan(390 * 0.75);
  });

  test("keeps the lead area visibly demo-only and impossible to submit", async ({
    page,
  }) => {
    await page.goto(`${ROUTE}#partner-form`);

    await expect(page.locator("#partner-form form")).toHaveCount(0);
    const fieldset = page.locator("#partner-form fieldset");
    await expect(fieldset).toHaveAttribute("disabled", "");
    await expect(fieldset).toContainText("Демо: данные не отправляются");
    await expect(page.getByText("Демонстрационные поля")).toHaveClass(
      "sr-only",
    );
    await expect(fieldset.getByLabel("Имя")).toBeDisabled();
    await expect(fieldset.getByLabel("Роль")).toHaveValue("Выберите роль");
    await expect(
      fieldset.getByRole("button", { name: "Обсудить партнёрство" }),
    ).toBeDisabled();
    await expect(
      page.getByText("Заявка отправлена", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Политика конфиденциальности" }),
    ).toHaveAttribute("href", "#privacy");
  });

  test("primary CTA exposes hover, keyboard-focus, and active deltas", async ({
    page,
  }) => {
    await page.goto(ROUTE);
    const cta = page.getByRole("link", { name: "Стать партнёром" }).first();
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
