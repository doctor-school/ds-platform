import { expect, test, type Page } from "@playwright/test";
import { bootstrapAdminSession } from "./support/admin-session";
import { totpCode } from "./support/totp";
import { visible } from "./support/visible";

/**
 * 017 EARS-19 (LD-9), browser half — the Минздрав specialty book in the running
 * admin.
 *
 * There is no API e2e twin to lean on here, because the deliverable is not a new
 * endpoint: the page reads the SAME public projection the doctor-facing surfaces
 * read (`GET /v1/public/specialties`). What only a browser can prove is that the
 * screen is read-only ALL THE WAY DOWN — no create button, no row action, no
 * «Действия» column, no lifecycle facet, and rows that go nowhere, because the
 * nomenclature follows a ministerial order and the admin has (deliberately) no
 * route that would edit it. An affordance here would promise an edit the API
 * refuses, which is exactly the broken promise EARS-19 rules out.
 *
 * What the operator CAN do is look something up before wiring it to a direction
 * on «Связи специальностей», so the search half is asserted as a real capability:
 * typing a nomenclature CODE narrows the book (the names are near-identical and
 * only the code tells them apart) and the applied search is undoable as a chip.
 *
 * Dev-stand-gated + MANUAL like every other `apps/admin/e2e` flow spec — the
 * bootstrap provisions a real `platform_admin` against the stand's Zitadel and
 * throws when `IDP_*` is absent. Run against a booted admin + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3201 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     e2e/taxonomy-specialties.spec.ts --config=playwright.flows.config.ts
 */
const ORIGIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3200";

/** Sign in and complete the one-time TOTP enrollment; lands on `/events`. */
async function signInAsAdmin(page: Page): Promise<void> {
  const { email, password } = await bootstrapAdminSession(ORIGIN);
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/mfa\/enroll/, { timeout: 20_000 });
  const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
  await page
    .getByTestId("mfa-enroll-form")
    .getByRole("textbox")
    .fill(totpCode(secret));
  await page.waitForURL(/\/events/, { timeout: 20_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("017 EARS-19 — the Минздрав specialty book in the live admin", () => {
  test("EARS-19: an operator reads and searches the closed nomenclature and is offered no way to change it", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    // ── Reach the book through the chrome, not by typing a URL ─────────────
    await page.getByTestId("nav-specialties").click();
    await page.waitForURL(/\/specialties$/, { timeout: 20_000 });
    const bookUrl = page.url();

    // ── The screen SAYS it is a book, before the operator hunts for an edit ─
    await expect(page.getByTestId("specialties-notice")).toBeVisible();
    await expect(page.getByTestId("specialties-notice")).toContainText(
      "не редактируется",
    );

    // ── Read-only all the way down ────────────────────────────────────────
    await expect(page.getByTestId("specialties-create")).toHaveCount(0);
    await expect(
      page.getByRole("columnheader", { name: "Действия" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /удалить/i })).toHaveCount(0);
    // No lifecycle: a specialty is in the nomenclature or it is not, so neither
    // the «Состояние» facet nor the retired toggle may exist.
    await expect(page.getByTestId("specialties-status")).toHaveCount(0);
    await expect(page.getByTestId("specialties-include-retired")).toHaveCount(0);
    // EARS-17 readouts still stand — the operator is told how much book there is.
    await expect(page.getByTestId("specialties-total")).toBeVisible();
    // The pagination readout ships with each DataTable variant (see
    // `support/visible`) — assert the copy the operator reads.
    await expect(visible(page.getByTestId("specialties-page"))).toBeVisible();

    // ── The book carries real rows, and the code rides with each one ───────
    const table = page.getByTestId("specialties-table");
    await expect(table).toBeVisible();
    const firstRow = visible(page.locator("[data-testid^='row-']")).first();
    await expect(firstRow).toBeVisible();
    // Picked positionally: the nomenclature is the seed's to decide, and a
    // literal specialty name here would assert the seed rather than the screen.
    const rowText = await table.getByRole("row").nth(1).innerText();
    const code = /Код номенклатуры:\s*([^\s\n]+)/.exec(rowText)?.[1];
    if (!code) {
      throw new Error(
        `The row context line must carry the nomenclature code; got: ${rowText}`,
      );
    }

    // ── Search narrows the book by CODE, instantly and undoably ───────────
    await page.getByRole("searchbox", { name: "Поиск специальности" }).fill(code);
    // No «Применить» — the bar debounces and applies on its own.
    await expect(
      page.getByRole("button", { name: "Применить", exact: true }),
    ).toHaveCount(0);
    await expect(table).toContainText(code);
    await expect(page.getByText("Выбрано:", { exact: false })).toBeVisible();
    // A search nobody meant is one click away from being undone.
    await page.getByRole("button", { name: "Сбросить всё" }).click();
    await expect(page.getByText("Выбрано:", { exact: false })).toHaveCount(0);

    // ── Rows are INERT by design — there is no detail route to open ───────
    await visible(page.locator("[data-testid^='row-']")).first().click();
    await expect(page).toHaveURL(bookUrl);
  });
});
