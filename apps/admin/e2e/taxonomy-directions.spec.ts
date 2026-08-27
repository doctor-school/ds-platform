import { expect, test, type Page } from "@playwright/test";
import { bootstrapAdminSession } from "./support/admin-session";
import { totpCode } from "./support/totp";

/**
 * 012 EARS-3 (#1285) + 017 EARS-16…18 (#1483), browser half — the REAL
 * Refine → NestJS → Postgres path.
 *
 * The API e2e suites (`apps/api/test/taxonomy/directions.e2e-spec.ts`) prove the
 * contract against the API directly. This proves the operator-facing arc on the
 * running admin: sign in, create a direction, find the row through the block-tier
 * list (search applies INSTANTLY — there is no «Применить»), open it by clicking
 * the ROW rather than an action button, edit the same row (an If-Match round-trip)
 * and confirm the change survives a reload. Both refusal branches ride along — the
 * client-side reject (an over-long title never leaves the browser) and the SERVER
 * reject (a second direction whose title derives the same address comes back as a
 * Problem Details rendered as one actionable RU sentence).
 *
 * «Адрес страницы» is asserted ABSENT on every surface (017-design §9.3): the
 * server derives it from the Russian title and freezes it on first publish, so
 * there is no box, no preview and no derived-value note for the operator to reason
 * about. An assertion that it is gone is the deliverable, not an omission.
 *
 * The no-Delete assertion is part of the contract, not a nicety: 012 exposes no
 * DELETE route for any taxonomy entity, so no destructive affordance may exist
 * on either surface.
 *
 * Dev-stand-gated + MANUAL like every other `apps/admin/e2e` flow spec — the
 * bootstrap provisions a real `platform_admin` against the stand's Zitadel and
 * throws when `IDP_*` is absent. Run against a booted admin + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3201 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test e2e/taxonomy-directions.spec.ts \
 *     --config=playwright.flows.config.ts
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

test.describe("012 EARS-3 / 017 EARS-16…18 — curated direction authoring in the live admin", () => {
  test("EARS-16: an operator creates, finds and edits a curated direction through the real admin", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    // ── Reach the resource through the chrome, not by typing a URL ─────────
    await page.getByTestId("nav-directions").click();
    await page.waitForURL(/\/directions$/, { timeout: 20_000 });
    await expect(page.getByTestId("directions-filters")).toBeVisible();
    // The retired-rows toggle is OFF by default (Stage-A answer 4).
    await expect(page.getByTestId("directions-include-retired")).not.toBeChecked();
    // EARS-17: the bar applies instantly — no submit control exists on it.
    await expect(
      page.getByRole("button", { name: "Применить", exact: true }),
    ).toHaveCount(0);
    // EARS-16: single-action list ⇒ the row IS the action; no «Действия» column
    // and no per-row «Редактировать» button.
    await expect(
      page.getByRole("columnheader", { name: "Действия" }),
    ).toHaveCount(0);

    // ── Reject branch (client): garbage input never leaves the browser ─────
    await page.getByTestId("directions-create").click();
    await page.waitForURL(/\/directions\/create$/, { timeout: 20_000 });
    // The address is derived server-side and rendered nowhere (017-design §9.3).
    await expect(page.getByTestId("direction-slug")).toHaveCount(0);
    await expect(page.getByTestId("direction-slug-preview")).toHaveCount(0);
    await expect(page.getByText("Адрес страницы", { exact: false })).toHaveCount(
      0,
    );
    await page.getByTestId("direction-title").fill("х".repeat(121));
    await page.getByTestId("submit-direction").click();
    // RU inline error, and we are still on the create screen.
    await expect(
      page.getByText("Слишком длинное значение", { exact: false }),
    ).toBeVisible();
    expect(page.url()).toMatch(/\/directions\/create$/);

    // ── Accept branch ─────────────────────────────────────────────────────
    const suffix = Date.now();
    const title = `Кардиология ${suffix}`;
    await page.getByTestId("direction-title").fill(title);
    await page.getByTestId("submit-direction").click();

    // ── The created row renders on its own detail page ─────────────────────
    await page.waitForURL(/\/directions\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const detailUrl = page.url();
    await expect(page.getByTestId("direction-heading")).toHaveText(title);
    await expect(page.getByTestId("direction-status")).toHaveText("Черновик");
    // EARS-18: one section ⇒ no tab strip at all until «Публикация» (#1287)
    // brings the second one.
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.getByTestId("direction-slug")).toHaveCount(0);

    // ── No destructive affordance anywhere on the surface (012 §5.1) ───────
    await expect(page.getByRole("button", { name: /удалить/i })).toHaveCount(0);

    // ── The block-tier list finds it by search, with no «Применить» ────────
    await page.getByTestId("back-to-list").click();
    await page.waitForURL(/\/directions$/, { timeout: 20_000 });
    // The bar's search box is a block-owned control: it is addressed by its
    // accessible name, not by a testid the block does not accept.
    await page.getByRole("searchbox", { name: "Поиск" }).fill(title);
    await expect(page.getByTestId("directions-table")).toContainText(title);
    // The applied set renders as a removable chip the operator can undo.
    await expect(page.getByText("Выбрано:", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /удалить/i })).toHaveCount(0);

    // ── EARS-16: the whole ROW opens the record ───────────────────────────
    await page.getByText(title, { exact: false }).first().click();
    await page.waitForURL(/\/directions\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    expect(page.url()).toBe(detailUrl);

    // ── Edit the SAME row (If-Match round-trip), not a second one ──────────
    const editedTitle = `${title} и сосудистая медицина`;
    await page.getByTestId("direction-title").fill(editedTitle);
    await page.getByTestId("submit-direction").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("direction-title")).toHaveValue(editedTitle);
    // The row's identity did not move — an edit is an edit, not a re-create.
    expect(page.url()).toBe(detailUrl);

    // ── Reject branch (server): a title deriving a taken address ──────────
    // The operator never typed an address, so the refusal must still read as
    // one sentence about the direction rather than about an internal slug.
    await page.goto("/directions/create");
    await page.getByTestId("direction-title").fill(title);
    await page.getByTestId("submit-direction").click();
    await expect(page.getByTestId("create-error")).toHaveText(
      /адрес страницы уже занят/i,
    );
    // The operator stays on the form with their input intact — a refusal is a
    // correction prompt, not a lost draft.
    expect(page.url()).toMatch(/\/directions\/create$/);
    await expect(page.getByTestId("direction-title")).toHaveValue(title);
  });
});
