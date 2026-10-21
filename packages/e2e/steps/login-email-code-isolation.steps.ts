import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  captureAddressedMailCheckpoint,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "../lib/mailpit.js";
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
    async ({ email, subject }) => {
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
          hasSubject: typeof auth.sub === "string" && auth.sub.length > 0,
          sameSubject: subject === undefined || subject === auth.sub,
          doctorGuest:
            Array.isArray(auth.roles) && auth.roles.includes("doctor_guest"),
        },
      };
    },
    { email: owner.email, subject: owner.subject },
  );
  expect(
    result.evidence,
    "the private identity belongs to the verified owner",
  ).toEqual({
    profile: 200,
    session: 200,
    sameEmail: true,
    verified: true,
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
  "two owned Academy doctors verify fresh registrations for email login isolation",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
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
        email: `email-isolation-3138-${index}-${randomUUID()}@example.test`,
        password: `Owned-${randomUUID()}-aA1!`,
        priorCookies: [],
        requests: 0,
        submissions: 0,
      };
      owners.push(owner);
      owned.on("request", (request) => {
        if (request.method() !== "POST") return;
        const path = new URL(request.url()).pathname;
        if (path === "/v1/auth/login/otp/request") owner.requests += 1;
        if (path === "/v1/auth/login/otp") owner.submissions += 1;
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
      const pending = captureResponse(owned, "/v1/auth/verify");
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
      a.subject !== b.subject && a.email !== b.email,
      "the two owned doctors are distinct",
    ).toBe(true);
  },
);

When(
  "both owned doctors retain distinct actual email login codes requested through Academy",
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
      await owner.page.getByTestId("otp-channel-email").click();
      await inputSecret(owner.page.getByTestId("otp-identifier"), owner.email);
      const mail = nativeRecoveryMail();
      const mailbox =
        process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl);
      const before = await captureAddressedMailCheckpoint(
        mail,
        mailbox,
        owner.email,
      );
      const pending = captureResponse(owner.page, "/v1/auth/login/otp/request");
      await owner.page.getByTestId("otp-send").click();
      const sent = await pending;
      let matches = false;
      let neutral = false;
      try {
        const request = sent.response.request().postDataJSON();
        const body = JSON.parse(sent.body);
        matches =
          Object.keys(request).sort().join(",") === "channel,identifier" &&
          request.channel === "email" &&
          request.identifier === owner.email;
        neutral = Object.keys(body).length === 1 && body.status === "otp_sent";
      } catch {
        /* Keep secret-bearing parser diagnostics out of reports. */
      }
      expect({ status: sent.response.status(), matches, neutral }).toEqual({
        status: 200,
        matches: true,
        neutral: true,
      });
      owner.code = await fetchRecoveryCode(
        mail,
        mailbox,
        owner.email,
        before,
        "login",
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
  "doctor B submits doctor A's live email login code and receives a generic refusal without a session",
  async ({ page }) => {
    const [a, b] = pair(page);
    if (!a.code || !b.code)
      throw new Error("Actual owner login codes are missing");
    const pending = captureResponse(b.page, "/v1/auth/login/otp");
    const field = b.page.locator('input[autocomplete="one-time-code"]');
    await inputSecret(field, a.code);
    const refused = await pending;
    let generic = false;
    let matches = false;
    try {
      const body = JSON.parse(refused.body);
      const request = refused.response.request().postDataJSON();
      generic =
        Object.keys(body).length === 3 &&
        body.statusCode === 401 &&
        body.message === "invalid credentials" &&
        body.error === "Unauthorized";
      matches =
        Object.keys(request).sort().join(",") === "channel,code,identifier" &&
        request.channel === "email" &&
        request.identifier === b.email &&
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
    const refusal = b.page
      .getByRole("alert")
      .filter({
        hasText: "Код не подошёл. Проверьте его или запросите новый.",
      });
    await expect(refusal).toHaveCount(1);
    await expect(refusal).toBeVisible();
  },
);

Then(
  "both retained email login codes still authenticate their rightful owners and preserve their identities through reload",
  async ({ page, world }) => {
    const [a, b] = pair(page);
    for (const owner of [a, b]) {
      if (!owner.code) throw new Error("The retained owner code is missing");
      const pending = captureResponse(owner.page, "/v1/auth/login/otp");
      await inputSecret(
        owner.page.locator('input[autocomplete="one-time-code"]'),
        owner.code,
      );
      const signedIn = await pending;
      let matches = false;
      let authenticated = false;
      try {
        const request = signedIn.response.request().postDataJSON();
        const body = JSON.parse(signedIn.body);
        matches =
          Object.keys(request).sort().join(",") === "channel,code,identifier" &&
          request.channel === "email" &&
          request.identifier === owner.email &&
          request.code === owner.code;
        authenticated =
          Object.keys(body).length === 1 && body.status === "authenticated";
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
        owner.page.getByTestId("profile-email-verified"),
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

After("@login-email-code-isolation", async ({ page }) => {
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
      throw new Error("Owned email isolation session cleanup failed");
    test
      .info()
      .annotations.push({
        type: "cleanup-failed",
        description:
          "Owned email isolation cleanup failed; original scenario failure retained.",
      });
  }
});
