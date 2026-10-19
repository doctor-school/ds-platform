import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  assertNoPrivateRegistrationAccess,
  inputSecret,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import {
  captureSmsCheckpoint,
  freshConfirmablePhone,
  smsOrigin,
  smsSinkMessages,
  smsSinkUrl,
  type SmsCheckpoint,
} from "../lib/sms-sink.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

const HINT =
  "Код по SMS придёт, только если телефон подтверждён в профиле. Если нет — укажите e-mail.";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface HintJourney extends OwnedCredentials {
  context: BrowserContext;
  visitor: Page;
  phone: string;
  sink: string;
  commands: string[];
  requestedAt?: SmsCheckpoint;
  setCookie: string;
}

const journeys = new WeakMap<Page, HintJourney>();
function journey(page: Page): HintJourney {
  const state = journeys.get(page);
  if (!state) throw new Error("Owned reset-hint visitor is absent");
  return state;
}

Given(
  "an Academy guest opens reset with a fresh unknown phone and a readable SMS sink",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink) throw new Error("Reset-hint proof requires E2E_SMS_SINK_URL");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const visitor = await context.newPage();
    const state: HintJourney = {
      context,
      visitor,
      sink,
      phone: freshConfirmablePhone(),
      email: `reset-hint-2989-${randomUUID()}@example.test`,
      password: `Unused-${randomUUID()}-aA1!`,
      commands: [],
      setCookie: "",
    };
    journeys.set(page, state);
    visitor.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
        path.startsWith("/v1/auth/")
      )
        state.commands.push(path);
    });
    await prepareCaptchaForJourney(
      context,
      world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    expect(
      (await smsSinkMessages(sink, state.phone, smsOrigin(state.phone))).length,
      "fresh owned phone has no prior SMS in the real sink",
    ).toBe(0);
    await visitor.goto(`${world.hostBaseUrl}/reset`, { waitUntil: "load" });
    await visitor.waitForLoadState("networkidle");
    await expect(visitor.getByText(HINT, { exact: true })).toHaveCount(0);
    await assertNoPrivateRegistrationAccess(visitor, "", state);
  },
);

When(
  "the Academy guest types that unknown phone in the real reset identifier field",
  async ({ page }) => {
    const state = journey(page);
    await inputSecret(
      state.visitor.getByLabel("Электронная почта или телефон", {
        exact: true,
      }),
      state.phone,
    );
  },
);

Then(
  "the reset field exposes the approved static SMS eligibility hint accessibly without an auth command",
  async ({ page }) => {
    const state = journey(page);
    await expect(state.visitor.getByText(HINT, { exact: true })).toBeVisible();
    await expect(
      state.visitor.getByLabel("Электронная почта или телефон", {
        exact: true,
      }),
    ).toHaveAccessibleDescription(HINT);
    expect(
      state.commands,
      "typing alone sends no authentication command",
    ).toEqual([]);
  },
);

When(
  "the Academy guest requests a reset code for that unknown phone",
  async ({ page }) => {
    const state = journey(page);
    state.requestedAt = await captureSmsCheckpoint(state.sink, state.phone);
    const pending = captureResponse(state.visitor, "/v1/auth/password/reset");
    await state.visitor.getByTestId("reset-request-submit").click();
    const captured = await pending;
    let exactCommand = false;
    let neutralBody = false;
    try {
      const command = captured.response.request().postDataJSON();
      exactCommand =
        Object.keys(command).join() === "identifier" &&
        command.identifier === state.phone;
      const body: unknown = JSON.parse(captured.body);
      neutralBody =
        body !== null &&
        typeof body === "object" &&
        Object.keys(body).join() === "status" &&
        "status" in body &&
        body.status === "reset_requested";
    } catch {
      // Parse diagnostics may contain the identifier or a provider token.
    }
    expect({
      status: captured.response.status(),
      exactCommand,
      neutralBody,
    }).toEqual({
      status: 200,
      exactCommand: true,
      neutralBody: true,
    });
    state.setCookie = (await captured.response.headerValue("set-cookie")) ?? "";
  },
);

Then(
  "Academy shows the conditional SMS code step and email way out while no addressed SMS arrives for twenty seconds",
  async ({ page }) => {
    const state = journey(page);
    if (!state.requestedAt) throw new Error("Reset request boundary is absent");
    await expect(
      state.visitor.locator('input[autocomplete="one-time-code"]'),
    ).toBeVisible();
    expect(
      await state.visitor.evaluate((phone) => {
        const expected = `Если телефон ${phone} подтверждён в профиле, мы отправили на него код по SMS. Введите его и задайте новый пароль.`;
        const destination = [...document.querySelectorAll("strong")].find(
          (element) => element.textContent === phone,
        );
        return {
          conditional: destination?.parentElement?.textContent === expected,
          unconditional:
            document.body.textContent?.includes(`Код отправлен на ${phone}.`) ??
            false,
        };
      }, state.phone),
      "conditional SMS sentence includes the number exactly as typed in bold",
    ).toEqual({ conditional: true, unconditional: false });
    await expect(state.visitor.getByTestId("reset-restart")).toHaveText(
      "Начать заново",
    );
    await expect(state.visitor.getByTestId("reset-restart")).toBeEnabled();
    await expect(
      state.visitor.getByText("Код действует 1 час.", { exact: true }),
    ).toBeVisible();
    await expect(state.visitor.getByText(HINT, { exact: true })).toHaveCount(0);
    const deadline = Date.now() + 20_000;
    while (true) {
      const finalObservation = Date.now() >= deadline;
      expect(
        (await smsSinkMessages(state.sink, state.phone, state.requestedAt))
          .length,
        "no SMS addressed to the owned unknown phone",
      ).toBe(0);
      if (finalObservation) break;
      await wait(Math.min(500, Math.max(0, deadline - Date.now())));
    }
    await assertNoPrivateRegistrationAccess(
      state.visitor,
      state.setCookie,
      state,
    );
  },
);

When(
  "the Academy guest uses start over and types the owned email instead",
  async ({ page }) => {
    const state = journey(page);
    await state.visitor.getByTestId("reset-restart").click();
    const identifier = state.visitor.getByLabel(
      "Электронная почта или телефон",
      {
        exact: true,
      },
    );
    await expect(identifier).toBeVisible();
    expect(
      (await identifier.inputValue()) === "",
      "restart clears the phone",
    ).toBe(true);
    await inputSecret(identifier, state.email);
  },
);

Then(
  "the reset email field has no SMS hint and the transition grants no private access or extra auth command",
  async ({ page, world }) => {
    const state = journey(page);
    await expect(state.visitor.getByText(HINT, { exact: true })).toHaveCount(0);
    const identifier = state.visitor.getByLabel(
      "Электронная почта или телефон",
      { exact: true },
    );
    expect(
      (await identifier.inputValue()) === state.email,
      "identifier contains the owned email",
    ).toBe(true);
    await expect(identifier).toHaveAccessibleDescription("");
    await expect(
      state.visitor.locator('input[autocomplete="one-time-code"]'),
    ).toHaveCount(0);
    await expect(
      state.visitor.getByTestId("reset-request-submit"),
    ).toBeVisible();
    await state.visitor.waitForLoadState("networkidle");
    expect(state.commands).toEqual(["/v1/auth/password/reset"]);
    expect(new URL(state.visitor.url()).origin).toBe(
      new URL(world.hostBaseUrl).origin,
    );
    expect(new URL(state.visitor.url()).pathname).toBe("/reset");
    await assertNoPrivateRegistrationAccess(
      state.visitor,
      state.setCookie,
      state,
    );
    expect(
      await state.visitor.evaluate(
        async () =>
          (await fetch("/v1/auth/session", { credentials: "include" })).status,
      ),
      "unknown phone reset creates no private principal",
    ).toBe(401);
  },
);

After("@reset-sms-hint", async ({ page }) => {
  const state = journeys.get(page);
  if (!state) return;
  await state.context.close();
  journeys.delete(page);
});
