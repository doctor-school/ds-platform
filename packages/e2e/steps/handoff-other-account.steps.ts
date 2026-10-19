import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { installCaptchaStub } from "../lib/captcha-stub.js";
import {
  captureResponse,
  type CapturedResponse,
} from "../lib/captured-response.js";
import { createOwnedCongressSignup } from "../lib/owned-congress-signup.js";
import {
  assertNoAddressedMail,
  captureAddressedMailCheckpoint,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
  type AddressedMailCheckpoint,
} from "../lib/mailpit.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

interface SwitchHandoff {
  context: BrowserContext;
  page: Page;
  email: string;
  reference: string;
  notice: AddressedMailCheckpoint;
  authPosts: string[];
  oldContext?: BrowserContext;
  oldPage?: Page;
  oldCookie?: string;
  oldSubject?: string;
  oldEmail?: string;
  oldMail?: AddressedMailCheckpoint;
  oldRevoked?: boolean;
  requested?: AddressedMailCheckpoint;
  code?: string;
  redeemed?: CapturedResponse;
  accepted?: CapturedResponse;
}
const states = new WeakMap<Page, SwitchHandoff>();
function stateFor(page: Page): SwitchHandoff {
  const state = states.get(page);
  if (!state) throw new Error("Owned other-account handoff was not prepared");
  return state;
}
const mailpitFor = (base: string) =>
  process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(base);

async function privateIdentity(page: Page) {
  return page.evaluate(async () => {
    const profile = await fetch("/v1/me/profile", {
      credentials: "include",
      cache: "no-store",
    });
    const body = await profile.json().catch(() => ({}));
    const session = await fetch("/v1/auth/session", {
      credentials: "include",
      cache: "no-store",
    });
    const claims = await session.json().catch(() => ({}));
    return {
      profile: profile.status,
      session: session.status,
      email: typeof body.email === "string" ? body.email : undefined,
      verified: body.emailVerified === true,
      subject: typeof claims.sub === "string" ? claims.sub : undefined,
    };
  });
}

Given(
  "a uniquely owned Academy congress account Y has a real hand-off reference",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    // Store cleanup ownership before any prerequisite can fail.
    const state: SwitchHandoff = {
      context,
      page: owned,
      email: "",
      reference: "",
      notice: { recipient: "", messageIds: [] },
      authPosts: [],
    };
    states.set(page, state);
    Object.assign(
      state,
      await createOwnedCongressSignup(
        owned,
        world.hostBaseUrl,
        "handoff-other-2943",
      ),
    );
  },
);

Given(
  "that Academy browser holds a different uniquely owned verified account X session",
  async ({ page, browser, httpCredentials, world }) => {
    const state = stateFor(page);
    const account = {
      email: `handoff-x-2943-${randomUUID()}@example.test`,
      password: `Handoff-${randomUUID()}-aA1!`,
    };
    if (process.env.BOT_PROTECTION_ENABLED !== "false")
      await installCaptchaStub(state.context);
    const registered = await registerOwnedCredentials(
      state.page,
      world.hostBaseUrl,
      account,
      "/account",
    );
    const pending = captureResponse(state.page, "/v1/auth/verify");
    await inputSecret(
      state.page.locator('input[autocomplete="one-time-code"]'),
      registered.code,
    );
    const verified = await pending;
    expect(verified.response.status(), "X registration code accepted").toBe(
      200,
    );
    await state.page.waitForURL((url) => url.pathname === "/account");
    await assertSecureSession(state.page, verified.response, world.hostBaseUrl);
    const identity = await privateIdentity(state.page);
    expect(
      {
        profile: identity.profile,
        session: identity.session,
        sameEmail: identity.email === account.email,
        verified: identity.verified,
        subject: Boolean(identity.subject),
      },
      "X is a real verified private account",
    ).toEqual({
      profile: 200,
      session: 200,
      sameEmail: true,
      verified: true,
      subject: true,
    });
    state.oldSubject = identity.subject;
    state.oldEmail = account.email;
    const cookies = await state.context.cookies();
    state.oldCookie = cookies.find(
      (cookie) => cookie.name === "__Host-ds_session",
    )!.value;
    state.oldContext = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    await state.oldContext.addCookies(cookies);
    state.oldPage = await state.oldContext.newPage();
    await state.oldPage.goto(`${world.hostBaseUrl}/account`, {
      waitUntil: "load",
    });
    const retained = await privateIdentity(state.oldPage);
    expect(
      retained.profile === 200 &&
        retained.session === 200 &&
        retained.email === account.email &&
        retained.subject === state.oldSubject,
      "independent context really holds the same live X session",
    ).toBe(true);
    state.oldMail = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      mailpitFor(world.hostBaseUrl),
      account.email,
    );
    state.page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "POST" && pathname.startsWith("/v1/auth/"))
        state.authPosts.push(pathname);
    });
  },
);

When(
  "X opens Y's Academy hand-off link with the account return target",
  async ({ page, world }) => {
    const state = stateFor(page);
    const target = new URL("/login", world.hostBaseUrl);
    target.search = new URLSearchParams({
      method: "code",
      handoff: state.reference,
      returnTo: "/account",
    }).toString();
    state.requested = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      mailpitFor(world.hostBaseUrl),
      state.email,
    );
    const pending = captureResponse(state.page, "/v1/auth/login/otp/handoff");
    await state.page.goto(target.toString(), { waitUntil: "load" });
    state.redeemed = await pending;
  },
);

Then(
  "one fresh sign-in code is delivered only to Y and Academy opens Y's code step",
  async ({ page, world }) => {
    const state = stateFor(page);
    if (
      !state.redeemed ||
      !state.requested ||
      !state.oldEmail ||
      !state.oldMail
    )
      throw new Error("Other-account redemption was not observed");
    let correct = false;
    try {
      const submitted = state.redeemed.response.request().postDataJSON();
      const answer = JSON.parse(state.redeemed.body);
      correct =
        Object.keys(submitted).length === 1 &&
        submitted.ref === state.reference &&
        Object.keys(answer).length === 2 &&
        answer.status === "otp_sent" &&
        answer.identifier === state.email;
    } catch {
      /* Discard reference-bearing parser diagnostics. */
    }
    expect(state.redeemed.response.status()).toBe(200);
    expect(correct, "handoff targets Y despite X's current session").toBe(true);
    state.code = await fetchRecoveryCode(
      nativeRecoveryMail(),
      mailpitFor(world.hostBaseUrl),
      state.email,
      state.requested,
      "login",
    );
    const delivered = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      mailpitFor(world.hostBaseUrl),
      state.email,
    );
    expect(
      delivered.messageIds.length === state.notice.messageIds.length + 1 &&
        state.notice.messageIds.every((id) =>
          delivered.messageIds.includes(id),
        ),
      "exactly one fresh Y mail added to congress notice",
    ).toBe(true);
    await Promise.all([
      assertNoAddressedMail(
        nativeRecoveryMail(),
        mailpitFor(world.hostBaseUrl),
        state.email,
        delivered,
      ),
      assertNoAddressedMail(
        nativeRecoveryMail(),
        mailpitFor(world.hostBaseUrl),
        state.oldEmail,
        state.oldMail,
      ),
    ]);
    await expect(state.page.getByTestId("otp-verify")).toBeVisible();
    expect(
      await state.page.getByText(`Мы отправили код на ${state.email}.`).count(),
      "code step addresses Y",
    ).toBe(1);
    await expect(
      state.page.locator('input[autocomplete="one-time-code"]'),
    ).toHaveValue("");
    expect(state.authPosts).toEqual(["/v1/auth/login/otp/handoff"]);
    await state.page.screenshot({
      path: test.info().outputPath("other-account-y-code.png"),
    });
  },
);

When(
  "the visitor enters Y's delivered hand-off code once in that Academy tab",
  async ({ page }) => {
    const state = stateFor(page);
    if (!state.code) throw new Error("Delivered Y sign-in code is missing");
    const pending = captureResponse(state.page, "/v1/auth/login/otp");
    await inputSecret(
      state.page.locator('input[autocomplete="one-time-code"]'),
      state.code,
    );
    state.accepted = await pending;
    let correct = false;
    try {
      const request = state.accepted.response.request().postDataJSON();
      correct =
        Object.keys(request).length === 3 &&
        request.identifier === state.email &&
        request.channel === "email" &&
        request.code === state.code &&
        state.accepted.body === '{"status":"authenticated"}';
    } catch {
      /* Discard code-bearing parser diagnostics. */
    }
    expect(state.accepted.response.status()).toBe(200);
    expect(correct, "only the fresh delivered Y code was accepted").toBe(true);
  },
);

Then(
  "X's retained Academy session is revoked and the browser holds only Y's secure session",
  async ({ page, world }) => {
    const state = stateFor(page);
    if (
      !state.accepted ||
      !state.oldPage ||
      !state.oldContext ||
      !state.oldCookie
    )
      throw new Error("Owned X/Y session proof is incomplete");
    await state.page.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await assertSecureSession(
      state.page,
      state.accepted.response,
      world.hostBaseUrl,
      [state.oldCookie],
    );
    expect(
      (await state.context.cookies()).filter(
        (cookie) => cookie.name === "__Host-ds_session",
      ).length,
      "exactly one browser session",
    ).toBe(1);
    const retainedCookie = (await state.oldContext.cookies()).find(
      (cookie) => cookie.name === "__Host-ds_session",
    );
    expect(
      retainedCookie?.value === state.oldCookie,
      "independent client still sends the actual old X cookie",
    ).toBe(true);
    const old = await privateIdentity(state.oldPage);
    expect(
      { profile: old.profile, session: old.session },
      "old X cookie fails real private reads after Y sign-in",
    ).toEqual({ profile: 401, session: 401 });
    state.oldRevoked = true;
  },
);

Then(
  "Academy returns to its account page with Y's own verified private profile",
  async ({ page, world }) => {
    const state = stateFor(page);
    const identity = await privateIdentity(state.page);
    expect(
      {
        profile: identity.profile,
        session: identity.session,
        sameEmail: identity.email === state.email,
        verified: identity.verified,
        distinctSubject:
          Boolean(identity.subject) && identity.subject !== state.oldSubject,
      },
      "private account identity is Y, never X",
    ).toEqual({
      profile: 200,
      session: 200,
      sameEmail: true,
      verified: true,
      distinctSubject: true,
    });
    expect(
      new URL(state.page.url()).origin === new URL(world.hostBaseUrl).origin &&
        new URL(state.page.url()).pathname === "/account",
      "actual Academy account return target",
    ).toBe(true);
    expect(
      await state.page
        .getByTestId("profile-email")
        .evaluate(
          (element, email) => element.textContent === email,
          state.email,
        ),
      "account screen renders Y",
    ).toBe(true);
    expect(
      state.authPosts,
      "one handoff redemption and one code submission",
    ).toEqual(["/v1/auth/login/otp/handoff", "/v1/auth/login/otp"]);
    await state.page.screenshot({
      path: test.info().outputPath("other-account-y-profile.png"),
    });
  },
);

After("@handoff-other-account", async ({ page }) => {
  const state = states.get(page);
  if (!state) return;
  try {
    for (const owned of [state.page, state.oldPage]) {
      if (
        !owned ||
        owned.isClosed() ||
        !(await owned.context().cookies()).some(
          (cookie) => cookie.name === "__Host-ds_session",
        )
      )
        continue;
      const result = await owned.evaluate(async () => {
        const logout = await fetch("/v1/auth/logout", {
          method: "POST",
          credentials: "include",
        });
        const profile = await fetch("/v1/me/profile", {
          credentials: "include",
          cache: "no-store",
        });
        return { logout: logout.status, profile: profile.status };
      });
      expect(result, "owned session cleanup").toEqual({
        logout: owned === state.oldPage && state.oldRevoked ? 401 : 200,
        profile: 401,
      });
    }
  } finally {
    for (const context of [state.context, state.oldContext]) {
      if (!context) continue;
      await Promise.all(context.pages().map((owned) => owned.close()));
      await context.close();
    }
    states.delete(page);
  }
});
