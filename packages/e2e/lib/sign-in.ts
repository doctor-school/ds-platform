import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import type { HostConfig } from "../hosts.js";
import { goldenDoctorPassword } from "./golden.js";
import type { GoldenDoctor } from "./golden.js";
import { resolveWorkerGoldenDoctor } from "./worker-golden.js";

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
 * True once React has hydrated `node`: React stamps a `__reactProps$<id>` key on
 * every DOM node it hydrates, and only then are the node's handlers (the login
 * form's `onSubmit`) attached. Self-contained so Playwright can serialise it
 * into `page.waitForFunction`.
 */
export function isReactHydrated(node: object | null): boolean {
  return (
    node !== null &&
    Object.keys(node).some((key) => key.startsWith("__reactProps$"))
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
 * `/v1/auth/login` is never called and the doctor is never signed in. Hence the
 * walk waits until React has hydrated the login `<form>` itself
 * ({@link isReactHydrated}). `networkidle` is not that signal: a login page
 * carrying the real Yandex SmartCaptcha widget (every slot) keeps the widget
 * iframe's Metrika beacons in flight, so the wait never settles (#3229: a slot
 * run sat in it until the 120 s test timeout).
 */
export async function signInGoldenDoctor(
  page: Page,
  host: HostConfig,
  seedName: string,
  baseUrl?: string,
): Promise<GoldenDoctor> {
  const doctor = resolveWorkerGoldenDoctor(seedName);
  await signInWithPassword(
    page,
    host,
    { email: doctor.email, password: goldenDoctorPassword(doctor) },
    baseUrl,
  );
  return doctor;
}

/**
 * The same 003 password sign-in for an account the CALLER names (a live spec's
 * `E2E_DOCTOR_EMAIL` / `E2E_DOCTOR_PASSWORD`, which a slot derives from the
 * golden verified doctor). One walk with {@link signInGoldenDoctor}, so the
 * hydration wait above covers every live spec: #3229 found
 * `webinar-archive.spec.ts` carrying its own `domcontentloaded` copy that
 * clicked «Войти» before hydration — a native `POST /login`, no
 * `/v1/auth/login`, the page left on `/login` until the test timed out.
 */
export async function signInWithPassword(
  page: Page,
  host: HostConfig,
  credentials: { readonly email: string; readonly password: string },
  baseUrl?: string,
): Promise<void> {
  await page.goto(`${baseUrl ?? ""}${host.loginPath}`, { waitUntil: "load" });
  const form = page.locator("form", {
    has: page.locator('input[autocomplete="current-password"]'),
  });
  await expect(form).toHaveCount(1);
  await page.waitForFunction(isReactHydrated, await form.elementHandle());
  await page.locator('input[autocomplete="username"]').fill(credentials.email);
  await page
    .locator('input[autocomplete="current-password"]')
    .fill(credentials.password);
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
}
