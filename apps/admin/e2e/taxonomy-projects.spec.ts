import { expect, test, type Page } from "@playwright/test";
import { bootstrapAdminSession } from "./support/admin-session";
import { totpCode } from "./support/totp";

/**
 * 012 EARS-1 (#1283), browser half — the REAL Refine → NestJS → Postgres path.
 *
 * The API e2e suites prove the contract against the API directly. This proves the
 * operator-facing arc on the running admin: sign in, create a project (watching
 * the generated slug preview and the description counter), find it through the
 * shared list shell's search, edit it, upload and then remove a cover, and see
 * the slug lock explain itself once the row has been published. Reject branches
 * ride along: a garbage slug and an over-long title must surface RU inline errors
 * BEFORE any request leaves the browser.
 *
 * Dev-stand-gated + MANUAL like every other `apps/admin/e2e` flow spec — the
 * bootstrap provisions a real `platform_admin` against the stand's Zitadel and
 * throws when `IDP_*` is absent. Run against a booted admin + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3201 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test e2e/taxonomy-projects.spec.ts \
 *     --config=playwright.flows.config.ts
 */
const ORIGIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3200";

/** A tiny valid PNG (1×1, opaque) — the cover fixture, built in-process. */
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

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

test.describe("012 EARS-1 — project authoring in the live admin", () => {
  test("012 EARS-1: an operator creates, finds, edits and covers a project through the real admin", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    // ── Reach the resource through the chrome, not by typing a URL ─────────
    await page.getByTestId("nav-projects").click();
    await page.waitForURL(/\/projects$/, { timeout: 20_000 });
    await expect(page.getByTestId("projects-filters")).toBeVisible();
    // The retired-rows toggle is OFF by default (Stage-A answer 4).
    await expect(page.getByTestId("projects-include-retired")).not.toBeChecked();

    // ── Reject branch: garbage input never leaves the browser ──────────────
    await page.getByTestId("projects-create").click();
    await page.waitForURL(/\/projects\/create$/, { timeout: 20_000 });
    await page.getByTestId("project-title").fill("x".repeat(161));
    await page.getByTestId("project-slug").fill("Not valid");
    await page.getByTestId("project-description").fill("");
    await page.getByTestId("submit-project").click();
    // RU inline errors, and we are still on the create screen.
    await expect(page.getByText("Слишком длинное значение", { exact: false })).toBeVisible();
    await expect(
      page.getByText("Только строчные латинские буквы", { exact: false }),
    ).toBeVisible();
    expect(page.url()).toMatch(/\/projects\/create$/);

    // ── Accept branch: the generated slug preview and the counter ──────────
    const title = `Школа кардиологии ${Date.now()}`;
    await page.getByTestId("project-title").fill(title);
    await page.getByTestId("project-slug").fill("");
    await expect(page.getByTestId("project-slug")).toHaveAttribute(
      "placeholder",
      /^shkola-kardiologii/,
    );
    await page
      .getByTestId("project-description")
      .fill("Программа для практикующих кардиологов.");
    // The counter reports the remaining budget, not a truncation.
    await expect(page.getByText("осталось", { exact: false })).toBeVisible();
    await page.getByTestId("submit-project").click();

    // ── The created row renders on its own detail page ─────────────────────
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const detailUrl = page.url();
    await expect(page.getByTestId("project-heading")).toHaveText(title);
    await expect(page.getByTestId("project-status")).toHaveText("Черновик");
    // «Основное» plus the «События» read direction EARS-6 added (#1288). Still no
    // empty placeholder tab: «Публикация» (#1287/#1295/#1296) arrives with the
    // transitions that give it something to show.
    await expect(page.getByTestId("tab-main")).toBeVisible();
    await expect(page.getByTestId("tab-events")).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(2);

    // ── The shared list shell finds it by search ───────────────────────────
    await page.getByTestId("back-to-list").click();
    await page.waitForURL(/\/projects$/, { timeout: 20_000 });
    await page.getByTestId("projects-search").fill(title);
    await page.getByTestId("projects-apply").click();
    await expect(page.getByTestId("projects-table")).toContainText(title);

    // ── Edit the same row (If-Match round-trip) ────────────────────────────
    await page.goto(detailUrl);
    const editedTitle = `${title} — правка`;
    await page.getByTestId("project-title").fill(editedTitle);
    await page.getByTestId("submit-project").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await expect(page.getByTestId("project-heading")).toHaveText(editedTitle);

    // ── Cover: upload, see the preview, then remove it ─────────────────────
    await page.setInputFiles("#cover", {
      name: "cover.png",
      mimeType: "image/png",
      buffer: PNG_1x1,
    });
    await expect(page.getByAltText("Обложка проекта")).toBeVisible();
    await page.getByTestId("submit-project").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    // The stored (normalized) cover comes back from the server.
    await expect(page.getByAltText("Обложка проекта")).toBeVisible();

    await page.getByRole("button", { name: "убрать" }).click();
    await expect(page.getByAltText("Обложка проекта")).toHaveCount(0);
    await page.getByTestId("submit-project").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await expect(page.getByAltText("Обложка проекта")).toHaveCount(0);

    // ── Preflight refusal: a non-image is refused in the browser ───────────
    await page.setInputFiles("#cover", {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });
    await expect(page.getByTestId("project-cover-error")).toBeVisible();

    // ── The slug stays editable while the row has never been published ────
    await expect(page.getByTestId("project-slug")).not.toHaveAttribute(
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
    // `apps/api/test/taxonomy/projects.e2e-spec.ts` (`slugEditable: false` on a
    // published row plus the 409 `SLUG_IMMUTABLE` refusal); the browser assertion
    // rides #1287, which introduces the transition that produces the state.
  });
});
