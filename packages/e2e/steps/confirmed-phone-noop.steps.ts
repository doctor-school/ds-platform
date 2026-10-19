import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import {
  captureResponse,
  type CapturedResponse,
} from "../lib/captured-response.js";
import { confirmOwnedPhone } from "../lib/owned-phone-confirmation.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import {
  captureSmsCheckpoint,
  freshConfirmablePhone,
  smsSinkMessages,
  smsSinkUrl,
  type SmsCheckpoint,
} from "../lib/sms-sink.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

interface OwnedPhone {
  context: BrowserContext;
  page: Page;
  email: string;
  phone: string;
  sink: string;
  cookie?: string;
  subject?: string;
  requestedAt?: SmsCheckpoint;
  repeated?: CapturedResponse;
  phonePosts: string[];
}
const accounts = new WeakMap<Page, OwnedPhone>();
function account(key: Page): OwnedPhone {
  const state = accounts.get(key);
  if (!state) throw new Error("The owned confirmed-phone account is missing");
  return state;
}

async function identity(page: Page) {
  return page.evaluate(async () => {
    const profileResponse = await fetch("/v1/me/profile", {
      credentials: "include",
      cache: "no-store",
    });
    const sessionResponse = await fetch("/v1/auth/session", {
      credentials: "include",
      cache: "no-store",
    });
    const profile = await profileResponse.json().catch(() => ({}));
    const session = await sessionResponse.json().catch(() => ({}));
    return {
      profileStatus: profileResponse.status,
      sessionStatus: sessionResponse.status,
      email: profile.email,
      emailVerified: profile.emailVerified,
      phone: profile.phone,
      phoneVerified: profile.phoneVerified,
      subject: session.sub,
    };
  });
}

Given(
  "a uniquely owned Academy account confirmed a fresh phone with its delivered SMS",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink)
      throw new Error("The confirmed-phone scenario requires E2E_SMS_SINK_URL");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: OwnedPhone = {
      context,
      page: owned,
      email: `noop2961-${randomUUID()}@example.test`,
      phone: freshConfirmablePhone(),
      sink,
      phonePosts: [],
    };
    accounts.set(page, state);
    await test.info().attach("owned-fixture", {
      body: JSON.stringify({
        issue: 2961,
        email: state.email,
        phone: state.phone,
      }),
      contentType: "application/json",
    });
    await prepareCaptchaForJourney(
      context,
      world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const { code } = await registerOwnedCredentials(
      owned,
      world.hostBaseUrl,
      {
        email: state.email,
        password: `Owned-${randomUUID()}-aA1!`,
      },
      "/account",
    );
    const pending = captureResponse(owned, "/v1/auth/verify");
    await inputSecret(
      owned.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const verified = await pending;
    expect(verified.response.status(), "owned registration verified").toBe(200);
    await owned.waitForURL((url) => url.pathname === "/account");
    await owned.waitForLoadState("networkidle");
    await assertSecureSession(owned, verified.response, world.hostBaseUrl);
    await confirmOwnedPhone(owned, { phone: state.phone, sink });
    const before = await identity(owned);
    expect(
      {
        profile: before.profileStatus,
        session: before.sessionStatus,
        sameEmail: before.email === state.email,
        emailVerified: before.emailVerified,
        samePhone: before.phone === state.phone,
        phoneVerified: before.phoneVerified,
        hasSubject:
          typeof before.subject === "string" && before.subject.length > 0,
      },
      "the real account owns the confirmed phone and private identity",
    ).toEqual({
      profile: 200,
      session: 200,
      sameEmail: true,
      emailVerified: true,
      samePhone: true,
      phoneVerified: true,
      hasSubject: true,
    });
    state.subject = before.subject;
    const cookie = (await context.cookies()).find(
      (cookie) => cookie.name === "__Host-ds_session",
    )?.value;
    expect(Boolean(cookie), "owned session before the repeated request").toBe(
      true,
    );
    if (!cookie) throw new Error("The owned session cookie is missing");
    state.cookie = cookie;
    owned.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "POST" && pathname.startsWith("/v1/me/phone"))
        state.phonePosts.push(pathname);
    });
  },
);

When(
  "the account requests confirmation of that same owned number through the Academy phone row",
  async ({ page }) => {
    const state = account(page);
    await state.page.getByTestId("profile-phone-action").click();
    await state.page
      .getByTestId("profile-phone-input")
      .pressSequentially(state.phone.slice(1));
    await state.page.evaluate(() => {
      const selector =
        '[data-testid="profile-phone-code"], [data-testid="profile-phone-code-sent"]';
      const observation = {
        seen: Boolean(document.querySelector(selector)),
        observer: null as MutationObserver | null,
      };
      observation.observer = new MutationObserver((records) => {
        observation.seen ||=
          Boolean(document.querySelector(selector)) ||
          records.some((record) =>
            [...record.addedNodes].some(
              (node) =>
                node instanceof Element &&
                (node.matches(selector) ||
                  Boolean(node.querySelector(selector))),
            ),
          );
      });
      observation.observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
      (
        window as typeof window & { __dsPhoneNoop?: typeof observation }
      ).__dsPhoneNoop = observation;
    });
    state.requestedAt = await captureSmsCheckpoint(state.sink, state.phone);
    const pending = captureResponse(state.page, "/v1/me/phone");
    await state.page.getByTestId("profile-phone-send").click();
    state.repeated = await pending;
  },
);

Then(
  "the exact already_confirmed reply leaves the confirmed row without a code step or new SMS over the full delivery horizon",
  async ({ page }) => {
    const state = account(page);
    if (!state.repeated || !state.requestedAt)
      throw new Error("Repeated phone request was not captured");
    let matches = false;
    try {
      const submitted = state.repeated.response.request().postDataJSON();
      matches =
        Object.keys(submitted).length === 1 &&
        submitted.phone === state.phone &&
        state.repeated.body === '{"status":"already_confirmed"}';
    } catch {
      // Retain no phone- or code-bearing parser diagnostics.
    }
    expect(
      state.repeated.response.status(),
      "same-number request accepted",
    ).toBe(200);
    expect(
      matches,
      "exact same-number request and code-free no-op acknowledgement",
    ).toBe(true);
    await expect(
      state.page.getByTestId("profile-phone-verified"),
    ).toBeVisible();
    // sms-sink.waitForSmsCode observes delivery for 40 × 500 ms.
    const deadline = Date.now() + 20_000;
    while (true) {
      const finalObservation = Date.now() >= deadline;
      expect(
        (await smsSinkMessages(state.sink, state.phone, state.requestedAt))
          .length,
        "no new addressed SMS over the complete positive-delivery window",
      ).toBe(0);
      await expect(state.page.getByTestId("profile-phone-code")).toHaveCount(0);
      await expect(
        state.page.getByTestId("profile-phone-code-sent"),
      ).toHaveCount(0);
      await expect(
        state.page.getByTestId("profile-phone-verified"),
      ).toBeVisible();
      if (finalObservation) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(
      state.phonePosts,
      "no extra request, resend or confirmation",
    ).toEqual(["/v1/me/phone"]);
    expect(
      await state.page.evaluate(() => {
        const target = window as typeof window & {
          __dsPhoneNoop?: { seen: boolean; observer: MutationObserver | null };
        };
        const observation = target.__dsPhoneNoop;
        observation?.observer?.disconnect();
        delete target.__dsPhoneNoop;
        return observation?.seen;
      }),
      "no transient code-step transition occurred",
    ).toBe(false);
  },
);

Then(
  "reloading Academy retains that same confirmed phone and secure private identity session",
  async ({ page, world }) => {
    const state = account(page);
    await state.page.reload({ waitUntil: "load" });
    await state.page.waitForLoadState("networkidle");
    await expect(
      state.page.getByTestId("profile-phone-verified"),
    ).toBeVisible();
    const after = await identity(state.page);
    expect(
      {
        profile: after.profileStatus,
        session: after.sessionStatus,
        sameEmail: after.email === state.email,
        emailVerified: after.emailVerified,
        samePhone: after.phone === state.phone,
        phoneVerified: after.phoneVerified,
        sameSubject: after.subject === state.subject,
      },
      "reload retains the same confirmed profile and identity",
    ).toEqual({
      profile: 200,
      session: 200,
      sameEmail: true,
      emailVerified: true,
      samePhone: true,
      phoneVerified: true,
      sameSubject: true,
    });
    const cookie = (await state.context.cookies()).find(
      (cookie) => cookie.name === "__Host-ds_session",
    );
    expect(
      {
        sameCookie: Boolean(cookie) && cookie!.value === state.cookie,
        host: cookie?.domain,
        path: cookie?.path,
        secure: cookie?.secure,
        httpOnly: cookie?.httpOnly,
        sameSite: cookie?.sameSite,
      },
      "no-op preserves the secure host-only session",
    ).toEqual({
      sameCookie: true,
      host: new URL(world.hostBaseUrl).hostname,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    });
    await state.page.screenshot({
      path: test.info().outputPath("confirmed-phone-noop.png"),
    });
  },
);

After("@confirmed-phone-noop", async ({ page }) => {
  const state = accounts.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      )
    ) {
      expect(
        await state.page.evaluate(async () => {
          const logout = await fetch("/v1/auth/logout", {
            method: "POST",
            credentials: "include",
          });
          const profile = await fetch("/v1/me/profile", {
            credentials: "include",
          });
          return { logout: logout.status, profile: profile.status };
        }),
        "owned no-op session revoked",
      ).toEqual({ logout: 200, profile: 401 });
    }
  } finally {
    await state.context.close();
    accounts.delete(page);
  }
});
