import { test, expect } from "@playwright/test";

/**
 * 017 EARS-1 / EARS-12 · 008 EARS-3 / EARS-11 / EARS-14 — the doctor
 * storefront's mount of the SHARED chrome (`@ds/storefront-shell`, #2180 /
 * epic #2020), driven in a real browser.
 *
 * This is the browser tier of the shell contract on THIS host: what only a
 * rendered page can prove — that the `(storefront)` layout actually mounts the
 * package chrome, that exactly ONE action cluster reaches the DOM at every
 * width, that every configured target is a real route, that the theme control
 * flips and REMEMBERS the choice across a reload (the pre-paint FOUC guard, not
 * a post-hydration correction), and that the whole document carries exactly one
 * Academy crossing, in the footer (017 EARS-12).
 *
 * Backend-free tier (`playwright.ci.config.ts`): every assertion here holds
 * with no api behind the app. The SIGNED-IN half of the cluster is resolved on
 * the SERVER from `__Host-ds_session` (ADR-0015 §4), so it cannot be reached
 * without a real session — it is driven against a live stand in
 * `shell-live.spec.ts` and asserted for both branches one tier down in
 * `components/storefront-auth-cluster.test.tsx`. Together they cover the
 * EARS-1 invariant: never both clusters, never neither.
 *
 * Host values under test live in `lib/shell-config.ts` (`DOCTOR_SHELL`); the
 * composition they drive lives once, in the package.
 */

const GUEST_CLUSTER = ["Войти", "Регистрация"];
const DOCTOR_CLUSTER = ["Личный кабинет"];
/** The explicit theme choice the shared chrome persists (`@ds/storefront-shell/theme`). */
const THEME_KEY = "ds-theme";
const TO_DARK = "Включить тёмную тему";
const TO_LIGHT = "Включить светлую тему";

function isDark(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
}

test.describe("017 EARS-1: the doctor storefront mounts the shared chrome", () => {
  test("017 EARS-1.1: the shell renders the topbar, wordmark, theme control and footer landmarks", async ({
    page,
  }) => {
    await page.goto("/");

    const header = page.getByTestId("storefront-header");
    await expect(header).toBeVisible();
    // The chrome is painted with THIS host's identity — the one thing the
    // package carries about a host, and never a render branch.
    await expect(page.locator('[data-host="doctor"]').first()).toBeVisible();
    // The BBM announcement micro-band (the a11y-excluded leaf, Issue #2189).
    await expect(page.getByTestId("shell-topbar")).toHaveText(
      "BBM: Академия смыслов",
    );

    const logo = header.getByTestId("storefront-logo");
    await expect(logo).toHaveAttribute("href", "/");
    // The mark itself is the white vector wordmark on the navy band (canvas
    // `d-home · шапка`) — the link paints an image, not set text.
    await expect(logo.locator("img")).toHaveAttribute(
      "src",
      /\/brand\/logo-white\.svg/,
    );
    await expect(logo.locator("img")).toBeVisible();
    await expect(header.getByTestId("theme-toggle")).toBeVisible();
    await expect(page.getByTestId("storefront-footer")).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
  });

  test("017 EARS-1.2: a guest sees the guest cluster and NOTHING of the signed-in cluster", async ({
    page,
  }) => {
    await page.goto("/");

    const cluster = page.getByTestId("shell-action-cluster");
    await expect(cluster).toHaveAttribute("data-cluster", "guest");
    for (const label of GUEST_CLUSTER) {
      await expect(cluster.getByRole("link", { name: label })).toBeVisible();
    }
    for (const label of DOCTOR_CLUSTER) {
      await expect(page.getByRole("link", { name: label })).toHaveCount(0);
    }
  });

  test("017 EARS-1.3: exactly one action cluster exists in the document, at both widths", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("shell-action-cluster")).toHaveCount(1);
    await expect(page.getByTestId("shell-auth-cluster")).toHaveCount(1);

    // The canvas reaches its mobile layout by RE-FLOWING the one chrome bar,
    // never by rendering a second hidden cluster — which is what EARS-1 forbids.
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(page.getByTestId("shell-action-cluster")).toHaveCount(1);
  });

  test("017 EARS-1.4: the header search is a real form aimed at a shipped route", async ({
    page,
  }) => {
    await page.goto("/");

    // Exactly one search element at every width (the canvas re-flows it onto its
    // own row below `layout`, it does not duplicate it).
    const search = page.getByTestId("shell-search");
    await expect(search).toHaveCount(1);
    await expect(search).toHaveAttribute("role", "search");
    // `/events` is the one shipped surface answering a query today; the
    // dedicated results surface is #1492. A `#`-target input would be the
    // placeholder affordance AGENTS.md §6 forbids.
    await expect(search).toHaveAttribute("action", "/events");
    await expect(search.locator('input[name="q"]')).toBeVisible();

    await page.setViewportSize({ width: 375, height: 800 });
    await expect(page.getByTestId("shell-search")).toHaveCount(1);
  });

  test("017 EARS-1.5: the shell is the layout of the route, not a page-local header", async ({
    page,
  }) => {
    await page.goto("/");
    // The home route renders INSIDE the shell: its `main` is a descendant of the
    // shell wrapper, and the page contributes no second header/footer of its own.
    await expect(
      page.getByTestId("storefront-shell").locator("main"),
    ).toHaveCount(1);
    await expect(page.locator("header")).toHaveCount(1);
    await expect(page.locator("footer")).toHaveCount(1);
  });

  test("017 EARS-1.6: the footer carries the «Документы и контакты» links with real targets", async ({
    page,
  }) => {
    await page.goto("/");

    const docs = page.getByTestId("footer-documents");
    await expect(docs).toBeVisible();
    const links = docs.getByRole("link");
    await expect(links).not.toHaveCount(0);
    for (const href of await links.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("href")),
    )) {
      // A `#` placeholder target is a dead affordance, not a link.
      expect(href, "footer document link target").toBeTruthy();
      expect(href).not.toBe("#");
    }
    // …and they RESOLVE: the legal surface answers, it is not a 404 (#1967).
    const first = docs.getByRole("link").first();
    const href = await first.getAttribute("href");
    const response = await page.request.get(href!);
    expect(response.status(), `${href} resolves`).toBeLessThan(400);
  });

  test("017 EARS-1.7: «Разделы» repeats the header nav from the same config value (008 EARS-14)", async ({
    page,
  }) => {
    await page.goto("/");

    const desktopNav = page.getByTestId("shell-nav-desktop");
    const navHrefs = await desktopNav
      .getByRole("link")
      .evaluateAll((els) => els.map((a) => a.getAttribute("href")));
    const footerHrefs = await page
      .getByTestId("footer-sections")
      .getByRole("link")
      .evaluateAll((els) => els.map((a) => a.getAttribute("href")));
    expect(navHrefs).toEqual(["/events"]);
    // One config value feeds both lists, so they cannot drift apart.
    expect(footerHrefs).toEqual(navHrefs);
  });

  test("017 EARS-1.8: the giant wordmark and brand note render this host's values", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("footer-giant")).toHaveText("Doctor.School");
    await expect(page.getByTestId("footer-note")).toContainText(
      "Бесплатное образование для врачей.",
    );
  });
});

test.describe("017 EARS-2: every configured chrome target is a real route", () => {
  test("017 EARS-2.1: the nav «Эфиры» navigates to the shipped events listing", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByTestId("shell-nav-desktop")
      .getByRole("link", { name: "Эфиры" })
      .click();
    await expect(page).toHaveURL(/\/events(?:$|[?#])/);
    // The chrome rides the destination too — it is the route group's layout.
    await expect(page.getByTestId("storefront-header")).toBeVisible();
  });

  test("017 EARS-2.2: the wordmark returns to the host home", async ({
    page,
  }) => {
    await page.goto("/events");
    await page.getByTestId("storefront-logo").click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("017 EARS-2.3: the guest cluster targets navigate to the shipped auth surfaces", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByTestId("shell-action-cluster")
      .getByRole("link", { name: "Войти" })
      .click();
    await expect(page).toHaveURL(/\/login(?:$|[?#])/);

    await page.goto("/");
    await page
      .getByTestId("shell-action-cluster")
      .getByRole("link", { name: "Регистрация" })
      .click();
    await expect(page).toHaveURL(/\/register(?:$|[?#])/);
  });
});

test.describe("017 EARS-11: the mobile nav disclosure", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("017 EARS-11.1: below the layout breakpoint the nav collapses into the ≡ disclosure, opens, navigates and closes", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByTestId("shell-nav-desktop")).toBeHidden();
    const menu = page.getByTestId("shell-mobile-menu");
    await expect(menu).toBeVisible();
    // Closed until asked: the dropdown's items are not on the surface.
    await expect(page.getByTestId("shell-nav-mobile")).toBeHidden();

    await menu.locator("summary").click();
    const mobileNav = page.getByTestId("shell-nav-mobile");
    await expect(mobileNav).toBeVisible();
    // The SAME configured targets as the desktop nav — one config value.
    await expect(mobileNav.getByRole("link")).toHaveCount(1);
    await expect(mobileNav.getByRole("link", { name: "Эфиры" })).toHaveAttribute(
      "href",
      "/events",
    );

    // It closes again — a native `<details>`, trapping nothing.
    await menu.locator("summary").click();
    await expect(mobileNav).toBeHidden();

    // …and its target actually navigates.
    await menu.locator("summary").click();
    await mobileNav.getByRole("link", { name: "Эфиры" }).click();
    await expect(page).toHaveURL(/\/events(?:$|[?#])/);
  });
});

test.describe("008 EARS-3: the shared theme control on this host", () => {
  test("008 EARS-3.1: the toggle flips the theme, persists the choice and survives a reload without a flash", async ({
    page,
  }) => {
    await page.goto("/");

    const toggle = page.getByTestId("theme-toggle");
    await expect(toggle).toBeVisible();
    // A fresh visit is LIGHT: the storefront default is the canvas default, and
    // the absence of a stored choice means light.
    expect(await isDark(page)).toBe(false);
    await expect(toggle).toHaveAttribute("aria-label", TO_DARK);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();
    await expect
      .poll(() => isDark(page), { message: "the toggle flips .dark live" })
      .toBe(true);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveAttribute("aria-label", TO_LIGHT);
    expect(
      await page.evaluate((key) => window.localStorage.getItem(key), THEME_KEY),
    ).toBe("dark");

    // The FOUC guard: the choice is applied by the pre-paint inline script, so
    // `.dark` is on `<html>` at the FIRST parsed byte, not after hydration.
    await page.goto("/", { waitUntil: "commit" });
    expect(
      await page.evaluate(() =>
        document.documentElement.classList.contains("dark"),
      ),
      "dark is applied before paint, not corrected after hydration",
    ).toBe(true);
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // …and it rides navigation inside the storefront.
    await page.goto("/events");
    expect(await isDark(page)).toBe(true);

    // Flipping back is equally remembered.
    await page.goto("/");
    await page.getByTestId("theme-toggle").click();
    await expect.poll(() => isDark(page)).toBe(false);
    expect(
      await page.evaluate((key) => window.localStorage.getItem(key), THEME_KEY),
    ).toBe("light");
  });

  test("008 EARS-3.2: the whole chrome renders in DARK as well as light", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("theme-toggle").click();
    await expect.poll(() => isDark(page)).toBe(true);

    // Every chrome landmark is still on the surface in the dark theme — the
    // theme changes tokens, never the composition.
    for (const testId of [
      "shell-topbar",
      "storefront-header",
      "storefront-logo",
      "shell-search",
      "shell-nav-desktop",
      "shell-action-cluster",
      "storefront-footer",
      "footer-sections",
      "footer-documents",
      "footer-cross",
      "footer-note",
    ]) {
      await expect(page.getByTestId(testId), `${testId} in dark`).toBeVisible();
    }
  });
});

test.describe("017 EARS-1: the chrome is scoped to the storefront route group", () => {
  test("017 EARS-1.9: the auth surfaces carry their own chrome, not the storefront shell", async ({
    page,
  }) => {
    // `/login` and `/register` live OUTSIDE `app/(storefront)/`, so the shared
    // chrome is absent by construction — no `hiddenOnPaths` and therefore no
    // client route boundary is added to this host for it.
    for (const route of ["/login", "/register"]) {
      await page.goto(route);
      await expect(
        page.getByTestId("storefront-header"),
        `no storefront chrome on ${route}`,
      ).toHaveCount(0);
      await expect(page.getByTestId("storefront-footer")).toHaveCount(0);
    }
  });
});

test.describe("017 EARS-12: exactly one Academy crossing", () => {
  test("017 EARS-12.1: exactly one Academy link exists and it lives in the footer", async ({
    page,
  }) => {
    await page.goto("/");

    const academy = page.locator('a[href^="https://academy.doctor.school"]');
    await expect(academy).toHaveCount(1);
    await expect(academy).toHaveAttribute(
      "href",
      "https://academy.doctor.school/",
    );
    await expect(
      page
        .getByTestId("storefront-footer")
        .locator('a[href^="https://academy.doctor.school"]'),
    ).toHaveCount(1);
    await expect(
      page
        .getByTestId("storefront-header")
        .locator('a[href*="academy.doctor.school"]'),
    ).toHaveCount(0);
    // The crossing sits in its own footer column with its explanatory note.
    await expect(page.getByTestId("footer-cross")).toContainText(
      "Academy.Doctor.School",
    );
  });

  test("017 EARS-12.2: the storefront carries no Academy navigation entry or content block", async ({
    page,
  }) => {
    await page.goto("/");
    // One mention only — the footer link itself. Any Academy nav entry or content
    // block would add a second occurrence of the word on the surface.
    const mentions = await page
      .locator("body")
      .innerText()
      .then((text) => text.match(/Academy/gi) ?? []);
    expect(mentions.length, "Academy mentions on the storefront").toBe(1);
  });
});
