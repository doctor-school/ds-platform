import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import type { HostConfig } from "../hosts.js";
import {
  CAPTCHA_TEST_TOKEN_ENV,
  prepareCaptchaForJourney,
} from "./captcha-stub.js";
import { standHttpCredentials } from "./stand-http-credentials.js";
import { isSignInHostForm } from "./sign-in-host-api.js";
import {
  captureAddressedMailCheckpoint,
  fetchRecoveryCode,
  nativeRecoveryMail,
} from "./mailpit.js";

/**
 * #3151 — the two `/account` auth paths of the #2073 wave-4 exit gate (§5,
 * «same-origin auth path unchanged on both hosts») that had no spec on either
 * host, as ONE spec body both storefronts run. The account surface is one
 * package (`@ds/account`) mounted by both hosts, so a regression in it hits both
 * unseen; each host binds this body once with its own config and nothing else
 * (`apps/portal/e2e/account-auth-paths-live.spec.ts`,
 * `apps/doctor/e2e/account-auth-paths-live.spec.ts`).
 *
 *   (1) EXPIRED SESSION — a doctor whose session dies server-side while the
 *       browser still holds the `__Host-` cookie opens `/account`: the server
 *       bounces to the host login carrying `returnTo=/account` (the
 *       `AccountPage` guest decision, `withReturnContext`), and signing in there
 *       returns to `/account`.
 *   (2) PASSWORD HAND-OFF — «Сменить пароль» on `/account` opens the host reset
 *       route carrying `returnTo=%2Faccount`; completing the reset with the
 *       emailed code returns to `/account`, signed in.
 *
 * HOW THE SESSION EXPIRES. `resolveServerAuth` (`@ds/auth-flow/server`) reads
 * «expired» as: the cookie is present and the api answers `GET
 * /v1/auth/session` with 401. On the api, an expired session is an ABSENT
 * session record — key expiry is the single source of truth and «an expired
 * `sid` is simply absent, indistinguishable from one that never existed»
 * (`apps/api/src/auth/session/session-store.redis.ts`). The spec produces that
 * state through the product's own server-side command: `POST /v1/auth/logout`
 * for the browser's `sid`, sent from a SEPARATE request context that replays the
 * browser's fingerprint headers, so the record is deleted while the browser keeps
 * its cookie. A cookie wipe would be the signed-out case, not expiry; the spec
 * asserts the cookie is still held before it opens `/account`.
 *
 * Accounts are provisioned per test through the host's own register + verify
 * commands with the Mailpit code (the verify carries the registration values:
 * the bare verify replaces the password, 003 EARS-41).
 *
 * ENV SET (gated by each host binding with a literal `requireLiveStandEnv`, so
 * the stage inventory test sees it): the host URL variable, `MAILPIT_URL`. Bare CI → inert green; a
 * half-exported env fails loudly by variable name (`live-stand-env.ts`), whose
 * stand preconditions apply (raised rate-limit ceilings; bot protection in its
 * stand bypass mode). Bind the storefront to IPv4 (`next … -H 127.0.0.1`): the
 * session fingerprint is IP/24-bound and a dual-stack bind forwards
 * `::ffff:127.0.0.1`, which bounces `/account` for a live session too.
 *
 * Import this module ONLY from a Playwright spec file: it registers tests.
 */

const SESSION_COOKIE = "__Host-ds_session";
const ACCOUNT = "/account";

/** What a host binds the shared body with. */
export interface AccountAuthPathsHost {
  readonly host: HostConfig;
  /** The host's register command (`AuthFlowHostConfig.api.registerPath`). */
  readonly registerPath: string;
  /** The host's verify command (`AuthFlowHostConfig.api.verifyPath`). */
  readonly verifyPath: string;
  /** The host's registration values besides email + password. */
  readonly registration: Readonly<Record<string, unknown>>;
  /** The host's reset route (`AuthFlowHostConfig.routes.reset`). */
  readonly resetPath: string;
}

const httpCredentials = standHttpCredentials();

const newEmail = (hostId: string): string =>
  `e2e-3151-${hostId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
const newPassword = (tag: string): string =>
  `Acc-${tag}-${Date.now()}-aA1!`;

/**
 * The bot-protection header a provisioning command carries on a stand that
 * enforces it (a slot: the operator's non-production test token, #2605); none
 * on a local stand that runs with bot protection off.
 */
function provisioningHeaders(): Record<string, string> {
  const token = process.env[CAPTCHA_TEST_TOKEN_ENV]?.trim();
  return token ? { "x-smartcaptcha-token": token } : {};
}

async function expectOk(
  api: APIRequestContext,
  path: string,
  data: unknown,
): Promise<void> {
  const response = await api.post(path, {
    data,
    headers: provisioningHeaders(),
  });
  expect(
    response.ok(),
    `POST ${path} should succeed — got ${response.status()}: ${await response.text()}`,
  ).toBe(true);
}

/** Wait until the hydrated page can no longer submit natively (#2067). */
async function openSettled(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
}

/**
 * The storefront entry the current page's navigation started from — the first
 * request of its redirect chain — as pathname + `returnTo` (#3172: the form on
 * the sign-in host carries neither).
 */
function storefrontEntryOf(page: Page): {
  pathname: string;
  returnTo: string | null;
} {
  return lastEntry.get(page) ?? { pathname: "", returnTo: null };
}

/** The last storefront-origin navigation a page made into a sign-in entry. */
const lastEntry = new WeakMap<Page, { pathname: string; returnTo: string | null }>();

function watchEntries(page: Page, base: string): void {
  page.on("request", (req) => {
    if (!req.isNavigationRequest()) return;
    const url = new URL(req.url());
    if (url.origin !== new URL(base).origin) return;
    if (!/^\/(login|register|reset|verify)$/.test(url.pathname)) return;
    lastEntry.set(page, {
      pathname: url.pathname,
      returnTo: url.searchParams.get("returnTo"),
    });
  });
}

export function defineAccountAuthPathTests(bound: AccountAuthPathsHost): void {
  const { host } = bound;

  const base = (process.env[host.baseUrlEnv] ?? "").replace(/\/$/, "");
  const mailbox = (process.env.MAILPIT_URL ?? "").replace(/\/$/, "");
  const mail = nativeRecoveryMail();

  /** A confirmed account, provisioned through the host's own commands. */
  async function provisionAccount(): Promise<{
    email: string;
    password: string;
  }> {
    const email = newEmail(host.id);
    const password = newPassword("old");
    const api = await playwrightRequest.newContext({
      baseURL: base,
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    try {
      const before = await captureAddressedMailCheckpoint(mail, mailbox, email);
      await expectOk(api, bound.registerPath, {
        email,
        password,
        ...bound.registration,
      });
      const code = await fetchRecoveryCode(
        mail,
        mailbox,
        email,
        before,
        "register",
      );
      await expectOk(api, bound.verifyPath, {
        email,
        code,
        registration: { password, ...bound.registration },
      });
    } finally {
      await api.dispose();
    }
    return { email, password };
  }

  /** Sign in through the host's own password form, as a doctor would. */
  async function signInHere(
    page: Page,
    account: { email: string; password: string },
  ): Promise<void> {
    await page.waitForLoadState("networkidle");
    await page.locator('input[autocomplete="username"]').fill(account.email);
    await page
      .locator('input[autocomplete="current-password"]')
      .fill(account.password);
    await page.getByTestId("password-login-submit").click();
  }

  /** Sign in at `/login?returnTo=/account` and land on the cabinet. */
  async function signInToAccount(
    page: Page,
    account: { email: string; password: string },
  ): Promise<void> {
    await openSettled(
      page,
      `${host.loginPath}?returnTo=${encodeURIComponent(ACCOUNT)}`,
    );
    await signInHere(page, account);
    await expect(page).toHaveURL(`${base}${ACCOUNT}`);
    await expect(page.getByText(account.email)).toBeVisible();
  }

  /**
   * End the browser's session SERVER-SIDE, leaving its cookie in place: the
   * product's logout command for that `sid`, sent from a separate context with
   * the browser's own fingerprint headers (UA + accept-language; same runner
   * IP), so the api deletes the record and the Set-Cookie clears nothing the
   * browser holds.
   */
  async function expireSessionServerSide(page: Page): Promise<void> {
    const cookie = (await page.context().cookies()).find(
      (c) => c.name === SESSION_COOKIE,
    );
    expect(cookie?.value, "the browser holds a session cookie").toBeTruthy();
    const probe = page.waitForRequest(
      (req) => new URL(req.url()).pathname === "/v1/me/profile",
    );
    const own = await page.evaluate(async () => {
      const res = await fetch("/v1/me/profile", { credentials: "include" });
      return res.status;
    });
    expect(own, "the session is live before it is expired").toBe(200);
    const headers = await (await probe).allHeaders();
    const sameDevice: Record<string, string> = {
      cookie: `${SESSION_COOKIE}=${cookie!.value}`,
      "user-agent": headers["user-agent"] ?? "",
      origin: base,
    };
    if (headers["accept-language"])
      sameDevice["accept-language"] = headers["accept-language"];

    const api = await playwrightRequest.newContext({
      baseURL: base,
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    try {
      const logout = await api.post("/v1/auth/logout", { headers: sameDevice });
      expect(
        logout.status(),
        `server-side logout of the browser's sid — ${await logout.text()}`,
      ).toBe(200);
      const session = await api.get("/v1/auth/session", { headers: sameDevice });
      expect(session.status(), "the sid no longer resolves").toBe(401);
    } finally {
      await api.dispose();
    }

    // The expiry case, not the signed-out one: the cookie is still held.
    const held = (await page.context().cookies()).find(
      (c) => c.name === SESSION_COOKIE,
    );
    expect(held?.value, "the browser still holds the dead cookie").toBe(
      cookie!.value,
    );
  }

  test.describe(`#3151 /account auth paths on the ${host.id} storefront`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    // Each test provisions an account through a mail round trip.
    test.setTimeout(120_000);
    // The reset request is captcha-gated: the stub on a slot, nothing on a
    // local stand booted with bot protection off (`captcha-stub.ts`).
    test.beforeEach(async ({ context, page }) => {
      watchEntries(page, base);
      await prepareCaptchaForJourney(
        context,
        base,
        process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
      );
    });

    test(`#3151 (${host.id}): an expired session on /account bounces to login carrying returnTo=/account, and signing in returns to /account`, async ({
      page,
    }) => {
      const account = await provisionAccount();
      await signInToAccount(page, account);

      await expireSessionServerSide(page);

      await page.goto(ACCOUNT);
      // #3172 — the bounce goes through the storefront entry to the sign-in
      // host's form; `returnTo=/account` rides the entry and lives in the
      // transaction, so the landing after signing in below is its proof.
      await expect(page).toHaveURL(
        (url) => url.pathname === host.loginPath && isSignInHostForm(url),
      );
      expect(
        storefrontEntryOf(page),
        "the bounce entered through the storefront's own login entry",
      ).toEqual({ pathname: host.loginPath, returnTo: ACCOUNT });

      await signInHere(page, account);
      await expect(page).toHaveURL(`${base}${ACCOUNT}`);
      await expect(page.getByText(account.email)).toBeVisible();
    });

    test(`#3151 (${host.id}): «Сменить пароль» on /account hands off to reset with returnTo=%2Faccount, and the completed reset returns to /account`, async ({
      page,
    }) => {
      const account = await provisionAccount();
      await signInToAccount(page, account);

      const handoff = page.getByRole("link", { name: "Сменить пароль" });
      await expect(handoff).toHaveAttribute(
        "href",
        `${bound.resetPath}?returnTo=%2Faccount`,
      );
      const entry = page.waitForRequest(
        (req) =>
          req.isNavigationRequest() &&
          req.url() === `${base}${bound.resetPath}?returnTo=%2Faccount`,
      );
      await handoff.click();
      await entry;
      // #3172 — the reset door is the sign-in host's; the return path rides
      // the transaction, and the completed reset landing on /account proves it.
      // The IdP arrives on the host's `/login`, which renders the door the
      // entry chose (`doorFor`, apps/login/lib/sign-in-entry.ts): the reset
      // door is proven by what renders, not by the path.
      await expect(page).toHaveURL((url) => isSignInHostForm(url));
      await expect(page.getByTestId("reset-request-submit")).toBeVisible();
      await page.waitForLoadState("networkidle");

      const before = await captureAddressedMailCheckpoint(
        mail,
        mailbox,
        account.email,
      );
      await page.locator('input[autocomplete="username"]').fill(account.email);
      await page.getByTestId("reset-request-submit").click();
      const code = await fetchRecoveryCode(
        mail,
        mailbox,
        account.email,
        before,
        "reset",
      );

      const replacement = newPassword("new");
      await page.locator('input[autocomplete="one-time-code"]').fill(code);
      const fresh = page.locator('input[autocomplete="new-password"]');
      await fresh.fill(replacement);
      await fresh.press("Enter");

      await expect(page).toHaveURL(`${base}${ACCOUNT}`);
      await expect(page.getByText(account.email)).toBeVisible();
      // The return is a signed-in one: the cabinet's own read answers.
      const own = await page.evaluate(async () => {
        const res = await fetch("/v1/me/profile", { credentials: "include" });
        return res.status;
      });
      expect(own).toBe(200);
    });
  });
}
