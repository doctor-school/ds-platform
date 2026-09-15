import { test, expect, type Page } from "@playwright/test";
import { LIVE_STAND, submitRegisterAndVerify } from "../support/doctor-session";
import {
  isDark,
  shellHeader,
  shellLogo,
  themeToggle,
  DISCOVERY_HREF,
  NAV_BROADCASTS,
  setMyDisplayName,
} from "../support/shell";

/**
 * 008 EARS-12 / EARS-14 · 017 EARS-1/EARS-12 — the ROUTE-VISIBILITY MATRIX of the
 * academy storefront's shared chrome (`@ds/storefront-shell`, #2180).
 *
 * `lib/shell-config.ts` declares `hiddenOnPaths` = the four auth surfaces plus
 * the starred room pattern; those routes carry their own chrome (`AuthShell`,
 * `room-header`) and a second header would be a duplicate landmark. Everywhere
 * else — including the discovery listing `/webinars` and an event page
 * `/webinars/:slug`, which the STARRED room pattern must NOT swallow — the
 * storefront header AND footer are both present.
 *
 * That last point is the reason this file exists rather than a unit test: the
 * package's `shell.test.tsx` pins the matcher's grammar on synthetic paths, but
 * only a real drive proves the ACADEMY's own patterns hit the academy's own
 * routes. The predecessor of this chrome hid itself with a hand-rolled prefix
 * check, which would have swallowed the listing.
 *
 * Tiering: the guest half needs only a running portal (`E2E_PORTAL_URL`); the
 * room half needs a session (a guest is bounced to `/login`, which would make the
 * absence assertion vacuous), so it rides the LIVE_STAND tier. Both `test.skip`
 * cleanly on a bare CI run.
 */

/** The four auth surfaces the academy config hides its chrome on. */
const AUTH_ROUTES = ["/login", "/register", "/verify", "/reset"] as const;

/** The seeded live room (the 006↔007 fixture seam), env-overridable exactly as
 *  `e2e/steps/room.steps.ts` overrides it, so a differently-seeded stand can
 *  retarget this drive without a code change. */
const SLUG_LIVE = process.env.E2E_ROOM_SLUG_LIVE ?? "seed-005-live";

/** Every chrome landmark the academy mounts, by the PACKAGE's test-ids. */
async function expectChromePresent(page: Page, where: string): Promise<void> {
  await expect(shellHeader(page), `header present on ${where}`).toBeVisible();
  await expect(page.getByTestId("shell-topbar")).toBeVisible();
  await expect(shellLogo(page)).toHaveAttribute("href", DISCOVERY_HREF);
  await expect(
    page.getByTestId("storefront-footer"),
    `footer present on ${where}`,
  ).toBeVisible();
  // 017 EARS-1: exactly ONE of each — no width-duplicated copy in the DOM.
  await expect(page.getByTestId("storefront-header")).toHaveCount(1);
  await expect(page.getByTestId("storefront-footer")).toHaveCount(1);
  await expect(page.getByTestId("theme-toggle")).toHaveCount(1);
}

/**
 * The first event-page href in the listing currently on screen, or `null` when
 * this tab carries none. The discovery cards are server-rendered, so the load
 * state is awaited first: an immediate count after `domcontentloaded` would race
 * the first paint and report a populated tab as empty.
 */
async function firstEventHref(page: Page): Promise<string | null> {
  await page.waitForLoadState("load");
  const links = page.locator('main a[href^="/webinars/"]');
  return (await links.count()) > 0 ? links.first().getAttribute("href") : null;
}

async function expectChromeAbsent(page: Page, where: string): Promise<void> {
  await expect(
    page.getByTestId("storefront-header"),
    `header absent on ${where}`,
  ).toHaveCount(0);
  await expect(
    page.getByTestId("storefront-footer"),
    `footer absent on ${where}`,
  ).toHaveCount(0);
}

test.describe("008 EARS-12 academy chrome route-visibility matrix (e2e)", () => {
  test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

  test("008 EARS-12: the chrome is absent on every auth surface, which carries its own", async ({
    page,
    context,
  }) => {
    await context.clearCookies();

    for (const route of AUTH_ROUTES) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      // The route really served itself — an absence assertion after a redirect
      // would prove nothing.
      expect(new URL(page.url()).pathname, `${route} serves itself`).toBe(
        route,
      );
      await expectChromeAbsent(page, route);
      // …and the surface really rendered its OWN chrome: `AuthShell`'s brand
      // panel stands in place of the storefront header (#237).
      await expect(page.getByTestId("auth-panel-wordmark")).toBeVisible();
    }
  });

  test("008 EARS-12/14: the chrome IS present on the discovery listing and on an event page — the room pattern does not swallow them", async ({
    page,
    context,
  }) => {
    await context.clearCookies();

    await page.goto(DISCOVERY_HREF, { waitUntil: "domcontentloaded" });
    await expectChromePresent(page, DISCOVERY_HREF);
    // The academy ships no header search (`search: null`) — the package must
    // render no input at all rather than one that submits nowhere.
    await expect(page.getByTestId("shell-search")).toHaveCount(0);
    await expect(
      shellHeader(page)
        .getByTestId("shell-nav-desktop")
        .getByRole("link", { name: NAV_BROADCASTS }),
    ).toHaveAttribute("href", DISCOVERY_HREF);

    // An EVENT page — one segment under the starred room pattern's parent.
    // `packages/db/src/seed/golden/now.ts` freezes `GOLDEN_NOW_DEFAULT`, so a
    // golden-seeded stand holds only PAST events: the default «Расписание» tab
    // is legitimately empty there and the event pages live under «Архив
    // записей». Take the schedule when it offers one, else the archive —
    // only BOTH being empty means the listing ships no event page at all.
    let slugHref = await firstEventHref(page);
    if (!slugHref) {
      await page.goto(`${DISCOVERY_HREF}?tab=past`, {
        waitUntil: "domcontentloaded",
      });
      slugHref = await firstEventHref(page);
    }
    expect(
      slugHref,
      "neither the schedule nor the archive offers an event page",
    ).toBeTruthy();
    await page.goto(slugHref!, { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe(slugHref);
    await expectChromePresent(page, slugHref!);
  });

  test("008 EARS-14: the footer's document links resolve, and the single cross-link reaches the doctor storefront", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(DISCOVERY_HREF, { waitUntil: "domcontentloaded" });

    const docs = page.getByTestId("footer-documents").getByRole("link");
    const count = await docs.count();
    expect(count, "the footer ships document links").toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const href = await docs.nth(i).getAttribute("href");
      expect(href, "every footer document link has a target").toBeTruthy();
      // Same-origin documents must actually resolve — an inert link in the
      // persistent chrome is the placeholder affordance AGENTS.md §6 forbids.
      const response = await page.request.get(href!.split("#")[0]!);
      expect(response.status(), `${href} resolves`).toBeLessThan(400);
    }

    // 017 EARS-12: exactly ONE crossing out of this storefront, absolute,
    // pointing at the doctor origin.
    const cross = page.getByTestId("footer-cross").getByRole("link");
    await expect(cross).toHaveCount(1);
    await expect(cross).toHaveAttribute("href", "https://doctor.school/");
  });

  test("008 EARS-14: the footer content column caps at the design-system container width on desktop", async ({
    page,
    context,
  }) => {
    // `--container-content` is 69rem = 1104px. The cap is a Tailwind UTILITY
    // resolved at build time, so only a rendered page can prove it reached the
    // stylesheet: a misspelled class name (the `--container-*` namespace yields
    // `max-w-content`, not `max-w-container-content`) leaves the column at
    // `max-width: none` with every unit test green — the giant wordmark then
    // spans the viewport (the #2180 Stage-B finding).
    await context.clearCookies();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(DISCOVERY_HREF, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByTestId("storefront-footer").locator("> div").first(),
    ).toHaveCSS("max-width", "1104px");
  });

  test("008 EARS-1: the BBM band is the canvas micro-size on the academy build too", async ({
    page,
    context,
  }) => {
    // Canvas `ds-shell.dc.html` line 16: `9px / 700 / .22em`. The utilities come
    // from tokens new in this PR and each host purges its OWN stylesheet
    // (`@source`, #2180), so the academy build has to prove them separately
    // from the doctor tier — the #2198 Stage-B finding was 13px caption ink.
    await context.clearCookies();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(DISCOVERY_HREF, { waitUntil: "domcontentloaded" });
    const topbar = page.getByTestId("shell-topbar");
    await expect(topbar).toHaveCSS("font-size", "9px");
    await expect(topbar).toHaveCSS("font-weight", "700");
    await expect(topbar).toHaveCSS("letter-spacing", "1.98px");
  });

  test("008 EARS-3: both themes keep every chrome landmark visible on the listing", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(DISCOVERY_HREF, { waitUntil: "domcontentloaded" });
    // …and then wait for the stream to finish in THIS test only: the toggle is
    // server-rendered, and a click fired before React attaches its handler is
    // simply lost (no `.dark`, `aria-pressed` stuck at `false`). Every other
    // test here reads the DOM rather than driving it, so they keep the cheaper
    // `domcontentloaded`. Looping the click is not the fix — each click toggles.
    await page.waitForLoadState("networkidle");

    // The portal's dark theme is CLASS-based (`.dark` on `<html>`), so a browser
    // `colorScheme` option is a no-op here — the toggle is the only real driver.
    const toggle = themeToggle(page);
    const before = await isDark(page);
    for (const expectDark of [!before, before]) {
      await toggle.click();
      await expect
        .poll(() => isDark(page), { message: "the toggle flips .dark live" })
        .toBe(expectDark);
      await expectChromePresent(
        page,
        `${DISCOVERY_HREF} (${expectDark ? "dark" : "light"})`,
      );
    }
  });

  test("008 EARS-11: the ≡ disclosure opens and closes at the mobile breakpoint, with the chrome still single", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(DISCOVERY_HREF, { waitUntil: "domcontentloaded" });

    await expectChromePresent(page, `${DISCOVERY_HREF} @375`);
    const menu = shellHeader(page).getByTestId("shell-mobile-menu");
    await expect(page.getByTestId("shell-nav-desktop")).toBeHidden();

    await menu.locator("summary").click();
    await expect(page.getByTestId("shell-nav-mobile")).toBeVisible();
    await menu.locator("summary").click();
    await expect(page.getByTestId("shell-nav-mobile")).toBeHidden();
  });
});

test.describe("008 EARS-12 academy chrome is absent inside the webinar room (e2e)", () => {
  test.skip(!LIVE_STAND, "requires a live portal + real Zitadel + Mailpit");

  test("008 EARS-12: `/webinars/:slug/room` carries its own chrome — the storefront header and footer are suppressed", async ({
    page,
  }) => {
    // The room's own 006 EARS-6 gate REDIRECTS anyone who is not a registered
    // doctor of a live event (guest → /login, unregistered → the event page), so
    // an absence assertion on a drive-by visit would be vacuous. Provision a
    // genuinely registered doctor through the real 003+005 flow — the same
    // mechanism `e2e/steps/room.steps.ts` drives — against the seeded live room.
    await page.goto(
      `/register?returnTo=${encodeURIComponent(`/webinars/${SLUG_LIVE}`)}`,
      { waitUntil: "domcontentloaded" },
    );
    await submitRegisterAndVerify(page);
    await page.waitForURL(new RegExp(`/webinars/${SLUG_LIVE}(?:$|[?#])`));

    // A freshly registered doctor carries NO display name, and the room's 006
    // EARS-14 just-in-time prompt then renders IN PLACE OF the room composition —
    // so the `room-header` assertion below would fail for a reason that has
    // nothing to do with the chrome matrix. Satisfy the precondition through the
    // shipped `PUT /v1/me/display-name` command, exactly as a doctor answering
    // the prompt would.
    await setMyDisplayName(page, "Тестовый Доктор");

    const eventPath = `/webinars/${SLUG_LIVE}`;
    const roomPath = `${eventPath}/room`;
    await page.goto(roomPath, { waitUntil: "domcontentloaded" });
    // The gate admitted us: the room really served itself at this path.
    expect(new URL(page.url()).pathname, "the room serves itself").toBe(
      roomPath,
    );
    await expectChromeAbsent(page, roomPath);
    // Its OWN chrome is what the doctor sees instead — the 006 `RoomHeaderBar`
    // (`packages/room/src/ui/room-header-bar.tsx`), a bare `<header>` inside the
    // room composition carrying the truthful exit link back to the event page.
    // It exposes no test id, so it is addressed the way a doctor perceives it.
    // RU copy = `apps/portal/messages/ru.json` → `room.exit`.
    const roomChrome = page.locator("main header");
    await expect(roomChrome).toHaveCount(1);
    await expect(
      roomChrome.getByRole("link", { name: "Выйти из комнаты" }),
    ).toHaveAttribute("href", eventPath);

    // …and its SIBLING event page keeps the chrome, proving the starred pattern
    // is segment-wise rather than a prefix match that would swallow the listing.
    await page.goto(eventPath, { waitUntil: "domcontentloaded" });
    await expectChromePresent(page, eventPath);
  });
});

/**
 * 017 EARS-1 / #2180 — ONE package, ONE geometry: the two storefronts must
 * render the shared chrome at IDENTICAL sizes.
 *
 * Before #2180 the header was one component with an `authCluster?: ReactNode`
 * slot, and each host hand-assembled its own chip into it: the academy's was
 * 194×44 and borderless, the doctor's 191×48 with a `border-2` — which dragged
 * the whole bar to 76px against the academy's 72 and shifted the toggle and the
 * `≡` by 2px. No unit test could see it: both hosts' trees were green, the
 * divergence lived in two different call sites' class strings.
 *
 * The fix is structural (the shell takes DATA and owns the markup), so the
 * regression proof has to be structural too: measure the SAME landmarks on BOTH
 * running storefronts and assert the boxes match exactly. A future host that
 * re-introduces a bespoke chip fails here, at the only place the difference is
 * observable.
 *
 * Tiering: needs both storefronts running (`E2E_PORTAL_URL` for this spec's
 * baseURL, `E2E_DOCTOR_URL` — the origin every `apps/doctor/playwright.*` config
 * reads — for the cross-origin half, reached by an absolute `page.goto`).
 */

/** The shared landmarks whose box must be identical on both storefronts. */
const SHARED_LANDMARKS = [
  "shell-topbar",
  "storefront-header",
  "shell-login",
  "theme-toggle",
] as const;

type ChromeGeometry = {
  heights: Record<string, number | null>;
  /** `summary` of `shell-mobile-menu` — the ≡ disclosure, addressed by element. */
  menuHeight: number | null;
  /** Signed distance between the topbar text's centre and its band's centre. */
  topbarCentreDelta: number | null;
  /** How many `shell-search` elements this host renders — the canvas gives the
   *  doctor one and the academy none, so this is a CONFIG difference, not drift. */
  searchCount: number;
  /** The search form's own box, when this host renders one. */
  searchHeight: number | null;
  /** The header's computed `row-gap` — what a re-flowed row costs in height. */
  headerRowGap: number | null;
};

async function measureChrome(page: Page, url: string): Promise<ChromeGeometry> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // The chip is the thing under test — wait for the guest branch to resolve, or
  // a client-side auth read would be measured mid-swap on one host only.
  await expect(page.getByTestId("shell-auth-cluster")).toHaveAttribute(
    "data-cluster",
    "guest",
  );

  const heights: Record<string, number | null> = {};
  for (const testId of SHARED_LANDMARKS) {
    const target = page.getByTestId(testId).first();
    heights[testId] = (await target.isVisible())
      ? ((await target.boundingBox())?.height ?? null)
      : null;
  }

  const menu = page.getByTestId("shell-mobile-menu").locator("summary");
  const menuHeight = (await menu.isVisible())
    ? ((await menu.boundingBox())?.height ?? null)
    : null;

  // The band is the topbar span's own box parent: the canvas puts the micro
  // type ON THE BAND, and a font-size that sits on the span instead leaves the
  // text riding the body's line-height strut — off-centre on both hosts, which
  // is exactly what the pr-2198 slot showed.
  const span = page.getByTestId("shell-topbar");
  const spanBox = await span.boundingBox();
  const bandBox = await span.locator("xpath=..").boundingBox();
  const topbarCentreDelta =
    spanBox && bandBox
      ? spanBox.y + spanBox.height / 2 - (bandBox.y + bandBox.height / 2)
      : null;

  const search = page.getByTestId("shell-search");
  const searchCount = await search.count();
  const searchHeight =
    searchCount > 0 && (await search.first().isVisible())
      ? ((await search.first().boundingBox())?.height ?? null)
      : null;
  const headerRowGap = await page
    .getByTestId("storefront-header")
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).rowGap));

  return {
    heights,
    menuHeight,
    topbarCentreDelta,
    searchCount,
    searchHeight,
    headerRowGap,
  };
}

test.describe("017 EARS-1 the two storefronts render one chrome geometry (e2e)", () => {
  test.skip(
    !process.env.E2E_PORTAL_URL || !process.env.E2E_DOCTOR_URL,
    "requires BOTH storefronts running",
  );

  for (const viewport of [
    // `mobileSearchRow` = the width at which the doctor's search re-flows onto
    // its own row, which is the ONE height the two hosts are allowed to differ
    // by. See the header assertion below.
    { width: 1440, height: 900, mobileSearchRow: false },
    { width: 375, height: 800, mobileSearchRow: true },
  ]) {
    test(`017 EARS-1.9: every shared chrome landmark has the same height on both storefronts at ${viewport.width}px`, async ({
      page,
      context,
    }) => {
      await context.clearCookies();
      await page.setViewportSize(viewport);

      const academy = await measureChrome(page, DISCOVERY_HREF);
      const doctor = await measureChrome(
        page,
        new URL("/", process.env.E2E_DOCTOR_URL!).toString(),
      );

      for (const testId of SHARED_LANDMARKS) {
        expect(
          academy.heights[testId],
          `${testId} is rendered on both storefronts at ${viewport.width}px`,
        ).not.toBeNull();
        // The header is the one landmark the CANVAS lets differ below `layout`:
        // `design-source/ds-shell.dc.html` gives the doctor host `search: true`
        // (l.188) and the academy `search: false` (l.202), and `mobileSearch:
        // h.search && m` (l.256) renders that search as its OWN row on mobile
        // (l.60–62). The difference is asserted exactly, just below.
        if (testId === "storefront-header" && viewport.mobileSearchRow)
          continue;
        expect(
          doctor.heights[testId],
          `${testId} height matches the academy at ${viewport.width}px`,
        ).toBe(academy.heights[testId]);
      }

      if (viewport.mobileSearchRow) {
        expect(
          academy.searchCount,
          "the academy renders no header search (canvas `search: false`)",
        ).toBe(0);
        expect(
          doctor.searchHeight,
          "the doctor's mobile search row is measurable",
        ).not.toBeNull();
        expect(
          doctor.heights["storefront-header"],
          "the header differs only by the mobile search row the canvas gives the doctor host",
        ).toBe(
          academy.heights["storefront-header"]! +
            doctor.searchHeight! +
            doctor.headerRowGap!,
        );
      }

      expect(
        doctor.menuHeight,
        `the ≡ disclosure matches the academy at ${viewport.width}px`,
      ).toBe(academy.menuHeight);
    });

    test(`017 EARS-1.10: the topbar text is vertically centred in its band on both storefronts at ${viewport.width}px`, async ({
      page,
      context,
    }) => {
      await context.clearCookies();
      await page.setViewportSize(viewport);

      for (const [host, url] of [
        ["academy", DISCOVERY_HREF],
        ["doctor", new URL("/", process.env.E2E_DOCTOR_URL!).toString()],
      ] as const) {
        const { topbarCentreDelta } = await measureChrome(page, url);
        expect(
          topbarCentreDelta,
          `${host} topbar text is measurable`,
        ).not.toBeNull();
        // Sub-pixel rounding is the only slack allowed; a line-height strut
        // pushes the text ~2.5px low, which this bound rejects.
        expect(
          Math.abs(topbarCentreDelta!),
          `${host} topbar text is centred in its band at ${viewport.width}px`,
        ).toBeLessThanOrEqual(1);
      }
    });
  }
});
