import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, type APIResponse, type Page } from "@playwright/test";

import { baseUrlFor, type HostConfig } from "../hosts.js";
import { Given, Then, When, type StepWorld } from "./support/fixtures.js";

type Specialty = {
  id: string;
  code: string;
  name: string;
  isOther: boolean;
};
type Book = { entries: Specialty[]; total: number };
const NO_MATCH_QUERY = "щщщфывапролдж";

function catalog(page: Page) {
  return page.getByTestId("specialty-catalog");
}
function search(page: Page) {
  return page.getByRole("searchbox", {
    name: "Поиск специальности",
    exact: true,
  });
}
async function read<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), path).toBe(200);
  return response.json() as Promise<T>;
}
async function book(page: Page): Promise<Book> {
  const result = await read<Book>(page, "/v1/public/specialties");
  expect(result.entries.length).toBeGreaterThan(0);
  expect(result.total).toBe(result.entries.length);
  expect(result.entries.some((entry) => entry.isOther)).toBe(true);
  return result;
}
async function open(
  page: Page,
  host: HostConfig,
  expectedState: "open" | "chosen" = "open",
): Promise<void> {
  const origin = new URL(baseUrlFor(host)).origin;
  const response = await page.goto(`${origin}/`, { waitUntil: "load" });
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(
    (url) => url.origin === origin && url.pathname === "/",
  );
  await expect(page.getByTestId("storefront-hero")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // 017 EARS-4/5: server markup can precede the catalog's client handlers.
  await page.waitForLoadState("networkidle");
  await expect(catalog(page)).toHaveAttribute("data-state", expectedState);
  await expect(catalog(page)).not.toHaveAttribute("aria-busy", "true");
}
async function entries(page: Page, expected: Specialty[]): Promise<void> {
  const chips = catalog(page).getByTestId("specialty-entry");
  await expect(chips).toHaveCount(expected.length);
  await expect
    .poll(() =>
      chips.evaluateAll((nodes) =>
        nodes.map((node) => ({
          code: node.getAttribute("data-code"),
          name: node.textContent?.trim(),
        })),
      ),
    )
    .toEqual(expected.map(({ code, name }) => ({ code, name })));
}
async function noMatch(page: Page): Promise<void> {
  await search(page).fill(NO_MATCH_QUERY);
  await expect(catalog(page)).toHaveAttribute("data-state", "nomatch");
  await expect(catalog(page)).not.toHaveAttribute("aria-busy", "true");
  await expect(catalog(page).getByTestId("specialty-entry")).toHaveCount(0);
}
async function expand(page: Page, expected: Book): Promise<void> {
  await page.getByTestId("specialty-expand").click();
  await expect(catalog(page)).toHaveAttribute("data-state", "expanded");
  await expect(page.getByTestId("specialty-expand")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await entries(page, expected.entries);
  const other = expected.entries.find((entry) => entry.isOther);
  expect(other).toBeDefined();
  await expect(
    catalog(page).getByRole("button", { name: other!.name, exact: true }),
  ).toBeVisible();
}

async function pageRemainsReachable(page: Page): Promise<void> {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const root = getComputedStyle(document.documentElement);
      return (
        body.overflow === "hidden" ||
        root.overflow === "hidden" ||
        body.position === "fixed"
      );
    }),
    "017 EARS-4: choosing a specialty must not lock the page",
  ).toBe(false);
  const hero = page.getByTestId("storefront-hero");
  const footer = page.getByTestId("storefront-footer");
  await hero.scrollIntoViewIfNeeded();
  await expect(hero).toBeInViewport();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight,
    ),
  ).toBe(true);
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toBeInViewport();
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
}

Given(
  "a guest uses the configured Doctor specialty catalog",
  async ({ page, host }) => {
    expect(host.id).toBe("doctor");
    await page.context().clearCookies();
  },
);

Given("a visitor with no chosen specialty", async ({ page }) => {
  await page.context().clearCookies();
});

When("they open the storefront home page", async ({ page, host }) => {
  const remembered = (await page.context().cookies()).some(
    (cookie) => cookie.name === "__Host-ds_specialty",
  );
  await open(page, host, remembered ? "chosen" : "open");
});

When(
  "they open the storefront home page and scroll to the footer",
  async ({ page, host }) => {
    await open(page, host);
    await page.getByTestId("storefront-footer").scrollIntoViewIfNeeded();
  },
);

Then(
  "the existing hero and footer stay readable without a specialty choice",
  async ({ page }) => {
    await pageRemainsReachable(page);
  },
);

Then(
  "no modal gate, interstitial, scroll lock or empty page appears at any point",
  async ({ page }) => {
    const served = await book(page);
    await expect(catalog(page)).toHaveAttribute("data-state", "open");
    await pageRemainsReachable(page);

    await expand(page, served);
    await pageRemainsReachable(page);

    const target = served.entries.find((entry) => !entry.isOther)!;
    const expected = await read<Book>(
      page,
      `/v1/public/specialties/search?q=${encodeURIComponent(target.name)}`,
    );
    expect(expected.entries.some((entry) => entry.id === target.id)).toBe(true);
    await search(page).fill(target.name);
    await expect(catalog(page)).toHaveAttribute("data-state", "filtered");
    await expect(catalog(page)).not.toHaveAttribute("aria-busy", "true");
    await entries(page, expected.entries);
    await pageRemainsReachable(page);

    await noMatch(page);
    await pageRemainsReachable(page);
  },
);

Then(
  "the catalog renders a labelled search field over the whole list as its hero element",
  async ({ page }) => {
    await expect(search(page)).toBeVisible();
    await expect(search(page)).toHaveAttribute(
      "placeholder",
      "Начните вводить название",
    );
    await expect(catalog(page)).toHaveAttribute(
      "data-total",
      String((await book(page)).total),
    );
  },
);

Then("the frequent specialties render beneath it", async ({ page }) => {
  const frequent = await read<{ entries: Specialty[] }>(
    page,
    "/v1/public/specialties/frequent",
  );
  expect(frequent.entries.length).toBeGreaterThan(0);
  await expect(
    catalog(page).getByText("Частые специальности", { exact: true }),
  ).toBeVisible();
  await entries(page, frequent.entries);
  const field = await search(page).boundingBox();
  const firstChip = await catalog(page)
    .getByTestId("specialty-entry")
    .first()
    .boundingBox();
  expect(field).not.toBeNull();
  expect(firstChip).not.toBeNull();
  expect(firstChip!.y).toBeGreaterThan(field!.y + field!.height);
});

Then(
  "a «Показать весь список — N» control, N rendered from the actual book size, reveals the remainder including «Другое»",
  async ({ page }) => {
    const served = await book(page);
    const control = page.getByTestId("specialty-expand");
    await expect(control).toHaveText(`Показать весь список — ${served.total}`);
    await expect(control).toHaveAttribute("aria-expanded", "false");
    await expand(page, served);
  },
);

Then(
  "the list is never presented as a bare full-length scroll",
  async ({ page }) => {
    const list = catalog(page).getByTestId("specialty-entries");
    await expect(list).toHaveCSS("flex-wrap", "wrap");
    expect(
      await list.evaluate((node) => getComputedStyle(node).overflowY),
    ).not.toMatch(/^(auto|scroll)$/u);
    await page.getByTestId("specialty-expand").click();
    await expect(catalog(page)).toHaveAttribute("data-state", "open");
    const frequent = await read<{ entries: Specialty[] }>(
      page,
      "/v1/public/specialties/frequent",
    );
    await entries(page, frequent.entries);
  },
);

Given("a visitor on the open catalog", async ({ page, host }) => {
  await open(page, host);
});

When("they type a fragment that matches no entry", async ({ page }) => {
  const response = await read<Book>(
    page,
    `/v1/public/specialties/search?q=${encodeURIComponent(NO_MATCH_QUERY)}`,
  );
  expect(response.total).toBe(0);
  expect(response.entries).toEqual([]);
  await noMatch(page);
});

Then(
  "the catalog states in plain Russian that nothing was found",
  async ({ page }) => {
    await expect(page.getByTestId("specialty-no-match")).toHaveText(
      "Ничего не найдено. Проверьте написание или выберите «Другое».",
    );
  },
);

Then("the typed query remains in the field and editable", async ({ page }) => {
  await expect(search(page)).toHaveValue(NO_MATCH_QUERY);
  await expect(search(page)).toBeEditable();
  const served = await book(page);
  const target = served.entries.find((entry) => !entry.isOther)!;
  const query = target.name;
  const expected = await read<Book>(
    page,
    `/v1/public/specialties/search?q=${encodeURIComponent(query)}`,
  );
  expect(expected.entries.some((entry) => entry.id === target.id)).toBe(true);
  await search(page).fill(query);
  await expect(catalog(page)).toHaveAttribute("data-state", "filtered");
  await expect(catalog(page)).not.toHaveAttribute("aria-busy", "true");
  await entries(page, expected.entries);
});

Then("«Другое» remains reachable", async ({ page }) => {
  await noMatch(page);
  await expand(page, await book(page));
  await expect(search(page)).toHaveValue("");
});

type Choice = { specialty: Specialty | null; storedIn: string };
type Behavior = {
  query?: string;
  beforeBook?: Book;
  beforeChoice?: Choice;
  beforeCookies?: Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>>;
  refusal?: APIResponse;
};
const behaviors = new WeakMap<StepWorld, Behavior>();
function behavior(world: StepWorld): Behavior {
  let result = behaviors.get(world);
  if (!result) {
    result = {};
    behaviors.set(world, result);
  }
  return result;
}
function fold(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
}
function matching(served: Book, query: string): Specialty[] {
  return served.entries.filter((entry) =>
    fold(entry.name).includes(fold(query)),
  );
}
async function filter(page: Page, query: string, served: Book): Promise<void> {
  const expected = matching(served, query);
  expect(
    expected.length,
    `nonempty real book result for ${query}`,
  ).toBeGreaterThan(0);
  const response = page.waitForResponse((answer) => {
    const url = new URL(answer.url());
    return (
      url.pathname === "/v1/public/specialties/search" &&
      url.searchParams.get("q") === query
    );
  });
  await search(page).fill(query);
  const answer = await response;
  expect(answer.status()).toBe(200);
  expect(await answer.json()).toEqual({
    query,
    entries: expected,
    total: expected.length,
  });
  await expect(catalog(page)).toHaveAttribute("data-state", "filtered");
  await expect(catalog(page)).not.toHaveAttribute("aria-busy", "true");
  await expect(search(page)).toHaveValue(query);
  await entries(page, expected);
}

When(
  "a choice is submitted for an identifier that is not a member of the specialty book",
  async ({ page, host, world }) => {
    await open(page, host);
    const state = behavior(world);
    state.beforeBook = await book(page);
    state.beforeChoice = await read<Choice>(
      page,
      "/v1/public/specialty-choice",
    );
    expect(state.beforeChoice).toEqual({ specialty: null, storedIn: "none" });
    state.beforeCookies = await page.context().cookies();
    const unknown = randomUUID();
    expect(state.beforeBook.entries.some((entry) => entry.id === unknown)).toBe(
      false,
    );
    state.refusal = await page.request.post("/v1/public/specialty-choice", {
      headers: { "Idempotency-Key": randomUUID() },
      data: { specialty: unknown },
    });
  },
);

Then(
  "the request is refused as a Problem Details document with an exact errorCode",
  async ({ world }) => {
    const response = behavior(world).refusal!;
    expect(response.status()).toBe(422);
    expect(response.headers()["content-type"]).toMatch(
      /^application\/problem\+json/u,
    );
    const problem = await response.json();
    expect(problem).toMatchObject({
      status: 422,
      errorCode: "SPECIALTY_NOT_IN_BOOK",
    });
    for (const key of ["type", "title", "traceId"])
      expect(problem[key], key).toMatch(/\S/u);
    expect(response.headers()["set-cookie"]).toBeUndefined();
  },
);

Then("no choice is recorded", async ({ page, world }) => {
  const state = behavior(world);
  expect(await read<Choice>(page, "/v1/public/specialty-choice")).toEqual(
    state.beforeChoice,
  );
  expect(await page.context().cookies()).toEqual(state.beforeCookies);
  await expect(catalog(page)).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("specialty-chosen")).toHaveCount(0);
});

Then(
  "no storefront path is able to write a new entry into the book",
  async ({ page, world }) => {
    // 017 EARS-3: the declared route inventory complements refused live writes.
    const controller = readFileSync(
      new URL(
        "../../../apps/api/src/storefront/specialties.public.controller.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(controller).toContain(
      '@Controller({ path: "public/specialties", version: "1" })',
    );
    expect(
      [...controller.matchAll(/^\s+@(Get|Post|Put|Patch|Delete)\(/gm)].map(
        (match) => match[1],
      ),
    ).toEqual(["Get", "Get", "Get"]);
    const contract = JSON.parse(
      readFileSync(
        new URL(
          "../../../packages/api-client/openapi.snapshot.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { paths: Record<string, Record<string, unknown>> };
    const routes = Object.entries(contract.paths).filter(([path]) =>
      path.startsWith("/v1/public/specialties"),
    );
    expect(routes.map(([path]) => path).sort()).toEqual([
      "/v1/public/specialties",
      "/v1/public/specialties/frequent",
      "/v1/public/specialties/search",
    ]);
    for (const [, operations] of routes)
      expect(Object.keys(operations)).toEqual(["get"]);
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const response = await page.request.fetch("/v1/public/specialties", {
        method,
        data: { code: `e2e-${randomUUID()}`, name: "Не член справочника" },
      });
      expect(
        response.status(),
        `${method} cannot author the book`,
      ).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
    }
    expect(await book(page)).toEqual(behavior(world).beforeBook);
  },
);

When(
  "they type {string} into the search field",
  async ({ page, world }, query: string) => {
    behavior(world).query = query;
    const served = await book(page);
    behavior(world).beforeBook = served;
    await filter(page, query, served);
  },
);

Then(
  "the list narrows to entries containing that fragment anywhere in the name",
  async ({ page, world }) => {
    const state = behavior(world);
    await entries(page, matching(state.beforeBook!, state.query!));
    expect(
      matching(state.beforeBook!, "орто").some(
        (entry) => !fold(entry.name).startsWith("орто"),
      ),
    ).toBe(true);
  },
);

Then(
  /^the match ignores letter case and the ё\/е distinction$/,
  async ({ page, world }) => {
    const served = behavior(world).beforeBook!;
    for (const query of ["терап", "ТЁРАП"]) await filter(page, query, served);
    expect(matching(served, "терап")).toEqual(matching(served, "ТЁРАП"));
  },
);

Then(
  "entries outside the frequent set are reachable this way",
  async ({ page, world }) => {
    const served = behavior(world).beforeBook!;
    const frequent = await read<{ entries: Specialty[] }>(
      page,
      "/v1/public/specialties/frequent",
    );
    const outsider = served.entries.find(
      (entry) => entry.name === "Стоматология ортопедическая",
    );
    expect(outsider).toBeDefined();
    expect(frequent.entries.some((entry) => entry.id === outsider!.id)).toBe(
      false,
    );
    await filter(page, "ортопед", served);
    await expect(
      catalog(page).getByRole("button", { name: outsider!.name, exact: true }),
    ).toBeVisible();
  },
);

Given(
  /^a visitor whose remembered specialty is (.+)$/,
  async ({ page, host }, name: string) => {
    await open(page, host);
    const served = await book(page);
    const target = served.entries.find((entry) => entry.name === name.trim());
    expect(target, "original specialty is a real member").toBeDefined();
    await expand(page, served);
    const command = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/public/specialty-choice" &&
        response.request().method() === "POST",
    );
    await catalog(page)
      .getByRole("button", { name: target!.name, exact: true })
      .click();
    const response = await command;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toEqual({
      specialty: target!.id,
    });
    expect(await response.json()).toEqual({
      specialty: target,
      storedIn: "session",
    });
    await expect(catalog(page)).toHaveAttribute("data-state", "chosen");
    const cookies = await page.context().cookies();
    expect(cookies.some((cookie) => cookie.name === "__Host-ds_session")).toBe(
      false,
    );
    expect(
      cookies.find((cookie) => cookie.name === "__Host-ds_specialty"),
    ).toMatchObject({
      value: target!.id,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
    expect(await read<Choice>(page, "/v1/public/specialty-choice")).toEqual({
      specialty: target,
      storedIn: "session",
    });
  },
);

Then(
  /^the catalog is collapsed to a single row naming (.+)$/,
  async ({ page }, name: string) => {
    await expect(catalog(page)).toHaveAttribute("data-state", "chosen");
    await expect(page.getByTestId("specialty-chosen")).toHaveText(name.trim());
    await expect(search(page)).toHaveCount(0);
    await expect(catalog(page).getByTestId("specialty-entry")).toHaveCount(0);
  },
);

Then(
  "the row offers a «сменить» control and the line about the specialty and adjacent areas",
  async ({ page }) => {
    await expect(page.getByTestId("specialty-change")).toHaveAccessibleName(
      "сменить",
    );
    await expect(page.getByTestId("specialty-adjacency-note")).toHaveText(
      "Контент подобран по вашей специальности и смежным областям",
    );
  },
);

When("they activate «сменить»", async ({ page }) => {
  await page.getByTestId("specialty-change").click();
});

Then("the catalog re-opens in its full search-first form", async ({ page }) => {
  const served = await book(page);
  const before = await read<Choice>(page, "/v1/public/specialty-choice");
  await expect(catalog(page)).toHaveAttribute("data-state", "open");
  await expect(search(page)).toBeVisible();
  await expect(search(page)).toBeEditable();
  await expect(search(page)).toHaveValue("");
  await expect(catalog(page)).toHaveAttribute(
    "data-total",
    String(served.total),
  );
  const frequent = await read<{ entries: Specialty[] }>(
    page,
    "/v1/public/specialties/frequent",
  );
  await entries(page, frequent.entries);
  await expect(page.getByTestId("specialty-expand")).toHaveText(
    `Показать весь список — ${served.total}`,
  );
  await expand(page, served);
  await filter(page, "ортопед", served);
  expect(await read<Choice>(page, "/v1/public/specialty-choice")).toEqual(
    before,
  );
});
