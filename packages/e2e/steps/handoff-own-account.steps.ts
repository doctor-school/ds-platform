import { expect, type BrowserContext, type Page } from "@playwright/test";
import { installCaptchaStub } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  assertNoAddressedMail,
  captureAddressedMailCheckpoint,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
  type AddressedMailCheckpoint,
} from "../lib/mailpit.js";
import { createOwnedCongressSignup } from "../lib/owned-congress-signup.js";
import { inputSecret } from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

interface OwnHandoff {
  context: BrowserContext;
  page: Page;
  email: string;
  reference?: string;
  subject?: string;
  sessionCookie?: string;
  before?: AddressedMailCheckpoint;
  authPosts: string[];
  formSeen: boolean;
  committed: string[];
  documentStatus?: number;
  documentToTarget?: boolean;
}
const states = new WeakMap<Page, OwnHandoff>();
function ownHandoff(key: Page): OwnHandoff {
  const state = states.get(key);
  if (!state) throw new Error("Owned same-account handoff was not prepared");
  return state;
}

Given(
  "a uniquely owned Academy congress account has a real hand-off reference and an independent ordinary-code session",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    if (process.env.BOT_PROTECTION_ENABLED !== "false")
      await installCaptchaStub(context);
    const owned = await context.newPage();
    const state: OwnHandoff = {
      context,
      page: owned,
      email: "",
      authPosts: [],
      formSeen: false,
      committed: [],
    };
    states.set(page, state);
    owned.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === "POST" && path.startsWith("/v1/auth/"))
        state.authPosts.push(path);
    });
    const signup = await createOwnedCongressSignup(
      owned,
      world.hostBaseUrl,
      "handoff-own-2942",
    );
    state.email = signup.email;
    state.reference = signup.reference;
    expect(state.authPosts, "signup uses no separate auth command").toEqual([]);

    const login = new URL("/login", world.hostBaseUrl);
    login.search = new URLSearchParams({
      method: "code",
      returnTo: "/account",
    }).toString();
    await owned.goto(login.toString(), { waitUntil: "load" });
    await owned.waitForLoadState("networkidle");
    await owned.getByTestId("otp-channel-email").click();
    await inputSecret(owned.getByTestId("otp-identifier"), state.email);
    const sentFrom = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
    );
    const requested = captureResponse(owned, "/v1/auth/login/otp/request");
    await owned.getByTestId("otp-send").click();
    const request = await requested;
    expect(request.response.status()).toBe(200);
    expect(
      request.body === '{"status":"otp_sent"}',
      "ordinary code request accepted",
    ).toBe(true);
    const code = await fetchRecoveryCode(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
      sentFrom,
      "login",
    );
    const accepted = captureResponse(owned, "/v1/auth/login/otp");
    await inputSecret(
      owned.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const signedIn = await accepted;
    expect(signedIn.response.status()).toBe(200);
    expect(
      signedIn.body === '{"status":"authenticated"}',
      "delivered ordinary code authenticates",
    ).toBe(true);
    await owned.waitForURL((url) => url.pathname === "/account");
    await assertSecureSession(owned, signedIn.response, world.hostBaseUrl);
    const identity = await owned.evaluate(async (email) => {
      const profile = await fetch("/v1/me/profile", { cache: "no-store" });
      const body = await profile.json();
      const session = await fetch("/v1/auth/session", { cache: "no-store" });
      const claims = await session.json();
      return {
        profile: profile.status,
        sameEmail: body.email === email,
        session: session.status,
        subject: typeof claims.sub === "string" ? claims.sub : "",
      };
    }, state.email);
    expect({ ...identity, subject: Boolean(identity.subject) }).toEqual({
      profile: 200,
      sameEmail: true,
      session: 200,
      subject: true,
    });
    state.subject = identity.subject;
    state.sessionCookie =
      (await context.cookies()).find(
        (cookie) => cookie.name === "__Host-ds_session",
      )?.value ?? "";
    expect(state.authPosts).toEqual([
      "/v1/auth/login/otp/request",
      "/v1/auth/login/otp",
    ]);
    state.before = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
    );
    expect(
      state.before.messageIds.length,
      "congress notice plus ordinary sign-in delivery",
    ).toBe(2);
  },
);

When(
  "that signed-in congress account opens its own Academy hand-off with the account return target",
  async ({ page, world }) => {
    const state = ownHandoff(page);
    await state.page.exposeFunction("recordOwnedHandoffForm", () => {
      state.formSeen = true;
    });
    await state.page.addInitScript(() => {
      if (
        location.pathname !== "/login" ||
        !new URL(location.href).searchParams.has("handoff")
      )
        return;
      const observe = () => {
        const visible = [
          ...document.querySelectorAll(
            '[data-testid="otp-send"], [data-testid="otp-verify"], input[autocomplete="current-password"]',
          ),
        ].some(
          (element) =>
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== "hidden",
        );
        if (visible)
          void (
            window as unknown as { recordOwnedHandoffForm(): Promise<void> }
          ).recordOwnedHandoffForm();
      };
      new MutationObserver(observe).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
      });
      document.addEventListener("DOMContentLoaded", observe);
    });
    state.authPosts = [];
    state.page.on("framenavigated", (frame) => {
      if (frame === state.page.mainFrame())
        state.committed.push(new URL(frame.url()).pathname);
    });
    const target = new URL("/login", world.hostBaseUrl);
    target.search = new URLSearchParams({
      method: "code",
      handoff: state.reference!,
      returnTo: "/account",
    }).toString();
    const landed = await state.page.goto(target.toString(), {
      waitUntil: "load",
    });
    // The hand-off document request is the first hop of the navigation chain;
    // only its status and whether Location names the carried target are kept,
    // never the reference-bearing URL (EARS-18 redaction).
    let handoffRequest = landed?.request();
    while (handoffRequest?.redirectedFrom())
      handoffRequest = handoffRequest.redirectedFrom()!;
    const handoffDocument = await handoffRequest?.response();
    state.documentStatus = handoffDocument?.status() ?? 0;
    const redirectTo = handoffDocument?.headers()["location"];
    if (redirectTo) {
      const next = new URL(redirectTo, target);
      state.documentToTarget =
        next.origin === target.origin &&
        next.pathname === "/account" &&
        !next.searchParams.has("handoff");
    }
  },
);

Then(
  "the hand-off document answer redirects straight to the account target with no sign-in page, auth command or addressed mail",
  async ({ page, world }) => {
    const state = ownHandoff(page);
    const status = state.documentStatus ?? 0;
    expect(
      status >= 300 && status < 400,
      `hand-off document answer is a redirect (status ${status})`,
    ).toBe(true);
    expect(
      state.documentToTarget,
      "redirect Location is the carried /account target",
    ).toBe(true);
    expect(
      state.committed.includes("/login"),
      "the sign-in page is never committed",
    ).toBe(false);
    expect(
      state.authPosts,
      "no hand-off redemption, code request, resend or acceptance",
    ).toEqual([]);
    await assertNoAddressedMail(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
      state.before!,
    );
  },
);

Then(
  "that unchanged secure session opens its own Academy account without displaying a sign-in form",
  async ({ page, world }) => {
    const state = ownHandoff(page);
    await state.page.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    expect(
      state.formSeen,
      "no visible sign-in form during handoff navigation",
    ).toBe(false);
    await expect(state.page.getByTestId("otp-send")).toHaveCount(0);
    await expect(state.page.getByTestId("otp-verify")).toHaveCount(0);
    const identity = await state.page.evaluate(
      async ({ email, subject }) => {
        const profile = await fetch("/v1/me/profile", { cache: "no-store" });
        const body = await profile.json();
        const session = await fetch("/v1/auth/session", { cache: "no-store" });
        const claims = await session.json();
        return {
          profile: profile.status,
          sameEmail: body.email === email,
          session: session.status,
          sameSubject: claims.sub === subject,
        };
      },
      { email: state.email, subject: state.subject },
    );
    expect(identity).toEqual({
      profile: 200,
      sameEmail: true,
      session: 200,
      sameSubject: true,
    });
    expect(
      (await state.context.cookies()).find(
        (cookie) => cookie.name === "__Host-ds_session",
      )?.value === state.sessionCookie,
      "handoff preserves the independently established session",
    ).toBe(true);
    expect(
      await state.page
        .getByTestId("profile-email")
        .evaluate(
          (element, email) => element.textContent === email,
          state.email,
        ),
    ).toBe(true);
    await state.page.screenshot({
      path: test.info().outputPath("handoff-own-account.png"),
    });
  },
);

After("@handoff-own-account", async ({ page }) => {
  const state = states.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      )
    ) {
      const revoked = await state.page.evaluate(async () => {
        const logout = await fetch("/v1/auth/logout", { method: "POST" });
        const profile = await fetch("/v1/me/profile");
        return { logout: logout.status, profile: profile.status };
      });
      expect(revoked, "only the owned session is revoked").toEqual({
        logout: 200,
        profile: 401,
      });
    }
  } finally {
    await state.context.close();
    states.delete(page);
  }
});
