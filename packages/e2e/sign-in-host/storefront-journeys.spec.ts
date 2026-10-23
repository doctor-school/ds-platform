import { randomUUID } from "node:crypto";

import { golden } from "@ds/db/seed/golden";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
} from "@playwright/test";

import { HOSTS, baseUrlFor, type HostId } from "../hosts.js";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import {
  captureAddressedMailCheckpoint,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "../lib/mailpit.js";
import {
  inputSecret,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import {
  isSignInHostForm,
  signInHostApiPath,
} from "../lib/sign-in-host-api.js";
import { OIDC_TX_COOKIE } from "../lib/storefront-entry.js";
import {
  expectEnteredThrough,
  watchStorefrontEntries,
} from "../lib/storefront-entry-watch.js";

/**
 * The storefront ⇄ sign-in host journeys of ADR-0015 §4 (#3172), end to end,
 * on BOTH storefronts: the visitor starts on a storefront page, presses the
 * shell's «Войти», does the credential work on the sign-in host's form and is
 * back on the storefront — signed in, on the page they left (the return path
 * is held by the API transaction, so the LANDING is the assertion, never a
 * form URL).
 *
 * Every journey registers its own uniquely owned account and reads its codes
 * from the stand's Mailpit; no golden credential is used. Only the 005 EARS-2
 * pair needs the golden dataset (a live эфир per storefront), so it runs where
 * golden data is seeded — the PR's stage slot.
 */

const STOREFRONTS: readonly HostId[] = ["academy", "doctor"];

const SESSION_COOKIE = "__Host-ds_session";

/** The one refusal copy a wrong password gets on every storefront form. */
const GENERIC_PASSWORD_ERROR =
  "Не удалось войти. Проверьте данные и попробуйте снова.";

/** A golden эфир on air per storefront (005 EARS-2 needs a joinable event). */
const LIVE_EVENT: Record<HostId, string> = {
  academy: `/webinars/${golden.events.academyLive.slug}`,
  doctor: `/events/${golden.events.live.slug}`,
};

const base = (id: HostId) => baseUrlFor(HOSTS[id]);
const origin = (id: HostId) => new URL(base(id)).origin;
/** A public page with the shell's «Войти» — the storefront's own events feed. */
const startPath = (id: HostId) => HOSTS[id].eventsPath;
/** The gated page whose guest bounce stores a return path on any stand. */
const STORED_PATH = "/account";

/**
 * The host's forms are captcha-gated: the stub on a slot (the real invisible
 * widget yields no token headless), nothing on a local stand booted with bot
 * protection off (`captcha-stub.ts`). Installed before the first navigation.
 */
const prepareCaptcha = (target: BrowserContext, baseURL: string) =>
  prepareCaptchaForJourney(
    target,
    baseURL,
    process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
  );
/**
 * The stand's one shared inbox, whichever storefront sent the mail: its host
 * is derived from the Academy slot URL (as doctor-landing.spec does) — the
 * doctor slot host carries no Mailpit derivation.
 */
const mailbox = () =>
  process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(base("academy"));

function ownedAccount(id: HostId): OwnedCredentials {
  return {
    email: `journey-3172-${id}-${randomUUID()}@example.test`,
    password: `Journey-${randomUUID()}-aA1!`,
  };
}

async function settled(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle");
}

/** Put a consent into the ticked state through its label (idempotent). */
async function setConsent(page: Page, testId: string) {
  const box = page.getByTestId(testId);
  if (!(await box.isChecked())) {
    await box.locator("xpath=ancestor::label[1]").click();
  }
  await expect(box).toBeChecked({ timeout: 2_000 });
}

/**
 * Open a storefront page and press the shell's «Войти»; the entry hands the
 * browser to the sign-in host's credential form. Off an event page the shell
 * carries no return path (only an event page is a land-only target, 003
 * EARS-61 / 020), so `returnTo` is what the entry is expected to carry.
 */
async function pressSignInFrom(
  page: Page,
  id: HostId,
  path = startPath(id),
  returnTo: string | null = null,
) {
  watchStorefrontEntries(page, base(id));
  await page.goto(`${base(id)}${path}`, { waitUntil: "load" });
  await settled(page);
  await page.getByTestId("shell-login").click();
  await onHostLoginForm(page, id, returnTo);
}

/**
 * A guest opens the storefront's own gated page (the cabinet): the storefront
 * bounces them through its entry, which stores that page as the return path.
 */
async function openGatedAsGuest(page: Page, id: HostId) {
  watchStorefrontEntries(page, base(id));
  await page.goto(`${base(id)}${STORED_PATH}`, { waitUntil: "load" });
  await onHostLoginForm(page, id, STORED_PATH);
}

async function onHostLoginForm(
  page: Page,
  id: HostId,
  returnTo: string | null,
) {
  await page.waitForURL((url) => isSignInHostForm(url));
  await settled(page);
  expectEnteredThrough(page, base(id), { pathname: "/login", returnTo });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
}

/** Fill the host's registration form, submit, and type the delivered code. */
async function registerOnHostForm(
  page: Page,
  id: HostId,
  account: OwnedCredentials,
) {
  await settled(page);
  expect(isSignInHostForm(page.url()), "on the sign-in host form").toBe(true);
  // A value typed into the pre-hydration DOM is discarded by the first client
  // render; the form is filled when the door itself agrees it is complete.
  await expect(async () => {
    if (id === "doctor") {
      await setConsent(page, "register-medworker");
      await setConsent(page, "register-partner-data");
    }
    await inputSecret(page.getByTestId("register-email"), account.email);
    await inputSecret(page.getByTestId("register-password"), account.password);
    await expect(page.getByTestId("register-submit")).toBeEnabled({
      timeout: 2_000,
    });
  }).toPass({ timeout: 15_000 });
  const before = await captureAddressedMailCheckpoint(
    nativeRecoveryMail(),
    mailbox(),
    account.email,
  );
  await page.getByTestId("register-submit").click();
  await page.waitForURL((url) => url.pathname === "/verify");
  await settled(page);
  const code = await fetchRecoveryCode(
    nativeRecoveryMail(),
    mailbox(),
    account.email,
    before,
    "register",
  );
  // The slotted OTP field auto-submits on completion: filling it IS the submit.
  await inputSecret(page.locator('input[autocomplete="one-time-code"]'), code);
}

/** A uniquely owned, confirmed account, made in a throwaway browser context. */
async function registeredAccount(
  browser: Browser,
  id: HostId,
): Promise<OwnedCredentials> {
  const account = ownedAccount(id);
  const context = await browser.newContext({ locale: "ru-RU" });
  try {
    await prepareCaptcha(context, base(id));
    const page = await context.newPage();
    await page.goto(`${base(id)}/register`, { waitUntil: "load" });
    await registerOnHostForm(page, id, account);
    await page.waitForURL(
      (url) =>
        url.origin === origin(id) &&
        !/^\/(register|verify|auth\/callback)$/.test(url.pathname),
    );
  } finally {
    await context.close();
  }
  return account;
}

/** Back on the storefront at exactly `path`, signed in as `account`. */
async function expectBackSignedIn(
  page: Page,
  id: HostId,
  path: string,
  account: OwnedCredentials,
) {
  await page.waitForURL(
    (url) => url.origin === origin(id) && url.pathname === path,
  );
  await settled(page);
  await expect(page.getByTestId("shell-avatar")).toBeVisible();
  await expect(page.getByTestId("shell-login")).toHaveCount(0);
  const profile = await page.evaluate(async (expected) => {
    const response = await fetch("/v1/me/profile", { credentials: "include" });
    const body = (await response.json()) as { email?: string };
    return { status: response.status, sameAccount: body.email === expected };
  }, account.email);
  expect(profile, "the storefront session is the account's own").toEqual({
    status: 200,
    sameAccount: true,
  });
}

async function submitPassword(
  page: Page,
  account: OwnedCredentials,
  password = account.password,
): Promise<Response> {
  await inputSecret(
    page.locator('input[autocomplete="username"]'),
    account.email,
  );
  await inputSecret(
    page.locator('input[autocomplete="current-password"]'),
    password,
  );
  const answered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        signInHostApiPath("/v1/auth/login") &&
      response.request().method() === "POST",
  );
  await page.getByTestId("password-login-submit").click();
  return answered;
}

function isDark(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
}

for (const id of STOREFRONTS) {
  test.describe(`ADR-0015 §4 (${id}): storefront → sign-in host → storefront`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    test.beforeEach(({ context }) => prepareCaptcha(context, base(id)));

    test(`ADR-0015 §4 req. 6 (${id}): after signing out, «Войти» shows the credential form — no silent re-sign-in`, async ({
      page,
      browser,
    }) => {
      const account = await registeredAccount(browser, id);
      await openGatedAsGuest(page, id);
      expect((await submitPassword(page, account)).status()).toBe(200);
      await expectBackSignedIn(page, id, STORED_PATH, account);

      // Sign out through the storefront's own control.
      await page.goto(`${base(id)}/account`, { waitUntil: "load" });
      await settled(page);
      await page.getByTestId("logout").click();
      await page.waitForURL(
        (url) => url.origin === origin(id) && url.pathname === "/",
      );
      await settled(page);

      // «Войти» again: the IdP session ended with the storefront's, so the
      // host shows the credential form and STAYS there.
      await page.getByTestId("shell-login").click();
      await page.waitForURL((url) => isSignInHostForm(url));
      await settled(page);
      await expect(
        page.locator('input[autocomplete="current-password"]'),
      ).toBeVisible();
      expect(
        isSignInHostForm(page.url()),
        "still on the host form — not bounced back signed in",
      ).toBe(true);
      expect(
        (await page.context().cookies()).some(
          (cookie) => cookie.name === SESSION_COOKIE,
        ),
        "no storefront session came back",
      ).toBe(false);
    });

    test(`ADR-0015 §4 journey (${id}): password — storefront entry → host form → back signed in on the stored path`, async ({
      page,
      browser,
    }) => {
      const account = await registeredAccount(browser, id);
      await openGatedAsGuest(page, id);
      expect((await submitPassword(page, account)).status()).toBe(200);
      await expectBackSignedIn(page, id, STORED_PATH, account);
    });

    test(`ADR-0015 §4 journey (${id}): e-mail code — storefront entry → host code step → back signed in on the stored path`, async ({
      page,
      browser,
    }) => {
      const account = await registeredAccount(browser, id);
      await openGatedAsGuest(page, id);
      await page.getByTestId("login-method-otp").click();
      await page.getByTestId("otp-channel-email").click();
      await inputSecret(page.getByTestId("otp-identifier"), account.email);
      const before = await captureAddressedMailCheckpoint(
        nativeRecoveryMail(),
        mailbox(),
        account.email,
      );
      await page.getByTestId("otp-send").click();
      const code = await fetchRecoveryCode(
        nativeRecoveryMail(),
        mailbox(),
        account.email,
        before,
        "login",
      );
      await inputSecret(
        page.locator('input[autocomplete="one-time-code"]'),
        code,
      );
      await expectBackSignedIn(page, id, STORED_PATH, account);
    });

    test(`ADR-0015 §4 journey (${id}): registration — storefront entry → host «Создать аккаунт» → code → back signed in on the stored path; the typed password signs in afterwards (003 EARS-24)`, async ({
      page,
    }) => {
      const account = ownedAccount(id);
      await openGatedAsGuest(page, id);
      await page.getByRole("link", { name: "Создать аккаунт" }).click();
      await page.waitForURL(
        (url) => url.pathname === "/register" && isSignInHostForm(url),
      );
      await registerOnHostForm(page, id, account);
      await expectBackSignedIn(page, id, STORED_PATH, account);

      // 003 EARS-24 warm step: the password typed at registration is the
      // account's password — a fresh browser state signs in with it.
      await page.context().clearCookies();
      await openGatedAsGuest(page, id);
      expect((await submitPassword(page, account)).status()).toBe(200);
      await expectBackSignedIn(page, id, STORED_PATH, account);
    });

    test(`ADR-0015 §4 journey (${id}): reset — storefront entry → host «Забыли пароль?» → code + new password → back signed in on the stored path`, async ({
      page,
      browser,
    }) => {
      const account = await registeredAccount(browser, id);
      const renewed = { ...account, password: `Renewed-${randomUUID()}-aA1!` };
      await openGatedAsGuest(page, id);
      await page.getByRole("link", { name: "Забыли пароль?" }).click();
      await page.waitForURL(
        (url) => url.pathname === "/reset" && isSignInHostForm(url),
      );
      await settled(page);
      await inputSecret(
        page.locator('input[autocomplete="username"]'),
        account.email,
      );
      const before = await captureAddressedMailCheckpoint(
        nativeRecoveryMail(),
        mailbox(),
        account.email,
      );
      await page.getByTestId("reset-request-submit").click();
      const code = await fetchRecoveryCode(
        nativeRecoveryMail(),
        mailbox(),
        account.email,
        before,
        "reset",
      );
      await inputSecret(
        page.locator('input[autocomplete="one-time-code"]'),
        code,
      );
      await inputSecret(
        page.locator('input[autocomplete="new-password"]'),
        renewed.password,
      );
      await page.locator('form button[type="submit"]').click();
      await expectBackSignedIn(page, id, STORED_PATH, renewed);
    });

    test(`ADR-0015 §4 (${id}): a wrong password shows the generic error on the host form`, async ({
      page,
      browser,
    }) => {
      const account = await registeredAccount(browser, id);
      await pressSignInFrom(page, id);
      const refused = await submitPassword(
        page,
        account,
        `Wrong-${randomUUID()}-aA1!`,
      );
      expect(refused.status()).toBe(401);
      expect((await refused.headerValue("set-cookie")) ?? "").not.toContain(
        `${SESSION_COOKIE}=`,
      );
      await expect(
        page.getByRole("alert").filter({ hasText: GENERIC_PASSWORD_ERROR }),
      ).toBeVisible();
      expect(isSignInHostForm(page.url()), "still on the host form").toBe(true);
    });

    test(`ADR-0015 §4 S3 (${id}): the storefront's dark theme is carried to the sign-in host`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto(`${base(id)}${startPath(id)}`, { waitUntil: "load" });
      await settled(page);
      expect(await isDark(page), "a fresh visit is light").toBe(false);
      await page.getByTestId("theme-toggle").click();
      await expect.poll(() => isDark(page)).toBe(true);

      await page.getByTestId("shell-login").click();
      await page.waitForURL((url) => isSignInHostForm(url));
      // Server-rendered from the visitor's explicit choice: dark at the first
      // parsed byte, not corrected after hydration.
      await page.waitForLoadState("domcontentloaded");
      expect(
        await isDark(page),
        "the host form renders dark for a visitor who chose dark",
      ).toBe(true);
      await settled(page);
      expect(await isDark(page)).toBe(true);
    });

    test(`003 EARS-61 (${id}): a guest view of the storefront home creates no IdP auth request`, async ({
      page,
    }) => {
      const authorize: string[] = [];
      page.on("request", (request) => {
        if (
          /\/oauth\/v2\/authorize(?:$|[?#])/.test(
            new URL(request.url()).pathname,
          )
        )
          authorize.push(request.url());
      });
      await page.goto(`${base(id)}/`, { waitUntil: "load" });
      await settled(page);
      // Pointing at «Войти» is where a router link would prefetch the entry.
      await page.getByTestId("shell-login").hover();
      await settled(page);
      expect(authorize, "no request to the IdP authorize URL").toEqual([]);
      expect(
        (await page.context().cookies()).some(
          (cookie) => cookie.name === OIDC_TX_COOKIE,
        ),
        "no sign-in transaction was minted",
      ).toBe(false);
    });

    test(`ADR-0015 §4 journey (${id}): «Войти» on an event page → host form → back signed in on that event page`, async ({
      page,
      browser,
    }) => {
      const account = await registeredAccount(browser, id);
      const event = LIVE_EVENT[id];
      // The shell carries an event page as a LAND-ONLY target (no registration).
      await pressSignInFrom(page, id, event, `${event}?intent=land`);
      expect((await submitPassword(page, account)).status()).toBe(200);
      await expectBackSignedIn(page, id, event, account);
    });

    test(`005 EARS-2 (${id}): sign-in from an event page ends back on that event, registered`, async ({
      page,
      browser,
    }) => {
      const account = await registeredAccount(browser, id);
      const event = LIVE_EVENT[id];
      watchStorefrontEntries(page, base(id));
      await page.goto(`${base(id)}${event}`, { waitUntil: "load" });
      await settled(page);
      await page.getByTestId("event-signup-cta").click();
      await page.waitForURL((url) => isSignInHostForm(url));
      await settled(page);
      // The guest door is registration; the account exists, so the visitor
      // takes the host's own way to sign in, carrying the same transaction.
      // The IdP already landed on the host's `/login` (rendering the register
      // door), so a URL wait is satisfied before the (client-side) hop: wait
      // for the login door itself to render, else the register door's fields
      // are filled and then replaced, and the submit sends nothing.
      await page.getByRole("link", { name: /Уже есть аккаунт/ }).click();
      await expect(page.getByTestId("password-login-submit")).toBeVisible();
      expect(
        new URL(page.url()).pathname === "/login" &&
          isSignInHostForm(page.url()),
        "on the host's login door",
      ).toBe(true);
      await settled(page);
      expect((await submitPassword(page, account)).status()).toBe(200);
      await expectBackSignedIn(page, id, event, account);

      // Registered in place: no «Участвовать» left to press.
      const card = page.getByTestId("event-signup-card");
      await expect(card).toBeVisible();
      await expect(card).not.toContainText("Участвовать");
      await expect(page.getByTestId("event-register-one-tap")).toHaveCount(0);
    });
  });
}
