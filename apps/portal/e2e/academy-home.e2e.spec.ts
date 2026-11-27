import AxeBuilder from "@axe-core/playwright";
import { MAIN_LANDMARK_RULES } from "@ds/e2e";
import { expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * The Academy home at `/` (feature 029, which replaced the 013 landing): the
 * readability / axe sweep, the 048 rail layout and the shell slots. The 029
 * browser journeys (V-4…V-8) land with #4244; the 013 section, portrait and
 * partnership-form checks retired with those sections (029 EARS-1, EARS-8).
 */
test.describe("Academy home at /", () => {
  test.describe.configure({ mode: "serial" });
  test("EARS-4: the home shall remain readable at desktop and mobile in light and dark themes and pass axe", async ({
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
        // 048 EARS-14 — axe reads the feed section once its first read settled.
        await expect(
          page.getByRole("heading", { name: "Новости, блог и видео" }),
        ).toBeVisible();
        await expect(
          page.locator('[data-academy-section="feed"] [aria-busy="true"]'),
        ).toHaveCount(0);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);

        const results = await new AxeBuilder({ page })
          .options({ rules: MAIN_LANDMARK_RULES })
          .withTags(WCAG_TAGS)
          .exclude('[data-testid="academy-footer-wordmark"]')
          // #2189 — the shared shell's BBM topbar (#2180) keeps its
          // owner-accepted canvas contrast; leaf-scoped, every interactive
          // shell control stays IN the scan.
          .exclude('[data-testid="shell-topbar"]')
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

  test("048 EARS-14: on a 390 px phone the feed rail shows one row with the next card partly visible, no page scroll and no axe violation", async ({
    page,
  }) => {
    // A layout check, so the page of cards is fixed here; the real API read
    // is proven by the 048 material-pages contour.
    const data = Array.from({ length: 12 }, (_, i) => ({
      kind: "news",
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      title: `Материал ленты ${String(i + 1).padStart(2, "0")}`,
      publishedAt: new Date(Date.UTC(2026, 9, 27 - i, 9)).toISOString(),
      image: null,
      source: { platform: "academy", name: "Академия" },
      partner: null,
      href: `/materials/feed-${i + 1}`,
    }));
    await page.route(
      (url) => url.pathname === "/v1/public/feed",
      (route) => route.fulfill({ json: { data, nextCursor: "next-page" } }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const rail = page.getByRole("region", {
      name: "Новости, блог и видео: листайте влево и вправо, стрелки клавиатуры — по одной карточке",
    });
    await expect(rail.locator("[data-slot] > a")).toHaveCount(12);
    await expect(rail).toHaveAttribute("data-rows", "1");
    await expect(
      page.getByRole("button", { name: "Дальше, к более ранним материалам" }),
    ).toHaveCount(0);
    const layout = await rail.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const slots = [...el.querySelectorAll("[data-slot]")].map((slot) =>
        slot.getBoundingClientRect(),
      );
      return {
        rows: new Set(slots.map((slot) => Math.round(slot.top))).size,
        nextPartlyVisible:
          slots[1]!.left < box.right && slots[1]!.right > box.right + 1,
      };
    });
    expect(layout).toEqual({ rows: 1, nextPartlyVisible: true });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    const results = await new AxeBuilder({ page })
      .include('[data-academy-section="feed"]')
      .withTags(WCAG_TAGS)
      .analyze();
    expect(
      results.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.flatMap((node) => node.target),
      })),
    ).toEqual([]);
  });

  test("048 EARS-14 (#4191): on a desktop a few cards take one row and many cards two, the arrows page by whole columns and the last column stops at the right gutter", async ({
    page,
  }) => {
    // A layout check, so the feed is fixed here: N cards, no next page.
    let count = 3;
    const feed = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        kind: "news",
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        title: `Материал ленты ${String(i + 1).padStart(2, "0")}`,
        publishedAt: new Date(
          Date.UTC(2026, 9, 27, 9) - i * 3_600_000,
        ).toISOString(),
        image: null,
        source: { platform: "academy", name: "Академия" },
        partner: null,
        href: `/materials/feed-${i + 1}`,
      }));
    await page.route(
      (url) => url.pathname === "/v1/public/feed",
      (route) =>
        route.fulfill({ json: { data: feed(count), nextCursor: null } }),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    const rail = page.getByRole("region", {
      name: "Новости, блог и видео: листайте влево и вправо, стрелки клавиатуры — по одной карточке",
    });
    const layout = () =>
      rail.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const padEnd = parseFloat(getComputedStyle(el).paddingRight);
        const slots = [...el.querySelectorAll("[data-slot]")].map((slot) =>
          slot.getBoundingClientRect(),
        );
        return {
          rows: new Set(slots.map((slot) => Math.round(slot.top))).size,
          order: [...el.querySelectorAll("[data-slot] a")].map(
            (a) => a.textContent?.match(/Материал ленты (\d\d)/)?.[1] ?? "",
          ),
          scrollLeft: el.scrollLeft,
          max: el.scrollWidth - el.clientWidth,
          lastGap: Math.round(
            box.right - padEnd - Math.max(...slots.map((slot) => slot.right)),
          ),
        };
      });

    for (const n of [1, 3, 6]) {
      count = n;
      await page.goto("/");
      await expect(rail.locator("[data-slot] > a")).toHaveCount(n);
      await expect(rail).toHaveAttribute("data-rows", "1");
      const few = await layout();
      expect(few.rows).toBe(1);
      expect(few.order).toEqual(
        Array.from({ length: n }, (_, i) => String(i + 1).padStart(2, "0")),
      );
    }

    count = 37;
    await page.goto("/");
    await expect(rail.locator("[data-slot] > a")).toHaveCount(37);
    await expect(rail).toHaveAttribute("data-rows", "2");
    expect((await layout()).rows).toBe(2);

    const next = page.getByRole("button", {
      name: "Дальше, к более ранним материалам",
    });
    const steps: number[] = [];
    while (await next.isEnabled()) {
      const before = (await layout()).scrollLeft;
      await next.click();
      await expect
        .poll(async () => (await layout()).scrollLeft)
        .not.toBe(before);
      // Let the smooth scroll settle before reading the step.
      let settled = -1;
      await expect
        .poll(async () => {
          const now = (await layout()).scrollLeft;
          const done = now === settled;
          settled = now;
          return done;
        })
        .toBe(true);
      steps.push(settled - before);
    }
    const end = await layout();
    expect(end.scrollLeft).toBeCloseTo(end.max, 0);
    // The last column is flush with the right gutter.
    expect(Math.abs(end.lastGap)).toBeLessThanOrEqual(1);
    // Every page but the last one moves by the same whole-column width.
    const full = steps.slice(0, -1);
    expect(full.length).toBeGreaterThan(0);
    for (const step of full)
      expect(Math.abs(step - full[0]!)).toBeLessThanOrEqual(1);
    expect(steps.at(-1)!).toBeLessThanOrEqual(full[0]! + 1);
  });

  for (const width of [1440, 2000]) {
    test(`048 EARS-14 (#4191): at ${width} px on a paginated feed, → pages by the same whole-column step while later pages load, and the last page stops at the right gutter`, async ({
      page,
    }) => {
      // The real API shape: a first page of 12 with a cursor, then pages of 8
      // by cursor, 37 cards in all — the first → reaches past the loaded cards.
      const total = 37;
      const card = (i: number) => ({
        kind: "news",
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        title: `Материал ленты ${String(i + 1).padStart(2, "0")}`,
        publishedAt: new Date(
          Date.UTC(2026, 9, 27, 9) - i * 3_600_000,
        ).toISOString(),
        image: null,
        source: { platform: "academy", name: "Академия" },
        partner: null,
        href: `/materials/feed-${i + 1}`,
      });
      await page.route(
        (url) => url.pathname === "/v1/public/feed",
        async (route) => {
          const url = new URL(route.request().url());
          const from = Number(url.searchParams.get("cursor") ?? "0");
          const limit = Number(url.searchParams.get("limit"));
          const to = Math.min(total, from + limit);
          // A later page answers after a network-like delay.
          if (from > 0) await new Promise((done) => setTimeout(done, 250));
          await route.fulfill({
            json: {
              data: Array.from({ length: to - from }, (_, i) => card(from + i)),
              nextCursor: to < total ? String(to) : null,
            },
          });
        },
      );
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const rail = page.getByRole("region", {
        name: "Новости, блог и видео: листайте влево и вправо, стрелки клавиатуры — по одной карточке",
      });
      await expect(rail.locator("[data-slot] > a").first()).toBeVisible();
      await expect(rail).toHaveAttribute("data-rows", "2");
      const layout = () =>
        rail.evaluate((el) => {
          const box = el.getBoundingClientRect();
          const padEnd = parseFloat(getComputedStyle(el).paddingRight);
          const slots = [...el.querySelectorAll("[data-slot]")].map((slot) =>
            slot.getBoundingClientRect(),
          );
          return {
            scrollLeft: el.scrollLeft,
            max: el.scrollWidth - el.clientWidth,
            cards: el.querySelectorAll("[data-slot] > a").length,
            busy: el.getAttribute("aria-busy") === "true",
            lastGap: Math.round(
              box.right - padEnd - Math.max(...slots.map((slot) => slot.right)),
            ),
          };
        });
      const settle = async () => {
        // A → past the loaded cards pauses at the loaded edge while the next
        // page loads (one step may span two pages), then follows to its goal
        // (#4221): a slow runner's pause outlasts one poll interval, so a
        // position only counts as settled while the rail is not busy.
        let settled = -1;
        await expect
          .poll(
            async () => {
              const { scrollLeft: now, busy } = await layout();
              const done = !busy && now === settled;
              settled = busy ? -1 : now;
              return done;
            },
            { intervals: [400] },
          )
          .toBe(true);
        return settled;
      };

      const next = page.getByRole("button", {
        name: "Дальше, к более ранним материалам",
      });
      const steps: number[] = [];
      while (await next.isEnabled()) {
        const before = (await layout()).scrollLeft;
        await next.click();
        await expect
          .poll(async () => (await layout()).scrollLeft)
          .not.toBe(before);
        steps.push((await settle()) - before);
      }
      const end = await layout();
      test.info().annotations.push({
        type: "steps",
        description: `${steps.join(", ")}; end ${end.scrollLeft} = max ${end.max}`,
      });
      expect(end.cards).toBe(total);
      expect(end.scrollLeft).toBeCloseTo(end.max, 0);
      expect(Math.abs(end.lastGap)).toBeLessThanOrEqual(1);
      // Every page but the last one moves by the same whole-column width.
      const full = steps.slice(0, -1);
      expect(full.length).toBeGreaterThan(1);
      for (const step of full)
        expect(Math.abs(step - full[0]!), `steps ${steps}`).toBeLessThanOrEqual(
          1,
        );
      expect(steps.at(-1)!).toBeLessThanOrEqual(full[0]! + 1);

      // Home returns to the first card.
      await rail.focus();
      await page.keyboard.press("Home");
      expect(await settle()).toBe(0);
    });
  }

  test("#1877: parallel chrome mounts the app-shell header on / and on non-root routes", async ({
    page,
  }) => {
    await page.route("**/v1/auth/session", (route) =>
      route.fulfill({ status: 401, body: "" }),
    );
    await page.route("**/v1/me/profile", (route) =>
      route.fulfill({ status: 401, body: "" }),
    );

    await page.goto("/");

    const header = page.locator("header");
    await expect(page.getByTestId("storefront-logo")).toBeVisible();
    await expect(header).toHaveCount(1);
    // A guest gets the real «Войти» way-in — the interim stub's disabled
    // bespoke buttons are gone (#1877).
    await expect(page.getByTestId("shell-login")).toHaveAttribute(
      "href",
      "/login",
    );
    await expect(header.locator("button[disabled]")).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    const menu = page.getByTestId("shell-mobile-menu");
    await menu.locator("summary").click();
    const mobileNav = page.getByTestId("shell-nav-mobile");
    await expect(mobileNav).toBeVisible();
    await expect(mobileNav.getByRole("link")).toHaveText(["Эфиры"]);

    await page.setViewportSize({ width: 1440, height: 900 });
    // The non-root probe is `/documents`, not `/account`. Since #2027 PR 1.4 the
    // cabinet takes the guest decision on the SERVER (rule S1) and a guest never
    // reaches it — `/account` answers 307 to `/login?returnTo=%2Faccount`, and the
    // auth doors deliberately carry no storefront chrome, so the old probe would
    // now assert the shell on a page that is designed not to have one. That
    // bounce is pinned by `apps/portal/app/account/page.test.tsx`; what #1877
    // asserts here is the PARALLEL-ROUTE property, so the probe moves to a
    // non-root route a guest can actually open.
    await page.goto("/documents");

    await expect(page.getByTestId("storefront-logo")).toBeVisible();
    await expect(page.locator("header")).toHaveCount(1);
  });
  test("#2664: the @footer slot mounts the home footer on / only — a soft navigation away drops it", async ({
    page,
  }) => {
    await page.route("**/v1/auth/session", (route) =>
      route.fulfill({ status: 401, body: "" }),
    );
    await page.route("**/v1/me/profile", (route) =>
      route.fulfill({ status: 401, body: "" }),
    );

    await page.goto("/");
    await expect(page.getByTestId("academy-footer-wordmark")).toHaveCount(1);

    // A client-side navigation keeps the root layout mounted; an unmatched
    // parallel slot would keep its previous content, so the slot's catch-all
    // must replace the home footer with nothing.
    // The header's first nav item is a router link (a soft navigation); the
    // guest «Войти» is a document link to the sign-in entry (003 EARS-61,
    // #3172), so it cannot be the probe.
    const away = page
      .getByTestId("shell-nav-desktop")
      .getByRole("link")
      .first();
    const href = await away.getAttribute("href");
    expect(href, "a non-root destination").toMatch(/^\/[^/?#]/);
    await page.evaluate(() => {
      (window as Window & { __softProbe?: boolean }).__softProbe = true;
    });
    await away.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    expect(
      await page.evaluate(
        () => (window as Window & { __softProbe?: boolean }).__softProbe,
      ),
      "the navigation was client-side (the document survived)",
    ).toBe(true);
    await expect(page.getByTestId("academy-footer-wordmark")).toHaveCount(0);
  });
});
