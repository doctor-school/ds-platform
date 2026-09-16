import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import type { HostConfig } from "../hosts.js";
import { goldenDoctorPassword, resolveGoldenDoctor } from "./golden.js";
import type { GoldenDoctor } from "./golden.js";

/**
 * The query parameter a NOT-yet-hydrated login `<form>` puts in the address bar
 * when the browser submits it natively: the identifier box is
 * `name="identifier"`, so a native GET submit re-loads the login route with the
 * typed credentials as a query string instead of POSTing `/v1/auth/login`.
 */
const NATIVE_SUBMIT_MARKER = "identifier";

/**
 * Names the pre-hydration native submit from the post-click URL alone.
 *
 * Pure so it is unit-testable without a browser: the walk must ACCUSE itself
 * with this message the moment it happens, instead of spending the full
 * `waitForURL` timeout on a login that was never attempted.
 */
export function preHydrationSubmitError(
  url: string,
  loginPath: string,
): string | null {
  const parsed = new URL(url);
  if (!parsed.searchParams.has(NATIVE_SUBMIT_MARKER)) return null;
  return (
    `Pre-hydration native form submit on ${loginPath}: the browser navigated to ` +
    `${parsed.pathname}?${NATIVE_SUBMIT_MARKER}=… instead of POSTing /v1/auth/login. ` +
    `The login card's client bundle had not executed when the submit button was ` +
    `clicked — this is a walk-tooling defect, not a product or API failure.`
  );
}

/**
 * THE golden sign-in — the single login path of the C6 regression contract
 * (staging/regression-contour tech spec §6.1, Issue #2067).
 *
 * Two consumers drive a signed-in doctor: the Gherkin step `Given the golden
 * doctor "<seed>" is signed in` (`steps/golden.steps.ts`) and the derived
 * navigation walk's doctor pass (`derived/navigation.walk.spec.ts`). They call
 * THIS function rather than each carrying their own `goto` + fill + submit, so a
 * change to the login surface is one edit and the two consumers can never
 * disagree about what «signed in» means.
 *
 * It adds NO auth primitive: the sequence is the shipped 008 shell journey's
 * (`apps/portal/e2e/steps/shell.steps.ts`) — open the host's login route, fill
 * the identifier/password fields, submit. Selectors key off stable `autocomplete`
 * attributes rather than visible copy, because the two hosts render different
 * labels (#177): the academy card is `next-intl`, the doctor card is Russian
 * literals. The values are the ones `@ds/design-system`'s `LoginCard` renders:
 * its identifier box is an `IdentifierField` (`autocomplete="username"` — the
 * box is an email-or-phone union, never `email`) and its password box a
 * `PasswordField purpose="current"` (`autocomplete="current-password"`).
 *
 * The wait before the first interaction is load-bearing, not defensive polish.
 * `domcontentloaded` resolves while the Next client chunks are still in flight,
 * and the login card is server-rendered as a real `<form>`: clicking its submit
 * button before those chunks EXECUTE makes the browser submit the form natively
 * (a GET back to the login route with the credentials in the query string), so
 * `/v1/auth/login` is never called and the doctor is never signed in. Hence
 * `waitUntil: "load"` — every subresource, chunks included, has arrived — plus
 * `networkidle`, which additionally covers the chunks React requests only while
 * hydrating. The doctor host is where this bites: its chunk set is the slower of
 * the two, which is why the academy pass could stay green while the doctor pass
 * hung for the full `waitForURL` timeout.
 */
export async function signInGoldenDoctor(
  page: Page,
  host: HostConfig,
  seedName: string,
  baseUrl?: string,
): Promise<GoldenDoctor> {
  const doctor = resolveGoldenDoctor(seedName);
  const password = goldenDoctorPassword(doctor);

  await page.goto(`${baseUrl ?? ""}${host.loginPath}`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  await page.locator('input[autocomplete="username"]').fill(doctor.email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: /войти|продолжить/i }).click();

  // The session cookie is set before the post-login redirect, so leaving the
  // login surface IS the signal that the doctor is signed in. Asserting «not
  // /login» rather than a specific landing keeps the helper reusable: the
  // post-login destination is a product decision each host owns, and the caller
  // asserts where it wanted to end up.
  await page.waitForURL(
    (url) =>
      new URL(url).pathname !== host.loginPath ||
      new URL(url).searchParams.has(NATIVE_SUBMIT_MARKER),
  );
  const nativeSubmit = preHydrationSubmitError(page.url(), host.loginPath);
  if (nativeSubmit) throw new Error(nativeSubmit);
  expect(new URL(page.url()).pathname).not.toBe(host.loginPath);
  return doctor;
}
