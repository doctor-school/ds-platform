import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import {
  failureEvent,
  failureProbe,
  installFailureProvider,
} from "../lib/captcha-failure.js";
import { inputSecret } from "../lib/owned-registration.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

const rejected = "Проверка истекла или не пройдена. Подтвердите ещё раз.";
const unavailable =
  "Не удалось выполнить проверку. Проверьте подключение к интернету и попробуйте ещё раз.";
const required = "Подтвердите, что вы не робот.";
type Theme = "light" | "dark";
interface State {
  context: BrowserContext;
  results: string[];
  themes: number;
}
const states = new WeakMap<Page, State>();
function state(page: Page) {
  const value = states.get(page);
  if (!value) throw new Error("S067 state missing");
  return value;
}

async function theme(page: Page, value: Theme) {
  await page.evaluate((value) => {
    document.documentElement.classList.toggle("dark", value === "dark");
    localStorage.setItem("theme", value);
  }, value);
}
async function open(
  context: BrowserContext,
  base: string,
  initial: Theme,
  path = "register",
) {
  const page = await context.newPage();
  await page.addInitScript(
    (value) => localStorage.setItem("theme", value),
    initial,
  );
  await installFailureProvider(page);
  await page.goto(`${base}/${path}`, { waitUntil: "networkidle" });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(initial === "dark");
  return page;
}
async function calls(page: Page, count: number) {
  await expect
    .poll(async () => (await failureProbe(page)).calls.length)
    .toBe(count);
}

Given(
  "the invisible widget uses the portal's resolved light or dark theme and follows a live theme change",
  async ({ page, browser, httpCredentials, world }) => {
    test.setTimeout(180_000);
    if (process.env.E2E_AUTH_LIMIT_TIER !== "default")
      throw new Error("S067 requires E2E_AUTH_LIMIT_TIER=default");
    if (test.info().config.workers !== 1)
      throw new Error("S067 requires exactly one Playwright worker");
    expect(world.host.id).toBe("academy");
    expect(
      process.env.BOT_PROTECTION_ENABLED,
      "S067 needs the lead-owned deterministic validation endpoint with the real guard enabled",
    ).toBe("true");
    expect(
      process.env.E2E_S067_VALIDATION_CONTOUR,
      "S067 must never send synthetic rejection tokens to the real Yandex service",
    ).toBe("local-provider");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const value: State = { context, results: [], themes: 0 };
    states.set(page, value);
    for (const initial of ["light", "dark"] as const) {
      const owned = await open(context, world.hostBaseUrl, initial);
      await inputSecret(
        owned.getByTestId("register-email"),
        `captcha-theme-3255-${randomUUID()}@example.test`,
      );
      await inputSecret(
        owned.getByTestId("register-password"),
        `Captcha-${randomUUID()}-aA1!`,
      );
      let requests = 0;
      owned.on("request", (request) => {
        if (
          new URL(request.url()).pathname === "/v1/auth/register" &&
          request.method() === "POST"
        )
          requests++;
      });
      await owned.getByTestId("register-submit").click();
      await calls(owned, 1);
      const original = (await failureProbe(owned)).calls[0];
      expect(original).toMatchObject({ theme: initial, invisible: true });
      await failureEvent(owned, 0, "challenge-visible");
      const next = initial === "light" ? "dark" : "light";
      await theme(owned, next);
      await calls(owned, 2);
      const changed = await failureProbe(owned);
      expect(changed.calls[1]).toMatchObject({ theme: next, invisible: true });
      expect(changed.destroyed).toContain(original!.id);
      await failureEvent(owned, 0, "success");
      await failureEvent(owned, 0, "challenge-hidden");
      await expect(owned.getByTestId("register-captcha-error")).toBeHidden();
      expect(
        requests,
        "retired theme callbacks cannot send the pending action",
      ).toBe(0);
      await failureEvent(owned, 1, "network-error");
      await expect(owned.getByTestId("register-captcha-error")).toHaveText(
        unavailable,
      );
      value.themes++;
      await owned.close();
    }
  },
);

When(
  "its token expires, Yandex rejects it, its script or network fails, or an incomplete challenge closes",
  async ({ page, world }) => {
    const value = state(page);
    const variants = [
      { name: "expired", event: "token-expired", copy: rejected },
      { name: "network", event: "network-error", copy: unavailable },
      { name: "script", event: "javascript-error", copy: unavailable },
      { name: "dismissed", event: "challenge-hidden", copy: required },
      { name: "rejected", event: "success", copy: rejected },
    ];
    for (const initial of ["light", "dark"] as const) {
      for (const variant of variants) {
        const owned = await open(value.context, world.hostBaseUrl, initial);
        const email = `captcha-failure-3255-${randomUUID()}@example.test`;
        const password = `Captcha-${randomUUID()}-aA1!`;
        await inputSecret(owned.getByTestId("register-email"), email);
        await inputSecret(owned.getByTestId("register-password"), password);
        const requests: { token: string; email: unknown; password: unknown }[] =
          [];
        owned.on("request", (request) => {
          if (
            request.method() !== "POST" ||
            new URL(request.url()).pathname !== "/v1/auth/register"
          )
            return;
          const body = JSON.parse(request.postData() ?? "{}") as Record<
            string,
            unknown
          >;
          requests.push({
            token: request.headers()["x-smartcaptcha-token"] ?? "",
            email: body.email,
            password: body.password,
          });
        });
        await owned.getByTestId("register-submit").click();
        await calls(owned, 1);
        if (variant.name === "dismissed")
          await failureEvent(owned, 0, "challenge-visible");
        const response =
          variant.name === "rejected"
            ? owned.waitForResponse(
                (response) =>
                  new URL(response.url()).pathname === "/v1/auth/register" &&
                  response.request().method() === "POST",
              )
            : undefined;
        await failureEvent(
          owned,
          0,
          variant.event,
          variant.name === "rejected"
            ? `s067-rejected-${randomUUID()}`
            : undefined,
        );
        if (response) {
          const actual = await response;
          expect(actual.status()).toBe(403);
          expect(await actual.json()).toMatchObject({
            code: "BOT_PROTECTION_REJECTED",
          });
        }
        await expect(owned.getByTestId("register-captcha-error")).toHaveText(
          variant.copy,
        );
        expect(
          (await owned.getByTestId("register-email").inputValue()) === email,
          "entered email preserved",
        ).toBe(true);
        expect(
          (await owned.getByTestId("register-password").inputValue()) ===
            password,
          "entered password preserved",
        ).toBe(true);
        await expect(owned.getByTestId("register-submit")).toBeEnabled();
        const before = variant.name === "rejected" ? 1 : 0;
        expect(
          requests.length,
          "failure sends no action; a guard rejection is the one refused probe",
        ).toBe(before);
        await expect
          .poll(async () =>
            (await failureProbe(owned)).destroyed.includes(
              (await failureProbe(owned)).calls[0]!.id,
            ),
          )
          .toBe(true);
        await failureEvent(owned, 0, "success");
        await failureEvent(owned, 0, "success");
        await owned.getByTestId("register-submit").click();
        await calls(owned, 2);
        const probe = await failureProbe(owned);
        expect(probe.calls[1]!.id).not.toBe(probe.calls[0]!.id);
        await failureEvent(owned, 0, "success");
        expect(
          requests.length,
          "failed callback cannot consume a fresh pending action",
        ).toBe(before);
        const accepted = owned.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/v1/auth/register" &&
            response.request().method() === "POST",
        );
        const freshToken = `s067-valid-${randomUUID()}`;
        await failureEvent(owned, 1, "success", freshToken, true);
        expect((await accepted).ok()).toBe(true);
        await expect.poll(() => new URL(owned.url()).pathname).toBe("/verify");
        expect(requests.length).toBe(before + 1);
        expect(
          requests.at(-1)?.token === freshToken,
          "real request carries the new callback token",
        ).toBe(true);
        expect(
          requests
            .slice(0, -1)
            .every((request) => request.token !== freshToken),
          "one-time token is not reused from a refused attempt",
        ).toBe(true);
        expect(
          requests.at(-1)?.email === email &&
            requests.at(-1)?.password === password,
          "fresh solve uses preserved form values",
        ).toBe(true);
        value.results.push(`${initial}:${variant.name}`);
        await owned.close();
      }
    }
  },
);

Then("the pending action is not sent or replayed", async ({ page }) => {
  expect(state(page).results).toHaveLength(10);
  expect(state(page).themes).toBe(2);
});
Then(
  "the widget and one-time token are reset for a fresh attempt",
  async ({ page }) => {
    expect(state(page).results).toEqual([
      "light:expired",
      "light:network",
      "light:script",
      "light:dismissed",
      "light:rejected",
      "dark:expired",
      "dark:network",
      "dark:script",
      "dark:dismissed",
      "dark:rejected",
    ]);
  },
);
Then(
  "the portal preserves entered form values and shows localized CAPTCHA-specific feedback",
  async ({ page }) => {
    expect(state(page).results).toHaveLength(10);
  },
);
Then(
  "a later successful solve clears only the CAPTCHA-specific feedback",
  async ({ page, world }) => {
    const value = state(page);
    const owned = await open(
      value.context,
      world.hostBaseUrl,
      "light",
      "reset",
    );
    const field = owned.locator('input[autocomplete="username"]');
    await inputSecret(
      field,
      `captcha-scoped-3255-${randomUUID()}@example.test`,
    );
    await owned.getByTestId("reset-request-submit").click();
    await calls(owned, 1);
    await failureEvent(owned, 0, "network-error");
    await expect(owned.getByTestId("reset-error")).toHaveText(unavailable);
    await owned.getByTestId("reset-request-submit").click();
    await calls(owned, 2);
    await expect(owned.getByTestId("reset-error")).toHaveText(unavailable);
    await field.focus();
    await inputSecret(field, "invalid-address");
    await field.blur();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await failureEvent(owned, 1, "success", `s067-slow-valid-${randomUUID()}`);
    await expect(owned.getByTestId("reset-error")).toBeHidden();
    await expect(field).toHaveValue("invalid-address");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(owned.getByTestId("reset-resend")).toBeVisible();
    await owned.close();
  },
);
After("@captcha-failure", async ({ page }) => {
  const value = states.get(page);
  if (!value) return;
  states.delete(page);
  await value.context.close();
});
