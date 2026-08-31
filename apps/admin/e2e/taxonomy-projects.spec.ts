import { expect, test, type Page } from "@playwright/test";
import { bootstrapAdminSession } from "./support/admin-session";
import { totpCode } from "./support/totp";
import { visible } from "./support/visible";

/**
 * 012 EARS-1 (#1283), browser half — the REAL Refine → NestJS → Postgres path.
 *
 * The API e2e suites prove the contract against the API directly. This proves the
 * operator-facing arc on the running admin: sign in, create a project, copy its
 * server-derived public link, find it through the block-tier list's INSTANT
 * search (#1297, EARS-23 — no «Применить», a removable chip, one «Сбросить
 * всё», a pager whose non-actionable control is disabled rather than dead),
 * edit it, then upload and remove a cover. An over-long title is refused before
 * any request leaves the browser; no slug authoring control exists.
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
    context,
  }) => {
    await signInAsAdmin(page);

    // ── Reach the resource through the chrome, not by typing a URL ─────────
    await page.getByTestId("nav-projects").click();
    await page.waitForURL(/\/projects$/, { timeout: 20_000 });
    await expect(page.getByTestId("projects-filters")).toBeVisible();
    // The retired-rows toggle is OFF by default (Stage-A answer 4).
    await expect(
      page.getByTestId("projects-include-retired"),
    ).not.toBeChecked();

    // ── Reject branch: garbage input never leaves the browser ──────────────
    await page.getByTestId("projects-create").click();
    await page.waitForURL(/\/projects\/create$/, { timeout: 20_000 });
    await page.getByTestId("project-title").fill("x".repeat(161));
    await page.getByTestId("project-description").fill("");
    await page.getByTestId("submit-project").click();
    // RU inline errors, and we are still on the create screen.
    await expect(
      page.getByText("Слишком длинное значение", { exact: false }),
    ).toBeVisible();
    await expect(page.getByTestId("project-slug")).toHaveCount(0);
    expect(page.url()).toMatch(/\/projects\/create$/);

    // ── Accept branch: server-owned address and the counter ────────────────
    const title = `Школа кардиологии ${Date.now()}`;
    await page.getByTestId("project-title").fill(title);
    await expect(page.getByTestId("project-public-link-note")).toContainText(
      "Адрес сгенерирует сервер",
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
    const publicUrl = await page.getByTestId("project-public-link").innerText();
    expect(publicUrl).toMatch(
      /^https:\/\/academy\.doctor\.school\/projects\/shkola-kardiologii/,
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: ORIGIN,
    });
    await page.getByTestId("project-copy-public-link").click();
    await expect(page.getByTestId("project-copy-public-link")).toHaveText(
      "Ссылка скопирована",
    );
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(publicUrl);
    // «Основное» plus the «События» read direction EARS-6 added (#1288). Still no
    // empty placeholder tab: «Публикация» (#1287/#1295/#1296) arrives with the
    // transitions that give it something to show.
    await expect(page.getByTestId("tab-main")).toBeVisible();
    await expect(page.getByTestId("tab-events")).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(4);

    // ── The block-tier list finds it by search, with no «Применить» ────────
    await page.getByTestId("back-to-list").click();
    await page.waitForURL(/\/projects$/, { timeout: 20_000 });
    // EARS-23: typing is the whole gesture. No Enter, no Apply — the bar
    // debounces and applies on its own, so the assertion below is the proof
    // that no submit control was needed.
    await page.getByRole("searchbox", { name: "Поиск" }).fill(title);
    await expect(
      page.getByRole("button", { name: "Применить", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId("projects-table")).toContainText(title);
    // EARS-23: the applied set is a removable chip, and one control clears all.
    await expect(page.getByText("Выбрано:", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Сбросить всё" }).click();
    await expect(page.getByText("Выбрано:", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("searchbox", { name: "Поиск" })).toHaveValue("");

    // ── EARS-16: single-action list ⇒ the ROW is the action ────────────────
    await expect(
      page.getByRole("columnheader", { name: "Действия" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("projects-total")).toBeVisible();

    // ── EARS-23: a non-actionable pager control is DISABLED, not a dead end ─
    await expect(
      visible(page.getByRole("button", { name: "Назад", exact: true })),
    ).toBeDisabled();

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

    // The address remains visible but never becomes an authored mutation field.
    await expect(page.getByTestId("project-slug")).toHaveCount(0);
    await expect(page.getByTestId("project-public-link")).toHaveText(publicUrl);
  });
});
