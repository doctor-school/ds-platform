import {
  expect,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";
import {
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
  const consent = request.consent;
  const accepted =
    Array.isArray(consent) && consent.length === 1 ? consent[0] : null;
  return {
    credentialsMatch:
      request.email === account.email && request.password === account.password,
    // 003 EARS-20: apps/portal/lib/auth-flow.host-config.ts consents contract.
    consentMatches:
      accepted !== null &&
      typeof accepted === "object" &&
      Object.keys(accepted).length === 2 &&
      accepted.purpose === "tos" &&
      accepted.version === "2026-01",
    acknowledgementMatches:
      Object.keys(response).length === 1 &&
      response.status === "pending_verification",
  };
}

/** Project secrets to booleans before assertions can include response diagnostics. */
export function verificationEvidence(
  requestText: string,
  responseText: string,
  account: OwnedCredentials,
  code: string,
) {
  const request = parsedObject(requestText);
  const response = parsedObject(responseText);
  const registration = request.registration;
  return {
    credentialsMatch:
      request.email === account.email &&
      registration !== null &&
      typeof registration === "object" &&
      "password" in registration &&
      registration.password === account.password &&
      request.code === code,
    acknowledgementMatches:
      Object.keys(response).length === 1 && response.status === "verified",
  };
}

/** 003 EARS-41: a cold confirmation submits no held registration password. */
export function coldVerificationEvidence(
  requestText: string,
  responseText: string,
  account: OwnedCredentials,
  code: string,
) {
  const request = parsedObject(requestText);
  const response = parsedObject(responseText);
  return {
    credentialsMatch: request.email === account.email && request.code === code,
    codeOnly:
      Object.keys(request).length === 2 &&
      Object.hasOwn(request, "email") &&
      Object.hasOwn(request, "code"),
    acknowledgementMatches:
      Object.keys(response).length === 1 && response.status === "verified",
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
    credentialsMatch: verificationEvidence(
      requestText,
      responseText,
      account,
      submitted,
    ).credentialsMatch,
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
): Promise<{ response: Response; code: string }> {
  await page.goto(registrationUrl(base, returnTo), { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  await inputSecret(page.locator('input[autocomplete="email"]'), account.email);
  await inputSecret(
    page.locator('input[autocomplete="new-password"]'),
    account.password,
  );
  const sentAt = new Date().toISOString();
  const registered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/v1/auth/register" &&
      response.request().method() === "POST",
  );
  await page.getByTestId("register-submit").click();
  const response = await registered;
  expect(response.ok(), "owned account registration accepted").toBe(true);
  await page.waitForURL((url) => url.pathname === "/verify");
  await page.waitForLoadState("networkidle");
  const code = await fetchRecoveryCode(
    nativeRecoveryMail(),
    process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(base),
    account.email,
    sentAt,
    "register",
  );
  return { response, code };
}
