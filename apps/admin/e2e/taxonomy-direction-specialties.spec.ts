import { expect, test, type Page } from "@playwright/test";
import { visible } from "./support/visible";
import { signInAsAdmin } from "./support/sign-in";

/**
 * #1483 (ADR-0016 §5) + 017 EARS-16…17, browser half — the REAL
 * Refine → NestJS → Postgres path for the direction↔specialty link.
 *
 * `apps/api/test/taxonomy/direction-relations.e2e-spec.ts` proves the contract
 * against the API. This proves the OPERATOR-facing arc, which no API test can:
 * that the specialty end is a CLOSED book (a select over the Минздрав
 * nomenclature, with no way to author a specialty from here), that an
 * unanswered select is refused in the browser with the sentence naming the
 * field rather than a generic «проверьте значение», that the duplicate pair
 * comes back as one actionable RU sentence, and that retire → restore moves the
 * SAME row rather than inserting a second one.
 *
 * On the block tier (#1578) the list half also proves the interaction model the
 * old submit-driven shell did not have: the direction facet APPLIES ON CHANGE
 * (there is no «Применить» control to click), the applied set is undoable as a
 * chip, and the whole ROW opens the link — a single-action list gets no
 * «Действия» column and no per-row button.
 *
 * Dev-stand-gated + MANUAL like every other `apps/admin/e2e` flow spec — the
 * bootstrap provisions a real `platform_admin` against the stand's Zitadel and
 * throws when `IDP_*` is absent. Run against a booted admin + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3201 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     e2e/taxonomy-direction-specialties.spec.ts --config=playwright.flows.config.ts
 */

/** A real direction row authored through the admin; returns its title. */
async function createDirection(page: Page, title: string): Promise<string> {
  await page.goto("/directions/create");
  await page.getByTestId("direction-title").fill(title);
  await page.getByTestId("submit-direction").click();
  await page.waitForURL(/\/directions\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return title;
}

test.describe.configure({ mode: "serial" });

test.describe("#1483 / 017 EARS-16…17 — direction↔specialty links in the live admin", () => {
  test("EARS-17: an operator links a direction to a Минздрав specialty, is refused the duplicate, and retires then restores the same link", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    const stamp = Date.now();
    const directionTitle = await createDirection(
      page,
      `Специальности направление ${stamp}`,
    );

    // ── Reach the resource through the chrome, not by typing a URL ─────────
    await page.getByTestId("nav-direction-specialties").click();
    await page.waitForURL(/\/direction-specialties$/, { timeout: 20_000 });
    await expect(
      page.getByTestId("direction-specialties-filters"),
    ).toBeVisible();
    // Retired rows are hidden until asked for — the shared list-shell default.
    await expect(
      page.getByTestId("direction-specialties-include-retired"),
    ).not.toBeChecked();
    // The list is a link register, not a text corpus: the list route accepts no
    // `q`, so the bar renders no search box rather than a dead one.
    await expect(page.getByRole("searchbox")).toHaveCount(0);
    // EARS-17: the bar applies instantly — no submit control exists on it.
    await expect(
      page.getByRole("button", { name: "Применить", exact: true }),
    ).toHaveCount(0);
    // EARS-16: single-action list ⇒ the row IS the action.
    await expect(
      page.getByRole("columnheader", { name: "Действия" }),
    ).toHaveCount(0);

    // ── Reject branch (client): an unanswered select never leaves the browser ─
    await page.getByTestId("direction-specialties-create").click();
    await page.waitForURL(/\/direction-specialties\/create$/, {
      timeout: 20_000,
    });
    await page.getByTestId("submit-direction-specialty").click();
    await expect(
      page.getByText("Выберите направление из списка.", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("Выберите специальность из списка.", { exact: false }),
    ).toBeVisible();
    expect(page.url()).toMatch(/\/direction-specialties\/create$/);

    // ── The specialty end is a CLOSED book ────────────────────────────────
    // The nomenclature is Минздрав's; the only affordance is choosing from it,
    // so the screen offers no way to author one.
    const specialtySelect = page.getByTestId("direction-specialty-specialty");
    await expect(
      page.getByRole("link", { name: /создать специальность/i }),
    ).toHaveCount(0);

    // ── Accept branch ─────────────────────────────────────────────────────
    await page
      .getByTestId("direction-specialty-direction")
      .selectOption({ label: directionTitle });
    // Picked positionally: the seeded nomenclature is the API's to decide, and a
    // literal specialty name here would assert the seed rather than the screen.
    const specialtyLabel = (
      await specialtySelect.locator("option").nth(1).innerText()
    ).trim();
    await specialtySelect.selectOption({ index: 1 });
    await page.getByTestId("submit-direction-specialty").click();

    await page.waitForURL(/\/direction-specialties\/[0-9a-f-]{36}$/, {
      timeout: 20_000,
    });
    const detailUrl = page.url();
    await expect(page.getByTestId("direction-specialty-direction")).toHaveText(
      directionTitle,
    );
    await expect(
      page.getByTestId("direction-specialty-specialty"),
    ).toContainText(specialtyLabel);
    await expect(page.getByTestId("direction-specialty-status")).toHaveText(
      "Действует",
    );
    // No DELETE route exists for any taxonomy entity, so no destructive
    // affordance may exist on the surface either.
    await expect(page.getByRole("button", { name: /удалить/i })).toHaveCount(0);

    // ── The list finds it through the direction facet, applied on change ──
    const linkId = detailUrl.slice(detailUrl.lastIndexOf("/") + 1);
    await page.goto("/direction-specialties");
    await page
      .getByTestId("direction-specialties-direction-filter")
      .selectOption({ label: directionTitle });
    // No «Применить»: choosing the direction IS the apply.
    await expect(page.getByTestId("direction-specialties-table")).toContainText(
      specialtyLabel,
    );
    // The applied facet renders as a removable chip the operator can undo.
    await expect(page.getByText("Выбрано:", { exact: false })).toBeVisible();

    // ── EARS-16: the whole ROW opens the link ─────────────────────────────
    // The DataTable block mounts both responsive variants (see `support/visible`),
    // so the row handle is scoped to the copy the operator can actually click.
    await visible(page.getByTestId(`row-${linkId}`)).click();
    await page.waitForURL(/\/direction-specialties\/[0-9a-f-]{36}$/, {
      timeout: 20_000,
    });
    expect(page.url()).toBe(detailUrl);

    // ── Reject branch (server): the duplicate pair is ONE RU sentence ─────
    await page.goto("/direction-specialties/create");
    await page
      .getByTestId("direction-specialty-direction")
      .selectOption({ label: directionTitle });
    await page
      .getByTestId("direction-specialty-specialty")
      .selectOption({ index: 1 });
    await page.getByTestId("submit-direction-specialty").click();
    await expect(page.getByTestId("create-error")).toHaveText(
      /такая связь уже заведена/i,
    );
    expect(page.url()).toMatch(/\/direction-specialties\/create$/);

    // ── Retire, then restore the SAME row ────────────────────────────────
    await page.goto(detailUrl);
    await page.getByTestId("relation-retire").click();
    await expect(page.getByTestId("direction-specialty-status")).toHaveText(
      "Снята",
    );
    // A two-state lifecycle offers exactly one move from either state.
    await expect(page.getByTestId("relation-retire")).toHaveCount(0);
    await expect(page.getByTestId("relation-restore")).toBeVisible();

    // The retired link left the ACTIVE list and is readable behind the toggle.
    await page.goto("/direction-specialties");
    await page
      .getByTestId("direction-specialties-direction-filter")
      .selectOption({ label: directionTitle });
    await expect(
      page.getByTestId("direction-specialties-table"),
    ).not.toContainText(specialtyLabel);
    // The DS `Switch` is a real checkbox rendered `sr-only` behind its painted
    // track, so a user (and this spec) clicks the wrapping label, not the input.
    await page
      .getByTestId("direction-specialties-include-retired")
      .locator("xpath=ancestor::label[1]")
      .click();
    await expect(page.getByTestId("direction-specialties-table")).toContainText(
      specialtyLabel,
    );

    await page.goto(detailUrl);
    await page.getByTestId("relation-restore").click();
    await expect(page.getByTestId("direction-specialty-status")).toHaveText(
      "Действует",
    );
    // Same URL ⇒ the same row came back; a restore is not a re-create.
    expect(page.url()).toBe(detailUrl);
  });
});
