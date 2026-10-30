import {
  AUTH_REQUEST_PARAM,
  isSignInHostForm,
  isAuthCommandPath,
  signInHostApiPath,
} from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import {
  expect,
  type BrowserContext,
  type Page,
  type Response,
} from "@playwright/test";
import { installCaptchaStub } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  assertNoAddressedMail,
  captureAddressedMailCheckpoint,
  mailpitUrlFor,
  nativeRecoveryMail,
  type AddressedMailCheckpoint,
} from "../lib/mailpit.js";
import {
  assertNoPrivateRegistrationAccess,
  coldVerificationEvidence,
  inputSecret,
  registerOwnedCredentials,
  registrationEvidence,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { gatedPasswordLogin } from "../lib/gated-password-login.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface ColdVerification extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  code?: string;
  authPosts: string[];
  visitedLogin: boolean;
  beforeReload?: string;
  submitted?: AddressedMailCheckpoint;
  verification?: Response;
  evidence?: ReturnType<typeof coldVerificationEvidence>;
  guest?: Page;
  refusal?: Response;
  passwordRequests?: number;
}
const verifications = new WeakMap<Page, ColdVerification>();
function verification(key: Page): ColdVerification {
  const state = verifications.get(key);
  if (!state) throw new Error("Owned cold verification was not prepared");
  return state;
}

Given(
  "a uniquely registered Academy account awaits its fresh unconsumed confirmation code with the account return target",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: ColdVerification = {
      context,
      page: owned,
      email: `cold-2722-${randomUUID()}@example.test`,
      password: `Cold-${randomUUID()}-aA1!`,
      authPosts: [],
      visitedLogin: false,
    };
    verifications.set(page, state);
    owned.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "POST" && isAuthCommandPath(pathname))
        state.authPosts.push(pathname);
    });
    owned.on("framenavigated", (frame) => {
      if (
        frame === owned.mainFrame() &&
        new URL(frame.url()).pathname === "/login"
      )
        state.visitedLogin = true;
    });
    await installCaptchaStub(context);
    const { response, body, code } = await registerOwnedCredentials(
      owned,
      world.hostBaseUrl,
      state,
      "/account",
    );
    // #3172 — the registration entry itself arrives through the IdP on the
    // host's `/login`, which renders the REGISTRATION door (`doorFor`). The
    // watch is over the confirmation that follows: from the code step on, no
    // navigation may reach the login door.
    state.visitedLogin = false;
    state.code = code;
    expect(
      registrationEvidence(response.request().postData() ?? "", body, state),
    ).toEqual({
      credentialsMatch: true,
      consentMatches: true,
      acknowledgementMatches: true,
    });
    expect(
      /^\d{6}$/.test(code),
      "fresh owned six-digit confirmation code",
    ).toBe(true);
    expect(state.authPosts).toEqual([signInHostApiPath("/v1/auth/register")]);
    await assertNoPrivateRegistrationAccess(
      owned,
      (await response.headerValue("set-cookie")) ?? "",
      state,
    );
  },
);

When(
  "the registrant hard reloads the Academy verification step with the sign-in host's form state cleared before entering any code",
  async ({ page }) => {
    const state = verification(page);
    const field = state.page.locator('input[autocomplete="one-time-code"]');
    await expect(field).toBeVisible();
    expect(
      (await field.inputValue()) === "",
      "confirmation code unconsumed before reload",
    ).toBe(true);
    state.beforeReload = state.page.url();
    // 003 EARS-39 on the host: the creating browser's form state is the warm
    // proof and survives a plain reload; the cold step is a cleared cookie.
    // Only the sign-in host's own cookies go — the storefront's transaction
    // (and with it the return target) stays.
    const signInHost = new URL(state.beforeReload).hostname;
    await state.context.clearCookies({ domain: signInHost });
    expect(
      (await state.context.cookies()).some((c) => c.domain === signInHost),
      "sign-in host form state cleared",
    ).toBe(false);
    const response = await state.page.reload({ waitUntil: "load" });
    expect(response?.status(), "real verification document reloaded").toBe(200);
    expect(
      response?.request().isNavigationRequest(),
      "full document navigation",
    ).toBe(true);
    await state.page.waitForLoadState("networkidle");
  },
);

Then(
  "the reloaded step keeps the same address and account return target without private access",
  async ({ page, world }) => {
    const state = verification(page);
    const url = new URL(state.page.url());
    // #3172 — the step is the sign-in host's: the reload keeps the same auth
    // request, whose transaction holds the `/account` return target (the
    // landing after the code is the journey's proof of it).
    expect(isSignInHostForm(url)).toBe(true);
    expect(url.origin).not.toBe(new URL(world.hostBaseUrl).origin);
    expect(url.pathname).toBe("/verify");
    expect(url.searchParams.get(AUTH_REQUEST_PARAM)).toBe(
      new URL(state.beforeReload ?? "about:blank").searchParams.get(
        AUTH_REQUEST_PARAM,
      ),
    );
    expect(
      url.searchParams.get("email") === state.email,
      "exact owned address survives reload",
    ).toBe(true);
    const field = state.page.locator('input[autocomplete="one-time-code"]');
    await expect(field).toBeVisible();
    expect(
      (await field.inputValue()) === "",
      "reloaded code remains unentered",
    ).toBe(true);
    expect(state.authPosts).toEqual([signInHostApiPath("/v1/auth/register")]);
    await assertNoPrivateRegistrationAccess(state.page, "", state);
  },
);

When(
  "the registrant enters that same delivered six-digit code once on the cold step",
  async ({ page, world }) => {
    const state = verification(page);
    const pending = captureResponse(
      state.page,
      signInHostApiPath("/v1/auth/verify"),
    ).then(({ response, body }) => {
      state.evidence = coldVerificationEvidence(
        response.request().postData() ?? "",
        body,
        state,
        state.code!,
        world.hostBaseUrl,
      );
      return response;
    });
    state.submitted = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
    );
    await inputSecret(
      state.page.locator('input[autocomplete="one-time-code"]'),
      state.code!,
    );
    state.verification = await pending;
  },
);

Then(
  "the cold verification submits only that address and code once and opens the verified owned account with a secure session",
  async ({ page, world }) => {
    const state = verification(page);
    expect(state.verification!.status(), "cold confirmation accepted").toBe(
      200,
    );
    expect(state.evidence).toEqual({
      credentialsMatch: true,
      codeOnly: true,
      acknowledgementMatches: true,
    });
    await state.page.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    const profile = await state.page.evaluate(async (email) => {
      const response = await fetch("/v1/me/profile", {
        credentials: "include",
      });
      const body = await response.json().catch(() => ({}));
      return {
        status: response.status,
        sameAccount: body.email === email,
        emailVerified: body.emailVerified === true,
      };
    }, state.email);
    expect(profile).toEqual({
      status: 200,
      sameAccount: true,
      emailVerified: true,
    });
    await assertSecureSession(
      state.page,
      state.verification!,
      world.hostBaseUrl,
    );
    const exposed = await state.page.evaluate(
      (secrets) => {
        const readable = JSON.stringify({
          url: location.href,
          cookie: document.cookie,
          local: Object.entries(localStorage),
          session: Object.entries(sessionStorage),
        });
        return secrets.some(
          (secret) =>
            readable.includes(secret) ||
            readable.includes(encodeURIComponent(secret)),
        );
      },
      [state.password, state.code!],
    );
    expect(
      exposed,
      "no registration password or confirmation code in readable stores",
    ).toBe(false);
    expect(
      (await state.context.cookies()).some((cookie) =>
        [state.password, state.code!].some((secret) =>
          cookie.value.includes(secret),
        ),
      ),
      "no registration credentials in cookies",
    ).toBe(false);
  },
);

Then(
  "the verification journey never visits login, replays registration, or requests another code mail",
  async ({ page, request, world }) => {
    const state = verification(page);
    await assertNoAddressedMail(
      request,
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
      state.submitted!,
    );
    expect(
      state.authPosts,
      "one registration and one code-only confirmation through authenticated arrival",
    ).toEqual([
      signInHostApiPath("/v1/auth/register"),
      signInHostApiPath("/v1/auth/verify"),
    ]);
    expect(state.visitedLogin, "confirmation never visits the login door").toBe(
      false,
    );
  },
);

When(
  "a separate guest browser submits the original registration password for that account",
  async ({ page, browser, httpCredentials, world }) => {
    const state = verification(page);
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const guest = await context.newPage();
    state.guest = guest;
    expect(context !== state.context, "independent guest context").toBe(true);
    expect(
      (await context.cookies()).some((cookie) => cookie.name === SESSION),
      "guest starts without the owner's session",
    ).toBe(false);
    await installCaptchaStub(context);
    await guest.goto(`${world.hostBaseUrl}/login?returnTo=%2Faccount`, {
      waitUntil: "load",
    });
    await guest.waitForLoadState("networkidle");
    await assertNoPrivateRegistrationAccess(guest, "", state);
    await inputSecret(
      guest.locator('input[autocomplete="username"]'),
      state.email,
    );
    await inputSecret(
      guest.locator('input[autocomplete="current-password"]'),
      state.password,
    );
    state.passwordRequests = 0;
    guest.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === signInHostApiPath("/v1/auth/login")
      )
        state.passwordRequests! += 1;
    });
    state.refusal = await gatedPasswordLogin(
      guest,
      world.hostBaseUrl,
      async () => {
        const pending = guest.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname ===
              signInHostApiPath("/v1/auth/login"),
        );
        await guest.getByTestId("password-login-submit").click();
        return pending;
      },
    );
    let matches = false;
    try {
      const submitted = state.refusal.request().postDataJSON();
      matches =
        submitted.identifier === state.email &&
        submitted.password === state.password;
    } catch {
      // Discard credential-bearing parser diagnostics.
    }
    expect(
      matches,
      "actual login probe submits the original owned credentials",
    ).toBe(true);
  },
);

Then(
  "that password is refused generically and the guest has no private session or profile access",
  async ({ page }) => {
    const state = verification(page);
    expect(
      state.refusal!.status(),
      "pre-verification registration password invalidated",
    ).toBe(401);
    expect(new URL(state.guest!.url()).pathname).toBe("/login");
    await expect(
      state.guest!.getByRole("alert").filter({
        hasText: "Не удалось войти. Проверьте данные и попробуйте снова.",
      }),
    ).toBeVisible();
    await assertNoPrivateRegistrationAccess(
      state.guest!,
      (await state.refusal!.headerValue("set-cookie")) ?? "",
      state,
    );
    expect(
      state.passwordRequests,
      "one independent password-refusal probe",
    ).toBe(1);
  },
);

After("@cold-email-confirmation", async ({ page }) => {
  const state = verifications.get(page);
  if (!state) return;
  const contexts = [
    state.context,
    ...(state.guest ? [state.guest.context()] : []),
  ];
  try {
    for (const context of contexts) {
      if ((await context.cookies()).some((cookie) => cookie.name === SESSION)) {
        const result = await context.pages()[0]!.evaluate(async () => {
          const logout = await fetch("/v1/auth/logout", {
            method: "POST",
            credentials: "include",
          });
          const profile = await fetch("/v1/me/profile", {
            credentials: "include",
          });
          return { logout: logout.status, profile: profile.status };
        });
        expect(result, "owned cold verification session revoked").toEqual({
          logout: 200,
          profile: 401,
        });
      }
    }
  } finally {
    // Close pages first so failure-context snapshots cannot capture credentials.
    for (const context of contexts) {
      await Promise.all(context.pages().map((owned) => owned.close()));
      await context.close();
    }
    verifications.delete(page);
  }
});
