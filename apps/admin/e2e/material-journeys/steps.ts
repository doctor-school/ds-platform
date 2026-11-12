import { randomUUID } from "node:crypto";

import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { createBdd } from "playwright-bdd";

import { adminWrite, expectNoPageSideScroll } from "../support/admin-write";
import { test, type AdminWorld } from "../support/fixtures";
import {
  ensurePublishedExpert,
  observe,
  operation,
  rows,
  signIn,
} from "../support/material-stand";
import { selectRelationshipCombobox } from "../support/relationship-combobox";

/**
 * 048 V-9 / V-10 / V-12 (#3517): the originals that cross the Admin writer and
 * the Academy reader in one run. The administrator writes through the real
 * Admin UI behind the second factor; a visitor in a separate, signed-out
 * browser context reads the real Academy home rail and reading page of
 * `E2E_PORTAL_URL`. A Given that states a past fact («first published on
 * 27 October», «30 published materials exist») is set up through the Admin
 * API or the owned database; every When and Then runs in the browser.
 */
const { Given, When, Then, Before, After } = createBdd(test);

const RAIL_LABEL =
  "Новости, блог и видео: листайте влево и вправо, стрелки клавиатуры — по одной карточке";
const PREV = "Назад к более новым материалам";
const NEXT = "Дальше, к более ранним материалам";
const DESKTOP = { width: 1440, height: 900 };
const MSK_DAY_MONTH = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "numeric",
  month: "long",
});
const MSK_YEAR = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  year: "numeric",
});

type Material = {
  id: string;
  slug: string;
  title: string;
  firstPublishedAt?: string;
  body?: unknown;
};
type State = {
  browser: Browser;
  contexts: BrowserContext[];
  materials: Map<string, Material>;
  current?: Material;
  kind?: "news" | "column";
  title?: string;
  organisationId?: string;
  viewport?: { width: number; height: number };
  visitor?: Page;
};
const states = new WeakMap<AdminWorld, State>();
function state(world: AdminWorld): State {
  const current = states.get(world);
  if (!current) throw new Error("Material journey has not started");
  return current;
}
function material(world: AdminWorld, title: string): Material {
  const found = state(world).materials.get(title);
  if (!found) throw new Error(`No material "${title}" in this scenario`);
  return found;
}
function remember(world: AdminWorld, written: Material): Material {
  const current = state(world);
  current.materials.set(written.title, written);
  current.current = written;
  operation("owned material", written);
  return written;
}
function portal(): string {
  const origin = process.env.E2E_PORTAL_URL;
  if (!origin) throw new Error("E2E_PORTAL_URL must name the Academy storefront");
  return origin.replace(/\/$/u, "");
}
/** The card date rule of 048 (Lead decision 10): day + month in Moscow time. */
function cardDate(iso: string): string {
  const at = new Date(iso);
  const dayMonth = MSK_DAY_MONTH.format(at);
  return MSK_YEAR.format(at) === MSK_YEAR.format(new Date())
    ? dayMonth
    : `${dayMonth} ${MSK_YEAR.format(at)}`;
}

Before(
  { tags: "@material-academy-journeys" },
  async ({ page, browser, world }) => {
    portal();
    states.set(world, { browser, contexts: [], materials: new Map() });
    await rows("SELECT 1");
    observe(page);
  },
);
After({ tags: "@material-academy-journeys" }, async ({ world }) => {
  for (const context of state(world).contexts) await context.close();
});

/** The signed-out visitor, in its own browser context (no Admin cookies). */
async function visitor(world: AdminWorld): Promise<Page> {
  const current = state(world);
  if (current.visitor) return current.visitor;
  const narrow = current.viewport;
  const context = await current.browser.newContext({
    viewport: narrow ?? DESKTOP,
    hasTouch: Boolean(narrow),
    locale: "ru-RU",
  });
  current.contexts.push(context);
  current.visitor = await context.newPage();
  observe(current.visitor);
  return current.visitor;
}

const feedSection = (page: Page) =>
  page.locator('[data-academy-section="feed"]');
const rail = (page: Page) => page.getByRole("region", { name: RAIL_LABEL });
const cards = (page: Page) => rail(page).locator("[data-slot] > a");
const cardOf = (page: Page, slug: string) =>
  rail(page).locator(`[data-slot] > a[href="/materials/${slug}"]`);

async function openHome(page: Page): Promise<void> {
  expect((await page.goto(`${portal()}/`))?.status()).toBe(200);
  await expect(cards(page).first()).toBeVisible();
}

/**
 * The visitor moves the rail with End until the card is loaded or the rail is
 * at the end of every material — «Дальше, к более ранним материалам» disabled
 * (048 EARS-14 / EARS-15).
 */
async function seekCard(page: Page, slug: string): Promise<Locator | null> {
  const card = cardOf(page, slug);
  const next = page.getByRole("button", { name: NEXT });
  for (let step = 0; step < 40; step += 1) {
    if (await card.count()) return card;
    if (await next.isDisabled()) return null;
    const before = await cards(page).count();
    await rail(page).focus();
    await page.keyboard.press("End");
    await expect
      .poll(
        async () =>
          (await cards(page).count()) > before ||
          (await card.count()) > 0 ||
          (await next.isDisabled()),
        { timeout: 20_000 },
      )
      .toBe(true);
  }
  throw new Error(`The rail never settled while looking for ${slug}`);
}
async function visibleCard(page: Page, slug: string): Promise<Locator> {
  await openHome(page);
  const card = await seekCard(page, slug);
  expect(card, `the rail has a card for /materials/${slug}`).not.toBeNull();
  await expect(card!).toHaveCount(1);
  return card!;
}
async function openReadingPage(page: Page, slug: string): Promise<number> {
  const response = await page.goto(`${portal()}/materials/${slug}`);
  return response?.status() ?? 0;
}

// ── Background and the administrator ───────────────────────────────────────

Given(
  "the published expert {string} is in the experts directory",
  async ({ page }, name: string) => {
    await signIn(page);
    await ensurePublishedExpert(page, name);
  },
);
Given(
  "a platform administrator is signed in to the admin with a second factor",
  async ({ page }) => {
    await expect(page.getByTestId("nav-materials")).toBeVisible();
  },
);

async function startMaterial(
  page: Page,
  world: AdminWorld,
  kind: "news" | "column",
  title: string,
): Promise<void> {
  const current = state(world);
  current.kind = kind;
  current.title = title;
  await page.goto("/materials/create");
  await expect(page.getByTestId("material-form")).toBeVisible();
  await page
    .getByTestId(`material-kind-${kind}`)
    .locator("xpath=ancestor::label[1]")
    .click();
  await page.getByTestId("material-title").fill(title);
}
const editorOf = (page: Page) =>
  page.getByTestId("material-body").locator('[contenteditable="true"]');
const toolbarButton = (page: Page, name: string) =>
  page
    .getByTestId("material-body")
    .getByRole("toolbar")
    .getByRole("button", { name, exact: true });

async function saveAndPublish(
  page: Page,
  world: AdminWorld,
  beforePublish?: (id: string) => Promise<void>,
): Promise<void> {
  const current = state(world);
  const created = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/v1/admin/materials",
  );
  await page.getByTestId("submit-material").click();
  const response = await created;
  expect(response.status()).toBe(201);
  const written = (await response.json()) as { id: string; slug: string };
  await page.waitForURL(new RegExp(`/materials/${written.id}$`, "u"));
  await expect(page.getByTestId("material-heading")).toHaveText(
    current.title!,
  );
  if (beforePublish) {
    await beforePublish(written.id);
    await page.reload();
  }
  await publishFromAdmin(page);
  const [stored] = await rows<{ first_published_at: Date; body: unknown }>(
    "SELECT first_published_at,body FROM materials WHERE id=$1",
    [written.id],
  );
  remember(world, {
    id: written.id,
    slug: written.slug,
    title: current.title!,
    firstPublishedAt: stored!.first_published_at.toISOString(),
    body: stored!.body,
  });
}
async function publishFromAdmin(page: Page): Promise<void> {
  const published = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/v1\/admin\/materials\/[^/]+\/publish$/u.test(new URL(r.url()).pathname),
  );
  await page.getByTestId("material-publish").click();
  expect((await published).status()).toBe(200);
  await expect(page.getByTestId("material-status")).toHaveText("Опубликован");
}
async function writePlainBody(page: Page): Promise<void> {
  await editorOf(page).fill("Материал о практическом применении ортобиологии.");
}
/** A news item written and published through the Admin UI. */
async function publishNews(
  page: Page,
  world: AdminWorld,
  title: string,
): Promise<Material> {
  await startMaterial(page, world, "news", title);
  await writePlainBody(page);
  await saveAndPublish(page, world);
  return material(world, title);
}

When(
  "the administrator creates a material of kind «Новость» titled {string}",
  async ({ page, world }, title: string) => {
    await startMaterial(page, world, "news", title);
  },
);
When(
  "the administrator creates a material of kind «Колонка эксперта» titled {string}",
  async ({ page, world }, title: string) => {
    await startMaterial(page, world, "column", title);
  },
);
When(
  "writes a body with a level-2 heading, a bulleted list and a bold phrase",
  async ({ page }) => {
    const editor = editorOf(page);
    await editor.click();
    await toolbarButton(page, "Заголовок").click();
    await page.keyboard.type("Что изучаем");
    await page.keyboard.press("Enter");
    await toolbarButton(page, "Список").click();
    await page.keyboard.type("однократное введение PRP");
    await page.keyboard.press("Enter");
    await page.keyboard.type("курс из трёх введений");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await toolbarButton(page, "Жирный").click();
    await page.keyboard.type("многоцентровое исследование");
    await toolbarButton(page, "Жирный").click();
    await page.keyboard.type(" по единому протоколу.");
    await expect(editor.locator("h2")).toHaveText("Что изучаем");
    await expect(editor.locator("ul > li")).toHaveText([
      "однократное введение PRP",
      "курс из трёх введений",
    ]);
    await expect(editor.locator("strong")).toHaveText(
      "многоцентровое исследование",
    );
  },
);
When("publishes the material", async ({ page, world }) => {
  await saveAndPublish(page, world);
});
When("writes a body and publishes the material", async ({ page, world }) => {
  await writePlainBody(page);
  await saveAndPublish(page, world);
});
Then("the material is published", async ({ page, world }) => {
  const current = state(world).current!;
  await expect(page.getByTestId("material-status")).toHaveText("Опубликован");
  const [stored] = await rows<{ status: string; body: string }>(
    "SELECT status,body::text AS body FROM materials WHERE id=$1",
    [current.id],
  );
  expect(stored!.status).toBe("published");
  // The formatting the administrator applied is what was stored (EARS-2).
  expect(stored!.body).toContain('"level": 2');
  expect(stored!.body).toContain('"bulletList"');
  expect(stored!.body).toContain('"bold"');
});
When(
  "chooses the expert {string}",
  async ({ page }, name: string) => {
    await selectRelationshipCombobox(
      page,
      "material-expert",
      name.split(" ")[0]!,
      name,
    );
  },
);

// ── The visitor on the Academy ─────────────────────────────────────────────

When(
  "a visitor who is not signed in opens the Academy home",
  async ({ world }) => {
    const page = await visitor(world);
    await openHome(page);
    expect(
      (await page.context().cookies()).filter((c) => /session/iu.test(c.name)),
    ).toEqual([]);
  },
);
When("a visitor opens the Academy home", async ({ world }) => {
  await openHome(await visitor(world));
});
Then(
  "the first card of the rail «Новости, блог и видео» reads «Новость», {string} and «Академия»",
  async ({ world }, title: string) => {
    const page = await visitor(world);
    await expect(
      feedSection(page).getByRole("heading", { name: "Новости, блог и видео" }),
    ).toBeVisible();
    const first = cards(page).first();
    await expect(first).toHaveAttribute(
      "href",
      `/materials/${material(world, title).slug}`,
    );
    await expect(first).toContainText("Новость");
    await expect(first).toContainText(title);
    await expect(first).toContainText("Академия");
  },
);
Then(
  /^the card of "([^"]+)" reads «([^»]+)» and «([^»]+)»$/u,
  async ({ world }, title: string, kind: string, source: string) => {
    const card = await visibleCard(
      await visitor(world),
      material(world, title).slug,
    );
    await expect(card).toContainText(kind);
    await expect(card).toContainText(title);
    await expect(card).toContainText(source);
  },
);
Then(
  /^the card of "([^"]+)" reads «([^»]+)»$/u,
  async ({ world }, title: string, mark: string) => {
    const card = await visibleCard(
      await visitor(world),
      material(world, title).slug,
    );
    await expect(card).toContainText(mark);
  },
);
Then(
  "the card of {string} has no partner mark",
  async ({ world }, title: string) => {
    const card = await visibleCard(
      await visitor(world),
      material(world, title).slug,
    );
    await expect(card).toContainText(title);
    await expect(card).not.toContainText("Партнёрский материал");
  },
);
Then("{string} stays in the rail", async ({ world }, title: string) => {
  const card = await visibleCard(
    await visitor(world),
    material(world, title).slug,
  );
  await expect(card).toContainText(title);
});
Then(
  "the reading page of {string} shows «Партнёрский материал · Партнёр А» under the byline",
  async ({ world }, title: string) => {
    const page = await visitor(world);
    expect(await openReadingPage(page, material(world, title).slug)).toBe(200);
    const byline = page.getByTestId("material-byline");
    const mark = page.getByTestId("material-partner-mark");
    await expect(mark).toHaveText("Партнёрский материал · Партнёр А");
    const [above, below] = [
      (await byline.boundingBox())!,
      (await mark.boundingBox())!,
    ];
    expect(below.y).toBeGreaterThanOrEqual(above.y + above.height - 1);
  },
);
Then(
  "the reading page of {string} has no partner mark",
  async ({ world }, title: string) => {
    const page = await visitor(world);
    expect(await openReadingPage(page, material(world, title).slug)).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByTestId("material-partner-mark")).toHaveCount(0);
    await expect(page.getByText(/Партнёрский материал/u)).toHaveCount(0);
  },
);

// ── The partner (EARS-19) ──────────────────────────────────────────────────

type Organisation = { id: string; status: string; public_name_visible: boolean };
Given(
  "the published organisation {string} with its name shown publicly is in the organisation registry",
  async ({ page, world }, title: string) => {
    let [found] = await rows<Organisation>(
      "SELECT id,status,public_name_visible FROM organisations WHERE title=$1",
      [title],
    );
    if (!found) {
      await page.goto("/organisations/create");
      await page.getByTestId("organisation-title").fill(title);
      await page.getByTestId("submit-organisation").click();
      await page.waitForURL(/\/organisations\/[0-9a-f-]{36}$/u);
      const id = new URL(page.url()).pathname.split("/").pop()!;
      operation("owned organisation", { id, title });
      found = { id, status: "draft", public_name_visible: true };
    }
    state(world).organisationId = found.id;
    if (!found.public_name_visible) await setPublicName(page, found.id, true);
    if (found.status !== "published") {
      await page.goto(`/organisations/${found.id}`);
      await page.getByTestId("tab-publish").click();
      await page.getByTestId("organisations-publish").click();
    }
    await expect
      .poll(async () =>
        rows<Organisation>(
          "SELECT id,status,public_name_visible FROM organisations WHERE id=$1",
          [found.id],
        ),
      )
      .toEqual([{ id: found.id, status: "published", public_name_visible: true }]);
  },
);
async function setPublicName(
  page: Page,
  id: string,
  visible: boolean,
): Promise<void> {
  await page.goto(`/organisations/${id}`);
  await expect(page.getByTestId("organisation-form")).toBeVisible();
  const checkbox = page.getByTestId("organisation-public-name-visible");
  if ((await checkbox.isChecked()) !== visible)
    await checkbox.locator("xpath=ancestor::label[1]").click();
  await expect(checkbox).toBeChecked({ checked: visible });
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" &&
      new URL(r.url()).pathname === `/v1/admin/organisations/${id}`,
  );
  await page.getByTestId("submit-organisation").click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByTestId("update-saved")).toBeVisible();
}
When("chooses the partner {string}", async ({ page }, name: string) => {
  await selectRelationshipCombobox(page, "material-partner", name, name);
  await expect(page.locator("#material-partner")).toContainText(name);
});
When(
  "the organisation {string} stops showing its name publicly",
  async ({ page, world }, title: string) => {
    void title;
    const id = state(world).organisationId!;
    await setPublicName(page, id, false);
    expect(
      await rows("SELECT public_name_visible FROM organisations WHERE id=$1", [
        id,
      ]),
    ).toEqual([{ public_name_visible: false }]);
  },
);
Given(
  "the news item {string} is published with no partner",
  async ({ page, world }, title: string) => {
    await publishNews(page, world, title);
    expect(
      await rows(
        "SELECT partner_organisation_id FROM materials WHERE id=$1",
        [material(world, title).id],
      ),
    ).toEqual([{ partner_organisation_id: null }]);
  },
);

// ── Edit, unpublish and republish (EARS-5 / EARS-6) ────────────────────────

Given(
  "the news item {string} was first published on 27 October",
  async ({ page, world }, title: string) => {
    // The first-publication date is write-once (048 EARS-5), so the past
    // date is the draft's history before the one real publish keeps it.
    const year = MSK_YEAR.format(new Date());
    const at = new Date(`${year}-10-27T12:00:00+03:00`).toISOString();
    expect(cardDate(at)).toBe("27 октября");
    await startMaterial(page, world, "news", title);
    await writePlainBody(page);
    await saveAndPublish(page, world, async (id) => {
      operation("first publication on 27 October", { id, at });
      await rows(
        "UPDATE materials SET first_published_at=$2 WHERE id=$1 AND status='draft' AND first_published_at IS NULL",
        [id, at],
      );
    });
    expect(material(world, title).firstPublishedAt).toBe(at);
  },
);
Given(
  "the news item {string} is published",
  async ({ page, world }, title: string) => {
    await publishNews(page, world, title);
  },
);
When(
  "the administrator changes its title to {string}",
  async ({ page, world }, title: string) => {
    const current = state(world).current!;
    await page.goto(`/materials/${current.id}`);
    await page.getByTestId("material-title").fill(title);
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" &&
        new URL(r.url()).pathname === `/v1/admin/materials/${current.id}`,
    );
    await page.getByTestId("submit-material").click();
    const response = await saved;
    expect(response.status()).toBe(200);
    await expect(page.getByTestId("update-saved")).toBeVisible();
    const { slug } = (await response.json()) as { slug: string };
    remember(world, { ...current, slug, title });
  },
);
Then(
  "its card reads {string} dated «27 октября»",
  async ({ world }, title: string) => {
    const current = state(world).current!;
    expect(current.title).toBe(title);
    const card = await visibleCard(await visitor(world), current.slug);
    await expect(card).toContainText(title);
    await expect(card).toContainText("27 октября");
    const [stored] = await rows<{ first_published_at: Date }>(
      "SELECT first_published_at FROM materials WHERE id=$1",
      [current.id],
    );
    expect(stored!.first_published_at.toISOString()).toBe(
      current.firstPublishedAt,
    );
  },
);
Then("its reading page shows the new title", async ({ world }) => {
  const current = state(world).current!;
  const page = await visitor(world);
  expect(await openReadingPage(page, current.slug)).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    current.title,
  );
});
When(
  "the administrator unpublishes it and confirms",
  async ({ page, world }) => {
    const current = state(world).current!;
    await page.goto(`/materials/${current.id}`);
    await page.getByTestId("material-unpublish").click();
    const dialog = page.getByTestId("material-unpublish-confirm");
    await expect(dialog).toBeVisible();
    const unpublished = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname ===
          `/v1/admin/materials/${current.id}/unpublish`,
    );
    await dialog.getByTestId("material-unpublish-submit").click();
    expect((await unpublished).status()).toBe(200);
    await expect(dialog).toBeHidden();
  },
);
Then(
  "{string} is a draft with its text kept",
  async ({ page, world }, title: string) => {
    const current = material(world, title);
    await expect(page.getByTestId("material-status")).toHaveText("Черновик");
    await expect(editorOf(page)).toContainText(
      "Материал о практическом применении ортобиологии.",
    );
    const [stored] = await rows<{ status: string; body: unknown }>(
      "SELECT status,body FROM materials WHERE id=$1",
      [current.id],
    );
    expect(stored).toEqual({ status: "draft", body: current.body });
  },
);
Then(
  "the rail has no card {string}",
  async ({ world }, title: string) => {
    const current = material(world, title);
    const page = await visitor(world);
    await openHome(page);
    expect(await seekCard(page, current.slug)).toBeNull();
    await expect(page.getByRole("button", { name: NEXT })).toBeDisabled();
    expect(
      await rows(
        "SELECT id FROM feed_entries WHERE source_platform='academy' AND source_ref=$1",
        [current.id],
      ),
    ).toEqual([]);
  },
);
Then(
  "its reading page address shows the Academy not-found page",
  async ({ world }) => {
    const page = await visitor(world);
    expect(await openReadingPage(page, state(world).current!.slug)).toBe(404);
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(
      page.getByText(state(world).current!.title, { exact: true }),
    ).toHaveCount(0);
  },
);
When("the administrator publishes it again", async ({ page }) => {
  await publishFromAdmin(page);
});
Then(
  "its card is back in the rail with its first publication date",
  async ({ world }) => {
    const current = state(world).current!;
    const [stored] = await rows<{ first_published_at: Date }>(
      "SELECT first_published_at FROM materials WHERE id=$1",
      [current.id],
    );
    expect(stored!.first_published_at.toISOString()).toBe(
      current.firstPublishedAt,
    );
    const card = await visibleCard(await visitor(world), current.slug);
    await expect(card).toContainText(current.title);
    await expect(card).toContainText(cardDate(current.firstPublishedAt!));
  },
);

// ── Reading a column (EARS-11 / EARS-12 / EARS-13) ─────────────────────────

Given(
  "the column {string} by {string} is published with a body linking to {string}",
  async ({ page, world }, title: string, expert: string, href: string) => {
    const [family, given, patronymic] = expert.split(" ");
    const [found] = await rows<{ id: string }>(
      "SELECT id FROM experts WHERE family_name=$1 AND given_name=$2 AND patronymic=$3 AND status='published'",
      [family, given, patronymic],
    );
    expect(found).toBeTruthy();
    await page.goto("/materials");
    const body = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Методология — в обзоре на " },
            {
              type: "text",
              text: "PubMed",
              marks: [{ type: "link", attrs: { href } }],
            },
          ],
        },
      ],
    };
    const created = await adminWrite(page, {
      path: "/v1/admin/materials",
      payload: { kind: "column", title, expertId: found!.id, body },
    });
    await adminWrite(page, {
      path: `/v1/admin/materials/${created.id}/publish`,
      version: created.version,
    });
    const [stored] = await rows<{ first_published_at: Date }>(
      "SELECT first_published_at FROM materials WHERE id=$1",
      [created.id],
    );
    remember(world, {
      id: created.id,
      slug: created.slug!,
      title,
      firstPublishedAt: stored!.first_published_at.toISOString(),
    });
  },
);
When("a visitor chooses its card in the rail", async ({ world }) => {
  const page = await visitor(world);
  const card = await visibleCard(page, state(world).current!.slug);
  await card.click();
});
Then(
  "the visitor lands on its reading page showing {string}",
  async ({ world }, title: string) => {
    const page = await visitor(world);
    await page.waitForURL(`${portal()}/materials/${state(world).current!.slug}`);
    await expect(
      page.getByRole("article").getByRole("heading", { level: 1 }),
    ).toHaveText(title);
  },
);
Then(
  "the page shows «Колонка эксперта», the publication date and the expert's name as plain text",
  async ({ world }) => {
    const page = await visitor(world);
    const article = page.getByRole("article");
    await expect(
      article.getByText("Колонка эксперта", { exact: true }),
    ).toBeVisible();
    const byline = page.getByTestId("material-byline");
    await expect(byline).toHaveText(
      `Страхов Михаил Андреевич · ${cardDate(state(world).current!.firstPublishedAt!)}`,
    );
    await expect(byline.getByRole("link")).toHaveCount(0);
  },
);
Then(
  "the link to {string} targets a new tab with rel {string}",
  async ({ world }, href: string, rel: string) => {
    const link = (await visitor(world))
      .getByRole("article")
      .locator(`a[href="${href}"]`);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", rel);
  },
);

// ── On a phone (EARS-18) ───────────────────────────────────────────────────

Given(
  "the viewport is {int} px wide",
  async ({ page, world }, width: number) => {
    state(world).viewport = { width, height: 844 };
    await page.setViewportSize({ width, height: 844 });
  },
);
Given(
  "{int} published materials exist",
  async ({ page, world }, count: number) => {
    await page.goto("/materials");
    const token = randomUUID().slice(0, 8);
    for (let n = 1; n <= count; n += 1) {
      const created = await adminWrite(page, {
        path: "/v1/admin/materials",
        payload: {
          kind: "news",
          title: `Материал ленты ${n} ${token}`,
          authorLine: "Академия",
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: `Текст материала ${n}.` }],
              },
            ],
          },
        },
      });
      await adminWrite(page, {
        path: `/v1/admin/materials/${created.id}/publish`,
        version: created.version,
      });
      operation("owned material", { id: created.id, n, token });
    }
    const [{ total }] = await rows<{ total: number }>(
      "SELECT count(*)::int AS total FROM materials WHERE status='published'",
    );
    expect(total).toBeGreaterThanOrEqual(count);
    void world;
  },
);
Then(
  "the rail shows one row with the next card partly visible and no arrow buttons",
  async ({ world }) => {
    const page = await visitor(world);
    await expect(cards(page)).toHaveCount(12);
    const layout = await rail(page).evaluate((el) => {
      const box = el.getBoundingClientRect();
      const slots = [...el.querySelectorAll<HTMLElement>("[data-slot]")].map(
        (slot) => slot.getBoundingClientRect(),
      );
      return {
        rows: new Set(slots.map((slot) => Math.round(slot.top))).size,
        partial: slots.some(
          (slot) => slot.left < box.right && slot.right > box.right + 1,
        ),
      };
    });
    expect(layout).toEqual({ rows: 1, partial: true });
    await expect(page.getByRole("button", { name: PREV })).toBeHidden();
    await expect(page.getByRole("button", { name: NEXT })).toBeHidden();
  },
);
When("the visitor swipes the rail and opens a card", async ({ world }) => {
  const page = await visitor(world);
  const region = rail(page);
  await region.scrollIntoViewIfNeeded();
  const box = (await region.boundingBox())!;
  // A finger drag from right to left across the rail (real touch input).
  const session = await page.context().newCDPSession(page);
  const y = Math.round(box.y + box.height / 2);
  const from = Math.round(box.x + box.width * 0.85);
  const to = Math.round(box.x + box.width * 0.15);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from, y }],
  });
  for (let n = 1; n <= 10; n += 1)
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: Math.round(from + ((to - from) * n) / 10), y }],
    });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  // The swipe moved the rail, and its snap has come to rest.
  await expect
    .poll(() =>
      region.evaluate(
        (el) =>
          new Promise<number>((resolve) => {
            const before = el.scrollLeft;
            setTimeout(
              () => resolve(el.scrollLeft === before ? before : 0),
              300,
            );
          }),
      ),
    )
    .toBeGreaterThan(0);
  const index = await region.evaluate((el) => {
    const slots = [...el.querySelectorAll<HTMLElement>("[data-slot] > a")];
    return slots.findIndex((link, at) => {
      const rect = link.getBoundingClientRect();
      return at > 0 && rect.left >= 0 && rect.right <= window.innerWidth;
    });
  });
  expect(index).toBeGreaterThan(0);
  const card = cards(page).nth(index);
  const href = (await card.getAttribute("href"))!;
  // Opened with a click: after any CDP touch drag (on the rail or not)
  // headless Chromium emits no click for a following tap — pointerup and
  // touchend arrive, click never does — so a tap here would test the harness.
  await card.click();
  await page.waitForURL(`${portal()}${href}`);
  await expect(page.getByRole("article")).toBeVisible();
});
Then(
  "neither the home nor the reading page scrolls horizontally",
  async ({ world }) => {
    const page = await visitor(world);
    await expectNoPageSideScroll(page);
    await page.goBack();
    await expect(cards(page).first()).toBeVisible();
    await expectNoPageSideScroll(page);
  },
);
Then(
  "a platform administrator's material list and material form do not scroll horizontally",
  async ({ page }) => {
    expect(page.viewportSize()?.width).toBe(390);
    await page.goto("/materials");
    await expect(page.getByTestId("materials-table")).toBeVisible();
    await expectNoPageSideScroll(page);
    await page.goto("/materials/create");
    await expect(editorOf(page)).toBeVisible();
    await expectNoPageSideScroll(page);
  },
);
