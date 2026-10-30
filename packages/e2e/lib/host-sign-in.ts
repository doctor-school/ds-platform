import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import type { HostId } from "../hosts.js";
import { prepareCaptchaForJourney } from "./captcha-stub.js";
import {
  captureAddressedMailCheckpoint,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "./mailpit.js";
import { inputSecret } from "./owned-registration.js";
import { signInWithPassword } from "./sign-in.js";
import { isSignInHostForm } from "./sign-in-host-api.js";
import { standHttpCredentials } from "./stand-http-credentials.js";

/**
 * Sign-in and account provisioning for the browser tiers, the production way
 * (ADR-0015 §4, #3172, #3565): through the storefront's `/login` / `/register`
 * entry, the IdP and the sign-in host's own form — never a storefront
 * credential command. The storefront session a test then carries is the one
 * the storefront's `/auth/callback` minted from the host's sign-in, linked to
 * the sign-in host exactly as a doctor's is.
 *
 * Every helper drives a REAL browser context: the host form state is bound to
 * the auth request the IdP handed the browser and to the browser's cookies,
 * and the storefront session to the browser's fingerprint, so a request
 * context cannot stand in for either.
 */

export interface PasswordCredentials {
  readonly email: string;
  readonly password: string;
}

/** The storefront login entry; both storefronts mount it at `/login`. */
const LOGIN_PATH = "/login";

/**
 * A fresh browser context the stand's basic-auth gate lets through, with the
 * journey's captcha adapter (the stub on a slot, nothing on a local stand
 * booted with bot protection off) — the host form may carry the widget.
 */
async function freshContext(
  browser: Browser,
  base: string,
): Promise<BrowserContext> {
  const httpCredentials = standHttpCredentials();
  const context = await browser.newContext({
    locale: "ru-RU",
    ...(httpCredentials ? { httpCredentials } : {}),
  });
  try {
    await prepareCaptchaForJourney(
      context,
      base,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
  } catch (error) {
    await context.close();
    throw error;
  }
  return context;
}

/**
 * Sign `page` in on the storefront at `base` with `credentials` through the
 * sign-in host's password form, leaving it on the storefront origin off the
 * login route. The session lives in `page`'s context.
 */
export async function signInPageThroughHost(
  page: Page,
  base: string,
  credentials: PasswordCredentials,
): Promise<void> {
  await signInWithPassword(
    page,
    { loginPath: LOGIN_PATH },
    credentials,
    base.replace(/\/$/, ""),
  );
}

/** The browser `page` runs in, for a detached context beside it. */
export function browserOf(page: Page): Browser {
  const browser = page.context().browser();
  if (!browser) throw new Error("the page has no browser to open a context in");
  return browser;
}

/** End `page`'s storefront session with the product's logout command. */
async function revokeSession(page: Page): Promise<void> {
  const statuses = await page.evaluate(async () => {
    const logout = await fetch("/v1/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    const session = await fetch("/v1/auth/session", {
      credentials: "include",
      cache: "no-store",
    });
    const profile = await fetch("/v1/me/profile", {
      credentials: "include",
      cache: "no-store",
    });
    return {
      logout: logout.status,
      session: session.status,
      profile: profile.status,
    };
  });
  expect(statuses, "the closing session is revoked").toEqual({
    logout: 200,
    session: 401,
    profile: 401,
  });
}

/**
 * A successful password sign-in on the storefront at `base` from a FRESH
 * browser context, closed afterwards — the caller's own contexts never see it.
 * What closes a login-failure window (`login-failure-gate.ts`): the host's
 * password step clears the IP's failure count exactly as the storefront's did.
 * `revoke` also ends the session it minted (an owned account's closure).
 */
export async function signInDetachedThroughHost(
  browser: Browser,
  base: string,
  credentials: PasswordCredentials,
  options: { readonly revoke?: boolean } = {},
): Promise<void> {
  const origin = base.replace(/\/$/, "");
  const context = await freshContext(browser, origin);
  try {
    const page = await context.newPage();
    await signInPageThroughHost(page, origin, credentials);
    if (options.revoke) await revokeSession(page);
  } finally {
    await context.close();
  }
}

/**
 * The owned-account closure of a gated password attempt (#2956): the owner's
 * successful sign-in, its session revoked. A closure failure fails the step
 * unless the attempt itself already failed — then the attempt's failure is the
 * one reported and the closure's is annotated for the lead.
 */
export async function closeOwnedLoginWindow(
  browser: Browser,
  base: string,
  credentials: PasswordCredentials,
  attemptFailed: boolean,
): Promise<void> {
  try {
    await signInDetachedThroughHost(browser, base, credentials, {
      revoke: true,
    });
  } catch (error) {
    if (!attemptFailed) throw error;
    test.info().annotations.push({
      type: "cleanup-failed",
      description:
        "Owned login closure failed; original password attempt failure retained; lead must inspect scoped cleanup.",
    });
  }
}

/** Put a consent into the ticked state through its label (idempotent). */
export async function tickConsent(page: Page, testId: string): Promise<void> {
  const box = page.getByTestId(testId);
  if (!(await box.isChecked())) {
    await box.locator("xpath=ancestor::label[1]").click();
  }
  await expect(box).toBeChecked({ timeout: 2_000 });
}

/**
 * The consents a storefront's registration door requires before it submits
 * (each host's auth-flow config): the doctor door's medical-worker declaration
 * and partner-data sharing (021 EARS-5); the academy door none.
 */
const REQUIRED_REGISTRATION_CONSENTS: Readonly<
  Record<HostId, readonly string[]>
> = {
  academy: [],
  doctor: ["register-medworker", "register-partner-data"],
};

/**
 * A confirmed account on the storefront at `base`, registered through its
 * `/register` entry and the sign-in host's registration + code steps, in a
 * fresh browser context closed afterwards. Account state is host-independent
 * (one API, one database), so the account then signs in on either storefront.
 */
export async function provisionConfirmedAccount(
  browser: Browser,
  host: HostId,
  base: string,
  account: PasswordCredentials,
): Promise<void> {
  const origin = base.replace(/\/$/, "");
  const mailbox = (
    process.env.E2E_MAILPIT_URL ??
    process.env.MAILPIT_URL ??
    mailpitUrlFor(origin)
  ).replace(/\/$/, "");
  const context = await freshContext(browser, origin);
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/register`, { waitUntil: "load" });
    await page.waitForLoadState("networkidle");
    expect(
      isSignInHostForm(page.url()),
      `the ${host} storefront /register leads to the sign-in host form`,
    ).toBe(true);
    // A value typed into the pre-hydration DOM is discarded by the first
    // client render; the form is filled once the door agrees it is complete.
    await expect(async () => {
      for (const consent of REQUIRED_REGISTRATION_CONSENTS[host])
        await tickConsent(page, consent);
      await inputSecret(page.getByTestId("register-email"), account.email);
      await inputSecret(
        page.getByTestId("register-password"),
        account.password,
      );
      await expect(page.getByTestId("register-submit")).toBeEnabled({
        timeout: 2_000,
      });
    }).toPass({ timeout: 15_000 });
    const mail = nativeRecoveryMail();
    const before = await captureAddressedMailCheckpoint(
      mail,
      mailbox,
      account.email,
    );
    await page.getByTestId("register-submit").click();
    await page.waitForURL((url) => url.pathname === "/verify");
    await expect(page.getByTestId("verify-submit")).toBeVisible();
    const code = await fetchRecoveryCode(
      mail,
      mailbox,
      account.email,
      before,
      "register",
    );
    // The slotted OTP field auto-submits on completion (#175).
    await inputSecret(
      page.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    // The accepted code signs the new account in and lands it back on the
    // storefront: the landing is the proof the account is confirmed.
    await page.waitForURL((url) => url.origin === new URL(origin).origin);
  } finally {
    await context.close();
  }
}
