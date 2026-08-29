import { test, expect, type Page } from "@playwright/test";

/**
 * 017 EARS-6 / EARS-7 (#1482) — choosing a specialty and the collapsed row, in a
 * real browser: a choice is recorded with no separate save step, the catalog
 * collapses to the row naming it, «сменить» re-opens the full variant-Б catalog,
 * re-choosing re-targets, and «Другое» is named exactly like any other entry.
 *
 * Mocked at the network boundary (`page.route`) like `specialty-catalog.spec.ts`,
 * for the same reason: the CI config for this app is backend-free by design
 * (`playwright.ci.config.ts`). The api side of the contract — the guest cookie,
 * the profile link row, the LD-2 sign-in cascade — is covered one tier down by
 * `apps/api/test/storefront/specialty-choice.e2e-spec.ts`. What is under test
 * here is the storefront's BEHAVIOUR on the contract.
 *
 * The fixture keeps the remembered choice in a variable that the POST handler
 * writes and the GET handler serves, so «open the next visit targeted» is a real
 * round trip through a store, not an assertion about client state that survived
 * a re-render. `page.route` handlers outlive a reload, which is what makes the
 * return-visit case expressible without a backend.
 *
 * One thing this tier CANNOT exercise: the SERVER-side resolve in
 * `app/(storefront)/page.tsx`. A Next server fetch is not a browser request and
 * `page.route` never sees it, so with no api reachable it resolves «unknown» and
 * the catalog takes its documented degradation path — the client re-issues the
 * same read. That path is the one asserted here; the server path is asserted at
 * the api tier and on the live stand.
 */
const BOOK_ROUTE = "**/v1/public/specialties";
const FREQUENT_ROUTE = "**/v1/public/specialties/frequent";
const SEARCH_ROUTE = "**/v1/public/specialties/search*";
const CHOICE_ROUTE = "**/v1/public/specialty-choice";
const STATISTICS_ROUTE = "**/v1/public/statistics";

function ref(index: number, name: string, isOther = false) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    code: `code-${index}`,
    name,
    isOther,
  };
}

const ENTRIES = [
  ref(1, "Кардиология"),
  ref(2, "Детская кардиология"),
  ref(3, "Неврология"),
  ref(4, "Травматология и ортопедия"),
  ref(5, "Бактериология (сохраняется до 1 сентября 2028 г.)"),
  ref(6, "Другое", true),
];
const FREQUENT = [ENTRIES[0]!, ENTRIES[2]!, ENTRIES[3]!];
const BOOK = { entries: ENTRIES, total: ENTRIES.length };

/** Canvas copy (`design-source/doctor-home.dc.html` L87), transcribed. */
const ADJACENCY_NOTE =
  "Контент подобран по вашей специальности и смежным областям";

interface ChoiceStore {
  /** The remembered entry id, or `null` for «nothing chosen yet». */
  remembered: string | null;
  /** Every reference the storefront submitted, in order. */
  submitted: string[];
  /** When true the write fails — a refusal the surface must not paper over. */
  writeFails: boolean;
}

async function serveStorefront(page: Page): Promise<ChoiceStore> {
  const store: ChoiceStore = {
    remembered: null,
    submitted: [],
    writeFails: false,
  };

  await page.route(STATISTICS_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        doctors: 1,
        computedAt: "2026-08-27T09:00:00.000Z",
      }),
    }),
  );

  // The choice read/write pair. GET answers what the store holds — resolved back
  // to the book entry, exactly as the api does — and POST records it.
  await page.route(CHOICE_ROUTE, async (route) => {
    const request = route.request();

    if (request.method() === "POST") {
      const body = request.postDataJSON() as { specialty?: string };
      const reference = body?.specialty ?? "";
      store.submitted.push(reference);
      if (store.writeFails) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ status: 503, title: "unavailable" }),
        });
        return;
      }
      const entry = ENTRIES.find(
        (candidate) =>
          candidate.id === reference || candidate.code === reference,
      );
      if (!entry) {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            status: 422,
            title: "not in book",
            errorCode: "SPECIALTY_NOT_IN_BOOK",
            traceId: "t",
          }),
        });
        return;
      }
      store.remembered = entry.id;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ specialty: entry, storedIn: "session" }),
      });
      return;
    }

    const entry = ENTRIES.find((candidate) => candidate.id === store.remembered);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        entry
          ? { specialty: entry, storedIn: "session" }
          : { specialty: null, storedIn: "none" },
      ),
    });
  });

  await page.route(SEARCH_ROUTE, async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") ?? "";
    const fold = (value: string) =>
      value.normalize("NFC").toLowerCase().replace(/ё/g, "е").trim();
    const found = ENTRIES.filter((entry) =>
      fold(entry.name).includes(fold(query)),
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ query, entries: found, total: found.length }),
    });
  });

  await page.route(FREQUENT_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: FREQUENT }),
    }),
  );

  await page.route(BOOK_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(BOOK),
    }),
  );

  return store;
}

/** The collapsed row, as a whole: the state the section reports plus its parts. */
async function expectTargeted(page: Page, name: string) {
  const catalog = page.getByTestId("specialty-catalog");
  await expect(catalog).toHaveAttribute("data-state", "chosen");
  await expect(page.getByTestId("specialty-chosen")).toHaveText(name);
  await expect(page.getByTestId("specialty-change")).toBeVisible();
  // The full catalog is GONE, not merely scrolled past: no field, no chips.
  await expect(page.getByTestId("specialty-search")).toHaveCount(0);
  await expect(page.getByTestId("specialty-entry")).toHaveCount(0);
}

test.describe("017 EARS-6/7: remembering a chosen specialty (#1482)", () => {
  test("017 EARS-6.10: choosing records the choice and collapses the catalog — no separate save step", async ({
    page,
  }) => {
    const store = await serveStorefront(page);
    await page.goto("/");

    await expect(page.getByTestId("specialty-catalog")).toHaveAttribute(
      "data-state",
      "open",
    );
    // Nothing on the open catalog offers to save: the chip IS the command.
    await expect(page.getByTestId("specialty-catalog")).not.toContainText(
      /сохранить|подтвердить/i,
    );

    await page.getByRole("button", { name: "Кардиология", exact: true }).click();

    await expectTargeted(page, "Кардиология");
    // The submitted reference is the entry's own identity, never the label a
    // doctor read on screen.
    expect(store.submitted).toEqual([ENTRIES[0]!.id]);
    expect(store.remembered).toBe(ENTRIES[0]!.id);
  });

  test("017 EARS-6.11: the next visit opens targeted — the choice is read back, not re-asked", async ({
    page,
  }) => {
    const store = await serveStorefront(page);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Травматология и ортопедия", exact: true })
      .click();
    await expectTargeted(page, "Травматология и ортопедия");

    await page.reload();

    // A fresh document, and the catalog never renders its open form: the section
    // resolves the remembered choice before it draws anything to choose from.
    await expectTargeted(page, "Травматология и ортопедия");
    // No second write happened — opening a page is not choosing again.
    expect(store.submitted).toHaveLength(1);
  });

  test("017 EARS-7.1: the collapsed row carries the adjacency line and «сменить» re-opens the full variant-Б catalog", async ({
    page,
  }) => {
    await serveStorefront(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Неврология", exact: true }).click();
    await expectTargeted(page, "Неврология");

    await expect(page.getByTestId("specialty-adjacency-note")).toHaveText(
      ADJACENCY_NOTE,
    );

    await page.getByTestId("specialty-change").click();

    // The FULL variant-Б form comes back — the search field over the whole book,
    // the frequent set, and «Показать весь список — N» bound to the served total.
    const catalog = page.getByTestId("specialty-catalog");
    await expect(catalog).toHaveAttribute("data-state", "open");
    await expect(
      page.getByRole("searchbox", { name: "Поиск специальности" }),
    ).toBeVisible();
    await expect(page.getByTestId("specialty-entry")).toHaveCount(
      FREQUENT.length,
    );
    await expect(page.getByTestId("specialty-expand")).toHaveText(
      `Показать весь список — ${BOOK.total}`,
    );
  });

  test("017 EARS-7.2: choosing another entry re-targets and is remembered in turn", async ({
    page,
  }) => {
    const store = await serveStorefront(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Неврология", exact: true }).click();
    await expectTargeted(page, "Неврология");

    await page.getByTestId("specialty-change").click();
    await page.getByRole("button", { name: "Кардиология", exact: true }).click();

    await expectTargeted(page, "Кардиология");
    expect(store.remembered).toBe(ENTRIES[0]!.id);
    expect(store.submitted).toEqual([ENTRIES[2]!.id, ENTRIES[0]!.id]);

    // And the re-choice survives the next visit exactly like the first one did.
    await page.reload();
    await expectTargeted(page, "Кардиология");
  });

  test("017 EARS-7.3: «Другое» is remembered and named like any other choice (LD-5)", async ({
    page,
  }) => {
    const store = await serveStorefront(page);
    await page.goto("/");

    // «Другое» is reached the same way it always was — by expanding the book.
    await page.getByTestId("specialty-expand").click();
    await page.getByRole("button", { name: "Другое", exact: true }).click();

    await expectTargeted(page, "Другое");
    await expect(page.getByTestId("specialty-adjacency-note")).toHaveText(
      ADJACENCY_NOTE,
    );
    expect(store.remembered).toBe(ENTRIES[5]!.id);

    // Not a «no choice made» state wearing a label: it reads back like any other.
    await page.reload();
    await expectTargeted(page, "Другое");
  });

  test("017 EARS-6.12: a write that FAILED claims nothing — the catalog stays open and says so", async ({
    page,
  }) => {
    const store = await serveStorefront(page);
    store.writeFails = true;
    await page.goto("/");

    await page.getByRole("button", { name: "Кардиология", exact: true }).click();

    // No collapsed row, no targeted state: the platform did not remember it.
    const catalog = page.getByTestId("specialty-catalog");
    await expect(catalog).not.toHaveAttribute("data-state", "chosen");
    await expect(page.getByTestId("specialty-chosen")).toHaveCount(0);
    await expect(page.getByTestId("specialty-choice-error")).toHaveText(
      "Не удалось запомнить выбор. Попробуйте ещё раз.",
    );
    // The catalog is still fully usable — the choice can simply be re-made.
    await expect(page.getByTestId("specialty-entry")).toHaveCount(
      FREQUENT.length,
    );

    store.writeFails = false;
    await page.getByRole("button", { name: "Кардиология", exact: true }).click();
    await expectTargeted(page, "Кардиология");
    await expect(page.getByTestId("specialty-choice-error")).toHaveCount(0);
  });

  test("017 EARS-6.13: the rest of the page stays whole around the collapsed row, with no gate", async ({
    page,
  }) => {
    await serveStorefront(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Кардиология", exact: true }).click();
    await expectTargeted(page, "Кардиология");

    await expect(page.getByTestId("storefront-hero")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const scrollLocked = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      return body.overflow === "hidden" || body.position === "fixed";
    });
    expect(scrollLocked).toBe(false);
  });
});
