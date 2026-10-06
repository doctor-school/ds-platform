import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { installCaptchaStub } from "../lib/captcha-stub.js";
import { resolveGoldenDoctor } from "../lib/golden.js";
import {
  assertNoAddressedMail,
  mailpitUrlFor,
  waitForResetMail,
} from "../lib/mailpit.js";
import { Then, When } from "./support/fixtures.js";

interface ResetObservation {
  email: string;
  requestedAt: string;
  body: unknown;
}
const observations = new WeakMap<Page, ResetObservation[]>();

When(
  "a guest requests password resets through Academy for a seeded and a unique unregistered email",
  async ({ page, world }) => {
    expect(world.host.id).toBe("academy");
    await installCaptchaStub(page);
    const results: ResetObservation[] = [];
    for (const email of [
      resolveGoldenDoctor("verified-cardiologist").email,
      `reset-2643-${randomUUID()}@example.test`,
    ]) {
      await page.goto(`${world.hostBaseUrl}/reset`, { waitUntil: "load" });
      await page.waitForLoadState("networkidle");
      await page.locator('input[autocomplete="username"]').fill(email);
      const requestedAt = new Date().toISOString();
      const responsePending = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/v1/auth/password/reset" &&
          response.request().method() === "POST",
      );
      await page.getByTestId("reset-request-submit").click();
      const response = await responsePending;
      expect(response.status(), "reset request status").toBe(200);
      const body: unknown = await response.json();
      expect(body, "neutral reset acknowledgement").toEqual({
        status: "reset_requested",
      });
      await expect(
        page.locator('input[autocomplete="one-time-code"]'),
      ).toBeVisible();
      await expect(
        page.locator('input[autocomplete="new-password"]'),
      ).toBeVisible();
      await expect(page.locator('form button[type="submit"]')).toBeVisible();
      await expect(page.getByTestId("reset-restart")).toBeVisible();
      await expect(page.getByTestId("reset-resend")).toBeVisible();
      // Keep the identifier out of assertion diagnostics.
      expect(
        await page
          .locator("strong")
          .evaluateAll(
            (elements, submitted) =>
              elements.some((element) => element.textContent === submitted),
            email,
          ),
        "complete step retains submitted identifier",
      ).toBe(true);
      await expect(page.getByTestId("reset-error")).toHaveCount(0);
      expect(
        (await response.headerValue("set-cookie"))?.includes(
          "__Host-ds_session=",
        ) ?? false,
        "request sets no private session",
      ).toBe(false);
      expect(
        (await page.context().cookies()).some(
          (cookie) => cookie.name === "__Host-ds_session",
        ),
        "browser has no private session",
      ).toBe(false);
      expect(
        await page.evaluate(
          async () =>
            (await fetch("/v1/me/profile", { credentials: "include" })).status,
        ),
        "private profile remains inaccessible",
      ).toBe(401);
      results.push({ email, requestedAt, body });
    }
    observations.set(page, results);
  },
);

Then(
  "both reset requests have identical acknowledgements and complete-step controls without a private session",
  async ({ page }) => {
    const results = observations.get(page);
    expect(results?.length, "both reset observations captured").toBe(2);
    expect(results![0]!.body).toEqual(results![1]!.body);
  },
);

Then(
  "fresh reset mail reaches only the seeded email while the unregistered email receives no mail for 15 seconds",
  async ({ page, request, world }) => {
    const results = observations.get(page);
    expect(results?.length, "reset requests were captured").toBe(2);
    const root =
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl);
    const known = results![0]!;
    const unknown = results![1]!;
    // Positive delivery first prevents a dead pipeline from proving absence.
    await waitForResetMail(request, root, known.email, known.requestedAt);
    await assertNoAddressedMail(
      request,
      root,
      unknown.email,
      unknown.requestedAt,
    );
  },
);
