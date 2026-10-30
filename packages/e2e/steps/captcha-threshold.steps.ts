import { storefrontCallbackAcknowledgement } from "../lib/owned-registration.js";
import { hostCommand, signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import {
  captchaStubScript,
  captchaTestTokenFromEnv,
  installCaptchaStub,
  isSmartCaptchaScriptUrl,
} from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import { runGatedLoginAttempt } from "../lib/login-failure-gate.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";
import { signInDetachedThroughHost } from "../lib/host-sign-in.js";

interface CaptchaObservation {
  executes: number;
  renders: number;
  invisible: boolean;
  solve(): void;
}
interface CaptchaWindow extends Window {
  __threshold3242: CaptchaObservation;
}
interface Threshold {
  context: BrowserContext;
  page: Page;
  email: string;
  password: string;
  wrong: string;
  posts: number;
  idleRenders: number;
  release?: () => void;
  gate?: Promise<void>;
}
const journeys = new WeakMap<Page, Threshold>();
const identifier = (page: Page) => page.locator('input[name="identifier"]');
const password = (page: Page) =>
  page.locator('input[autocomplete="current-password"]');
function journey(key: Page): Threshold {
  const state = journeys.get(key);
  if (!state) throw new Error("Owned threshold journey missing");
  return state;
}
async function observations(page: Page) {
  return page.evaluate(() => {
    const observer = (window as unknown as CaptchaWindow).__threshold3242;
    return {
      renders: observer.renders,
      executes: observer.executes,
      invisible: observer.invisible,
    };
  });
}
async function logout(page: Page) {
  expect(
    await page.evaluate(
      async () =>
        (
          await fetch("/v1/auth/logout", {
            method: "POST",
            credentials: "include",
          })
        ).status,
    ),
    "owned session revoked",
  ).toBe(200);
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === "__Host-ds_session",
    ),
  ).toBe(false);
}

Given(
  "a visitor has entered an identifier and password",
  async ({ page, browser, httpCredentials, world }) => {
    if (process.env.E2E_AUTH_LIMIT_TIER !== "default")
      throw new Error("S065 requires E2E_AUTH_LIMIT_TIER=default");
    if (test.info().config.workers !== 1)
      throw new Error("S065 requires exactly one Playwright worker");
    if (process.env.BOT_PROTECTION_ENABLED !== "true")
      throw new Error("S065 requires BOT_PROTECTION_ENABLED=true");
    expect(world.host.id).toBe("academy");
    const token = captchaTestTokenFromEnv();
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: Threshold = {
      context,
      page: owned,
      email: `captcha-threshold-3242-${randomUUID()}@example.test`,
      password: `Original-${randomUUID()}-aA1!`,
      wrong: `Wrong-${randomUUID()}-aA1!`,
      posts: 0,
      idleRenders: 0,
    };
    journeys.set(page, state);
    await installCaptchaStub(context);
    const { code } = await registerOwnedCredentials(
      owned,
      world.hostBaseUrl,
      state,
      "/account",
    );
    const verified = captureResponse(
      owned,
      signInHostApiPath("/v1/auth/verify"),
    );
    await inputSecret(
      owned.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    expect(
      (await verified).response.status(),
      "owned registration verified",
    ).toBe(200);
    await owned.waitForURL((url) => url.pathname === "/account");
    await logout(owned);

    // Hold the existing cross-worker gate across the Gherkin steps. Real owned
    // sign-ins establish/restore the baseline; no policy/counter is written here.
    const close = () =>
      signInDetachedThroughHost(
        browser,
        world.hostBaseUrl,
        { email: state.email, password: state.password },
        { revoke: true },
      );
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      state.release = resolve;
    });
    state.gate = runGatedLoginAttempt({ close }, async () => {
      await close();
      entered();
      await held;
    });
    await Promise.race([
      ready,
      state.gate.then(() => {
        throw new Error("Threshold gate ended before entry");
      }),
    ]);

    await owned.addInitScript(() => {
      (window as unknown as CaptchaWindow).__threshold3242 = {
        renders: 0,
        executes: 0,
        invisible: false,
        solve() {},
      };
    });

    await owned.route(isSmartCaptchaScriptUrl, async (route) => {
      const onload =
        new URL(route.request().url()).searchParams.get("onload") ??
        "__onSmartCaptchaReady";
      // Only the external provider script is adapted; the BFF and its threshold
      // remain real. Holding execute lets the user edit before the solve arrives.
      const observer = `
;(function () {
  var api = window.smartCaptcha, pending = [], originalExecute = api.execute, originalRender = api.render, originalSubscribe = api.subscribe;
  var observed = window.__threshold3242 = { renders: 0, executes: 0, invisible: false, solve: function () { var queue = pending.splice(0); queue.forEach(function (id) { originalExecute(id); }); } };
  api.render = function (container, params) { observed.renders++; observed.invisible = params.invisible === true; return originalRender(container, params); };
  api.execute = function (id) { observed.executes++; pending.push(id); };
  api.subscribe = function (id, event, cb) { return originalSubscribe(id, event, event === 'success' ? function (token) { cb(token); cb(token); } : cb); };
})();`;
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: captchaStubScript(token, onload) + observer,
      });
    });
    owned.on("request", (req) => {
      if (
        req.method() === "POST" &&
        new URL(req.url()).pathname === signInHostApiPath("/v1/auth/login")
      )
        state.posts++;
    });
    await owned.goto(`${world.hostBaseUrl}/login?returnTo=%2Faccount`, {
      waitUntil: "load",
    });
    await owned.waitForLoadState("networkidle");
    await expect
      .poll(async () => (await observations(owned)).renders)
      .toBeGreaterThan(0);
    state.idleRenders = (await observations(owned)).renders;
    await inputSecret(identifier(owned), state.email);
    await inputSecret(password(owned), state.wrong);
  },
);

When(
  "the visitor submits password login before the failed-login threshold",
  async ({ page }) => {
    const state = journey(page);
    for (let attempt = 0; attempt < 3; attempt++) {
      const pending = captureResponse(
        state.page,
        signInHostApiPath("/v1/auth/login"),
      );
      await state.page.getByTestId("password-login-submit").click();
      const result = await pending;
      expect(
        result.response.status(),
        "real credential refusal before captcha threshold",
      ).toBe(401);
      expect(
        Boolean(result.response.request().headers()["x-smartcaptcha-token"]),
      ).toBe(false);
      await expect(
        state.page.getByTestId("password-login-submit"),
      ).toBeEnabled();
    }
  },
);

Then(
  "the portal sends the login request without requesting CAPTCHA",
  async ({ page }) => {
    const state = journey(page);
    expect(state.posts).toBe(3);
    expect(await observations(state.page)).toEqual({
      renders: state.idleRenders,
      executes: 0,
      invisible: true,
    });
  },
);

When(
  "the backend returns BOT_PROTECTION_REQUIRED after the threshold",
  async ({ page }) => {
    const state = journey(page);
    await inputSecret(password(state.page), state.password);
    const pending = captureResponse(
      state.page,
      signInHostApiPath("/v1/auth/login"),
    );
    await state.page.getByTestId("password-login-submit").click();
    const result = await pending;
    expect(result.response.status()).toBe(403);
    expect(JSON.parse(result.body).code).toBe("BOT_PROTECTION_REQUIRED");
    expect(
      Boolean(result.response.request().headers()["x-smartcaptcha-token"]),
    ).toBe(false);
  },
);

Then("the portal executes a fresh invisible challenge", async ({ page }) => {
  const state = journey(page);
  await expect
    .poll(() => observations(state.page))
    .toEqual({ renders: state.idleRenders + 1, executes: 1, invisible: true });
  expect(state.posts, "solve is still pending").toBe(4);
});

Then(
  "a successful solve retries the captured original login values exactly once",
  async ({ page, world }) => {
    const state = journey(page);
    const editedEmail = `edited-3242-${randomUUID()}@example.test`;
    await inputSecret(identifier(state.page), editedEmail);
    await inputSecret(password(state.page), state.wrong);
    expect(
      (await identifier(state.page).inputValue()) === editedEmail &&
        (await password(state.page).inputValue()) === state.wrong,
      "both form fields really changed while the original action is pending",
    ).toBe(true);
    const pending = captureResponse(
      state.page,
      signInHostApiPath("/v1/auth/login"),
    );
    await state.page.evaluate(() =>
      (window as unknown as CaptchaWindow).__threshold3242.solve(),
    );
    const accepted = await pending;
    const command = hostCommand(accepted.response.request().postDataJSON());
    expect({
      status: accepted.response.status(),
      original:
        command.identifier === state.email &&
        command.password === state.password,
      keys: Object.keys(command).sort().join(","),
      freshProof:
        accepted.response.request().headers()["x-smartcaptcha-token"] ===
        captchaTestTokenFromEnv(),
      acknowledgement: storefrontCallbackAcknowledgement(
        accepted.body,
        world.hostBaseUrl,
      ),
    }).toEqual({
      status: 200,
      original: true,
      keys: "identifier,password",
      freshProof: true,
      acknowledgement: true,
    });
    await state.page.waitForURL((url) => url.pathname === "/account");
    await state.page.waitForLoadState("networkidle");
    expect(
      state.posts,
      "duplicate provider success did not replay the original action",
    ).toBe(5);
    await assertSecureSession(state.page, accepted.response, world.hostBaseUrl);
    expect(
      await state.page.evaluate(async (email) => {
        const response = await fetch("/v1/me/profile", {
          credentials: "include",
        });
        const profile = await response.json();
        return (
          response.status === 200 &&
          profile.email === email &&
          profile.emailVerified === true
        );
      }, state.email),
      "original owned identity authenticated despite edited fields",
    ).toBe(true);
    await logout(state.page);
  },
);

After("@captcha-threshold", async ({ page }) => {
  const state = journeys.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      )
    ) {
      await logout(state.page);
    }
  } finally {
    state.release?.();
    try {
      await state.gate;
    } finally {
      await state.context.close();
      journeys.delete(page);
    }
  }
});
