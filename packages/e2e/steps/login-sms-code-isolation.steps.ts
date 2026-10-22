import { storefrontCallbackAcknowledgement } from "../lib/owned-registration.js";
import { hostCommand, signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import { confirmOwnedPhone } from "../lib/owned-phone-confirmation.js";
import {
  captureSmsCheckpoint,
  freshConfirmablePhone,
  smsSinkUrl,
  waitForSmsCode,
} from "../lib/sms-sink.js";
import {
  inputSecret,
  registerOwnedCredentials,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface Owner extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  phone: string;
  sink: string;
  subject?: string;
  code?: string;
  priorCookies: string[];
  requests: number;
  submissions: number;
}
const pairs = new WeakMap<Page, Owner[]>();
function pair(key: Page): [Owner, Owner] {
  const owners = pairs.get(key);
  if (owners?.length !== 2)
    throw new Error("Two owned login identities are required");
  return owners as [Owner, Owner];
}

async function identity(owner: Owner) {
  const result = await owner.page.evaluate(
    async ({ email, phone, subject }) => {
      const profile = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const session = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const body = await profile.json().catch(() => ({}));
      const auth = await session.json().catch(() => ({}));
      return {
        subject: typeof auth.sub === "string" ? auth.sub : undefined,
        evidence: {
          profile: profile.status,
          session: session.status,
          sameEmail: body.email === email,
          verified: body.emailVerified === true,
          samePhone: body.phone === phone,
          phoneVerified: body.phoneVerified === true,
          hasSubject: typeof auth.sub === "string" && auth.sub.length > 0,
          sameSubject: subject === undefined || subject === auth.sub,
          doctorGuest:
            Array.isArray(auth.roles) && auth.roles.includes("doctor_guest"),
        },
      };
    },
    { email: owner.email, phone: owner.phone, subject: owner.subject },
  );
  expect(
    result.evidence,
    "the private identity belongs to the verified owner",
  ).toEqual({
    profile: 200,
    session: 200,
    sameEmail: true,
    verified: true,
    samePhone: true,
    phoneVerified: true,
    hasSubject: true,
    sameSubject: true,
    doctorGuest: true,
  });
  owner.subject = result.subject;
}

async function guest(owner: Owner) {
  const access = await owner.page.evaluate(async () => ({
    profile: (
      await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      })
    ).status,
    session: (
      await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      })
    ).status,
  }));
  expect(access, "a login guest has no private access").toEqual({
    profile: 401,
    session: 401,
  });
  expect(
    (await owner.context.cookies()).some((c) => c.name === SESSION),
    "a guest has no private cookie",
  ).toBe(false);
}

async function logout(owner: Owner) {
  const status = await owner.page.evaluate(
    async () =>
      (
        await fetch("/v1/auth/logout", {
          method: "POST",
          credentials: "include",
        })
      ).status,
  );
  expect(status, "the owned session is revoked normally").toBe(200);
  await guest(owner);
}

Given(
  "two owned Academy doctors verify email and confirm distinct phones for SMS login isolation",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink) throw new Error("SMS isolation requires E2E_SMS_SINK_URL");
    const owners: Owner[] = [];
    pairs.set(page, owners);
    for (let index = 0; index < 2; index += 1) {
      const context = await browser.newContext({
        locale: "ru-RU",
        ...(httpCredentials ? { httpCredentials } : {}),
      });
      const owned = await context.newPage();
      const owner: Owner = {
        context,
        page: owned,
        email: `sms-isolation-3161-${index}-${randomUUID().replaceAll("-", "")}@example.test`,
        phone: freshConfirmablePhone(),
        sink,
        password: `Owned-${randomUUID()}-aA1!`,
        priorCookies: [],
        requests: 0,
        submissions: 0,
      };
      owners.push(owner);
      expect(
        owner.email.split("@")[0]!.length <= 64,
        "owned email local-part fits its contract",
      ).toBe(true);
      owned.on("request", (request) => {
        if (request.method() !== "POST") return;
        const path = new URL(request.url()).pathname;
        if (path === signInHostApiPath("/v1/auth/login/otp/request"))
          owner.requests += 1;
        if (path === signInHostApiPath("/v1/auth/login/otp"))
          owner.submissions += 1;
      });
      await prepareCaptchaForJourney(
        context,
        world.hostBaseUrl,
        process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
      );
      const { code } = await registerOwnedCredentials(
        owned,
        world.hostBaseUrl,
        owner,
        "/account",
      );
      const pending = captureResponse(
        owned,
        signInHostApiPath("/v1/auth/verify"),
      );
      await inputSecret(
        owned.locator('input[autocomplete="one-time-code"]'),
        code,
      );
      const verified = await pending;
      expect(
        verified.response.status(),
        "owned registration verification accepted",
      ).toBe(200);
      await owned.waitForURL((url) => url.pathname === "/account");
      await owned.waitForLoadState("networkidle");
      await assertSecureSession(owned, verified.response, world.hostBaseUrl);
      await confirmOwnedPhone(owned, { phone: owner.phone, sink });
      await identity(owner);
      const cookie = (await context.cookies()).find(
        (c) => c.name === SESSION,
      )?.value;
      expect(Boolean(cookie), "registration minted a private session").toBe(
        true,
      );
      owner.priorCookies.push(cookie!);
      await logout(owner);
    }
    const [a, b] = pair(page);
    expect(
      a.subject !== b.subject && a.email !== b.email && a.phone !== b.phone,
      "the two owned doctors are distinct",
    ).toBe(true);
  },
);

When(
  "both owned doctors retain distinct actual SMS login codes requested through Academy",
  async ({ page, world }) => {
    for (const owner of pair(page)) {
      await owner.page.goto(
        new URL(
          "/login?method=code&returnTo=%2Faccount",
          world.hostBaseUrl,
        ).toString(),
        { waitUntil: "load" },
      );
      await owner.page.waitForLoadState("networkidle");
      await guest(owner);
      await expect(owner.page.getByTestId("login-method-otp")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await owner.page.getByTestId("otp-channel-sms").click();
      await inputSecret(owner.page.getByTestId("otp-identifier"), owner.phone);
      const before = await captureSmsCheckpoint(owner.sink, owner.phone);
      const pending = captureResponse(
        owner.page,
        signInHostApiPath("/v1/auth/login/otp/request"),
      );
      await owner.page.getByTestId("otp-send").click();
      const sent = await pending;
      let matches = false;
      let neutral = false;
      try {
        const request = hostCommand(sent.response.request().postDataJSON());
        const body = JSON.parse(sent.body);
        matches =
          Object.keys(request).sort().join(",") === "channel,identifier" &&
          request.channel === "sms" &&
          request.identifier === owner.phone;
        neutral = Object.keys(body).length === 1 && body.status === "otp_sent";
      } catch {
        /* Keep secret-bearing parser diagnostics out of reports. */
      }
      expect({ status: sent.response.status(), matches, neutral }).toEqual({
        status: 200,
        matches: true,
        neutral: true,
      });
      owner.code = await waitForSmsCode(
        owner.sink,
        owner.phone,
        before,
        (message) => {
          if (
            message.json?.contextInfo?.eventType !==
            "session.otp.sms.challenged"
          )
            return null;
          const args = message.json.args as
            { oTP?: unknown; code?: unknown } | undefined;
          const code = String(args?.oTP ?? args?.code ?? "");
          return /^\d{6}$/.test(code) ? code : null;
        },
        "session.otp.sms.challenged",
      );
      await guest(owner);
    }
    const [a, b] = pair(page);
    expect(
      Boolean(
        a.code &&
        b.code &&
        /^\d{6}$/.test(a.code) &&
        /^\d{6}$/.test(b.code) &&
        a.code !== b.code,
      ),
      "the actual delivered owner codes are distinct; collisions fail without another request",
    ).toBe(true);
  },
);

When(
  "doctor B submits doctor A's live SMS login code and receives a generic refusal without a session",
  async ({ page }) => {
    const [a, b] = pair(page);
    if (!a.code || !b.code)
      throw new Error("Actual owner login codes are missing");
    const pending = captureResponse(
      b.page,
      signInHostApiPath("/v1/auth/login/otp"),
    );
    const field = b.page.locator('input[autocomplete="one-time-code"]');
    await inputSecret(field, a.code);
    const refused = await pending;
    let generic = false;
    let matches = false;
    try {
      const body = JSON.parse(refused.body);
      const request = hostCommand(refused.response.request().postDataJSON());
      generic =
        Object.keys(body).length === 3 &&
        body.statusCode === 401 &&
        body.message === "invalid credentials" &&
        body.error === "Unauthorized";
      matches =
        Object.keys(request).sort().join(",") === "channel,code,identifier" &&
        request.channel === "sms" &&
        request.identifier === b.phone &&
        request.code === a.code;
    } catch {
      /* Assertions project only booleans. */
    }
    expect({
      status: refused.response.status(),
      generic,
      matches,
      noCookie: (await refused.response.headerValue("set-cookie")) === null,
    }).toEqual({ status: 401, generic: true, matches: true, noCookie: true });
    await guest(a);
    await guest(b);
    await expect(field).toHaveValue("");
    await expect(field).toBeFocused();
    const refusal = b.page.getByRole("alert").filter({
      hasText: "Код не подошёл. Проверьте его или запросите новый.",
    });
    await expect(refusal).toHaveCount(1);
    await expect(refusal).toBeVisible();
  },
);

Then(
  "both retained SMS login codes still authenticate their rightful owners and preserve their identities through reload",
  async ({ page, world }) => {
    const [a, b] = pair(page);
    for (const owner of [a, b]) {
      if (!owner.code) throw new Error("The retained owner code is missing");
      const pending = captureResponse(
        owner.page,
        signInHostApiPath("/v1/auth/login/otp"),
      );
      await inputSecret(
        owner.page.locator('input[autocomplete="one-time-code"]'),
        owner.code,
      );
      const signedIn = await pending;
      let matches = false;
      let authenticated = false;
      try {
        const request = hostCommand(signedIn.response.request().postDataJSON());
        matches =
          Object.keys(request).sort().join(",") === "channel,code,identifier" &&
          request.channel === "sms" &&
          request.identifier === owner.phone &&
          request.code === owner.code;
        authenticated =
          storefrontCallbackAcknowledgement(signedIn.body, world.hostBaseUrl);
      } catch {
        /* Assertions project only booleans. */
      }
      expect({
        status: signedIn.response.status(),
        matches,
        authenticated,
      }).toEqual({ status: 200, matches: true, authenticated: true });
      await owner.page.waitForURL(
        (url) =>
          url.origin === new URL(world.hostBaseUrl).origin &&
          url.pathname === "/account",
      );
      await owner.page.waitForLoadState("networkidle");
      await assertSecureSession(
        owner.page,
        signedIn.response,
        world.hostBaseUrl,
        owner.priorCookies,
      );
      await identity(owner);
      const cookie = (await owner.context.cookies()).find(
        (c) => c.name === SESSION,
      )?.value;
      await owner.page.reload({ waitUntil: "load" });
      await owner.page.waitForLoadState("networkidle");
      await identity(owner);
      expect(
        Boolean(cookie) &&
          (await owner.context.cookies()).find((c) => c.name === SESSION)
            ?.value === cookie,
        "the rightful owner's session survives reload",
      ).toBe(true);
      await expect(
        owner.page.getByTestId("profile-phone-verified"),
      ).toBeVisible();
      expect(
        await owner.page
          .getByTestId("profile-email")
          .evaluate(
            (element, email) => element.textContent === email,
            owner.email,
          ),
        "the account surface shows its rightful owner",
      ).toBe(true);
    }
    expect(
      {
        aRequests: a.requests,
        bRequests: b.requests,
        aSubmissions: a.submissions,
        bSubmissions: b.submissions,
      },
      "no code was resent or silently retried",
    ).toEqual({ aRequests: 1, bRequests: 1, aSubmissions: 1, bSubmissions: 2 });
    for (const owner of [a, b]) await logout(owner);
  },
);

After("@login-sms-code-isolation", async ({ page }) => {
  const owners = pairs.get(page);
  if (!owners) return;
  let failed = false;
  for (const owner of owners) {
    try {
      if (
        (await owner.context.cookies()).some(
          (cookie) => cookie.name === SESSION,
        )
      )
        await logout(owner);
    } catch {
      failed = true;
    } finally {
      delete owner.code;
      await owner.context.close().catch(() => {
        failed = true;
      });
    }
  }
  pairs.delete(page);
  if (failed) {
    if (test.info().status === test.info().expectedStatus)
      throw new Error("Owned SMS isolation session cleanup failed");
    test.info().annotations.push({
      type: "cleanup-failed",
      description:
        "Owned SMS isolation cleanup failed; original scenario failure retained.",
    });
  }
});
