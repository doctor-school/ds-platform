import { expect, test, type Page } from "@playwright/test";
import { bootstrapAdminSession } from "./support/admin-session";
import { totpCode } from "./support/totp";

/**
 * 012 EARS-3 (#1285), browser half — the REAL Refine → NestJS → Postgres path.
 *
 * The API e2e suites (`apps/api/test/taxonomy/topics.e2e-spec.ts`) prove the
 * contract against the API directly. This proves the operator-facing arc on the
 * running admin: sign in, create a topic while watching the generated slug
 * preview, find the row through the shared list shell's search, edit the same
 * row (an If-Match round-trip) and confirm the change survives a reload. Both
 * refusal branches ride along — the client-side reject (a garbage slug never
 * leaves the browser) and the SERVER reject (a duplicate slug comes back as a
 * 400/409 Problem Details rendered as one actionable RU sentence).
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
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test e2e/taxonomy-topics.spec.ts \
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

test.describe("012 EARS-3 — curated topic authoring in the live admin", () => {
  test("012 EARS-3: an operator creates, finds and edits a curated topic through the real admin", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    // ── Reach the resource through the chrome, not by typing a URL ─────────
    await page.getByTestId("nav-topics").click();
    await page.waitForURL(/\/topics$/, { timeout: 20_000 });
    await expect(page.getByTestId("topics-filters")).toBeVisible();
    // The retired-rows toggle is OFF by default (Stage-A answer 4).
    await expect(page.getByTestId("topics-include-retired")).not.toBeChecked();

    // ── Reject branch (client): garbage input never leaves the browser ─────
    await page.getByTestId("topics-create").click();
    await page.waitForURL(/\/topics\/create$/, { timeout: 20_000 });
    await page.getByTestId("topic-title").fill("х".repeat(121));
    await page.getByTestId("topic-slug").fill("Not valid");
    await page.getByTestId("submit-topic").click();
    // RU inline errors, and we are still on the create screen.
    await expect(
      page.getByText("Слишком длинное значение", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("Только строчные латинские буквы", { exact: false }),
    ).toBeVisible();
    expect(page.url()).toMatch(/\/topics\/create$/);

    // ── Accept branch: the generated slug preview follows the title ────────
    const suffix = Date.now();
    const title = `Кардиология ${suffix}`;
    const slug = `kardiologiya-${suffix}`;
    await page.getByTestId("topic-title").fill(title);
    await page.getByTestId("topic-slug").fill("");
    // The preview is computed by the same `@ds/schemas` slugifier the API uses,
    // so what the box promises is what the server will store.
    await expect(page.getByTestId("topic-slug")).toHaveAttribute(
      "placeholder",
      /^kardiologiya/,
    );
    await expect(page.getByTestId("topic-slug-preview")).toHaveText(
      new RegExp(`^kardiologiya`),
    );
    await page.getByTestId("topic-slug").fill(slug);
    await page.getByTestId("submit-topic").click();

    // ── The created row renders on its own detail page ─────────────────────
    await page.waitForURL(/\/topics\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const detailUrl = page.url();
    await expect(page.getByTestId("topic-heading")).toHaveText(title);
    await expect(page.getByTestId("topic-status")).toHaveText("Черновик");
    // Only «Основное» ships in this slice — no empty placeholder tabs.
    await expect(page.getByTestId("tab-main")).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(1);
    // A topic is a title plus its address — and nothing else has a box here.
    await expect(page.getByTestId("topic-slug")).toHaveValue(slug);

    // ── No destructive affordance anywhere on the surface (012 §5.1) ───────
    await expect(page.getByRole("button", { name: /удалить/i })).toHaveCount(0);

    // ── The shared list shell finds it by search ───────────────────────────
    await page.getByTestId("back-to-list").click();
    await page.waitForURL(/\/topics$/, { timeout: 20_000 });
    await page.getByTestId("topics-search").fill(title);
    await page.getByTestId("topics-apply").click();
    await expect(page.getByTestId("topics-table")).toContainText(title);
    await expect(page.getByRole("button", { name: /удалить/i })).toHaveCount(0);

    // ── Edit the SAME row (If-Match round-trip), not a second one ──────────
    await page.goto(detailUrl);
    const editedTitle = `${title} и сосудистая медицина`;
    await page.getByTestId("topic-title").fill(editedTitle);
    await page.getByTestId("submit-topic").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("topic-title")).toHaveValue(editedTitle);
    // The row's identity did not move — an edit is an edit, not a re-create.
    expect(page.url()).toBe(detailUrl);
    await expect(page.getByTestId("topic-slug")).toHaveValue(slug);

    // ── Reject branch (server): the taken address comes back as one sentence ─
    await page.goto("/topics/create");
    await page.getByTestId("topic-title").fill(`Дубликат ${suffix}`);
    await page.getByTestId("topic-slug").fill(slug);
    await page.getByTestId("submit-topic").click();
    await expect(page.getByTestId("create-error")).toHaveText(
      /адрес страницы уже занят/i,
    );
    // The operator stays on the form with their input intact — a refusal is a
    // correction prompt, not a lost draft.
    expect(page.url()).toMatch(/\/topics\/create$/);
    await expect(page.getByTestId("topic-slug")).toHaveValue(slug);

    // ── The slug stays editable while the row has never been published ────
    await page.goto(detailUrl);
    await expect(page.getByTestId("topic-slug")).not.toHaveAttribute(
      "readonly",
      /.*/,
    );
    await expect(
      page.getByText("До первой публикации адрес можно изменить", {
        exact: false,
      }),
    ).toBeVisible();
    // The LOCKED rendering (read-only box + «адрес зафиксирован…» explanation)
    // cannot be reached from the browser in this slice: publication is #1287 and
    // no route here can set `first_published_at`. Its contract half is proven in
    // `apps/api/test/taxonomy/topics.e2e-spec.ts` (`slugEditable: false` on a
    // published row plus the 409 `SLUG_IMMUTABLE` refusal); the browser assertion
    // rides #1287, which introduces the transition that produces the state.
  });
});
