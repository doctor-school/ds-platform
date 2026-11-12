import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInAsAdmin } from "@ds/e2e/admin-events";

import {
  adminWrite,
  expectNoPageSideScroll,
  publishedMaterial,
  type Written,
} from "./support/admin-write";

/**
 * 048 «Reading page» (#3514) on the REAL path — the admin authors through the
 * admin API, the Academy storefront reads `GET /v1/public/materials/{slug}`
 * server-side, the doctor storefront has nothing of it:
 *
 * - EARS-3 — «Предпросмотр» on an unsaved form shows the reading page with the
 *   banner «Предпросмотр — материал не опубликован», and nothing is saved or
 *   added to the feed.
 * - EARS-12 — the Academy page of a published news item with a cover, a
 *   partner and a body carrying every allowlisted node; a column without a
 *   cover and without a partner.
 *
 * Every rendered surface (both pages in both Academy schemes, the preview
 * panel) also passes an axe WCAG 2 A/AA scan.
 *
 * 048 EARS-11/12/17: retry, draft/unknown404 and Doctor absence now run from
 * the original feature in `packages/e2e/material-pages.config.ts` (#3702).
 * The page unit tests remain; this file retains preview and rich articles.
 *
 * Two groups. The EARS-3 preview needs only the admin + api. The storefront
 * group (EARS-12 rich pages, EARS-18 at 390 px) also needs `E2E_PORTAL_URL`:
 * CI `admin-e2e` boots the Academy storefront for the flows tier, and only a
 * local run without it skips. `E2E_SHOT_DIR` opts into the captures the PR
 * body cites.
 */
const PORTAL = process.env.E2E_PORTAL_URL;
const SHOT_DIR = process.env.E2E_SHOT_DIR;
const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 390, height: 844 };
/** A decodable 1×1 PNG — the API cover normalizer is real. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
).toString("base64");

const RUN = Date.now().toString(36);

const LONG_BODY = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Академия открывает " },
        {
          type: "text",
          text: "многоцентровое исследование",
          marks: [{ type: "bold" }],
        },
        { type: "text", text: " — " },
        {
          type: "text",
          text: "по единому протоколу",
          marks: [{ type: "italic" }],
        },
        { type: "hardBreak" },
        { type: "text", text: "Протокол зарегистрирован на " },
        {
          type: "text",
          text: "ClinicalTrials.gov",
          marks: [
            { type: "link", attrs: { href: "https://clinicaltrials.gov/" } },
          ],
        },
        { type: "text", text: ", вебинары — в " },
        {
          type: "text",
          text: "разделе вебинаров",
          marks: [
            {
              type: "link",
              attrs: { href: "https://academy.doctor.school/webinars" },
            },
          ],
        },
        { type: "text", text: "." },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Что изучаем" }],
    },
    {
      type: "orderedList",
      content: [
        "однократное введение PRP;",
        "курс из трёх введений;",
        "контрольная группа.",
      ].map((text) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      })),
    },
    {
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "Требования к центру" }],
    },
    {
      type: "bulletList",
      content: [
        "не меньше 40 первичных пациентов в год;",
        "центрифуга для стандартизированного протокола.",
      ].map((text) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      })),
    },
    {
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Нам важно получить данные из обычной клинической практики.",
            },
          ],
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Вопросы — " },
        {
          type: "text",
          text: "research@doctor.school",
          marks: [
            { type: "link", attrs: { href: "mailto:research@doctor.school" } },
          ],
        },
      ],
    },
  ],
};

const SHORT_BODY = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Методология — в обзоре на " },
        {
          type: "text",
          text: "PubMed",
          marks: [
            {
              type: "link",
              attrs: { href: "https://pubmed.ncbi.nlm.nih.gov/" },
            },
          ],
        },
      ],
    },
  ],
};

async function shot(
  page: Page,
  name: string,
  { fullPage = true }: { fullPage?: boolean } = {},
): Promise<void> {
  if (!SHOT_DIR) return;
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage });
}

/** Captures in both schemes: the Academy theme is class-based (`<html class="dark">`). */
async function shotBothSchemes(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  for (const scheme of ["light", "dark"] as const) {
    await page.evaluate((dark) => {
      document.documentElement.classList.toggle("dark", dark);
    }, scheme === "dark");
    await shot(page, `${name}-${scheme}`);
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
}

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** axe WCAG 2 A/AA over `include` (default the whole page), in the current scheme. */
async function expectNoAxeViolations(
  page: Page,
  label: string,
  include?: string,
): Promise<void> {
  let builder = new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    // #2189 — the shared shell's BBM topbar keeps the owner-accepted canvas
    // contrast (2026-09-11); #2180 — the footer's giant wordmark is aria-hidden
    // decoration; the Academy home draws its own footer wordmark, excluded
    // as the same leaf by every full-page home scan (`academy-home.e2e`).
    // Leaf exclusions, the same as every portal axe scan.
    .exclude('[data-testid="shell-topbar"]')
    .exclude('[data-testid="footer-giant"]')
    // #1692 — open defect: the Academy footer wordmark contrast (same leaf as academy-home.e2e).
    .exclude('[data-testid="academy-footer-wordmark"]');
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target).flat(),
  }));
  expect(summary, `axe violations: ${label}`).toEqual([]);
}

/** The Academy page in both schemes (class-based `.dark`). */
async function expectNoAxeViolationsBothSchemes(
  page: Page,
  label: string,
): Promise<void> {
  for (const dark of [false, true]) {
    await page.evaluate((on) => {
      document.documentElement.classList.toggle("dark", on);
    }, dark);
    await expectNoAxeViolations(page, `${label} (${dark ? "dark" : "light"})`);
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
}

test.describe("048 reading page — admin preview", () => {
  test("048 EARS-3: «Предпросмотр» shows the unsaved form as its reading page with the banner, saving nothing", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    const title = `Предпросмотр без сохранения ${RUN}`;
    await page.goto("/materials/create");
    await page.getByTestId("material-form").waitFor({ state: "visible" });
    await page.getByTestId("material-title").fill(title);
    await page.getByTestId("material-author-line").fill("Редакция Академии");
    const editor = page
      .getByTestId("material-body")
      .locator('[contenteditable="true"]');
    await editor.click();
    await page.keyboard.type("Текст, который ещё не сохранён.");

    for (const viewport of [WIDE, NARROW]) {
      await page.setViewportSize(viewport);
      await page.getByTestId("material-preview").click();
      const panel = page.getByTestId("material-preview-panel");
      await expect(panel).toBeVisible();
      // Full-screen at every width: once the slide rests, it covers the viewport.
      await expect
        .poll(async () => {
          const box = await panel.boundingBox();
          return box
            ? [
                Math.round(box.x),
                Math.round(box.y),
                Math.round(box.width),
                Math.round(box.height),
              ]
            : null;
        })
        .toEqual([0, 0, viewport.width, viewport.height]);
      await expect(panel).toHaveAttribute("aria-modal", "true");
      // The info `Alert` carries its glyph before the text.
      await expect(panel.getByTestId("material-preview-banner")).toContainText(
        "Предпросмотр — материал не опубликован",
      );
      await expect(panel.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(panel.getByText("Новость", { exact: true })).toBeVisible();
      await expect(panel.getByTestId("material-byline")).toHaveText(
        "Редакция Академии",
      );
      await expect(panel).toContainText("Текст, который ещё не сохранён.");
      await expectNoAxeViolations(
        page,
        `preview panel ${viewport.width}px`,
        '[data-testid="material-preview-panel"]',
      );
      // The viewport, not the full page: the sheet is `fixed`, so a full-page
      // capture would draw it as a band over the scrolled form.
      await shot(
        page,
        `preview-${viewport === WIDE ? "desktop" : "mobile"}-light`,
        { fullPage: false },
      );
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
    }

    // Nothing saved: still the create form, no row with that title, no card.
    await expect(page).toHaveURL(/\/materials\/create$/);
    // Read from the page itself: the admin session is bound to its fingerprint.
    const list = await page.evaluate(async (q) => {
      const res = await fetch(
        `/v1/admin/materials?q=${encodeURIComponent(q)}`,
        { credentials: "include", headers: { accept: "application/json" } },
      );
      return { status: res.status, text: await res.text() };
    }, title);
    expect(list.status, list.text).toBe(200);
    expect(list.text).not.toContain(title);
    // The public feed through the admin origin's `/v1/*` rewrite (the feed
    // read is not host-scoped), so no storefront is needed.
    const feed = await page.evaluate(async () => {
      const res = await fetch("/v1/public/feed?limit=24", {
        headers: { accept: "application/json" },
      });
      return { status: res.status, text: await res.text() };
    });
    expect(feed.status, feed.text).toBe(200);
    expect(feed.text).not.toContain(title);
  });
});

test.describe("048 reading page — storefronts", () => {
  // CI boots the Academy storefront for this group, so CI has no skip path:
  // a missing URL there fails every test instead of passing them as skipped.
  test.skip(
    !PORTAL && process.env.CI !== "true",
    "needs E2E_PORTAL_URL (the Academy storefront of this stand)",
  );
  test.beforeAll(() => {
    expect(PORTAL, "E2E_PORTAL_URL names the Academy storefront").toBeTruthy();
  });
  test.describe.configure({ mode: "serial" });

  let news: Written;
  let column: Written;
  // Own titles: the job's later 048 originals find their materials by the
  // source titles, so this group's rows must not share them.
  const newsTitle = `Набор центров в многоцентровое исследование ${RUN}`;
  const columnTitle = `Колонка о практике ортобиологии ${RUN}`;
  const partnerName = `Партнёр А ${RUN}`;
  const expertFamily = `Страхов${RUN}`;

  test("seed: published news with cover and partner, a column without either", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/materials");
    const organisation = await adminWrite(page, {
      path: "/v1/admin/organisations",
      payload: { title: partnerName, publicNameVisible: true },
    });
    await adminWrite(page, {
      path: `/v1/admin/organisations/${organisation.id}/publish`,
      version: organisation.version,
    });
    const expert = await adminWrite(page, {
      path: "/v1/admin/experts",
      payload: {
        familyName: expertFamily,
        givenName: "Михаил",
        patronymic: "Андреевич",
        professionalRole: "Травматолог-ортопед",
        credentials: "д. м. н.",
        affiliation: "Академия Doctor.School",
        bio: "Научный руководитель исследования PRP.",
      },
    });
    await adminWrite(page, {
      path: `/v1/admin/experts/${expert.id}/publish`,
      version: expert.version,
    });
    news = await publishedMaterial(
      page,
      {
        kind: "news",
        title: newsTitle,
        authorLine: "Академия",
        partnerOrganisationId: organisation.id,
        body: LONG_BODY,
      },
      PNG,
    );
    column = await publishedMaterial(page, {
      kind: "column",
      title: columnTitle,
      expertId: expert.id,
      body: SHORT_BODY,
    });
    expect(news.slug && column.slug).toBeTruthy();
  });

  test("048 EARS-12: a news item with a cover, a partner and every allowlisted node", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    const response = await page.goto(`${PORTAL}/materials/${news.slug}`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(newsTitle);
    const article = page.getByRole("article");
    await expect(article.getByText("Новость", { exact: true })).toBeVisible();
    await expect(article.getByRole("heading", { level: 1 })).toHaveText(
      newsTitle,
    );
    await expect(page.getByTestId("material-byline")).toHaveText(
      /^Академия · \d{1,2} [а-я]+$/,
    );
    await expect(page.getByTestId("material-partner-mark")).toHaveText(
      `Партнёрский материал · ${partnerName}`,
    );
    const cover = page.getByTestId("material-cover").locator("img");
    await expect(cover).toBeVisible();
    expect(
      await cover.evaluate((img) => (img as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);
    await expect(article.getByRole("heading", { level: 2 })).toHaveText(
      "Что изучаем",
    );
    await expect(article.getByRole("heading", { level: 3 })).toHaveText(
      "Требования к центру",
    );
    await expect(article.locator("ol > li")).toHaveCount(3);
    await expect(article.locator("ul > li")).toHaveCount(2);
    await expect(article.locator("blockquote")).toContainText(
      "Нам важно получить данные",
    );
    await expect(article.locator("strong")).toHaveText(
      "многоцентровое исследование",
    );
    await expect(article.locator("em")).toHaveText("по единому протоколу");
    await expect(article.locator("p br")).toHaveCount(1);
    const external = article.getByRole("link", { name: "ClinicalTrials.gov" });
    await expect(external).toHaveAttribute("target", "_blank");
    await expect(external).toHaveAttribute("rel", "noopener noreferrer");
    await expect(external).toHaveText("ClinicalTrials.gov ↗\uFE0E");
    const own = article.getByRole("link", { name: "разделе вебинаров" });
    await expect(own).not.toHaveAttribute("target", /.+/);
    await expect(own).toHaveText("разделе вебинаров");
    const mail = article.getByRole("link", { name: "research@doctor.school" });
    await expect(mail).toHaveAttribute("href", "mailto:research@doctor.school");
    await expect(mail).not.toHaveAttribute("target", /.+/);
    // No raw HTML: the body is React elements, no script / iframe anywhere in it.
    await expect(article.locator("script, iframe, style")).toHaveCount(0);
    const back = page.getByRole("link", { name: "← Новости, блог и видео" });
    await expect(back).toHaveAttribute("href", "/#feed-h");
    await expectNoAxeViolationsBothSchemes(page, "news reading page");
    await shotBothSchemes(page, "page-news-cover-partner-desktop");
    await page.setViewportSize(NARROW);
    await expectNoPageSideScroll(page);
    await shotBothSchemes(page, "page-news-cover-partner-mobile");
    await back.click();
    await expect(page).toHaveURL(`${PORTAL}/#feed-h`);
  });

  test("048 EARS-12: a column without a cover and without a partner", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    const response = await page.goto(`${PORTAL}/materials/${column.slug}`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(columnTitle);
    await expect(
      page.getByText("Колонка эксперта", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("material-byline")).toHaveText(
      new RegExp(`^${expertFamily} Михаил Андреевич · \\d{1,2} [а-я]+$`),
    );
    await expect(
      page.getByTestId("material-byline").getByRole("link"),
    ).toHaveCount(0);
    await expect(page.getByTestId("material-partner-mark")).toHaveCount(0);
    await expect(page.getByText(/Партнёрский материал/)).toHaveCount(0);
    await expect(page.getByTestId("material-cover")).toHaveCount(0);
    const pubmed = page.getByRole("link", { name: "PubMed" });
    await expect(pubmed).toHaveAttribute("target", "_blank");
    await expect(pubmed).toHaveAttribute("rel", "noopener noreferrer");
    await expect(pubmed).toHaveText("PubMed ↗\uFE0E");
    await expectNoAxeViolationsBothSchemes(page, "column reading page");
    await shotBothSchemes(page, "page-column-bare-desktop");
    await page.setViewportSize(NARROW);
    await expectNoPageSideScroll(page);
    await shotBothSchemes(page, "page-column-bare-mobile");
  });

  test("048 EARS-18: at 390 px the home rail, the reading page, the material list and the form with its editor reach every card, button and editor control by keyboard and pass axe", async ({
    page,
    browser,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/materials");
    for (let n = 1; n <= 30; n += 1)
      await publishedMaterial(page, {
        kind: "news",
        title: `Материал ленты ${n} ${RUN}`,
        authorLine: "Академия",
        body: SHORT_BODY,
      });

    const visitor = await browser.newContext({
      viewport: NARROW,
      hasTouch: true,
      locale: "ru-RU",
    });
    try {
      const home = await visitor.newPage();
      expect((await home.goto(`${PORTAL}/`))?.status()).toBe(200);
      const feed = home.locator('[data-academy-section="feed"]');
      const cards = feed.getByRole("region").locator("[data-slot] > a");
      await expect(cards).toHaveCount(12);
      await expect(cards.first()).toHaveAttribute(
        "href",
        /^\/materials\/[^/]+$/u,
      );
      await expectNoPageSideScroll(home);
      await expectKeyboardReaches(home, '[data-academy-section="feed"]');
      await expectNoAxeViolationsBothSchemes(home, "home with the rail 390px");

      await cards.first().click();
      await home.waitForURL(/\/materials\/[^/]+$/u);
      await expect(home.getByRole("article")).toBeVisible();
      await expectNoPageSideScroll(home);
      await expectKeyboardReaches(home, "main");
      await expectNoAxeViolationsBothSchemes(home, "reading page 390px");
    } finally {
      await visitor.close();
    }

    await page.setViewportSize(NARROW);
    await page.goto("/materials");
    await expect(page.getByTestId("materials-table")).toBeVisible();
    await expectNoPageSideScroll(page);
    await expectKeyboardReaches(page, "main");
    await expectNoAdminAxeViolations(page, "material list 390px");

    await page.goto("/materials/create");
    const editor = page
      .getByTestId("material-body")
      .locator('[contenteditable="true"]');
    await expect(editor).toBeVisible();
    await expectNoPageSideScroll(page);
    await expectKeyboardReaches(page, '[data-testid="material-form"]');
    await expectNoAdminAxeViolations(page, "material form 390px");
  });
});

/**
 * 048 EARS-18 — every visible card, button, field and editor control inside
 * `scope` takes keyboard focus from Tab. A composite widget (a radio group, a
 * toolbar, a tab list) is one Tab stop by the ARIA pattern, so reaching any of
 * its members reaches the widget; its members move with the arrow keys.
 */
async function expectKeyboardReaches(page: Page, scope: string): Promise<void> {
  const total = await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root) throw new Error(`no ${selector}`);
    const controls = root.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
    );
    let unit = 0;
    const groups = new Map<Element | string, number>();
    for (const control of controls) {
      const hidden =
        (control as HTMLButtonElement).disabled ||
        control.closest("[inert], [aria-hidden='true']") ||
        !control.checkVisibility({ visibilityProperty: true }) ||
        control.getClientRects().length === 0 ||
        (control instanceof HTMLInputElement && control.type === "hidden");
      if (hidden) continue;
      const composite =
        control.closest('[role="toolbar"], [role="radiogroup"], [role="tablist"]') ??
        (control instanceof HTMLInputElement && control.type === "radio"
          ? `radio:${control.name}`
          : null);
      const key = composite ?? control;
      if (!groups.has(key)) groups.set(key, unit++);
      control.dataset.tabUnit = String(groups.get(key));
    }
    (document.activeElement as HTMLElement | null)?.blur();
    return unit;
  }, scope);
  expect(total, `${scope} has keyboard controls`).toBeGreaterThan(0);
  const reached = new Set<string>();
  for (let press = 0; press < total * 4 + 80 && reached.size < total; press += 1) {
    await page.keyboard.press("Tab");
    const unit = await page.evaluate(
      () =>
        (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(
          "[data-tab-unit]",
        )?.dataset.tabUnit ?? null,
    );
    if (unit !== null) reached.add(unit);
  }
  const missed = await page.evaluate((seen) => {
    return [...document.querySelectorAll<HTMLElement>("[data-tab-unit]")]
      .filter((el) => !seen.includes(el.dataset.tabUnit!))
      .map((el) => el.outerHTML.slice(0, 160));
  }, [...reached]);
  expect(missed, `${scope}: not reachable with Tab`).toEqual([]);
}

/** The admin scan: light only, no exclusion (the admin axe sweep's shape). */
async function expectNoAdminAxeViolations(
  page: Page,
  label: string,
): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target).flat(),
  }));
  expect(summary, `axe violations: ${label}`).toEqual([]);
}
