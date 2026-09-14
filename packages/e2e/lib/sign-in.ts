import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import type { HostConfig } from "../hosts.js";
import { goldenDoctorPassword, resolveGoldenDoctor } from "./golden.js";
import type { GoldenDoctor } from "./golden.js";

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
 */
export async function signInGoldenDoctor(
  page: Page,
  host: HostConfig,
  seedName: string,
  baseUrl?: string,
): Promise<GoldenDoctor> {
  const doctor = resolveGoldenDoctor(seedName);
  const password = goldenDoctorPassword(doctor);

  await page.goto(`${baseUrl ?? ""}${host.loginPath}`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator('input[autocomplete="username"]').fill(doctor.email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: /войти|продолжить/i }).click();

  // The session cookie is set before the post-login redirect, so leaving the
  // login surface IS the signal that the doctor is signed in. Asserting «not
  // /login» rather than a specific landing keeps the helper reusable: the
  // post-login destination is a product decision each host owns, and the caller
  // asserts where it wanted to end up.
  await page.waitForURL((url) => new URL(url).pathname !== host.loginPath);
  expect(new URL(page.url()).pathname).not.toBe(host.loginPath);
  return doctor;
}
