import type { Page } from "@playwright/test";

import { goldenDoctorPassword } from "./golden.js";
import { browserOf, signInDetachedThroughHost } from "./host-sign-in.js";
import { runGatedLoginAttempt } from "./login-failure-gate.js";
import { resolveWorkerGoldenDoctor } from "./worker-golden.js";

/** Golden seed whose worker-pool account closes each gated attempt (#2956). */
const CLOSING_SEED = "verified-cardiologist";

/**
 * A successful password sign-in of the worker's golden doctor on the storefront
 * at `base`, through the sign-in host in a fresh browser context the probe
 * never sees (#3565).
 */
async function closeWithGoldenSignIn(page: Page, base: string): Promise<void> {
  const doctor = resolveWorkerGoldenDoctor(CLOSING_SEED);
  await signInDetachedThroughHost(browserOf(page), base, {
    email: doctor.email,
    password: goldenDoctorPassword(doctor),
  });
}

/**
 * Wraps a step's password-form submit (register the response capture, click,
 * await the answer) so that no other password-login attempt runs alongside it
 * and any failure it causes is cleared before the next one. `page` is on the
 * sign-in host's password form; `base` is the storefront the journey entered
 * from, where the closing sign-in enters too.
 */
export async function gatedPasswordLogin<T>(
  page: Page,
  base: string,
  attempt: () => Promise<T>,
): Promise<T> {
  return runGatedLoginAttempt(
    { close: () => closeWithGoldenSignIn(page, base) },
    attempt,
  );
}
