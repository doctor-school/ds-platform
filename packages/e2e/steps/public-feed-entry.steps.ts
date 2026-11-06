import { expect, type Page, type BrowserContext } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Given, When, Then, After } from "./support/fixtures.js";
import { chooseGuestSpecialty } from "../lib/specialty-choice.js";
import { waitForClientReady } from "../lib/page-ready.js";
import { signInAsAdmin } from "../admin/sign-in.js";
import { createReadonlyOperator } from "../lib/public-readonly-fixture.js";
import { createRecordFormFixture } from "../lib/record-form-fixture.js";
import {
  publicRecordFormTitles,
  publicSpecialtyMemoryTitles,
} from "../lib/host-tags.js";
import {
  feedEntryLog,
  feedEntryRoot,
  assertRecordFormComposition,
  verifyFeedEntryProvenance,
  verifyManagedFeedEntryAdjacency,
  verifyOwnedFeedEntryListeners,
} from "../lib/feed-entry.js";

type Specialty = { id: string; code: string; name: string; isOther: boolean };
const state = new WeakMap<
  Page,
  {
    book: Specialty[];
    chosen?: Specialty;
    commands: string[];
    backgrounds: string[];
    rechoiceStart?: number;
    operator?: Awaited<ReturnType<typeof createReadonlyOperator>>;
    adminContext?: BrowserContext;
    admin?: Page;
    records?: Awaited<ReturnType<typeof createRecordFormFixture>>;
    sourceTitle?: string;
    targetTitle?: string;
    chosenKind?: string;
  }
>();
function entry(page: Page) {
  const value = state.get(page);
  if (!value) throw new Error("017 feed-entry Background did not run");
  return value;
}
async function read<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(new URL(path, page.url()).href);
  feedEntryLog({
    command: "read real Doctor API",
    path,
    status: response.status(),
  });
  expect(response.status(), path).toBe(200);
  return response.json() as Promise<T>;
}
async function remembered(page: Page) {
  const body = await page.evaluate(async () => {
    const response = await fetch("/v1/public/specialty-choice");
    return { status: response.status, body: await response.json() };
  });
  expect(body.status).toBe(200);
  return body.body as { specialty: Specialty | null; storedIn: string };
}

Given(
  /^the storefront is apps\/doctor serving doctor\.school on the shared design system$/,
  async ({ page, host, world }) => {
    expect(host.id).toBe("doctor");
    verifyOwnedFeedEntryListeners();
    state.set(page, { book: [], commands: [], backgrounds: [] });
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/v1/public/specialty-choice" &&
        request.method() === "POST"
      ) {
        const key = request.headers()["idempotency-key"];
        if (key) entry(page).commands.push(key);
      }
    });
    const response = await page.goto(world.hostBaseUrl);
    feedEntryLog({
      command: "visit real guest Doctor home",
      status: response?.status(),
      origin: new URL(world.hostBaseUrl).origin,
    });
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId("storefront-shell")).toBeVisible();
    await expect(page.getByTestId("shell-nav-desktop")).toBeVisible();
    await expect(page.getByTestId("storefront-footer")).toBeVisible();
    verifyFeedEntryProvenance();
    entry(page).backgrounds.push("storefront and shared design system");
  },
);

Given(
  "the specialty book is the closed Минздрав list seeded from the nomenclature order in force plus «Другое»",
  async ({ page }) => {
    const book = await read<{ entries: Specialty[]; total: number }>(
      page,
      "/v1/public/specialties",
    );
    const { buildSpecialtyBookSeed } = await import(
      pathToFileURL(
        resolve(feedEntryRoot, "packages/db/src/seed/specialties-minzdrav.ts"),
      ).href
    );
    const project = (rows: Specialty[]) =>
      rows
        .map(({ code, name, isOther }) => ({ code, name, isOther }))
        .sort((a, b) => a.code.localeCompare(b.code));
    expect(book.total).toBe(book.entries.length);
    expect(project(book.entries)).toEqual(project(buildSpecialtyBookSeed()));
    expect(
      book.entries.filter((row) => row.isOther).map((row) => row.name),
    ).toEqual(["Другое"]);
    entry(page).book = book.entries;
    entry(page).backgrounds.push("closed Ministry book plus Other");
  },
);

Given(
  "adjacency is read from the managed directions-to-specialties link and the direction adjacency relation",
  async ({ page }) => {
    const specialty = entry(page).book.find(
      (row) => row.name === "Кардиология",
    );
    expect(specialty).toBeDefined();
    await verifyManagedFeedEntryAdjacency(specialty!.id);
    entry(page).backgrounds.push("managed links and adjacency");
  },
);

Given(
  "nothing on the home page requires an account to read",
  async ({ page }) => {
    expect((await remembered(page)).specialty).toBeNull();
    await expect(page.getByTestId("storefront-hero")).toBeVisible();
    await expect(page.getByTestId("specialty-catalog")).toHaveAttribute(
      "data-state",
      "open",
    );
    await expect(page.getByTestId("home-events")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      (await page.context().cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      ),
    ).toBe(false);
    entry(page).backgrounds.push("anonymous readable home");
  },
);

Given(
  "no surface states who finances the doctor's learning and none shows a price, cart or subscription",
  async ({ page }) => {
    const content = await page.locator("body").innerText();
    expect(content).not.toMatch(
      /финансирует|финансирован|за счёт|за счет|спонсор|фармацевтическ|корзин|подписк|стоимость|цена|[₽$€]|\bруб\./i,
    );
    await expect(
      page.getByRole("link", { name: /корзина|купить|подписка|тариф/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /корзина|купить|подписка|оплатить/i }),
    ).toHaveCount(0);
    entry(page).backgrounds.push("no financing or commerce");
  },
);

Given(
  /^the vendored canvas design-source\/doctor-home\.dc\.html is the composition source of truth for the home page, and design-source\/ds-shell\.dc\.html \(host=doctor\) for the shared shell$/,
  async ({ page }) => {
    verifyFeedEntryProvenance();
    const hero = page.getByTestId("storefront-hero"),
      catalog = page.getByTestId("specialty-catalog"),
      events = page.getByTestId("home-events");
    const boxes = await Promise.all([
      hero.boundingBox(),
      catalog.boundingBox(),
      events.boundingBox(),
    ]);
    expect(boxes.every(Boolean)).toBe(true);
    expect(boxes[0]!.y).toBeLessThan(boxes[1]!.y);
    expect(boxes[1]!.y).toBeLessThan(boxes[2]!.y);
    entry(page).backgrounds.push("vendored composition and shell provenance");
  },
);

Given(
  "a visitor with no chosen specialty on the storefront home page",
  async ({ page }) => {
    expect((await remembered(page)).specialty).toBeNull();
    await expect(page.getByTestId("specialty-catalog")).toHaveAttribute(
      "data-state",
      "open",
    );
  },
);

async function rememberSpecialty(page: Page, home: string) {
  const chosen = entry(page).book.find(
    (row) => row.name === "Травматология и ортопедия",
  );
  expect(chosen).toBeDefined();
  entry(page).chosen = chosen!;
  expect(await chooseGuestSpecialty(page, home, chosen!.name)).toBe(
    chosen!.code,
  );
  await page.reload();
  expect(await remembered(page)).toEqual({
    specialty: chosen,
    storedIn: "session",
  });
}

Given("a visitor with a remembered specialty", async ({ page, world }) => {
  await rememberSpecialty(page, world.hostBaseUrl);
});

Given(
  "a visitor with a remembered specialty and the catalog re-opened",
  async ({ page, world }) => {
    await rememberSpecialty(page, world.hostBaseUrl);
    await waitForClientReady(page);
    await page.getByTestId("specialty-change").click();
    await expect(page.getByTestId("specialty-catalog")).toHaveAttribute(
      "data-state",
      "open",
    );
    await expect(page.getByTestId("specialty-search")).toBeVisible();
    await expect(page.getByTestId("specialty-entries")).toBeVisible();
    entry(page).rechoiceStart = entry(page).commands.length;
    await expect(page.getByRole("button", { name: /сохранить/i })).toHaveCount(
      0,
    );
  },
);

async function chooseCatalogSpecialty(page: Page) {
  await waitForClientReady(page);
  const chosen = entry(page).book.find((row) => row.name === "Кардиология");
  expect(chosen).toBeDefined();
  entry(page).chosen = chosen!;
  const command = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/v1/public/specialty-choice" &&
      response.request().method() === "POST",
  );
  await page
    .getByTestId("specialty-catalog")
    .getByRole("button", { name: chosen!.name, exact: true })
    .click();
  const response = await command;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ specialty: chosen!.id });
  expect(await response.json()).toEqual({
    specialty: chosen,
    storedIn: "session",
  });
}

When("they choose a specialty in the catalog", async ({ page }) => {
  await chooseCatalogSpecialty(page);
});

When("they choose a different specialty", async ({ page }) => {
  const previous = entry(page).chosen!;
  await chooseCatalogSpecialty(page);
  expect(entry(page).chosen!.id).not.toBe(previous.id);
});

When("they activate «Моя лента» in the header navigation", async ({ page }) => {
  await waitForClientReady(page);
  const link = page
    .getByTestId("shell-nav-desktop")
    .getByRole("link", { name: "Моя лента", exact: true });
  await expect(link).toHaveAttribute("href", "/feed");
  await link.click();
});

Then(
  /^the shell lands on (?:that|the new) specialty's "\/feed\/<code>" showing the data-surface "specialty-feed" marker$/,
  async ({ page }) => {
    const chosen = entry(page).chosen!;
    await expect(page).toHaveURL(new RegExp(`/feed/${chosen.code}$`));
    await expect(page.locator('[data-surface="specialty-feed"]')).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: chosen.name, exact: true }),
    ).toBeVisible();
    const envelope = await read<{
      specialty: Specialty;
      viewer: { loggedIn: boolean };
    }>(page, `/v1/storefront/feed/${chosen.code}`);
    expect(envelope.specialty).toEqual(chosen);
    expect(envelope.viewer.loggedIn).toBe(false);
    const document = await page.request.get(page.url());
    expect(document.status()).toBe(200);
    expect(await document.text()).toContain('data-surface="specialty-feed"');
    expect(await remembered(page)).toEqual({
      specialty: chosen,
      storedIn: "session",
    });
  },
);

Then(/^the (?:new )?choice is remembered$/, async ({ page }) => {
  await page.reload();
  expect(await remembered(page)).toEqual({
    specialty: entry(page).chosen,
    storedIn: "session",
  });
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: entry(page).chosen!.name,
      exact: true,
    }),
  ).toBeVisible();
});

Then(
  "the catalog renders collapsed to a single row naming that specialty with a «сменить» control",
  async ({ page }) => {
    const catalog = page.getByTestId("specialty-catalog");
    await expect(catalog).toHaveAttribute("data-state", "chosen");
    await expect(catalog.getByTestId("specialty-chosen")).toHaveCount(1);
    await expect(catalog.getByTestId("specialty-chosen")).toHaveText(
      entry(page).chosen!.name,
    );
    await expect(catalog.getByTestId("specialty-change")).toHaveAccessibleName(
      "сменить",
    );
    await expect(catalog.getByTestId("specialty-change")).toBeVisible();
    for (const id of [
      "specialty-search",
      "specialty-entries",
      "specialty-entry",
      "specialty-expand",
    ])
      await expect(catalog.getByTestId(id)).toHaveCount(0);
  },
);

Then("no separate save action was required", async ({ page }) => {
  expect(entry(page).commands.length - entry(page).rechoiceStart!).toBe(1);
  await expect(page.getByRole("button", { name: /сохранить/i })).toHaveCount(0);
  expect((await remembered(page)).specialty).toEqual(entry(page).chosen);
});

When("an operator opens the admin navigation", async ({ page, browser }) => {
  const value = entry(page);
  expect(value.backgrounds).toHaveLength(6);
  value.operator = await createReadonlyOperator(3789);
  value.adminContext = await browser.newContext({
    baseURL: process.env.E2E_ADMIN_URL!,
    locale: "ru-RU",
    viewport: { width: 1440, height: 1000 },
  });
  value.admin = await value.adminContext.newPage();
  await signInAsAdmin(value.admin, value.operator.credentials);
});

Then(
  "the entry for the specialty link surface reads «Связи специальностей»",
  async ({ page }) => {
    const admin = entry(page).admin!;
    const link = admin.getByTestId("nav-direction-specialties");
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText("Связи специальностей");
    await expect(link).toHaveAccessibleName("Связи специальностей");
    await expect(link).toHaveAttribute("href", "/direction-specialties");
    await link.click();
    await expect(admin).toHaveURL(/\/direction-specialties$/);
    await expect(
      admin.getByRole("heading", {
        level: 1,
        name: "Направления и специальности",
        exact: true,
      }),
    ).toBeVisible();
  },
);

async function recordOperator(
  page: Page,
  browser: import("@playwright/test").Browser,
) {
  const value = entry(page);
  expect(value.backgrounds).toHaveLength(6);
  value.records = await createRecordFormFixture();
  value.operator = await createReadonlyOperator(3797);
  value.adminContext = await browser.newContext({
    baseURL: process.env.E2E_ADMIN_URL!,
    locale: "ru-RU",
    viewport: { width: 1440, height: 1000 },
  });
  value.admin = await value.adminContext.newPage();
  await signInAsAdmin(value.admin, value.operator.credentials);
  const titles = [
    `Кардиология ${randomUUID()}`,
    `Ревматология ${randomUUID()}`,
  ] as const;
  for (const title of titles) {
    await value.admin.goto("/directions/create");
    await value.admin.getByTestId("direction-title").fill(title);
    const created = value.admin.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/admin/directions" &&
        response.request().method() === "POST",
    );
    await value.admin.getByTestId("submit-direction").click();
    const response = await created;
    const body = await response.json();
    if (response.status() === 201) value.records.own("direction", body.id);
    expect(response.status()).toBe(201);
    await expect(value.admin).toHaveURL(new RegExp(`/directions/${body.id}$`));
    await expect(value.admin.getByTestId("direction-heading")).toHaveText(
      title,
    );
  }
  [value.sourceTitle, value.targetTitle] = titles;
  await value.admin.goto("/direction-adjacency/create");
  await expect(
    value.admin.getByTestId("direction-adjacency-form"),
  ).toBeVisible();
  await value.admin
    .getByTestId("direction-adjacency-direction")
    .selectOption(value.records.directions[0]!);
  await value.admin
    .getByTestId("direction-adjacency-adjacent")
    .selectOption(value.records.directions[1]!);
  return value;
}

const kindOptions = [
  {
    value: "related",
    label: "Смежное направление",
    description:
      "Соседняя область: врачи одного направления регулярно читают материалы другого.",
  },
  {
    value: "subdiscipline",
    label: "Поддисциплина",
    description:
      "Более узкая область внутри направления — часть его, а не сосед.",
  },
  {
    value: "interdisciplinary",
    label: "Междисциплинарная связь",
    description:
      "Направления из разных областей, которые сходятся на общих задачах.",
  },
] as const;

async function submitAdjacency(page: Page, kind: (typeof kindOptions)[number]) {
  const value = entry(page),
    admin = value.admin!;
  await admin
    .getByRole("option", {
      name: `${kind.label} ${kind.description}`,
      exact: true,
    })
    .click();
  value.chosenKind = kind.value;
  const created = admin.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/v1/admin/direction-adjacency" &&
      response.request().method() === "POST",
  );
  await admin.getByTestId("submit-direction-adjacency").click();
  const response = await created,
    body = await response.json();
  if (response.status() === 201) value.records!.own("edge", body.id);
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON().kind).toBe(kind.value);
  expect(body.kind).toBe(kind.value);
  await expect(admin).toHaveURL(new RegExp(`/direction-adjacency/${body.id}$`));
  await expect(admin.getByTestId("direction-adjacency-heading")).toHaveText(
    `${value.sourceTitle} → ${value.targetTitle}`,
  );
  await expect(admin.getByTestId("direction-adjacency-status")).toHaveText(
    "Действует",
  );
  await expect(admin.locator("#kind")).toContainText(kind.label);
}

Given(
  "an operator opens a reference-book record with exactly one tab",
  async ({ page, browser }) => {
    const value = await recordOperator(page, browser);
    await value.admin!.locator("#kind").click();
    await submitAdjacency(page, kindOptions[0]);
    await expect(
      value.admin!.getByTestId("direction-adjacency-form"),
    ).toBeVisible();
    expect((await value.records!.edge(value.records!.edges[0]!)).kind).toBe(
      "related",
    );
  },
);

Then("no tab bar is rendered", async ({ page }) => {
  const admin = entry(page).admin!;
  await expect(admin.getByRole("tablist")).toHaveCount(0);
  await expect(admin.getByRole("tab")).toHaveCount(0);
  await expect(
    admin.getByTestId("direction-adjacency-direction"),
  ).toBeDisabled();
});

Then("a record with two or more tabs renders the tab bar", async ({ page }) => {
  const value = entry(page),
    admin = value.admin!;
  await admin.goto(`/directions/${value.records!.directions[0]}`);
  await expect(admin.getByTestId("direction-heading")).toHaveText(
    value.sourceTitle!,
  );
  await expect(admin.getByRole("tablist")).toHaveCount(1);
  await expect(admin.getByRole("tab")).toHaveCount(2);
  const main = admin.getByTestId("tab-main"),
    events = admin.getByTestId("tab-events");
  await expect(main).toHaveAttribute("aria-selected", "true");
  await expect(admin.getByTestId("direction-form")).toBeVisible();
  await events.click();
  await expect(events).toHaveAttribute("aria-selected", "true");
  await expect(main).toHaveAttribute("aria-selected", "false");
  await expect(admin.getByTestId("direction-form")).toBeHidden();
  await expect(admin.getByRole("tabpanel")).toBeVisible();
  await expect(admin.getByRole("tabpanel")).toHaveAttribute(
    "aria-labelledby",
    (await events.getAttribute("id")) as string,
  );
  await expect(admin.getByTestId("event-directions-panel")).toBeVisible();
  await expect(admin.getByTestId("event-directions-empty")).toBeVisible();
  await main.click();
  await expect(main).toHaveAttribute("aria-selected", "true");
  await expect(admin.getByTestId("direction-title")).toHaveValue(
    value.sourceTitle!,
  );
});

Given(
  "an operator creates a direction adjacency link",
  async ({ page, browser }) => {
    await recordOperator(page, browser);
  },
);

When("they open «Вид связи»", async ({ page }) => {
  await entry(page)
    .admin!.getByRole("combobox", { name: "Вид связи", exact: true })
    .click();
});

Then(
  "the options are the closed Russian-labelled vocabulary with an explanation line each",
  async ({ page }) => {
    const admin = entry(page).admin!;
    await expect(admin.getByRole("option")).toHaveCount(3);
    for (const kind of kindOptions) {
      const option = admin.getByRole("option", {
        name: `${kind.label} ${kind.description}`,
        exact: true,
      });
      await expect(option).toBeVisible();
      await expect(option.getByText(kind.label, { exact: true })).toBeVisible();
      await expect(
        option.getByText(kind.description, { exact: true }),
      ).toBeVisible();
    }
  },
);

Then(
  "the stored value is the existing slug for the chosen option",
  async ({ page }) => {
    await submitAdjacency(page, kindOptions[1]);
    const value = entry(page),
      id = value.records!.edges[0]!;
    const response = await value.admin!.request.get(
      new URL(`/v1/admin/direction-adjacency/${id}`, value.admin!.url()).href,
    );
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ id, kind: value.chosenKind });
    expect(await value.records!.edge(id)).toMatchObject({
      id,
      kind: value.chosenKind,
    });
  },
);

Then(
  "a value outside the vocabulary is refused by the API",
  async ({ page }) => {
    const value = entry(page),
      id = value.records!.edges[0]!;
    const before = await value.records!.edge(id);
    const result = await value.admin!.evaluate(
      async ({ id, version }) => {
        const cookie = document.cookie
          .split("; ")
          .find((item) => item.startsWith("__Host-ds_admin_csrf="));
        if (!cookie) throw new Error("Normal Admin CSRF cookie is absent");
        const response = await fetch(`/v1/admin/direction-adjacency/${id}`, {
          method: "PATCH",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            "x-ds-admin-csrf": decodeURIComponent(
              cookie.slice(cookie.indexOf("=") + 1),
            ),
            "idempotency-key": crypto.randomUUID(),
            "if-match": `"${version}"`,
          },
          body: JSON.stringify({ kind: "outside-the-vocabulary" }),
        });
        return { status: response.status, body: await response.json() };
      },
      { id, version: before.version },
    );
    expect(result.status).toBe(400);
    expect(result.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "kind" })]),
    );
    expect(await value.records!.edge(id)).toEqual(before);
    feedEntryLog({
      command: "real invalid-kind API refusal preserved exact row",
      id,
      status: result.status,
    });
  },
);

Given(
  "an operator opens a reference-book record form",
  async ({ page, browser }) => {
    await recordOperator(page, browser);
  },
);

Then("the fields render inside a single framed panel", async ({ page }) => {
  const admin = entry(page).admin!,
    form = admin.getByTestId("direction-adjacency-form");
  await expect(admin.locator("form")).toHaveCount(1);
  await expect(form).toBeVisible();
  await expect(form.locator("fieldset")).toHaveCount(2);
  const border = await form.evaluate((element) => {
    const style = getComputedStyle(element);
    return [
      style.borderTopWidth,
      style.borderRightWidth,
      style.borderBottomWidth,
      style.borderLeftWidth,
    ].map(parseFloat);
  });
  expect(border.every((width) => width > 0)).toBe(true);
  await expect(form.getByTestId("submit-direction-adjacency")).toHaveCount(1);
  await expect(form.locator("fieldset [data-form-actions]")).toHaveCount(0);
});

Then("its sections are separated by hairlines", async ({ page }) => {
  const sections = entry(page)
    .admin!.getByTestId("direction-adjacency-form")
    .locator("fieldset");
  expect(
    await sections.evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        return {
          width: parseFloat(style.borderTopWidth),
          style: style.borderTopStyle,
          color: style.borderTopColor,
        };
      }),
    ),
  ).toEqual([
    { width: 0, style: "solid", color: expect.any(String) },
    {
      width: 1,
      style: "solid",
      color: expect.not.stringMatching(/transparent|rgba\(0, 0, 0, 0\)/),
    },
  ]);
});

Then(
  "each section is led by a statement heading with its explanatory line",
  async ({ page }) => {
    const sections = entry(page)
      .admin!.getByTestId("direction-adjacency-form")
      .locator("fieldset");
    const statements = ["Между какими направлениями связь", "Что это за связь"];
    for (let i = 0; i < 2; i++) {
      const section = sections.nth(i),
        legend = section.locator(":scope > legend");
      await expect(legend).toHaveText(statements[i]!);
      await expect(section).toHaveAccessibleName(statements[i]!);
      const description = await section.getAttribute("aria-describedby");
      expect(description).toBeTruthy();
      const text = await section.evaluate((element) => {
        const id = element.getAttribute("aria-describedby")!;
        const target = document.getElementById(id);
        if (!target || target.parentElement !== element)
          throw new Error("Orphaned section description");
        return target.textContent!.trim();
      });
      expect(text.length).toBeGreaterThan(20);
      await expect(section).toHaveAccessibleDescription(text);
    }
  },
);

Then(
  "no section-local form layout is assembled in place of the Field family",
  async () => {
    const path = "apps/admin/components/direction-adjacency-form.tsx";
    assertRecordFormComposition(
      readFileSync(resolve(feedEntryRoot, path), "utf8"),
    );
    feedEntryLog({
      command: "owning AST proves imported and mounted Field-family primitives",
      path,
    });
  },
);

Then(
  /^the shell lands on "\/#specialties" showing the open specialty catalog in view$/,
  async ({ page }) => {
    await expect(page).toHaveURL(/\/#specialties$/);
    const catalog = page.locator("#specialties");
    await expect(catalog).toHaveAttribute("data-testid", "specialty-catalog");
    await expect(catalog).toHaveAttribute("data-state", "open");
    await expect(catalog).toBeInViewport();
    await expect(page.locator('[data-surface="specialty-feed"]')).toHaveCount(
      0,
    );
    expect((await remembered(page)).specialty).toBeNull();
  },
);

After(async ({ page, $testInfo }) => {
  const value = state.get(page);
  if (!value) return;
  feedEntryLog({
    command:
      "owned public preference proof complete; cookie is the only guest preference store",
    title: $testInfo.title,
    chosen: value?.chosen?.code,
    idempotencyKeys: value?.commands ?? [],
  });
  await page.context().clearCookies({ name: "__Host-ds_specialty" });
  await $testInfo.attach("public-feed-entry", {
    body: JSON.stringify({
      chosen: value?.chosen,
      idempotencyKeys: value?.commands,
      url: page.url(),
      backgrounds: value.backgrounds,
    }),
    contentType: "application/json",
  });
  try {
    if (
      [...publicSpecialtyMemoryTitles, ...publicRecordFormTitles].some(
        (title) =>
          $testInfo.title === title || $testInfo.title.startsWith(title + " @"),
      )
    )
      expect(value.backgrounds).toHaveLength(6);
  } finally {
    try {
      await value.records?.cleanup();
    } finally {
      try {
        await value.adminContext?.close();
      } finally {
        await value.operator?.cleanup();
        state.delete(page);
      }
    }
  }
});
