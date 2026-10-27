import { storefrontCallbackAcknowledgement } from "../lib/owned-registration.js";
import {
  isAuthCommandPath,
  signInHostApiPath,
} from "../lib/sign-in-host-api.js";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  captureAddressedMailCheckpoint,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "../lib/mailpit.js";
import { createOwnedCongressSignup } from "../lib/owned-congress-signup.js";
import { inputSecret } from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import {
  captureSmsCheckpoint,
  freshConfirmablePhone,
  smsSinkMessages,
  smsSinkUrl,
  type SmsCheckpoint,
} from "../lib/sms-sink.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

const RAW_PHONE = "8 (999) 123-45-67";
const NORMALIZED_PHONE = "+79991234567";
const DISPLAY_PHONE = "+7 999 123-45-67";

interface Prefill {
  context: BrowserContext;
  page: Page;
  email: string;
  editedPhone: string;
  sink: string;
  /** Per-phone sink checkpoints taken at the scenario start (suggested, edited). */
  startedAt: SmsCheckpoint[];
  phoneWrites: string[];
  authPosts: string[];
  observeEditing: boolean;
  editingRequests: number;
}
const prefills = new WeakMap<Page, Prefill>();
function prefill(key: Page): Prefill {
  const state = prefills.get(key);
  if (!state) throw new Error("Owned congress phone fixture is missing");
  return state;
}

async function assertSuggestedProfile(state: Prefill): Promise<void> {
  const evidence = await state.page.evaluate(
    async ({ email, rawPhone }) => {
      const response = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const profile = await response.json().catch(() => ({}));
      return {
        status: response.status,
        sameAccount: profile.email === email,
        emailVerified: profile.emailVerified === true,
        exactSuggestion: profile.suggestedPhone === rawPhone,
        phoneEmpty: profile.phone === null,
        phoneUnconfirmed: profile.phoneVerified === null,
      };
    },
    { email: state.email, rawPhone: RAW_PHONE },
  );
  expect(
    evidence,
    "003 EARS-50: raw suggestion is not a confirmed API phone",
  ).toEqual({
    status: 200,
    sameAccount: true,
    emailVerified: true,
    exactSuggestion: true,
    phoneEmpty: true,
    phoneUnconfirmed: true,
  });
}

Given(
  "a fresh Academy congress intake holds the raw contact phone and the participant signs in with the ordinary emailed code",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink)
      throw new Error(
        "E2E_SMS_SINK_URL is required for congress phone absence proof",
      );
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const editedPhone = freshConfirmablePhone();
    const state: Prefill = {
      context,
      page: owned,
      email: "",
      editedPhone,
      sink,
      startedAt: await Promise.all(
        [NORMALIZED_PHONE, editedPhone].map((phone) =>
          captureSmsCheckpoint(sink, phone),
        ),
      ),
      phoneWrites: [],
      authPosts: [],
      observeEditing: false,
      editingRequests: 0,
    };
    prefills.set(page, state);
    owned.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() !== "GET" && path.startsWith("/v1/me/phone"))
        state.phoneWrites.push(path);
      if (request.method() === "POST" && isAuthCommandPath(path))
        state.authPosts.push(path);
      if (
        state.observeEditing &&
        ["fetch", "xhr"].includes(request.resourceType())
      )
        state.editingRequests++;
    });
    await prepareCaptchaForJourney(
      context,
      baseURL ?? "",
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const signup = await createOwnedCongressSignup(
      owned,
      world.hostBaseUrl,
      "prefill-2960",
      { contactPhone: RAW_PHONE },
    );
    state.email = signup.email;
    expect(
      state.email.split("@")[0]!.length <= 64,
      "owned mailbox local-part fits email limits",
    ).toBe(true);
    expect(
      state.authPosts,
      "intake has not used the handoff or any auth command",
    ).toEqual([]);
    const url = new URL("/login", world.hostBaseUrl);
    url.search = new URLSearchParams({
      method: "code",
      returnTo: "/account",
    }).toString();
    await owned.goto(url.toString(), { waitUntil: "load" });
    await owned.waitForLoadState("networkidle");
    await owned.getByTestId("otp-channel-email").click();
    await inputSecret(owned.getByTestId("otp-identifier"), state.email);
    const mailbox =
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl);
    const requestedAt = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      mailbox,
      state.email,
    );
    const requested = captureResponse(
      owned,
      signInHostApiPath("/v1/auth/login/otp/request"),
    );
    await owned.getByTestId("otp-send").click();
    const response = await requested;
    expect(
      response.response.status(),
      "ordinary email code request accepted",
    ).toBe(200);
    expect(
      response.body === '{"status":"otp_sent"}',
      "neutral email-code acknowledgement",
    ).toBe(true);
    const code = await fetchRecoveryCode(
      nativeRecoveryMail(),
      mailbox,
      state.email,
      requestedAt,
      "login",
    );
    const accepted = captureResponse(
      owned,
      signInHostApiPath("/v1/auth/login/otp"),
    );
    await inputSecret(
      owned.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const signedIn = await accepted;
    expect(signedIn.response.status(), "delivered sign-in code accepted").toBe(
      200,
    );
    expect(
      storefrontCallbackAcknowledgement(signedIn.body, world.hostBaseUrl),
      "code establishes authentication",
    ).toBe(true);
    await owned.waitForURL(
      (target) =>
        target.origin === new URL(world.hostBaseUrl).origin &&
        target.pathname === "/account",
    );
    await assertSecureSession(owned, signedIn.response, world.hostBaseUrl);
    expect(
      state.authPosts,
      "ordinary sign-in uses no handoff redemption",
    ).toEqual([
      signInHostApiPath("/v1/auth/login/otp/request"),
      signInHostApiPath("/v1/auth/login/otp"),
    ]);
  },
);

Then(
  "Academy's profile API returns the exact raw congress suggestion with an empty unconfirmed phone and its existing row displays the formatted number",
  async ({ page }) => {
    const state = prefill(page);
    await assertSuggestedProfile(state);
    await expect(state.page.getByTestId("profile-phone")).toHaveText(
      DISPLAY_PHONE,
    );
    await expect(state.page.getByTestId("profile-phone-verified")).toHaveCount(
      0,
    );
    await expect(state.page.getByTestId("profile-phone-code")).toHaveCount(0);
    expect(
      state.phoneWrites,
      "intake, sign-in and profile reads requested no phone mutation",
    ).toEqual([]);
  },
);

When(
  "the participant opens the suggested phone editor, changes its masked value and cancels without requesting a code",
  async ({ page }) => {
    const state = prefill(page);
    await state.page.waitForLoadState("networkidle");
    state.observeEditing = true;
    await state.page.getByTestId("profile-phone-action").click();
    const field = state.page.getByTestId("profile-phone-input");
    await expect(field).toBeEditable();
    await expect(field).toHaveValue(RAW_PHONE);
    await field.fill("");
    await field.fill(RAW_PHONE);
    await expect(field).toHaveValue(NORMALIZED_PHONE);
    await field.fill(state.editedPhone);
    expect(
      (await field.inputValue()) === state.editedPhone,
      "editor accepts the distinct owned phone",
    ).toBe(true);
    await expect(state.page.getByTestId("profile-phone-send")).toBeEnabled();
    await state.page.getByTestId("profile-phone-cancel").click();
    await expect(state.page.getByTestId("profile-phone-input")).toHaveCount(0);
    await expect(state.page.getByTestId("profile-phone")).toHaveText(
      DISPLAY_PHONE,
    );
    await state.page.getByTestId("profile-phone-action").click();
    await expect(field).toHaveValue(RAW_PHONE);
    await state.page.getByTestId("profile-phone-cancel").click();
  },
);

Then(
  "editing and canceling makes no fetch or phone request and neither number receives SMS throughout the full delivery horizon while the API suggestion remains unchanged",
  async ({ page }) => {
    const state = prefill(page);
    // Match the complete 40 x 500ms delivery horizon of sms-sink.waitForSmsCode.
    for (let sample = 0; sample <= 40; sample++) {
      const counts = await Promise.all(
        state.startedAt.map(
          async (checkpoint) =>
            (await smsSinkMessages(state.sink, checkpoint.phone, checkpoint))
              .length,
        ),
      );
      expect(counts, "no addressed SMS for suggestion or edited draft").toEqual(
        [0, 0],
      );
      if (sample < 40) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    state.observeEditing = false;
    expect(state.editingRequests, "editing and canceling are local-only").toBe(
      0,
    );
    expect(
      state.phoneWrites,
      "no automatic phone request or confirmation",
    ).toEqual([]);
    await assertSuggestedProfile(state);
    await expect(state.page.getByTestId("profile-phone")).toHaveText(
      DISPLAY_PHONE,
    );
    await expect(state.page.getByTestId("profile-phone-verified")).toHaveCount(
      0,
    );
    await expect(state.page.getByTestId("profile-phone-code")).toHaveCount(0);
    await state.page.screenshot({
      path: test.info().outputPath("congress-phone-suggestion.png"),
      mask: [state.page.getByTestId("profile-email")],
    });
  },
);

After("@congress-phone-prefill", async ({ page }) => {
  const state = prefills.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      )
    ) {
      const result = await state.page.evaluate(async () => {
        const logout = await fetch("/v1/auth/logout", {
          method: "POST",
          credentials: "include",
        });
        const profile = await fetch("/v1/me/profile", {
          credentials: "include",
        });
        return { logout: logout.status, profile: profile.status };
      });
      expect(result, "owned congress session revoked").toEqual({
        logout: 200,
        profile: 401,
      });
    }
  } finally {
    await state.context.close();
    prefills.delete(page);
  }
});
