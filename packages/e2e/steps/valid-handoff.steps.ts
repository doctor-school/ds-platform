import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { captchaTestTokenFromEnv } from "../lib/captcha-stub.js";
import {
  captureResponse,
  type CapturedResponse,
} from "../lib/captured-response.js";
import {
  assertNoAddressedMail,
  captureAddressedMailCheckpoint,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
  type AddressedMailCheckpoint,
} from "../lib/mailpit.js";
import { inputSecret } from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

interface Handoff {
  context: BrowserContext;
  page: Page;
  email: string;
  reference?: string;
  authPosts: string[];
  beforeHandoff?: AddressedMailCheckpoint;
  requestedAt?: string;
  code?: string;
  redeemed?: CapturedResponse;
  accepted?: CapturedResponse;
}

const handoffs = new WeakMap<Page, Handoff>();
function handoff(key: Page): Handoff {
  const state = handoffs.get(key);
  if (!state) throw new Error("Owned Academy handoff was not prepared");
  return state;
}

Given(
  "a uniquely owned Academy congress sign-up was accepted and returned a real hand-off reference",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: Handoff = {
      context,
      page: owned,
      email: `valid-handoff-2929-${randomUUID()}@example.test`,
      authPosts: [],
    };
    handoffs.set(page, state);
    owned.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "POST" && pathname.startsWith("/v1/auth/"))
        state.authPosts.push(pathname);
    });
    await owned.goto(world.hostBaseUrl, { waitUntil: "load" });
    const before = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
    );
    expect(before.messageIds.length, "fresh owned mailbox is empty").toBe(0);
    // 044 EARS-1/39: use the real intake as the only reference minter.
    const accepted = await owned.evaluate(
      async ({ email, captchaToken }) => {
        const book = await fetch("/v1/public/specialties");
        const specialties = await book.json().catch(() => ({}));
        const specialtyId = specialties.entries?.[0]?.id;
        if (!book.ok || typeof specialtyId !== "string")
          throw new Error("Congress specialty prerequisite is unavailable");
        const response = await fetch("/v1/congress/sign-up", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(captchaToken ? { "x-smartcaptcha-token": captchaToken } : {}),
          },
          body: JSON.stringify({
            surname: "Иванова",
            firstName: "Мария",
            patronymic: "Петровна",
            email,
            specialtyId,
            workplace: "ГКБ № 1",
            city: "Москва",
            region: "Москва",
            contactPhone: "+7 (900) 123-45-67",
            personalDataConsent: true,
          }),
        });
        const body = await response.json().catch(() => ({}));
        return {
          status: response.status,
          accepted: body.status === "accepted",
          reference:
            typeof body.handoff === "string" &&
            /^[A-Za-z0-9_-]{43}$/.test(body.handoff)
              ? body.handoff
              : undefined,
        };
      },
      {
        email: state.email,
        captchaToken:
          process.env.BOT_PROTECTION_ENABLED === "false"
            ? undefined
            : captchaTestTokenFromEnv(),
      },
    );
    expect(
      {
        status: accepted.status,
        accepted: accepted.accepted,
        validReference: Boolean(accepted.reference),
      },
      "real congress intake accepted the owned account and minted a reference",
    ).toEqual({ status: 200, accepted: true, validReference: true });
    state.reference = accepted.reference;
    expect(state.authPosts, "signup used no separate auth command").toEqual([]);
    const mail = nativeRecoveryMail();
    const mailpit =
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl);
    // 044 EARS-11/13: the real intake sends its own code-free notice first.
    await expect
      .poll(
        async () =>
          (await captureAddressedMailCheckpoint(mail, mailpit, state.email))
            .messageIds.length,
        { message: "the congress confirmation notice is delivered" },
      )
      .toBe(1);
    const notice = await captureAddressedMailCheckpoint(
      mail,
      mailpit,
      state.email,
    );
    const detail = await mail.get(
      `${mailpit.replace(/\/$/, "")}/api/v1/message/${encodeURIComponent(notice.messageIds[0]!)}`,
    );
    expect(detail.status(), "owned congress notice can be read").toBe(200);
    const message = (await detail.json().catch(() => {
      throw new Error("Malformed owned congress notice");
    })) as { ID?: string; Subject?: string; To?: { Address?: string }[] };
    expect(
      message.ID === notice.messageIds[0] &&
        message.To?.some(
          (recipient) => recipient.Address?.toLowerCase() === state.email,
        ) &&
        typeof message.Subject === "string" &&
        message.Subject.startsWith("Doctor.School — вы зарегистрированы на ") &&
        message.Subject.length >
          "Doctor.School — вы зарегистрированы на ".length,
      "the pre-handoff delivery is the real congress notice, not an auth-code mail",
    ).toBe(true);
    await assertNoAddressedMail(
      mail,
      mailpit,
      state.email,
      new Date().toISOString(),
      notice,
    );
    state.beforeHandoff = notice;
  },
);

When(
  "the visitor opens that valid Academy hand-off link with the account return target",
  async ({ page, world }) => {
    const state = handoff(page);
    if (!state.reference) throw new Error("Real handoff reference is missing");
    const target = new URL("/login", world.hostBaseUrl);
    target.search = new URLSearchParams({
      method: "code",
      handoff: state.reference,
      returnTo: "/account",
    }).toString();
    state.requestedAt = new Date().toISOString();
    const pending = captureResponse(state.page, "/v1/auth/login/otp/handoff");
    const response = await state.page.goto(target.toString(), {
      waitUntil: "load",
    });
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    state.redeemed = await pending;
  },
);

Then(
  "exactly one fresh sign-in code mail is issued to that hand-off account without another request",
  async ({ page, world }) => {
    const state = handoff(page);
    if (!state.redeemed || !state.requestedAt || !state.beforeHandoff)
      throw new Error("Handoff redemption was not observed");
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
      // Do not retain reference-bearing parser diagnostics.
    }
    expect(state.redeemed.response.status(), "real handoff redeemed").toBe(200);
    expect(correct, "redemption returns the exact original address").toBe(true);
    const mailpit =
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl);
    state.code = await fetchRecoveryCode(
      nativeRecoveryMail(),
      mailpit,
      state.email,
      state.requestedAt,
      "login",
    );
    expect(/^\d{6}$/.test(state.code), "delivered code has six digits").toBe(
      true,
    );
    const delivered = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      mailpit,
      state.email,
    );
    const beforeIds = new Set(state.beforeHandoff.messageIds);
    expect(
      {
        total: delivered.messageIds.length,
        added: delivered.messageIds.filter((id) => !beforeIds.has(id)).length,
        unique:
          new Set(delivered.messageIds).size === delivered.messageIds.length,
        congressNoticeRemains: state.beforeHandoff.messageIds.every((id) =>
          delivered.messageIds.includes(id),
        ),
      },
      "exactly one addressed login delivery was added to the congress-notice baseline",
    ).toEqual({
      total: 2,
      added: 1,
      unique: true,
      congressNoticeRemains: true,
    });
    await assertNoAddressedMail(
      nativeRecoveryMail(),
      mailpit,
      state.email,
      state.requestedAt,
      delivered,
    );
    expect(state.authPosts, "no second code request or resend").toEqual([
      "/v1/auth/login/otp/handoff",
    ]);
  },
);

Then(
  "the hand-off code step shows the exact original address and six cells without a method choice or captcha",
  async ({ page }) => {
    const state = handoff(page);
    await expect(state.page.getByTestId("otp-verify")).toBeVisible();
    expect(
      await state.page.getByText(`Мы отправили код на ${state.email}.`).count(),
      "the complete sent-to sentence retains the original address",
    ).toBe(1);
    const input = state.page.locator('input[autocomplete="one-time-code"]');
    await expect(input).toHaveAttribute("maxlength", "6");
    await expect(input).toHaveValue("");
    await expect(
      state.page.locator("[data-input-otp-container] > div:first-child > div"),
    ).toHaveCount(6);
    await expect(state.page.getByTestId("login-method-password")).toHaveCount(
      0,
    );
    await expect(state.page.getByTestId("login-method-otp")).toHaveCount(0);
    await expect(state.page.getByTestId("otp-send")).toHaveCount(0);
    await expect(
      state.page.locator(
        'iframe[src*="smartcaptcha"], [data-testid="smartcaptcha"]',
      ),
    ).toHaveCount(0);
    expect(
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      ),
      "no private session before the mailed code is entered",
    ).toBe(false);
    expect(
      await state.page.evaluate(
        async () => (await fetch("/v1/me/profile")).status,
      ),
      "private profile is inaccessible before code acceptance",
    ).toBe(401);
    await state.page.screenshot({
      path: test.info().outputPath("handoff-code.png"),
    });
  },
);

Then(
  "the hand-off reference is absent from the address bar and browser navigation history",
  async ({ page }) => {
    const state = handoff(page);
    const url = new URL(state.page.url());
    expect(
      url.pathname === "/login" &&
        url.searchParams.size === 2 &&
        url.searchParams.get("method") === "code" &&
        url.searchParams.get("returnTo") === "/account",
      "the address bar retains only the method and Academy return context",
    ).toBe(true);
    const history = await state.context.newCDPSession(state.page);
    try {
      const entries = await history.send("Page.getNavigationHistory");
      expect(
        entries.entries.some(
          (entry) =>
            new URL(entry.url).searchParams.has("handoff") ||
            entry.url.includes(state.reference!),
        ),
        "history replacement retains no reference-bearing entry",
      ).toBe(false);
    } finally {
      await history.detach();
    }
  },
);

When(
  "the visitor enters the delivered hand-off sign-in code once in that Academy tab",
  async ({ page }) => {
    const state = handoff(page);
    if (!state.code) throw new Error("The delivered handoff code is missing");
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
      // Do not retain code-bearing parser diagnostics.
    }
    expect(
      state.accepted.response.status(),
      "delivered handoff code accepted",
    ).toBe(200);
    expect(
      correct,
      "only the original account's delivered code was submitted",
    ).toBe(true);
  },
);

Then(
  "a secure BFF session opens that hand-off account's own Academy profile at the account return target",
  async ({ page, world }) => {
    const state = handoff(page);
    if (!state.accepted) throw new Error("Handoff sign-in was not observed");
    await state.page.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await assertSecureSession(
      state.page,
      state.accepted.response,
      world.hostBaseUrl,
    );
    expect(
      await state.page.evaluate(async (email) => {
        const response = await fetch("/v1/me/profile", {
          credentials: "include",
          cache: "no-store",
        });
        const profile = await response.json().catch(() => ({}));
        const session = await fetch("/v1/auth/session", {
          credentials: "include",
          cache: "no-store",
        });
        const claims = await session.json().catch(() => ({}));
        return {
          profile: response.status,
          sameEmail: profile.email === email,
          session: session.status,
          hasSubject: typeof claims.sub === "string" && claims.sub.length > 0,
        };
      }, state.email),
      "the private profile and session belong to the signed-in handoff account",
    ).toEqual({
      profile: 200,
      sameEmail: true,
      session: 200,
      hasSubject: true,
    });
    expect(
      await state.page
        .getByTestId("profile-email")
        .evaluate(
          (element, email) => element.textContent === email,
          state.email,
        ),
      "account surface shows the exact owned email",
    ).toBe(true);
    expect(
      state.authPosts,
      "one redemption and one code submission without another auth command",
    ).toEqual(["/v1/auth/login/otp/handoff", "/v1/auth/login/otp"]);
    await state.page.screenshot({
      path: test.info().outputPath("handoff-account.png"),
    });
  },
);

After("@valid-handoff", async ({ page }) => {
  const state = handoffs.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      )
    ) {
      const revoked = await state.page.evaluate(async () => {
        const logout = await fetch("/v1/auth/logout", {
          method: "POST",
          credentials: "include",
        });
        const profile = await fetch("/v1/me/profile", {
          credentials: "include",
        });
        return { logout: logout.status, profile: profile.status };
      });
      expect(revoked, "owned handoff session revoked").toEqual({
        logout: 200,
        profile: 401,
      });
    }
  } finally {
    await Promise.all(state.context.pages().map((owned) => owned.close()));
    await state.context.close();
    handoffs.delete(page);
  }
});
