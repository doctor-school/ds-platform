import { expect, test, type Page } from "@playwright/test";
import { signInAsAdmin } from "@ds/e2e/admin-events";

/**
 * 032 EARS-14 (#3492), with the EARS-1 / EARS-2 / EARS-3 journeys it covers —
 * the organisation registry and its role book on the REAL Refine → NestJS →
 * Postgres path: the «Организации» section in place of «Партнёры», a create with
 * a description, two roles and a display rule switched off, an edit that
 * replaces the role set, the role book (add, refused duplicate and empty
 * titles shown on the field, rename), and every one of these screens at a
 * 390 px phone width without horizontal scrolling of the page. The axe half of
 * EARS-14 is `e2e/a11y/a11y-axe.e2e.spec.ts` («the organisation registry …»).
 *
 * Dev-stand-gated like every `apps/admin/e2e` flow spec; run against a booted
 * admin + api with `--config=playwright.flows.config.ts`.
 *
 * `E2E_SHOT_DIR` opts into the captures the PR body cites; unset, the spec
 * still asserts.
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;
const NARROW = { width: 390, height: 844 };
const WIDE = { width: 1440, height: 900 };

/** The page itself never scrolls sideways (EARS-14). */
async function expectNoPageSideScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, `${page.url()} side-scrolls by ${overflow}px`).toBe(0);
}

/**
 * Toggle a design-system checkbox the way a mouse does: the input is `sr-only`
 * behind its painted box, so the wrapping label is the click target.
 */
async function toggle(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).locator("xpath=ancestor::label[1]").click();
}

/** The responsive-web evidence profile owes each screen in both schemes. */
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: `${SHOT_DIR}/${name}-${colorScheme}.png`,
      fullPage: true,
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test.describe.configure({ mode: "serial" });

test.describe("032 EARS-14 — the organisation registry in the live admin", () => {
  test("032 EARS-14: an operator registers an organisation with roles, edits it and keeps the role book, on desktop and at 390 px", async ({
    page,
  }) => {
    const stamp = Date.now();
    const roleTitle = `Производитель оборудования ${stamp}`;
    const renamedRole = `Производитель техники ${stamp}`;
    const title = `Клиника Здоровье ${stamp}`;

    await page.setViewportSize(WIDE);
    await signInAsAdmin(page);

    // ── org-nav: «Организации» and «Роли организаций», no «Партнёры» ───────
    await expect(page.getByTestId("nav-organisations")).toHaveText(
      "Организации",
    );
    await expect(page.getByTestId("nav-organisation-roles")).toHaveText(
      "Роли организаций",
    );
    await expect(page.getByTestId("nav-partners")).toHaveCount(0);
    await expect(
      page.locator("header").getByRole("link", { name: "Партнёры" }),
    ).toHaveCount(0);

    // ── org-roles: the seeded book with holder counts ──────────────────────
    await page.getByTestId("nav-organisation-roles").click();
    await page.waitForURL(/\/organisation-roles$/, { timeout: 20_000 });
    for (const seeded of [
      "Инвестор",
      "Клиническая площадка",
      "Образовательный лицензиат",
    ]) {
      await expect(page.getByTestId("organisation-roles-table")).toContainText(
        seeded,
      );
    }
    // The table row and the narrow card both carry the count; one is shown.
    await expect(
      page.getByTestId("role-count-investor").first(),
    ).toBeAttached();
    // The book has no search and no filter: its count stands alone, with no
    // empty filter box around it.
    await expect(page.getByTestId("organisation-roles-total")).toBeVisible();
    await expect(page.getByTestId("organisation-roles-filters")).toHaveCount(0);

    // ── EARS-3 reject: an empty title never leaves the browser ─────────────
    await page.getByTestId("organisation-roles-create").click();
    await page.waitForURL(/\/organisation-roles\/create$/, { timeout: 20_000 });
    await page.getByTestId("organisation-role-title").fill("   ");
    await page.getByTestId("submit-organisation-role").click();
    await expect(page.getByText("Обязательное поле.")).toBeVisible();
    expect(page.url()).toMatch(/\/organisation-roles\/create$/);

    // ── EARS-3 reject: a duplicate active title is refused ON the field ────
    await page.getByTestId("organisation-role-title").fill("инвестор");
    await page.getByTestId("submit-organisation-role").click();
    await expect(
      page.getByText("Роль с таким названием уже есть", { exact: false }),
    ).toBeVisible();
    await expect(page.getByTestId("organisation-role-title")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    // One message, on the field — no banner repeating it above the form.
    await expect(page.getByTestId("create-error")).toHaveCount(0);
    expect(page.url()).toMatch(/\/organisation-roles\/create$/);

    // ── EARS-3 accept: the new role joins the book ─────────────────────────
    await page.getByTestId("organisation-role-title").fill(roleTitle);
    await page.getByTestId("submit-organisation-role").click();
    await page.waitForURL(/\/organisation-roles$/, { timeout: 20_000 });
    await expect(page.getByTestId("organisation-roles-table")).toContainText(
      roleTitle,
    );
    await shot(page, "roles-desktop");

    // ── org-form: create with two roles, a description, the logo rule off ──
    await page.getByTestId("nav-organisations").click();
    await page.waitForURL(/\/organisations$/, { timeout: 20_000 });
    await page.getByTestId("organisations-create").click();
    await page.waitForURL(/\/organisations\/create$/, { timeout: 20_000 });
    // EARS-3: the role added a moment ago is offered at once.
    await expect(page.getByTestId("organisation-roles")).toContainText(
      roleTitle,
    );
    // EARS-1: both display rules are on by default.
    await expect(
      page.getByTestId("organisation-public-name-visible"),
    ).toBeChecked();
    await expect(
      page.getByTestId("organisation-public-logo-visible"),
    ).toBeChecked();
    // EARS-1 reject: an over-long description is refused on the field.
    await page.getByTestId("organisation-title").fill(title);
    await page.getByTestId("organisation-description").fill("д".repeat(1001));
    await page.getByTestId("submit-organisation").click();
    await expect(
      page.getByText("Слишком длинное значение", { exact: false }),
    ).toBeVisible();
    expect(page.url()).toMatch(/\/organisations\/create$/);

    await page
      .getByTestId("organisation-description")
      .fill("Многопрофильная клиника и учебная база.");
    await toggle(page, "organisation-role-clinical-base");
    await toggle(page, "organisation-role-educational-licensee");
    await toggle(page, "organisation-public-logo-visible");
    await shot(page, "form-desktop");
    await page.getByTestId("submit-organisation").click();

    // ── The created row on its detail: same values back from the server ────
    await page.waitForURL(/\/organisations\/[0-9a-f-]{36}$/, {
      timeout: 20_000,
    });
    const detailUrl = page.url();
    await expect(page.getByTestId("organisation-heading")).toHaveText(title);
    await expect(page.getByTestId("organisation-status")).toHaveText(
      "Черновик",
    );
    await expect(
      page.getByTestId("organisation-role-clinical-base"),
    ).toBeChecked();
    await expect(
      page.getByTestId("organisation-role-educational-licensee"),
    ).toBeChecked();
    await expect(
      page.getByTestId("organisation-role-investor"),
    ).not.toBeChecked();
    await expect(
      page.getByTestId("organisation-public-logo-visible"),
    ).not.toBeChecked();
    await expect(page.getByTestId("organisation-description")).toHaveValue(
      "Многопрофильная клиника и учебная база.",
    );

    // ── EARS-2: the next save REPLACES the set ─────────────────────────────
    await toggle(page, "organisation-role-educational-licensee");
    await toggle(page, "organisation-role-investor");
    await page.getByTestId("submit-organisation").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("organisation-role-investor")).toBeChecked();
    await expect(
      page.getByTestId("organisation-role-educational-licensee"),
    ).not.toBeChecked();

    // ── EARS-2: no save from a role book that has not loaded ───────────────
    // The set is replaced whole, so a save from a missing book would drop
    // every held role. Reject: the book request fails, the form says so and
    // cannot be saved. Accept: the retry loads it, the held roles are still
    // ticked, and a save keeps them.
    const isRoleBook = (url: URL) =>
      url.pathname.endsWith("/organisation-roles");
    await page.route(isRoleBook, (route) => route.abort("failed"));
    await page.reload();
    await expect(page.getByTestId("organisation-roles-error")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("submit-organisation")).toBeDisabled();
    await page.unroute(isRoleBook);
    await page.getByTestId("organisation-roles-retry").click();
    await expect(page.getByTestId("organisation-role-investor")).toBeChecked();
    await expect(
      page.getByTestId("organisation-role-clinical-base"),
    ).toBeChecked();
    await expect(page.getByTestId("submit-organisation")).toBeEnabled();
    // A slow book keeps the save disabled until it arrives.
    let releaseBook: () => void = () => {};
    const bookHeld = new Promise<void>((resolve) => (releaseBook = resolve));
    await page.route(isRoleBook, async (route) => {
      await bookHeld;
      await route.continue();
    });
    await page.reload();
    await page.getByTestId("organisation-form").waitFor();
    await expect(page.getByTestId("submit-organisation")).toBeDisabled();
    releaseBook();
    await expect(page.getByTestId("submit-organisation")).toBeEnabled();
    await page.unroute(isRoleBook);
    await page.getByTestId("organisation-description").fill("Учебная база.");
    await page.getByTestId("submit-organisation").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("organisation-role-investor")).toBeChecked();
    await expect(
      page.getByTestId("organisation-role-clinical-base"),
    ).toBeChecked();

    // ── org-list: «Название», «Роли», «Статус», «Обновлено» ───────────────
    await page.getByTestId("back-to-list").click();
    await page.waitForURL(/\/organisations$/, { timeout: 20_000 });
    for (const header of ["Название", "Роли", "Статус", "Обновлено"]) {
      await expect(
        page.getByRole("columnheader", { name: header, exact: true }),
      ).toBeVisible();
    }
    await page.getByRole("searchbox", { name: "Поиск" }).fill(title);
    await expect(page.getByTestId("organisations-table")).toContainText(title);
    await expect(page.getByTestId("organisations-table")).toContainText(
      "Инвестор, Клиническая площадка",
    );
    await shot(page, "list-desktop");

    // ── EARS-3 rename: same id, new title, shown on the organisation ───────
    await page.goto("/organisation-roles");
    await page
      .getByTestId("organisation-roles-table")
      .getByRole("link", { name: roleTitle })
      .click();
    await page.waitForURL(/\/organisation-roles\/[0-9a-f-]{36}$/, {
      timeout: 20_000,
    });
    const roleUrl = page.url();
    await page.getByTestId("organisation-role-title").fill(renamedRole);
    await page.getByTestId("submit-organisation-role").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await expect(page.getByTestId("organisation-role-heading")).toHaveText(
      renamedRole,
    );
    expect(page.url()).toBe(roleUrl);
    // Renaming onto another active title is refused on the field, too.
    await page.getByTestId("organisation-role-title").fill("Инвестор");
    await page.getByTestId("submit-organisation-role").click();
    await expect(
      page.getByText("Роль с таким названием уже есть", { exact: false }),
    ).toBeVisible();
    await expect(page.getByTestId("update-error")).toHaveCount(0);
    await expect(page.getByTestId("organisation-role-heading")).toHaveText(
      renamedRole,
    );

    // ── EARS-14: every screen at 390 px, no horizontal page scroll ─────────
    await page.setViewportSize(NARROW);
    await page.goto("/organisations");
    await page.getByTestId("organisations-filters").waitFor();
    await expectNoPageSideScroll(page);
    // The same row the desktop capture shows, not whatever else the stand holds.
    await page.getByRole("searchbox", { name: "Поиск" }).fill(title);
    await expect(page.getByTestId("organisations-table")).toContainText(title);
    await expectNoPageSideScroll(page);
    await shot(page, "list-mobile");

    await page.goto("/organisations/create");
    await page.getByTestId("organisation-form").waitFor();
    await expectNoPageSideScroll(page);
    await shot(page, "form-mobile");

    await page.goto(detailUrl);
    await page.getByTestId("organisation-form").waitFor();
    await expectNoPageSideScroll(page);

    await page.goto("/organisation-roles");
    await expect(page.getByTestId("organisation-roles-table")).toContainText(
      renamedRole,
    );
    await expectNoPageSideScroll(page);
    await shot(page, "roles-mobile");

    await page.goto("/organisation-roles/create");
    await page.getByTestId("organisation-role-form").waitFor();
    await expectNoPageSideScroll(page);

    await page.goto(roleUrl);
    await page.getByTestId("organisation-role-form").waitFor();
    await expectNoPageSideScroll(page);
  });
});
