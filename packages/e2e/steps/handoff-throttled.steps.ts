import { handoffCommandWithoutReference,
  AUTH_REQUEST_PARAM,
  isAuthCommandPath,
  isSignInHostForm,
  signInHostApiPath,
} from "../lib/sign-in-host-api.js";
import {
  expectEnteredThrough,
  watchStorefrontEntries,
} from "../lib/storefront-entry-watch.js";
import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { captchaTestTokenFromEnv } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  assertNoAddressedMail,
  captureAddressedMailCheckpoint,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "../lib/mailpit.js";
import { createOwnedCongressSignup } from "../lib/owned-congress-signup.js";
import {
  After,
  Before,
  Given,
  Then,
  When,
  test,
} from "./support/auth-fixtures.js";

const REQUEST = signInHostApiPath("/v1/auth/login/otp/request");
const HANDOFF = signInHostApiPath("/v1/auth/login/otp/handoff");
// 003 design §10 / EARS-13: the real, unmodified per-account window.
const PER_ACCOUNT_REQUESTS = 10;
const GENERIC_429 =
  '{"statusCode":429,"message":"too many requests, please try again later"}';
interface Journey {
  context: BrowserContext;
  email: string;
  reference: string;
  ordinaryBody: string;
  guest?: Page;
}
const journeys = new WeakMap<Page, Journey>();
Before("@handoff-throttled", async () => {
  test.setTimeout(180_000);
});
function journey(page: Page): Journey {
  const state = journeys.get(page);
  if (!state)
    throw new Error("Owned throttled-handoff prerequisite is missing");
  return state;
}

async function requestCode(page: Page, email: string) {
  return page.evaluate(
    async ({ email, token, endpoint }) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { "x-smartcaptcha-token": token } : {}),
        },
        body: JSON.stringify({ identifier: email, channel: "email" }),
      });
      return { status: response.status, body: await response.text() };
    },
    {
      email,
      endpoint: REQUEST,
      token:
        process.env.BOT_PROTECTION_ENABLED === "false"
          ? undefined
          : captchaTestTokenFromEnv(),
    },
  );
}

Given(
  "a fresh owned Academy congress reference remains unused while nine legitimate ordinary email-code requests exhaust its account window",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const state: Journey = {
      context,
      email: "",
      reference: "",
      ordinaryBody: "",
    };
    journeys.set(page, state);
    const intake = await context.newPage();
    const signup = await createOwnedCongressSignup(
      intake,
      world.hostBaseUrl,
      "throttled-3037",
    );
    state.email = signup.email;
    state.reference = signup.reference;
    const handoffPosts: boolean[] = [];
    context.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === HANDOFF
      )
        handoffPosts.push(true);
    });
    const mail = nativeRecoveryMail();
    const mailpit =
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl);
    // 003 EARS-13: the real intake already spent one unscoped email unit.
    for (let index = 0; index < PER_ACCOUNT_REQUESTS - 1; index++) {
      const checkpoint = await captureAddressedMailCheckpoint(
        mail,
        mailpit,
        state.email,
      );
      const response = await requestCode(intake, state.email);
      expect(
        {
          status: response.status,
          neutral: response.body === '{"status":"otp_sent"}',
        },
        "each legitimate request consumes the unchanged account window",
      ).toEqual({ status: 200, neutral: true });
      const delivered = await fetchRecoveryCode(
        mail,
        mailpit,
        state.email,
        checkpoint,
        "login",
      );
      expect(
        /^\d{6}$/.test(delivered),
        "each ordinary request delivers its fresh addressed code before the refusal boundary",
      ).toBe(true);
    }
    const refusalCheckpoint = await captureAddressedMailCheckpoint(
      mail,
      mailpit,
      state.email,
    );
    const ordinary = await requestCode(intake, state.email);
    state.ordinaryBody = ordinary.body;
    expect(
      { status: ordinary.status, generic: ordinary.body === GENERIC_429 },
      "the tenth ordinary request after the intake reaches the actual per-account limit",
    ).toEqual({ status: 429, generic: true });
    const controlEmail = `throttle-control-${randomUUID()}@example.test`;
    const checkpoint = await captureAddressedMailCheckpoint(
      mail,
      mailpit,
      controlEmail,
    );
    const control = await requestCode(intake, controlEmail);
    expect(
      {
        status: control.status,
        neutral: control.body === '{"status":"otp_sent"}',
      },
      "a fresh identifier from the same browser proves the shared source budget is not exhausted",
    ).toEqual({ status: 200, neutral: true });
    await Promise.all([
      assertNoAddressedMail(mail, mailpit, controlEmail, checkpoint),
      assertNoAddressedMail(mail, mailpit, state.email, refusalCheckpoint),
    ]);
    expect(
      handoffPosts.length,
      "ordinary exhaustion has spent zero reference redemptions",
    ).toBe(0);
    await intake.close();
  },
);

When(
  "a guest opens that still-live reference through the Academy code door with the account return target",
  async ({ page, world }) => {
    const state = journey(page);
    const guest = await state.context.newPage();
    watchStorefrontEntries(guest, world.hostBaseUrl);
    state.guest = guest;
    const posts: string[] = [];
    guest.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === "POST" && isAuthCommandPath(path))
        posts.push(path);
    });
    const mail = nativeRecoveryMail();
    const mailpit =
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl);
    const checkpoint = await captureAddressedMailCheckpoint(
      mail,
      mailpit,
      state.email,
    );
    const pending = captureResponse(guest, HANDOFF);
    const url = new URL("/login", world.hostBaseUrl);
    url.search = new URLSearchParams({
      method: "code",
      handoff: state.reference,
      returnTo: "/account",
    }).toString();
    await guest.goto(url.toString(), { waitUntil: "load" });
    const response = await pending;
    let exactCommand = false;
    try {
      const body = response.response.request().postDataJSON();
      // 003 EARS-44 (host): the reference rides the form state only.
      exactCommand = handoffCommandWithoutReference(body, state.reference);
    } catch {
      // Never retain a reference-bearing parser diagnostic.
    }
    expect(
      {
        status: response.response.status(),
        exactCommand,
        generic: response.body === GENERIC_429,
        sameOrdinary: response.body === state.ordinaryBody,
        noSession: !(
          (await response.response.headerValue("set-cookie")) ?? ""
        ).includes("__Host-ds_session="),
      },
      "the first redemption of a live reference returns the exact ordinary generic throttle",
    ).toEqual({
      status: 429,
      exactCommand: true,
      generic: true,
      sameOrdinary: true,
      noSession: true,
    });
    await expect(guest.getByTestId("login-method-otp")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(guest.getByTestId("otp-channel-email")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(guest.getByTestId("otp-identifier")).toHaveValue("");
    await expect(guest.getByTestId("login-method-password")).toBeVisible();
    await expect(guest.getByTestId("otp-send")).toBeVisible();
    await expect(guest.getByTestId("otp-verify")).toHaveCount(0);
    await expect(guest.getByRole("main").getByRole("alert")).toHaveText(
      /Слишком много попыток — повторите через несколько минут\./,
    );
    expect(
      await guest.evaluate(
        (email) => document.body.textContent?.includes(email) ?? false,
        state.email,
      ),
      "throttled fallback reveals no address",
    ).toBe(false);
    await assertNoAddressedMail(mail, mailpit, state.email, checkpoint);
    expect(
      posts,
      "one legitimate handoff command and no secondary code request",
    ).toEqual([HANDOFF]);
  },
);

Then(
  "the throttled handoff leaves empty email-code entry with generic refusal and no new mail, private access or reference in history",
  async ({ page, world }) => {
    const state = journey(page);
    const guest = state.guest;
    if (!guest) throw new Error("Throttled guest page was not opened");
    expect(
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      ),
      "throttle creates no session cookie",
    ).toBe(false);
    expect(
      await guest.evaluate(async () => {
        const profile = await fetch("/v1/me/profile", {
          credentials: "include",
          cache: "no-store",
        });
        const session = await fetch("/v1/auth/session", {
          credentials: "include",
          cache: "no-store",
        });
        return { profile: profile.status, session: session.status };
      }),
      "private endpoints remain inaccessible",
    ).toEqual({ profile: 401, session: 401 });
    // #3172 — the code door is the sign-in host's form, whose URL carries only
    // the IdP's auth request: the reference never reaches it, and the ordinary
    // account target rode the storefront entry into the transaction.
    const url = new URL(guest.url());
    expect(
      isSignInHostForm(url) &&
        url.pathname === "/login" &&
        [...url.searchParams.keys()].join() === AUTH_REQUEST_PARAM,
      "reference stripped from the code door",
    ).toBe(true);
    expectEnteredThrough(guest, world.hostBaseUrl, {
      pathname: "/login",
      method: "code",
      returnTo: "/account",
    });
    const cdp = await state.context.newCDPSession(guest);
    try {
      const history = await cdp.send("Page.getNavigationHistory");
      expect(
        history.entries.some(
          (entry) =>
            new URL(entry.url).searchParams.has("handoff") ||
            entry.url.includes(state.reference),
        ),
        "browser history contains no handoff reference",
      ).toBe(false);
    } finally {
      await cdp.detach();
    }
    await guest.screenshot({
      path: test.info().outputPath("throttled-handoff-fallback.png"),
    });
  },
);

After("@handoff-throttled", async ({ page }) => {
  const state = journeys.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      )
    ) {
      const owned = state.context.pages()[0] ?? (await state.context.newPage());
      const status = await owned.evaluate(
        async () =>
          (
            await fetch("/v1/auth/logout", {
              method: "POST",
              credentials: "include",
            })
          ).status,
      );
      expect(status, "unexpected owned session revoked during cleanup").toBe(
        200,
      );
    }
  } finally {
    await state.context.close();
    journeys.delete(page);
  }
});
