import { isSignInHostForm } from "@ds/e2e/sign-in-host-api";
import {
  expectEnteredThrough,
  watchStorefrontEntries,
} from "@ds/e2e/storefront-entry-watch";
import { expect, test, type Page } from "@playwright/test";

import { fetchOtpCode } from "./support/mailpit";
import { NOTIFICATION_SUBJECTS } from "./support/notification-subjects";

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";

/**
 * 033 — «Подать заявку» on the real stack: the account gate's one action
 * «Войти / Регистрация» starts the 003 / 021 flow through the sign-in host
 * (`apps/login`), and the visitor comes back to `/apply` with the form open
 * (EARS-3); the signed-in expert sends a real application to the real api
 * (EARS-4, EARS-7, EARS-9) and on the next visit sees the repeat banner from
 * the real `GET /v1/me/applications?kind=author` (EARS-10).
 *
 * The per-state branches (field refusals, server failure + same-key retry,
 * 390 px, axe) run on the backend-free CI tier in `apply.e2e.spec.ts`; what
 * only a live stack proves is here: the sign-in round trip and the api answers.
 *
 * Gated like `return-to-origin.spec.ts`: skipped unless the real-Zitadel
 * dev-stand env and a portal base URL are present; NOT wired into CI.
 *
 * Run against a provisioned dev-stand (api with bot protection off), e.g.:
 *   IDP_ISSUER=… IDP_CLIENT_ID=… IDP_SERVICE_TOKEN=… IDP_REDIRECT_URI=… \
 *   MAILPIT_URL=http://<stand-host>:8025 E2E_PORTAL_URL=http://localhost:3001 \
 *   pnpm --filter @ds/portal exec playwright test --project=e2e apply-sign-in-live
 */

const LIVE_OIDC =
  !!process.env.IDP_ISSUER &&
  !!process.env.IDP_CLIENT_ID &&
  !!process.env.IDP_SERVICE_TOKEN &&
  !!process.env.IDP_REDIRECT_URI &&
  !!process.env.E2E_PORTAL_URL;

const PATH = "/apply";
const TOPIC = `Ортобиология в амбулаторной практике ${Date.now()}`;

const newEmail = (): string =>
  `e2e-4031-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
const livePassword = (): string => `Apply-${Date.now()}-aA1!`;

/** The shared dev-stand IdP throttles serial sign-ins; wait it out, never mask it. */
async function submitPastThrottle(
  page: Page,
  submit: () => Promise<void>,
  settled: (url: URL) => boolean,
): Promise<void> {
  const ATTEMPTS = 4;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    await submit();
    const throttled = page.getByRole("alert").filter({ hasText: /повторите/i });
    const landed = await Promise.race([
      page
        .waitForURL(settled, { timeout: 45_000 })
        .then(() => true)
        .catch(() => false),
      throttled
        .waitFor({ state: "visible", timeout: 45_000 })
        .then(() => false)
        .catch(() => false),
    ]);
    if (landed) return;
    expect(
      attempt,
      "the shared dev-stand IdP kept throttling across every retry",
    ).toBeLessThan(ATTEMPTS);
    await page.waitForTimeout(60_000);
  }
}

async function expectOpenForm(page: Page, email: string) {
  await expect(page).toHaveURL(new RegExp(`${PATH}$`));
  await expect(page.getByText(`Отправите как ${email}`, { exact: false })).toBeVisible();
  await expect(page.getByLabel(/^Тема/)).toBeEditable();
  await expect(page.getByTestId("apply-gate")).toHaveCount(0);
}

/** Click the gate's one action and land on the sign-in host's door. */
async function openGate(page: Page) {
  watchStorefrontEntries(page, BASE);
  await page.goto(PATH);
  await page
    .getByTestId("apply-gate")
    .getByRole("link", { name: "Войти / Регистрация" })
    .click();
  await page.waitForURL((url) => isSignInHostForm(url.toString()), {
    timeout: 60_000,
  });
  expectEnteredThrough(page, BASE, { pathname: "/login", returnTo: PATH });
}

let account: { email: string; password: string } | null = null;

test.describe("033 «Подать заявку» — live sign-in round trip", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!LIVE_OIDC, "requires the real-Zitadel dev-stand env + E2E_PORTAL_URL");
  test.beforeEach(() => {
    test.setTimeout(900_000);
  });

  test("EARS-3: registration started from the gate returns the new account to /apply with the form open", async ({
    page,
  }) => {
    await openGate(page);
    const email = newEmail();
    const password = livePassword();
    // Registration is reachable from the sign-in door, inside the same flow.
    await page.getByRole("link", { name: /Регистрац|Зарегистр|Создать/ }).first().click();
    await page.waitForURL((url) => url.pathname.startsWith("/register"));
    const sentAt = new Date().toISOString();
    await submitPastThrottle(
      page,
      async () => {
        await page.locator('input[autocomplete="email"]').fill(email);
        await page.locator('input[autocomplete="new-password"]').fill(password);
        await page.getByTestId("register-submit").click();
      },
      (url) => url.pathname.startsWith("/verify"),
    );
    const code = await fetchOtpCode(email, sentAt, NOTIFICATION_SUBJECTS.verifyEmail);
    expect(code, "registration code should reach Mailpit").toBeTruthy();
    await page.locator('input[autocomplete="one-time-code"]').fill(code!);
    await page.waitForURL((url) => !url.pathname.startsWith("/verify"), {
      timeout: 60_000,
    });
    // The confirmation signs in directly or falls back to the in-flow door.
    if (new URL(page.url()).pathname.startsWith("/login")) {
      await submitPastThrottle(
        page,
        async () => {
          await page.locator('input[autocomplete="username"]').fill(email);
          await page.locator('input[autocomplete="current-password"]').fill(password);
          await page.getByTestId("password-login-submit").click();
        },
        (url) => !url.pathname.startsWith("/login"),
      );
    }
    account = { email, password };
    await expectOpenForm(page, email);
  });

  test("EARS-3: sign-in started from the gate returns to /apply with the form open", async ({
    page,
  }) => {
    expect(account, "the registration journey runs first").not.toBeNull();
    const { email, password } = account!;
    await page.context().clearCookies();
    await openGate(page);
    await submitPastThrottle(
      page,
      async () => {
        await page.locator('input[autocomplete="username"]').fill(email);
        await page.locator('input[autocomplete="current-password"]').fill(password);
        await page.getByTestId("password-login-submit").click();
      },
      (url) => !url.pathname.startsWith("/login"),
    );
    await expectOpenForm(page, email);
  });

  test("EARS-9/10: a real application is sent and the next visit shows the repeat banner", async ({
    page,
  }) => {
    expect(account, "the registration journey runs first").not.toBeNull();
    const { email, password } = account!;
    await page.context().clearCookies();
    await openGate(page);
    await submitPastThrottle(
      page,
      async () => {
        await page.locator('input[autocomplete="username"]').fill(email);
        await page.locator('input[autocomplete="current-password"]').fill(password);
        await page.getByTestId("password-login-submit").click();
      },
      (url) => !url.pathname.startsWith("/login"),
    );
    await expectOpenForm(page, email);
    await expect(page.getByText("Ваша предыдущая заявка в работе.")).toHaveCount(0);

    await page.getByLabel(/^Тема/).fill(TOPIC);
    await page.getByRole("button", { name: "отдельный урок" }).click();
    await page
      .getByText("Согласие на обработку персональных данных из заявки", { exact: true })
      .click();
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await expect(page.getByRole("heading", { name: "Заявка отправлена" })).toBeVisible({
      timeout: 30_000,
    });

    await page.reload();
    await expect(page.getByText("Ваша предыдущая заявка в работе.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Отправить заявку" })).toBeEnabled();
  });
});
