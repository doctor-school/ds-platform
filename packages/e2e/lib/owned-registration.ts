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

/** Shared by registration acceptance and the owned password-reset prerequisites. */
export async function registerOwnedCredentials(
  page: Page,
  base: string,
  account: OwnedCredentials,
): Promise<{ response: Response; code: string }> {
  await page.goto(`${base}/register`, { waitUntil: "load" });
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
