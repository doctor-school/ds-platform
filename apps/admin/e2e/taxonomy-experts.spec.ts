import { expect, test, type Page } from "@playwright/test";
import { bootstrapAdminSession } from "./support/admin-session";
import { totpCode } from "./support/totp";

/**
 * 012 EARS-2 (#1284), browser half — the REAL Refine → NestJS → Postgres path.
 *
 * The API e2e suites prove the contract against the API directly. This proves the
 * operator-facing arc on the running admin: sign in, create an expert (watching
 * the generated slug preview and the character counter), see the deterministic
 * initials the SERVER computed stand in for the missing photo, find the row
 * through the shared list shell's search, edit it, upload a photo, remove it and
 * watch the initials come back. Reject branches ride along: an over-long name and
 * a garbage slug must surface RU inline errors BEFORE any request leaves the
 * browser.
 *
 * Dev-stand-gated + MANUAL like every other `apps/admin/e2e` flow spec — the
 * bootstrap provisions a real `platform_admin` against the stand's Zitadel and
 * throws when `IDP_*` is absent. Run against a booted admin + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3201 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test e2e/taxonomy-experts.spec.ts \
 *     --config=playwright.flows.config.ts
 */
const ORIGIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3200";

/** A tiny valid PNG (1×1, opaque) — the photo fixture, built in-process. */
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

test.describe("012 EARS-2 — expert authoring in the live admin", () => {
  test("012 EARS-2: an operator creates, finds, edits and photographs an expert through the real admin", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    // ── Reach the resource through the chrome, not by typing a URL ─────────
    await page.getByTestId("nav-experts").click();
    await page.waitForURL(/\/experts$/, { timeout: 20_000 });
    await expect(page.getByTestId("experts-filters")).toBeVisible();
    // The retired-rows toggle is OFF by default (Stage-A answer 4).
    await expect(page.getByTestId("experts-include-retired")).not.toBeChecked();

    // ── Reject branch: garbage input never leaves the browser ──────────────
    await page.getByTestId("experts-create").click();
    await page.waitForURL(/\/experts\/create$/, { timeout: 20_000 });
    await page.getByTestId("expert-name").fill("x".repeat(161));
    await page.getByTestId("expert-slug").fill("Not valid");
    await page.getByTestId("submit-expert").click();
    // RU inline errors, and we are still on the create screen.
    await expect(
      page.getByText("Слишком длинное значение", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("Только строчные латинские буквы", { exact: false }),
    ).toBeVisible();
    expect(page.url()).toMatch(/\/experts\/create$/);

    // ── Accept branch: the generated slug preview and the counter ──────────
    // A draft expert is legally allowed to carry only a name — the four
    // publish-required fields are filled here because the arc under test is the
    // complete card, not because the form demands them.
    const name = `Иван Петров ${Date.now()}`;
    await page.getByTestId("expert-name").fill(name);
    await page.getByTestId("expert-slug").fill("");
    await expect(page.getByTestId("expert-slug")).toHaveAttribute(
      "placeholder",
      /^ivan-petrov/,
    );
    await page.getByTestId("expert-professional-role").fill("Кардиолог");
    await page.getByTestId("expert-credentials").fill("Д.м.н., профессор");
    await page.getByTestId("expert-affiliation").fill("НМИЦ кардиологии");
    await page
      .getByTestId("expert-bio")
      .fill("Практикующий кардиолог, ведёт приём и читает лекции.");
    // The counter reports the remaining budget, not a truncation. Two boxes carry
    // one (regalia and bio), so the assertion is scoped to the first rather than
    // written as a strict-mode-violating whole-page match.
    await expect(
      page.getByText("осталось", { exact: false }).first(),
    ).toBeVisible();
    await page.getByTestId("submit-expert").click();

    // ── The created row renders on its own detail page ─────────────────────
    await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const detailUrl = page.url();
    await expect(page.getByTestId("expert-heading")).toHaveText(name);
    await expect(page.getByTestId("expert-status")).toHaveText("Черновик");
    // Only «Основное» ships in this slice — no empty placeholder tabs.
    await expect(page.getByTestId("tab-main")).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(1);
    // No photo yet ⇒ the SERVER-computed initials stand in for it (012 §2.2).
    await expect(page.getByTestId("expert-initials")).toHaveText("ИП");

    // ── The shared list shell finds it by search ───────────────────────────
    await page.getByTestId("back-to-list").click();
    await page.waitForURL(/\/experts$/, { timeout: 20_000 });
    await page.getByTestId("experts-search").fill(name);
    await page.getByTestId("experts-apply").click();
    await expect(page.getByTestId("experts-table")).toContainText(name);

    // ── Edit the same row (If-Match round-trip) ────────────────────────────
    await page.goto(detailUrl);
    const editedRole = "Кардиолог, руководитель отделения";
    await page.getByTestId("expert-professional-role").fill(editedRole);
    await page.getByTestId("submit-expert").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("expert-professional-role")).toHaveValue(
      editedRole,
    );

    // ── Photo: upload, see the preview instead of the initials, then remove ─
    await page.setInputFiles("#photo", {
      name: "photo.png",
      mimeType: "image/png",
      buffer: PNG_1x1,
    });
    await expect(page.getByAltText("Фото эксперта")).toBeVisible();
    await page.getByTestId("submit-expert").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    // The stored (normalized) photo comes back from the server, and the initials
    // fallback stands down.
    await expect(page.getByAltText("Фото эксперта")).toBeVisible();
    await expect(page.getByTestId("expert-initials")).toHaveCount(0);

    await page.getByRole("button", { name: "убрать" }).click();
    await expect(page.getByAltText("Фото эксперта")).toHaveCount(0);
    await page.getByTestId("submit-expert").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await expect(page.getByAltText("Фото эксперта")).toHaveCount(0);
    // …and the initials come back — the fallback is state, not a first-render trick.
    await expect(page.getByTestId("expert-initials")).toHaveText("ИП");

    // ── Preflight refusal: a non-image is refused in the browser ───────────
    await page.setInputFiles("#photo", {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });
    await expect(page.getByTestId("expert-photo-error")).toBeVisible();

    // ── The slug stays editable while the row has never been published ────
    await expect(page.getByTestId("expert-slug")).not.toHaveAttribute(
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
    // `apps/api/test/taxonomy/experts.e2e-spec.ts` (`slugEditable: false` on a
    // published row plus the 409 `SLUG_IMMUTABLE` refusal); the browser assertion
    // rides #1287, which introduces the transition that produces the state.
  });
});
