import { test, expect } from "@playwright/test";

/**
 * 017 EARS-1 / EARS-12 — the storefront shell layout (`app/(storefront)/layout.tsx`).
 *
 * This is the browser tier of the shell contract: what only a rendered page can
 * prove — that the layout is actually mounted by the route, that exactly ONE
 * action cluster reaches the DOM, that the reserved search slot ships EMPTY
 * (LD-6), and that the whole document carries exactly ONE Academy crossing and
 * it lives in the footer (EARS-12).
 *
 * The signed-in branch is NOT exercised here on purpose: the cluster is resolved
 * on the SERVER from the `__Host-ds_session` cookie (ADR-0015 §4, design §1), so
 * a browser-side route mock cannot reach it and this Playwright tier is
 * backend-free (`playwright.ci.config.ts`). The both-branches assertion lives one
 * tier down, in `components/storefront-header.test.tsx`, which renders the header
 * for `guest` and `doctor` directly. Together they cover the EARS-1 invariant:
 * never both clusters, never neither.
 */

const GUEST_CLUSTER = ["Войти", "Регистрация"];
const DOCTOR_CLUSTER = ["Личный кабинет"];

test.describe("017 EARS-1: single storefront shell layout", () => {
  test("017 EARS-1.1: the shell renders logo, theme control and footer landmarks", async ({
    page,
  }) => {
    await page.goto("/");

    const header = page.getByTestId("storefront-header");
    await expect(header).toBeVisible();
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

  test("017 EARS-1.3: exactly one action cluster exists in the document", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("shell-action-cluster")).toHaveCount(1);
  });

  test("017 EARS-1.4: the search slot is reserved but empty (LD-6)", async ({
    page,
  }) => {
    await page.goto("/");

    const slot = page.getByTestId("shell-search-slot");
    await expect(slot).toHaveCount(1);
    // Reserved, not built: no input and no interactive control may ship in it
    // until the feature that owns the results surface lands (design §1 table).
    await expect(slot.locator("input, button, a, [role]")).toHaveCount(0);
    await expect(slot).toHaveText("");
  });

  test("017 EARS-1.5: the shell is the layout of the route, not a page-local header", async ({
    page,
  }) => {
    await page.goto("/");
    // The home route renders INSIDE the shell: its `main` is a descendant of the
    // shell wrapper, and the page contributes no second header/footer of its own.
    await expect(page.getByTestId("storefront-shell").locator("main")).toHaveCount(
      1,
    );
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
    await expect(page.getByTestId("storefront-footer").locator(
      'a[href^="https://academy.doctor.school"]',
    )).toHaveCount(1);
    await expect(page.getByTestId("storefront-header").locator(
      'a[href*="academy.doctor.school"]',
    )).toHaveCount(0);
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
