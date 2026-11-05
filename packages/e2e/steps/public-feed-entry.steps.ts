import { expect, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Given, When, Then, After } from "./support/fixtures.js";
import { chooseGuestSpecialty } from "../lib/specialty-choice.js";
import { waitForClientReady } from "../lib/page-ready.js";
import {
  feedEntryLog,
  feedEntryRoot,
  verifyFeedEntryProvenance,
  verifyManagedFeedEntryAdjacency,
  verifyOwnedFeedEntryListeners,
} from "../lib/feed-entry.js";

type Specialty = { id: string; code: string; name: string; isOther: boolean };
const state = new WeakMap<
  Page,
  { book: Specialty[]; chosen?: Specialty; commands: string[] }
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
    state.set(page, { book: [], commands: [] });
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

Given("a visitor with a remembered specialty", async ({ page, world }) => {
  const chosen = entry(page).book.find(
    (row) => row.name === "Травматология и ортопедия",
  );
  expect(chosen).toBeDefined();
  entry(page).chosen = chosen!;
  expect(
    await chooseGuestSpecialty(page, world.hostBaseUrl, chosen!.name),
  ).toBe(chosen!.code);
  await page.reload();
  expect(await remembered(page)).toEqual({
    specialty: chosen,
    storedIn: "session",
  });
});

When("they choose a specialty in the catalog", async ({ page }) => {
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
  /^the shell lands on that specialty's "\/feed\/<code>" showing the data-surface "specialty-feed" marker$/,
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

Then("the choice is remembered", async ({ page }) => {
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

After("@public-feed-entry", async ({ page, $testInfo }) => {
  const value = state.get(page);
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
    }),
    contentType: "application/json",
  });
});
