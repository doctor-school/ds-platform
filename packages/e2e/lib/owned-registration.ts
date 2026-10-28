import {
  expect,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";
import { captureResponse } from "./captured-response.js";
import { signInHostApiPath } from "./sign-in-host-api.js";
import { watchStorefrontEntries } from "./storefront-entry-watch.js";
import {
  captureAddressedMailCheckpoint,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "./mailpit.js";

export interface OwnedCredentials {
  email: string;
  password: string;
}

export async function inputSecret(
  locator: Locator,
  value: string,
): Promise<void> {
  await locator.waitFor({ state: "visible" });
  // evaluate keeps secret values out of Playwright fill() timeout call logs.
  await locator.evaluate((element, text) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(element, text);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

function parsedObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** 003 EARS-20: project the empty-consent probe without retaining secrets. */
export function consentRefusalEvidence(
  requestText: string,
  responseText: string,
  account: OwnedCredentials,
) {
  const request = parsedObject(requestText);
  const response = parsedObject(responseText);
  return {
    credentialsMatch:
      request.email === account.email && request.password === account.password,
    consentAbsent:
      Array.isArray(request.consent) && request.consent.length === 0,
    refusalMatches:
      Object.keys(response).length === 3 &&
      response.statusCode === 400 &&
      response.message === "the request could not be completed" &&
      response.error === "Bad Request",
  };
}

/** Shared absent-session proof for pending registration and consent refusal. */
export async function assertNoPrivateRegistrationAccess(
  page: Page,
  setCookie: string,
  account: OwnedCredentials,
): Promise<void> {
  const sessionName = "__Host-ds_session";
  expect(
    setCookie.includes(`${sessionName}=`),
    "registration minted no private session",
  ).toBe(false);
  const cookies = await page.context().cookies();
  expect(
    cookies.some((cookie) => cookie.name === sessionName),
    "browser has no private session",
  ).toBe(false);
  expect(
    cookies.some((cookie) => cookie.value.includes(account.password)),
    "cookies contain no registration password",
  ).toBe(false);
  const exposed = await page.evaluate((password) => {
    const readable = JSON.stringify({
      url: location.href,
      cookie: document.cookie,
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
    });
    return (
      readable.includes(password) ||
      readable.includes(encodeURIComponent(password)) ||
      /__Host-ds_session|access[_-]?token|refresh[_-]?token|eyJ[\w-]+\.[\w-]+\.[\w-]+/i.test(
        readable,
      )
    );
  }, account.password);
  expect(
    exposed,
    "URL and JavaScript-readable stores expose no password or tokens",
  ).toBe(false);
  expect(
    await page.evaluate(
      async () =>
        (await fetch("/v1/me/profile", { credentials: "include" })).status,
    ),
    "registration cannot read a private profile",
  ).toBe(401);
}

/** Return only booleans so an assertion can never print credential-bearing bytes. */
export function registrationEvidence(
  requestText: string,
  responseText: string,
  account: OwnedCredentials,
) {
  const request = parsedObject(requestText);
  const response = parsedObject(responseText);
  return {
    credentialsMatch:
      request.email === account.email && request.password === account.password,
    consentMatches: academyConsentMatches(request.consent),
    acknowledgementMatches:
      Object.keys(response).length === 1 &&
      response.status === "pending_verification",
  };
}

/*
 * The evidence contract on the sign-in host (ADR-0015 §4, #3172; 003 EARS-5
 * amended, EARS-39 host, EARS-24 host warm step). The credential step moved off
 * the storefront, so each property the storefront-hosted evidence proved is now
 * asserted where it is carried:
 *
 *   old (storefront command)              → now
 *   code accepted, `{status:"verified"}`  → the host command answers exactly
 *                                           `{status:"redirect", url}`, `url`
 *                                           being the ORIGINATING storefront's
 *                                           `/auth/callback` (its origin + path,
 *                                           an authorization `code` + `state`,
 *                                           no `error`) — the transaction's own
 *                                           client, never «some redirect»
 *                                           ({@link storefrontCallbackAcknowledgement})
 *   account verified, signed in           → the journey lands on the storefront
 *                                           with a fresh `__Host-ds_session`
 *                                           (`lib/secure-session.ts`, at the
 *                                           calling step's landing)
 *   held password rides with the code     → unchanged on the WARM step (the
 *                                           host renders the code step in place,
 *                                           003 EARS-24): the code command
 *                                           carries `registration` with exactly
 *                                           the typed password and the ticked
 *                                           consent (EARS-41/23). Only the COLD
 *                                           step (after a reload, EARS-41) sends
 *                                           the code alone, the password nowhere
 *                                           in its body
 *                                           ({@link coldVerificationEvidence})
 *   refusal shape / no enumeration / copy → unchanged: the host command keeps
 *                                           the storefront's exact 400 body
 *                                           ({@link verificationRefusalEvidence})
 *                                           and the form keeps its error copy
 */

/**
 * The host's success answer for a credential step: exactly
 * `{ status: "redirect", url }` whose `url` is the `/auth/callback` of the
 * storefront `base` the transaction belongs to (one registered `redirect_uri`
 * per storefront client, 003 EARS-61/62), carrying the IdP's `code` + `state`.
 */
export function storefrontCallbackAcknowledgement(
  responseText: string,
  base: string,
): boolean {
  const response = parsedObject(responseText);
  if (
    Object.keys(response).length !== 2 ||
    response.status !== "redirect" ||
    typeof response.url !== "string"
  )
    return false;
  let url: URL;
  try {
    url = new URL(response.url);
  } catch {
    return false;
  }
  return (
    url.origin === new URL(base).origin &&
    url.pathname === "/auth/callback" &&
    Boolean(url.searchParams.get("code")) &&
    Boolean(url.searchParams.get("state")) &&
    !url.searchParams.has("error")
  );
}

/** 003 EARS-20: the Academy consent contract (apps/portal/lib/auth-flow.host-config.ts). */
function academyConsentMatches(consent: unknown): boolean {
  const accepted =
    Array.isArray(consent) && consent.length === 1 ? consent[0] : null;
  return (
    accepted !== null &&
    typeof accepted === "object" &&
    Object.keys(accepted).length === 2 &&
    accepted.purpose === "tos" &&
    accepted.version === "2026-01"
  );
}

/**
 * Which code step sent the command: `warm` — the in-place step right after the
 * accepted registration form, holding the typed values (003 EARS-24/41);
 * `cold` — the step reached after a reload, holding nothing (003 EARS-41).
 */
type CodeStep = "warm" | "cold";

/**
 * The code command names the owned address and code on the host form state;
 * the warm step carries exactly the typed password and ticked consent as
 * `registration`, the cold step no registration value and no password.
 */
function codeCommandMatches(
  requestText: string,
  account: OwnedCredentials,
  code: string,
  step: CodeStep,
): boolean {
  const request = parsedObject(requestText);
  const addressed =
    request.email === account.email &&
    request.code === code &&
    typeof request.authRequest === "string" &&
    request.authRequest.length > 0;
  if (step === "cold")
    return (
      addressed &&
      !Object.hasOwn(request, "registration") &&
      !requestText.includes(account.password)
    );
  const registration = request.registration;
  return (
    addressed &&
    registration !== null &&
    typeof registration === "object" &&
    !Array.isArray(registration) &&
    Object.keys(registration).length === 2 &&
    (registration as Record<string, unknown>).password === account.password &&
    academyConsentMatches((registration as Record<string, unknown>).consent)
  );
}

/**
 * 003 EARS-3/41: the warm in-place code step's command and answer, secrets
 * projected to booleans before assertions can include response diagnostics.
 */
export function verificationEvidence(
  requestText: string,
  responseText: string,
  account: OwnedCredentials,
  code: string,
  base: string,
) {
  return {
    credentialsMatch: codeCommandMatches(requestText, account, code, "warm"),
    acknowledgementMatches: storefrontCallbackAcknowledgement(
      responseText,
      base,
    ),
  };
}

/** 003 EARS-41: a cold confirmation submits the code alone (plus the form-post fields). */
export function coldVerificationEvidence(
  requestText: string,
  responseText: string,
  account: OwnedCredentials,
  code: string,
  base: string,
) {
  const request = parsedObject(requestText);
  return {
    credentialsMatch: codeCommandMatches(requestText, account, code, "cold"),
    codeOnly:
      Object.keys(request).length === 4 &&
      ["email", "code", "authRequest", "csrf"].every((key) =>
        Object.hasOwn(request, key),
      ),
    acknowledgementMatches: storefrontCallbackAcknowledgement(
      responseText,
      base,
    ),
  };
}

export function registrationUrl(base: string, returnTo?: "/account"): string {
  if (returnTo !== undefined && returnTo !== "/account")
    throw new Error("Unsupported owned registration return target");
  return `${base}/register${returnTo ? `?${new URLSearchParams({ returnTo })}` : ""}`;
}

export function differentVerificationCode(delivered: string): string {
  if (!/^\d{6}$/.test(delivered)) {
    throw new Error("Expected a delivered six-digit confirmation code");
  }
  return `${(Number(delivered[0]) + 1) % 10}${delivered.slice(1)}`;
}

/** Keep refusal diagnostics safe even if the server echoes submitted secrets. */
export function verificationRefusalEvidence(
  requestText: string,
  responseText: string,
  account: OwnedCredentials,
  delivered: string,
  submitted: string,
) {
  const response = parsedObject(responseText);
  return {
    credentialsMatch: codeCommandMatches(
      requestText,
      account,
      submitted,
      "warm",
    ),
    wrongCode:
      /^\d{6}$/.test(delivered) &&
      /^\d{6}$/.test(submitted) &&
      submitted !== delivered,
    refusalMatches:
      Object.keys(response).length === 3 &&
      response.statusCode === 400 &&
      response.message === "the request could not be completed" &&
      response.error === "Bad Request",
  };
}

/** Shared by registration acceptance and the owned password-reset prerequisites. */
export async function registerOwnedCredentials(
  page: Page,
  base: string,
  account: OwnedCredentials,
  returnTo?: "/account",
): Promise<{ response: Response; body: string; code: string }> {
  // #3172 — the caller can prove the return path by the entry it rode.
  watchStorefrontEntries(page, base);
  await page.goto(registrationUrl(base, returnTo), { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  return submitOwnedRegistration(page, base, account);
}

/**
 * The sign-in host's registration form, already open on `page` (reached from
 * {@link registerOwnedCredentials}' storefront entry, or from a page CTA such
 * as the event page's «Участвовать»): fills it, submits, waits for the code
 * step and returns the delivered code. `base` is the storefront the journey
 * started on (its mailbox and its callback).
 */
export async function submitOwnedRegistration(
  page: Page,
  base: string,
  account: OwnedCredentials,
): Promise<{ response: Response; body: string; code: string }> {
  await inputSecret(page.locator('input[autocomplete="email"]'), account.email);
  await inputSecret(
    page.locator('input[autocomplete="new-password"]'),
    account.password,
  );
  const mailbox = process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(base);
  const before = await captureAddressedMailCheckpoint(
    nativeRecoveryMail(),
    mailbox,
    account.email,
  );
  // The form navigates to the code step on success, so the body is kept at
  // arrival (lib/captured-response.ts) for the caller's evidence.
  const registered = captureResponse(
    page,
    signInHostApiPath("/v1/auth/register"),
  );
  await page.getByTestId("register-submit").click();
  const { response, body } = await registered;
  expect(response.ok(), "owned account registration accepted").toBe(true);
  await page.waitForURL((url) => url.pathname === "/verify");
  await page.waitForLoadState("networkidle");
  const code = await fetchRecoveryCode(
    nativeRecoveryMail(),
    mailbox,
    account.email,
    before,
    "register",
  );
  return { response, body, code };
}
