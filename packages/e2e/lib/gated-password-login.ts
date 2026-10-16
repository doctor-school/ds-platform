import { expect, request, type Page } from "@playwright/test";

import { goldenDoctorPassword } from "./golden.js";
import { runGatedLoginAttempt } from "./login-failure-gate.js";
import { resolveWorkerGoldenDoctor } from "./worker-golden.js";

/** Golden seed whose worker-pool account closes each gated attempt (#2956). */
const CLOSING_SEED = "verified-cardiologist";

/** A successful password sign-in of the worker's golden doctor, cookie-free. */
async function closeWithGoldenSignIn(origin: string): Promise<void> {
  const doctor = resolveWorkerGoldenDoctor(CLOSING_SEED);
  // The stage basic-auth pair, read exactly as `playwright.config.ts` reads it.
  const user = process.env.E2E_HTTP_USER;
  const pass = process.env.E2E_HTTP_PASS;
  const context = await request.newContext({
    baseURL: origin,
    ...(user && pass
      ? { httpCredentials: { username: user, password: pass } }
      : {}),
  });
  try {
    const response = await context.post("/v1/auth/login", {
      data: {
        identifier: doctor.email,
        password: goldenDoctorPassword(doctor),
      },
    });
    expect(
      response.status(),
      "the closing golden sign-in clears the login-failure window",
    ).toBe(200);
  } finally {
    await context.dispose();
  }
}

/**
 * Wraps a step's password-form submit (register the response capture, click,
 * await the answer) so that no other password-login attempt runs alongside it
 * and any failure it causes is cleared before the next one. `page` must be on
 * the host's login route: its origin is where the closing sign-in goes.
 */
export async function gatedPasswordLogin<T>(
  page: Page,
  attempt: () => Promise<T>,
): Promise<T> {
  const origin = new URL(page.url()).origin;
  return runGatedLoginAttempt(
    { close: () => closeWithGoldenSignIn(origin) },
    attempt,
  );
}
