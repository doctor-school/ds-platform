import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInAsAdmin } from "@ds/e2e/admin-events";

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
 *   cover and without a partner; a draft and an unknown slug are the Academy
 *   not-found page with a real 404.
 * - EARS-17 — `doctor.school/materials/{slug}` is the doctor not-found page and
 *   the doctor home has no rail.
 *
 * Every rendered surface (both pages in both Academy schemes, the preview
 * panel) also passes an axe WCAG 2 A/AA scan.
 *
 * The read error with «Повторить» needs the api to fail under a running
 * storefront; it is driven by hand on the stand (PR body) and pinned in
 * `apps/portal/app/materials/[slug]/page.test.tsx`.
 *
 * Two groups. The EARS-3 preview needs only the admin + api, so it runs
 * wherever the admin flows run — CI `admin-e2e` included. The storefront group
 * (EARS-12 pages, EARS-17 doctor not-found) also needs `E2E_PORTAL_URL` and
 * `E2E_DOCTOR_URL` (the two storefronts proxying to the same api) and skips
 * without them; its CI journeys are tracked by #3517. `E2E_SHOT_DIR` opts into
 * the captures the PR body cites.
 */
const PORTAL = process.env.E2E_PORTAL_URL;
const DOCTOR = process.env.E2E_DOCTOR_URL;
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

interface Written {
  id: string;
  slug?: string;
  version: number;
}

/**
 * One admin API write from the signed-in admin page: the CSRF double-submit,
 * a fresh `Idempotency-Key` and, for an edit or a lifecycle call, `If-Match`.
 * A `coverBase64` sends the multipart shape (payload + cover parts).
 */
async function adminWrite(
  page: Page,
  input: {
    path: string;
    payload?: unknown;
    version?: number;
    coverBase64?: string;
  },
): Promise<Written> {
  const result = await page.evaluate(
    async ({ path, payload, version, coverBase64 }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((pair) => pair.startsWith("__Host-ds_admin_csrf="))
          ?.split("=")[1] ?? "";
      const headers: Record<string, string> = {
        accept: "application/json",
        "x-ds-admin-csrf": decodeURIComponent(csrf),
        "idempotency-key": crypto.randomUUID(),
      };
      if (version !== undefined) headers["if-match"] = `W/"${version}"`;
      let body: BodyInit | undefined;
      if (coverBase64) {
        const form = new FormData();
        form.append("payload", JSON.stringify(payload));
        const bytes = Uint8Array.from(atob(coverBase64), (c) =>
          c.charCodeAt(0),
        );
        form.append(
          "cover",
          new Blob([bytes], { type: "image/png" }),
          "cover.png",
        );
        body = form;
      } else if (payload !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(payload);
      }
      const res = await fetch(path, {
        method: "POST",
        credentials: "include",
        headers,
        body,
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    input,
  );
  expect(
    result.status,
    `${input.path} → ${JSON.stringify(result.json)}`,
  ).toBeLessThan(300);
  return result.json as Written;
}

async function publishedMaterial(
  page: Page,
  payload: Record<string, unknown>,
  coverBase64?: string,
): Promise<Written> {
  const created = await adminWrite(page, {
    path: "/v1/admin/materials",
    payload,
    coverBase64,
  });
  await adminWrite(page, {
    path: `/v1/admin/materials/${created.id}/publish`,
    version: created.version,
  });
  return created;
}

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
    // decoration. Leaf exclusions, the same as every portal axe scan.
    .exclude('[data-testid="shell-topbar"]')
    .exclude('[data-testid="footer-giant"]');
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

async function expectNoPageSideScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
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
  test.skip(
    !PORTAL || !DOCTOR,
    "needs E2E_PORTAL_URL and E2E_DOCTOR_URL (the storefronts of this stand); CI journeys: #3517",
  );
  test.describe.configure({ mode: "serial" });

  let news: Written;
  let column: Written;
  let draft: Written;
  const newsTitle = `Открыт набор центров в исследование PRP ${RUN}`;
  const columnTitle = `Ортобиология в России: чего не хватает практике ${RUN}`;
  const partnerName = `Партнёр А ${RUN}`;
  const expertFamily = `Страхов${RUN}`;

  test("seed: published news with cover and partner, a column without either, a draft", async ({
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
    draft = await adminWrite(page, {
      path: "/v1/admin/materials",
      payload: {
        kind: "news",
        title: `Черновик новости ${RUN}`,
        body: SHORT_BODY,
      },
    });
    expect(news.slug && column.slug && draft.slug).toBeTruthy();
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
    await expect(external).toHaveText("ClinicalTrials.gov ↗");
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
    await expect(pubmed).toHaveText("PubMed ↗");
    await expectNoAxeViolationsBothSchemes(page, "column reading page");
    await shotBothSchemes(page, "page-column-bare-desktop");
    await page.setViewportSize(NARROW);
    await expectNoPageSideScroll(page);
    await shotBothSchemes(page, "page-column-bare-mobile");
  });

  test("048 EARS-12: a draft and an unknown address are the Academy not-found page with a 404", async ({
    page,
  }) => {
    const unknown = await page.goto(`${PORTAL}/materials/net-takogo-${RUN}`);
    expect(unknown?.status()).toBe(404);
    // The not-found content is the Academy's own (its root not-found inside
    // the root layout's one `<main>`); the header slot is the frame around it.
    const host404 = await page.locator("main").innerText();
    const draftPage = await page.goto(`${PORTAL}/materials/${draft.slug}`);
    expect(draftPage?.status()).toBe(404);
    await expect(page.getByRole("article")).toHaveCount(0);
    expect(await page.locator("main").innerText()).toBe(host404);
    // The same not-found content the Academy renders for any unknown address.
    const elsewhere = await page.goto(`${PORTAL}/net-takoy-stranicy-${RUN}`);
    expect(elsewhere?.status()).toBe(404);
    expect(await page.locator("main").innerText()).toBe(host404);
    await page.goto(`${PORTAL}/materials/${draft.slug}`);
    await shot(page, "page-not-found-desktop-light");
  });

  test("048 EARS-17: doctor.school/materials/{slug} is the doctor not-found page and the doctor home has no rail", async ({
    page,
  }) => {
    const res = await page.goto(`${DOCTOR}/materials/${news.slug}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByText(newsTitle)).toHaveCount(0);
    await expect(page.getByRole("article")).toHaveCount(0);
    const doctor404 = await page.locator("body").innerText();
    await page.goto(`${DOCTOR}/net-takoy-stranicy-${RUN}`);
    expect(await page.locator("body").innerText()).toBe(doctor404);
    await page.goto(`${DOCTOR}/materials/${news.slug}`);
    await shot(page, "doctor-materials-not-found-desktop-light");
    await page.goto(`${DOCTOR}/`);
    await expect(page.getByText("Новости, блог и видео")).toHaveCount(0);
    await expect(page.getByText(newsTitle)).toHaveCount(0);
  });
});
