import { expect, test, type Page } from "@playwright/test";
import { bootstrapAdminSession } from "./support/admin-session";
import { totpCode } from "./support/totp";

/**
 * #1483 (ADR-0016 §5), browser half — the REAL Refine → NestJS → Postgres path
 * for the DIRECTED direction↔direction adjacency edge.
 *
 * `apps/api/test/taxonomy/direction-relations.e2e-spec.ts` proves the contract
 * against the API. This proves what only the browser can: that the self-edge is
 * refused before it leaves the form with the sentence naming WHY, that the
 * weight box refuses a non-integer, that an edge's ENDS are locked once
 * authored (only `kind`/`weight` are editable — «переставить» means retire and
 * re-author), and that a RETIRED edge shows its kind/weight as read-only text
 * instead of an edit form that could only ever come back 409.
 *
 * Dev-stand-gated + MANUAL like every other `apps/admin/e2e` flow spec — the
 * bootstrap provisions a real `platform_admin` against the stand's Zitadel and
 * throws when `IDP_*` is absent. Run against a booted admin + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3201 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     e2e/taxonomy-direction-adjacency.spec.ts --config=playwright.flows.config.ts
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

/** A real direction row authored through the admin; returns its title. */
async function createDirection(page: Page, title: string): Promise<string> {
  await page.goto("/directions/create");
  await page.getByTestId("direction-title").fill(title);
  await page.getByTestId("submit-direction").click();
  await page.waitForURL(/\/directions\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return title;
}

test.describe.configure({ mode: "serial" });

test.describe("#1483 — direction adjacency in the live admin", () => {
  test("#1483: an operator authors a directed adjacency edge, is refused the self-edge, edits kind/weight and retires it", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    const stamp = Date.now();
    const source = await createDirection(page, `Смежность источник ${stamp}`);
    const target = await createDirection(page, `Смежность цель ${stamp}`);

    // ── Reach the resource through the chrome, not by typing a URL ─────────
    await page.getByTestId("nav-direction-adjacency").click();
    await page.waitForURL(/\/direction-adjacency$/, { timeout: 20_000 });
    await expect(page.getByTestId("direction-adjacency-filters")).toBeVisible();
    await expect(
      page.getByTestId("direction-adjacency-include-retired"),
    ).not.toBeChecked();
    // The list states the DIRECTED contract in words, because an operator who
    // reads it as symmetric would author half the graph they meant to.
    await expect(
      page.getByText("Связь направленная", { exact: false }),
    ).toBeVisible();

    // ── Reject branch (client): the self-edge and a non-integer weight ────
    await page.getByTestId("direction-adjacency-create").click();
    await page.waitForURL(/\/direction-adjacency\/create$/, {
      timeout: 20_000,
    });
    await page
      .getByTestId("direction-adjacency-direction")
      .selectOption({ label: source });
    await page
      .getByTestId("direction-adjacency-adjacent")
      .selectOption({ label: source });
    await page.getByTestId("direction-adjacency-kind").fill("related");
    await page.getByTestId("direction-adjacency-weight").fill("7,5");
    await page.getByTestId("submit-direction-adjacency").click();
    await expect(
      page.getByText("Направление не бывает смежным самому себе", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Введите целое число от 1 до 100.", { exact: false }),
    ).toBeVisible();
    expect(page.url()).toMatch(/\/direction-adjacency\/create$/);

    // ── Accept branch ─────────────────────────────────────────────────────
    await page
      .getByTestId("direction-adjacency-adjacent")
      .selectOption({ label: target });
    await page.getByTestId("direction-adjacency-weight").fill("40");
    await page.getByTestId("submit-direction-adjacency").click();
    await page.waitForURL(/\/direction-adjacency\/[0-9a-f-]{36}$/, {
      timeout: 20_000,
    });
    const detailUrl = page.url();
    await expect(page.getByTestId("direction-adjacency-status")).toHaveText(
      "Действует",
    );
    await expect(page.getByTestId("direction-adjacency-kind")).toHaveValue(
      "related",
    );
    await expect(page.getByTestId("direction-adjacency-weight")).toHaveValue(
      "40",
    );
    await expect(page.getByRole("button", { name: /удалить/i })).toHaveCount(0);

    // ── The ENDS are locked on an authored edge ───────────────────────────
    // Reversing an edge means retiring this one and authoring the reverse, and
    // the screen says so rather than offering a control the API would refuse.
    await expect(
      page.getByTestId("direction-adjacency-direction"),
    ).toBeDisabled();
    await expect(
      page.getByTestId("direction-adjacency-adjacent"),
    ).toBeDisabled();
    await expect(
      page.getByText("Стороны связи не меняются", { exact: false }),
    ).toBeVisible();

    // ── Edit the SAME row (If-Match round-trip), not a second one ─────────
    await page.getByTestId("direction-adjacency-weight").fill("80");
    await page.getByTestId("submit-direction-adjacency").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("direction-adjacency-weight")).toHaveValue(
      "80",
    );
    expect(page.url()).toBe(detailUrl);

    // ── The list finds it through the source-side direction filter ───────
    await page.goto("/direction-adjacency");
    await page
      .getByTestId("direction-adjacency-direction-filter")
      .selectOption({ label: source });
    await page.getByTestId("direction-adjacency-apply").click();
    await expect(page.getByTestId("direction-adjacency-table")).toContainText(
      target,
    );
    // DIRECTED: the reverse edge was never authored, so filtering by the target
    // side finds nothing — the graph says exactly what the operator entered.
    await page
      .getByTestId("direction-adjacency-direction-filter")
      .selectOption({ label: target });
    await page.getByTestId("direction-adjacency-apply").click();
    await expect(page.getByTestId("direction-adjacency-empty")).toBeVisible();

    // ── Reject branch (server): the duplicate edge is ONE RU sentence ─────
    await page.goto("/direction-adjacency/create");
    await page
      .getByTestId("direction-adjacency-direction")
      .selectOption({ label: source });
    await page
      .getByTestId("direction-adjacency-adjacent")
      .selectOption({ label: target });
    await page.getByTestId("direction-adjacency-kind").fill("related");
    await page.getByTestId("direction-adjacency-weight").fill("10");
    await page.getByTestId("submit-direction-adjacency").click();
    await expect(page.getByTestId("create-error")).toHaveText(
      /такая смежность уже заведена/i,
    );

    // ── Retire: the edit form gives way to read-only values ──────────────
    await page.goto(detailUrl);
    await page.getByTestId("relation-retire").click();
    await expect(page.getByTestId("direction-adjacency-status")).toHaveText(
      "Снята",
    );
    // A retired edge answers PATCH with 409, so no box pretends otherwise.
    await expect(page.getByTestId("direction-adjacency-form")).toHaveCount(0);
    await expect(page.getByTestId("direction-adjacency-kind-value")).toHaveText(
      "related",
    );
    await expect(
      page.getByTestId("direction-adjacency-weight-value"),
    ).toHaveText("80");
    await expect(page.getByTestId("relation-restore")).toBeVisible();

    // ── Restore brings the SAME row (and its edit form) back ─────────────
    await page.getByTestId("relation-restore").click();
    await expect(page.getByTestId("direction-adjacency-status")).toHaveText(
      "Действует",
    );
    await expect(page.getByTestId("direction-adjacency-form")).toBeVisible();
    expect(page.url()).toBe(detailUrl);
  });
});
