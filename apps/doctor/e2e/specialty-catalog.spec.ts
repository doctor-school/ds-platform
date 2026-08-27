import { test, expect, type Page } from "@playwright/test";

/**
 * 017 EARS-4 / EARS-5 — the home-page specialty catalog in Stage-A variant Б,
 * in a real browser: the four §3 ready states (Open · Filtered · NoMatch ·
 * Expanded) plus Loading and the error render, and the two structural
 * guarantees EARS-4 makes about the REST of the page.
 *
 * Reads are mocked at the network boundary (`page.route`) rather than seeded:
 * the CI Playwright config for this app is backend-free by design
 * (`playwright.ci.config.ts`), and the api side of the contract is covered one
 * tier down by `apps/api/test/storefront/specialty-search.spec.ts` and the
 * matching rule one tier above that in `@ds/schemas`. What is under test here is
 * the storefront's rendering of the contract, not the contract.
 *
 * The fixture book is DELIBERATELY not the real nomenclature: every assertion
 * about a count derives from `BOOK.total` as this file serves it, so the suite
 * proves the surface BINDS to the served total rather than that the surface
 * happens to agree with today's seed. A hardcoded `118` anywhere here would
 * assert the exact thing EARS-4 forbids.
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
  ref(4, "Терапия"),
  ref(5, "Бактериология (сохраняется до 1 сентября 2028 г.)"),
  ref(6, "Другое", true),
];
const FREQUENT = [ENTRIES[0]!, ENTRIES[2]!, ENTRIES[3]!];
const BOOK = { entries: ENTRIES, total: ENTRIES.length };

/** The rule the api applies, mirrored here only to build fixture RESPONSES. */
function matches(name: string, query: string): boolean {
  const fold = (v: string) =>
    v.normalize("NFC").toLowerCase().replace(/ё/g, "е").trim();
  return fold(name).includes(fold(query));
}

async function serveCatalog(
  page: Page,
  options: {
    searchDelayMs?: number;
    onSearch?: (query: string) => void;
    failBook?: boolean;
    /** Read per request, so a test can fail a search and then let it recover. */
    searchFails?: () => boolean;
    /** Every reference the storefront submitted as a choice, in order. */
    onChoice?: (reference: string) => void;
  } = {},
) {
  // The hero's own read — unrelated to the catalog, but the page fetches it and
  // an unrouted request would make the hero's state noise in these assertions.
  await page.route(STATISTICS_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ doctors: 1, computedAt: "2026-08-27T09:00:00.000Z" }),
    }),
  );

  // The remembered-choice endpoint. This file's subject is the CATALOG, not the
  // memory (that is `specialty-memory.spec.ts`), so the handler is the minimum
  // that keeps the section resolvable: the read answers «nothing chosen yet», so
  // every case below opens on the full variant-Б form, and the write echoes the
  // entry back exactly as the api's contract does. Leaving it unrouted would
  // send a real POST at the dev proxy on the first chip activation.
  await page.route(CHOICE_ROUTE, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ specialty: null, storedIn: "none" }),
      });
      return;
    }
    const body = request.postDataJSON() as { specialty?: string };
    const reference = body?.specialty ?? "";
    options.onChoice?.(reference);
    const entry = ENTRIES.find((candidate) => candidate.id === reference);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ specialty: entry ?? null, storedIn: "session" }),
    });
  });

  // The three patterns are disjoint by construction — `**/v1/public/specialties`
  // matches that exact path only, so it cannot swallow `/frequent` or `/search`
  // however the handlers are ordered.
  await page.route(SEARCH_ROUTE, async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") ?? "";
    options.onSearch?.(query);
    if (options.searchFails?.()) {
      await route.abort("failed");
      return;
    }
    if (options.searchDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.searchDelayMs));
    }
    const found = ENTRIES.filter((entry) => matches(entry.name, query));
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
    options.failBook
      ? route.abort("failed")
      : route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(BOOK),
        }),
  );
}

/** Search is debounced, so a keystroke's effect is awaited, never slept on. */
async function typeQuery(page: Page, query: string) {
  await page.getByTestId("specialty-search").fill(query);
}

test.describe("017 EARS-4/5: the home specialty catalog (variant Б)", () => {
  test("017 EARS-4.1: Open — a labelled search field, the frequent set, and «Показать весь список — N» bound to the SERVED total", async ({
    page,
  }) => {
    await serveCatalog(page);
    await page.goto("/");

    const catalog = page.getByTestId("specialty-catalog");
    await expect(catalog).toHaveAttribute("data-state", "open");

    // A real accessible name, not a placeholder standing in for one.
    const field = page.getByRole("searchbox", { name: "Поиск специальности" });
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute("placeholder", "Начните вводить название");

    await expect(catalog.getByText("Частые специальности")).toBeVisible();
    const chips = page.getByTestId("specialty-entry");
    await expect(chips).toHaveCount(FREQUENT.length);
    for (const entry of FREQUENT) {
      await expect(chips.filter({ hasText: entry.name })).toHaveCount(1);
    }

    // N is the served book total, and it is NOT the number of chips on screen —
    // which is exactly what a count literal, or a count taken from the frequent
    // set, would produce.
    const expand = page.getByTestId("specialty-expand");
    await expect(expand).toHaveText(`Показать весь список — ${BOOK.total}`);
    expect(BOOK.total).not.toBe(FREQUENT.length);
    await expect(expand).toHaveAttribute("aria-expanded", "false");
  });

  test("017 EARS-4.2: Expanded — the control reveals the remainder INCLUDING «Другое», and collapses again", async ({
    page,
  }) => {
    await serveCatalog(page);
    await page.goto("/");

    await page.getByTestId("specialty-expand").click();

    const catalog = page.getByTestId("specialty-catalog");
    await expect(catalog).toHaveAttribute("data-state", "expanded");
    await expect(page.getByTestId("specialty-entry")).toHaveCount(BOOK.total);
    // «Другое» is reachable by expanding — it is a member of the book, not a
    // separate fallback bolted on beside it.
    await expect(
      page.getByTestId("specialty-entry").filter({ hasText: "Другое" }),
    ).toHaveCount(1);
    // The official wording is rendered VERBATIM, temporal qualifier and all.
    await expect(
      catalog.getByText("Бактериология (сохраняется до 1 сентября 2028 г.)"),
    ).toBeVisible();
    await expect(page.getByTestId("specialty-expand")).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await page.getByTestId("specialty-expand").click();
    await expect(catalog).toHaveAttribute("data-state", "open");
  });

  test("017 EARS-5.1: Filtered — typing narrows over the WHOLE book, not the frequent set, matching anywhere in the name", async ({
    page,
  }) => {
    const queries: string[] = [];
    await serveCatalog(page, { onSearch: (q) => queries.push(q) });
    await page.goto("/");
    await expect(page.getByTestId("specialty-catalog")).toHaveAttribute(
      "data-state",
      "open",
    );

    await typeQuery(page, "кардиолог");

    const catalog = page.getByTestId("specialty-catalog");
    await expect(catalog).toHaveAttribute("data-state", "filtered");
    const chips = page.getByTestId("specialty-entry");
    await expect(chips).toHaveCount(2);
    // «Детская кардиология» is NOT in the frequent set and the fragment is not
    // its prefix: it can only be here if the search ran over the whole book and
    // matched anywhere in the name.
    await expect(chips.filter({ hasText: "Детская кардиология" })).toHaveCount(1);
    expect(queries.at(-1)).toBe("кардиолог");
  });

  test("017 EARS-5.2: Filtered — case and «ё/е» are folded, and the fold reaches the server as typed", async ({
    page,
  }) => {
    await serveCatalog(page);
    await page.goto("/");

    await typeQuery(page, "ТЁРАПИЯ");

    await expect(page.getByTestId("specialty-catalog")).toHaveAttribute(
      "data-state",
      "filtered",
    );
    await expect(
      page.getByTestId("specialty-entry").filter({ hasText: "Терапия" }),
    ).toHaveCount(1);
  });

  test("017 EARS-5.3: NoMatch — plain Russian, the query stays editable, and «Другое» stays reachable", async ({
    page,
  }) => {
    await serveCatalog(page);
    await page.goto("/");

    await typeQuery(page, "щщщфывапролдж");

    const catalog = page.getByTestId("specialty-catalog");
    await expect(catalog).toHaveAttribute("data-state", "nomatch");
    await expect(page.getByTestId("specialty-no-match")).toHaveText(
      "Ничего не найдено. Проверьте написание или выберите «Другое».",
    );

    // The typed text is still in the field and still editable — the state is
    // recoverable by editing, not only by clearing.
    const field = page.getByRole("searchbox", { name: "Поиск специальности" });
    await expect(field).toHaveValue("щщщфывапролдж");
    await typeQuery(page, "неврол");
    await expect(catalog).toHaveAttribute("data-state", "filtered");
    await expect(
      page.getByTestId("specialty-entry").filter({ hasText: "Неврология" }),
    ).toHaveCount(1);

    // …and from a no-match the expand control still reaches «Другое», which is
    // the second route EARS-5 requires to every entry of the book.
    await typeQuery(page, "щщщфывапролдж");
    await expect(catalog).toHaveAttribute("data-state", "nomatch");
    await page.getByTestId("specialty-expand").click();
    await expect(catalog).toHaveAttribute("data-state", "expanded");
    await expect(field).toHaveValue("");
    await expect(
      page.getByTestId("specialty-entry").filter({ hasText: "Другое" }),
    ).toHaveCount(1);
  });

  test("017 EARS-5.4: clearing the query returns to Open with the frequent set", async ({
    page,
  }) => {
    await serveCatalog(page);
    await page.goto("/");

    await typeQuery(page, "кардиолог");
    await expect(page.getByTestId("specialty-catalog")).toHaveAttribute(
      "data-state",
      "filtered",
    );

    await typeQuery(page, "");
    await expect(page.getByTestId("specialty-catalog")).toHaveAttribute(
      "data-state",
      "open",
    );
    await expect(page.getByTestId("specialty-entry")).toHaveCount(
      FREQUENT.length,
    );
  });

  test("017 EARS-4.3: NO modal, backdrop or scroll lock in ANY state — the page stays scrollable with no choice made", async ({
    page,
  }) => {
    await serveCatalog(page);
    await page.goto("/");

    const scrollLocked = () =>
      page.evaluate(() => {
        const body = getComputedStyle(document.body);
        const root = getComputedStyle(document.documentElement);
        return (
          body.overflow === "hidden" ||
          root.overflow === "hidden" ||
          body.position === "fixed"
        );
      });

    for (const reach of [
      async () => {},
      async () => page.getByTestId("specialty-expand").click(),
      async () => typeQuery(page, "кардиолог"),
      async () => typeQuery(page, "щщщфывапролдж"),
    ]) {
      await reach();
      // No dialog, no backdrop, no interstitial — in any of the four states.
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(await scrollLocked()).toBe(false);
    }

    // The rest of the page is genuinely reachable without choosing anything:
    // the hero above and the footer below both render and the document scrolls.
    await typeQuery(page, "");
    await expect(page.getByTestId("storefront-hero")).toBeVisible();
    const scrollable = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight,
    );
    expect(scrollable).toBe(true);
  });

  test("017 EARS-4.4: Loading — a skeleton stands in, claims no entries, and resolves", async ({
    page,
  }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await serveCatalog(page);
    // Re-route the book behind a gate; the later registration wins.
    await page.route(BOOK_ROUTE, async (route) => {
      await held;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(BOOK),
      });
    });
    await page.goto("/");

    const catalog = page.getByTestId("specialty-catalog");
    await expect(catalog).toHaveAttribute("data-state", "loading");
    await expect(page.getByTestId("specialty-entry")).toHaveCount(0);
    // Not an unresolving spinner, and no count claimed before the read.
    await expect(catalog).not.toContainText("Показать весь список");

    release();
    await expect(catalog).toHaveAttribute("data-state", "open");
  });

  test("017 EARS-4.5: error — the catalog says so in Russian with a working retry, and the rest of the page is untouched", async ({
    page,
  }) => {
    await serveCatalog(page, { failBook: true });
    await page.goto("/");

    const catalog = page.getByTestId("specialty-catalog");
    await expect(catalog).toHaveAttribute("data-state", "error");
    await expect(page.getByTestId("specialty-catalog-error")).toHaveText(
      "Не удалось загрузить список специальностей.",
    );
    // No zero, no made-up count, no backend explanation.
    await expect(catalog).not.toContainText(/500|fetch|failed|— 0/i);

    // The page around it is entirely usable — EARS-4's «the rest of the home
    // page shall remain fully readable and scrollable».
    await expect(page.getByTestId("storefront-hero")).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Doctor.School — бесплатное образование для врачей",
      }),
    ).toBeVisible();

    // The retry is real: once the read succeeds, the catalog appears.
    await serveCatalog(page);
    await page.getByTestId("specialty-catalog-retry").click();
    await expect(catalog).toHaveAttribute("data-state", "open");
  });

  test("017 EARS-5.12: a failed SEARCH keeps the field, the query and the route to «Другое», and the retry re-runs the SEARCH", async ({
    page,
  }) => {
    let searchFails = true;
    const queries: string[] = [];
    await serveCatalog(page, {
      searchFails: () => searchFails,
      onSearch: (q) => queries.push(q),
    });
    await page.goto("/");

    await typeQuery(page, "кардиолог");

    const catalog = page.getByTestId("specialty-catalog");
    await expect(catalog).toHaveAttribute("data-state", "searchfailed");

    // The BOOK is fine, so the section is not replaced by the section-wide error
    // card: the field survives with the typed text still editable.
    const field = page.getByRole("searchbox", { name: "Поиск специальности" });
    await expect(field).toHaveValue("кардиолог");
    await expect(page.getByTestId("specialty-catalog-error")).toHaveCount(0);
    await expect(page.getByTestId("specialty-search-error")).toBeVisible();

    // The frequent set is NEVER presented as the matches for the query in the
    // field — a wrong answer is worse than a stated failure.
    await expect(page.getByTestId("specialty-entry")).toHaveCount(0);
    for (const entry of FREQUENT) {
      await expect(catalog).not.toContainText(entry.name);
    }

    // The second route to every entry, «Другое» included, is still on screen and
    // still bound to the served book total.
    await expect(page.getByTestId("specialty-expand")).toHaveText(
      `Показать весь список — ${BOOK.total}`,
    );

    // The retry re-issues the SEARCH — not only the book read, which would leave
    // the narrowing unresolved forever.
    const before = queries.length;
    searchFails = false;
    await page.getByTestId("specialty-search-retry").click();

    await expect(catalog).toHaveAttribute("data-state", "filtered");
    await expect(page.getByTestId("specialty-entry")).toHaveCount(2);
    expect(queries.length).toBeGreaterThan(before);
    expect(queries.at(-1)).toBe("кардиолог");
  });

  test("017 EARS-4.6: a chip is a real labelled control — reachable from the keyboard, and its activation IS the command", async ({
    page,
  }) => {
    const submitted: string[] = [];
    await serveCatalog(page, {
      onChoice: (reference) => submitted.push(reference),
    });
    await page.goto("/");

    // Every entry is a genuine, named interactive element — never a div with a
    // click handler — which is what makes the catalog keyboard-reachable at all.
    const chip = page.getByRole("button", { name: "Кардиология", exact: true });
    await expect(chip).toBeVisible();
    await chip.focus();
    await expect(chip).toBeFocused();

    // Activated from the KEYBOARD, and that alone records the choice: there is
    // no separate save control to tab to afterwards (EARS-7's «no separate save
    // step» is a keyboard promise too). What the recorded choice then does to
    // the section is `specialty-memory.spec.ts`'s subject; what this case holds
    // is that the chip is the control, not decoration in front of one.
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("specialty-chosen")).toHaveText("Кардиология");
    // The submitted reference is the entry's own identity, never its label.
    expect(submitted).toEqual([ENTRIES[0]!.id]);
  });
});
