import { expect, test, type Page } from "@playwright/test";
import { bootstrapAdminSession } from "./support/admin-session";
import { totpCode } from "./support/totp";

/**
 * 012 EARS-4 (#1286) + EARS-23 (#1297), browser half — the REAL Refine → NestJS → Postgres path.
 *
 * The API e2e suites prove the contract against the API directly. This proves the
 * operator-facing arc on the running admin: sign in, create a partner, copy its
 * server-derived public link, find and edit it, then upload, replace and clear a
 * logo. Invalid title/site/media inputs are refused; no slug authoring exists.
 *
 * Where it deliberately differs from `taxonomy-experts.spec.ts`: there is no
 * initials fallback to assert (an organisation has none — §2.2), and no
 * publish-requirement branch (012-design §5.2 declares both `logoUrl` and
 * `websiteUrl` nullable on the public projection, so neither blocks publication).
 *
 * Dev-stand-gated + MANUAL like every other `apps/admin/e2e` flow spec — the
 * bootstrap provisions a real `platform_admin` against the stand's Zitadel and
 * throws when `IDP_*` is absent. Run against a booted admin + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3201 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test e2e/taxonomy-partners.spec.ts \
 *     --config=playwright.flows.config.ts
 */
const ORIGIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3200";

/** A tiny valid PNG (1×1, opaque) — the logo fixture, built in-process. */
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

test.describe("012 EARS-4 — partner authoring in the live admin", () => {
  test("012 EARS-4: an operator creates, finds, edits and brands a partner through the real admin", async ({
    page,
    context,
  }) => {
    await signInAsAdmin(page);

    // ── Reach the resource through the chrome, not by typing a URL ─────────
    await page.getByTestId("nav-partners").click();
    await page.waitForURL(/\/partners$/, { timeout: 20_000 });
    await expect(page.getByTestId("partners-filters")).toBeVisible();
    // The retired-rows toggle is OFF by default (Stage-A answer 4).
    await expect(
      page.getByTestId("partners-include-retired"),
    ).not.toBeChecked();

    // ── Reject branch: garbage input never leaves the browser ──────────────
    await page.getByTestId("partners-create").click();
    await page.waitForURL(/\/partners\/create$/, { timeout: 20_000 });
    await page.getByTestId("partner-title").fill("x".repeat(161));
    await page.getByTestId("partner-website-url").fill("example.ru");
    await page.getByTestId("submit-partner").click();
    // RU inline errors — one per field kind — and we are still on the create screen.
    await expect(
      page.getByText("Слишком длинное значение", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("должен начинаться с https://", { exact: false }),
    ).toBeVisible();
    await expect(page.getByTestId("partner-slug")).toHaveCount(0);
    expect(page.url()).toMatch(/\/partners\/create$/);

    // An http:// address is the same refusal as a bare domain — the rule is
    // «absolute https», not «looks like a URL».
    await page.getByTestId("partner-website-url").fill("http://example.ru");
    await page.getByTestId("submit-partner").click();
    await expect(
      page.getByText("должен начинаться с https://", { exact: false }),
    ).toBeVisible();
    expect(page.url()).toMatch(/\/partners\/create$/);

    // ── Accept branch: the server-owned public address ─────────────────────
    // A draft partner is legally allowed to carry only a title; the site is
    // filled here because the arc under test is the complete card.
    const title = `Фарма Лаб ${Date.now()}`;
    await page.getByTestId("partner-title").fill(title);
    await expect(page.getByTestId("partner-public-link-note")).toContainText(
      "Адрес сгенерирует сервер",
    );
    await page.getByTestId("partner-website-url").fill("https://example.ru");
    await page.getByTestId("submit-partner").click();

    // ── The created row renders on its own detail page ─────────────────────
    await page.waitForURL(/\/partners\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const detailUrl = page.url();
    await expect(page.getByTestId("partner-heading")).toHaveText(title);
    await expect(page.getByTestId("partner-status")).toHaveText("Черновик");
    const publicUrl = await page.getByTestId("partner-public-link").innerText();
    expect(publicUrl).toMatch(
      /^https:\/\/academy\.doctor\.school\/partners\/farma-lab/,
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: ORIGIN,
    });
    await page.getByTestId("partner-copy-public-link").click();
    await expect(page.getByTestId("partner-copy-public-link")).toHaveText(
      "Ссылка скопирована",
    );
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(publicUrl);
    // The retained project-relation read tab ships alongside «Основное».
    await expect(page.getByTestId("tab-main")).toBeVisible();
    await expect(page.getByTestId("tab-projects")).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(2);
    // No logo yet ⇒ an EMPTY slot. Unlike an expert, an organisation has no
    // initials fallback anywhere on the platform, so nothing stands in for it.
    await expect(page.getByAltText("Логотип партнёра")).toHaveCount(0);

    // ── The block-tier list finds it by search, with no «Применить» ────────
    await page.getByTestId("back-to-list").click();
    await page.waitForURL(/\/partners$/, { timeout: 20_000 });
    // EARS-23: typing is the whole gesture — no Enter, no Apply control.
    await page.getByRole("searchbox", { name: "Поиск" }).fill(title);
    await expect(
      page.getByRole("button", { name: "Применить", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId("partners-table")).toContainText(title);
    // The list column carries the address the operator typed.
    await expect(page.getByTestId("partners-table")).toContainText(
      "https://example.ru",
    );
    // EARS-23: the applied set is a removable chip; one control clears all.
    await expect(page.getByText("Выбрано:", { exact: false })).toBeVisible();

    // ── EARS-23: the state facet applies on change, with no submit ─────────
    await page.getByTestId("partners-status").selectOption("published");
    // A draft partner leaves the result set the moment the facet moves.
    await expect(page.getByTestId("partners-table")).not.toContainText(title);
    // Scoped to the toolbar: when the facet empties the result set the empty
    // state offers the SAME reset action as its own way out, so an unscoped
    // role query legitimately matches two controls.
    await page
      .getByTestId("partners-filters")
      .getByRole("button", { name: "Сбросить всё" })
      .click();
    await expect(page.getByText("Выбрано:", { exact: false })).toHaveCount(0);
    await expect(page.getByTestId("partners-status")).toHaveValue("");

    // ── EARS-16: single-action list ⇒ the ROW is the action ────────────────
    await expect(
      page.getByRole("columnheader", { name: "Действия" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("partners-total")).toBeVisible();
    // EARS-23: no dead-end pager — the DS `Pagination` block omits «Назад» on
    // the first page and the whole pager on a single page, rather than
    // rendering a focusable disabled control.
    await expect(
      page.getByRole("button", { name: "Назад", exact: true }),
    ).toHaveCount(0);

    // ── Edit the same row (If-Match round-trip) ────────────────────────────
    await page.goto(detailUrl);
    const editedUrl = "https://example.ru/about";
    await page.getByTestId("partner-website-url").fill(editedUrl);
    await page.getByTestId("submit-partner").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("partner-website-url")).toHaveValue(
      editedUrl,
    );

    // ── Emptying the website box CLEARS it (explicit null, not «unchanged») ─
    await page.getByTestId("partner-website-url").fill("");
    await page.getByTestId("submit-partner").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("partner-website-url")).toHaveValue("");

    // ── Logo: upload, see the preview, replace it, then clear it ───────────
    await page.setInputFiles("#logo", {
      name: "logo.png",
      mimeType: "image/png",
      buffer: PNG_1x1,
    });
    await expect(page.getByAltText("Логотип партнёра")).toBeVisible();
    await page.getByTestId("submit-partner").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    // The stored (normalized WebP) logo comes back from the server.
    await expect(page.getByAltText("Логотип партнёра")).toBeVisible();

    // Replace: a second upload over a stored logo is the `replace` cleanup path.
    await page.setInputFiles("#logo", {
      name: "logo-2.png",
      mimeType: "image/png",
      buffer: PNG_1x1,
    });
    await page.getByTestId("submit-partner").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await expect(page.getByAltText("Логотип партнёра")).toBeVisible();

    // Clear: `mediaAction: "clear"` — and the slot stays empty after a reload,
    // so the removal is stored state, not a first-render trick.
    await page.getByRole("button", { name: "убрать" }).click();
    await expect(page.getByAltText("Логотип партнёра")).toHaveCount(0);
    await page.getByTestId("submit-partner").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await expect(page.getByAltText("Логотип партнёра")).toHaveCount(0);

    // ── Preflight refusal: a non-image is refused in the browser ───────────
    await page.setInputFiles("#logo", {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });
    await expect(page.getByTestId("partner-logo-error")).toBeVisible();

    await expect(page.getByTestId("partner-slug")).toHaveCount(0);
    await expect(page.getByTestId("partner-public-link")).toHaveText(publicUrl);
    //
    // Retire/restore is the same story: 012 exposes NO retire/restore route on
    // the partners controller in this slice (the merged expert and direction
    // verticals have none either — the transitions arrive with #1287/#1295/#1296),
    // so no control is rendered for them here. Rendering a button with no route
    // behind it would be exactly the untracked scaffold AGENTS.md §6 forbids.
  });
});
