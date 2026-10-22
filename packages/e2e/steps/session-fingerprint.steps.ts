import { signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface FingerprintJourney {
  context: BrowserContext;
  owner: Page;
  email: string;
  cookie?: Awaited<ReturnType<BrowserContext["cookies"]>>[number];
  subject?: string;
  profile?: string;
  copiedContext?: BrowserContext;
}
const journeys = new WeakMap<Page, FingerprintJourney>();
function journey(page: Page): FingerprintJourney {
  const state = journeys.get(page);
  if (!state) throw new Error("Owned fingerprint journey missing");
  return state;
}

async function ownerIdentity(state: FingerprintJourney) {
  const result = await state.owner.evaluate(
    async ({ email, subject, profile }) => {
      const sessionResponse = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const profileResponse = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const claims = await sessionResponse.json().catch(() => ({}));
      const body = await profileResponse.json().catch(() => ({}));
      const serialized = JSON.stringify(body);
      return {
        subject: typeof claims.sub === "string" ? claims.sub : undefined,
        profile: serialized,
        evidence: {
          session: sessionResponse.status,
          profile: profileResponse.status,
          sameEmail: body.email === email,
          verified: body.emailVerified === true,
          sameSubject:
            typeof claims.sub === "string" &&
            !!claims.sub &&
            (subject === undefined || claims.sub === subject),
          unchangedProfile: profile === undefined || profile === serialized,
        },
      };
    },
    { email: state.email, subject: state.subject, profile: state.profile },
  );
  expect(result.evidence, "same owned private identity").toEqual({
    session: 200,
    profile: 200,
    sameEmail: true,
    verified: true,
    sameSubject: true,
    unchangedProfile: true,
  });
  state.subject ??= result.subject;
  state.profile ??= result.profile;
}

Given(
  "an owned verified Academy account has its original fingerprint-bound private session",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const state: FingerprintJourney = {
      context,
      owner: await context.newPage(),
      email: `fingerprint-3060-${randomUUID()}@example.test`,
    };
    journeys.set(page, state);
    await prepareCaptchaForJourney(
      context,
      world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const { code } = await registerOwnedCredentials(
      state.owner,
      world.hostBaseUrl,
      {
        email: state.email,
        password: `Owned-${randomUUID()}-aA1!`,
      },
      "/account",
    );
    const verifying = captureResponse(
      state.owner,
      signInHostApiPath("/v1/auth/verify"),
    );
    await inputSecret(
      state.owner.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const verified = await verifying;
    expect(
      verified.response.status(),
      "owned email verification accepted",
    ).toBe(200);
    await state.owner.waitForURL((url) => url.pathname === "/account");
    await state.owner.waitForLoadState("networkidle");
    await assertSecureSession(
      state.owner,
      verified.response,
      world.hostBaseUrl,
    );
    await ownerIdentity(state);
    const cookie = (await context.cookies()).find(
      (cookie) => cookie.name === SESSION,
    );
    expect(
      Boolean(cookie),
      "actual owned session captured only in memory",
    ).toBe(true);
    if (!cookie) throw new Error("Owned session cookie missing");
    state.cookie = cookie;
  },
);

Then(
  "a fresh browser sending that copied cookie with a different user agent receives only generic private-read refusals",
  async ({ page, browser, httpCredentials, world }) => {
    const state = journey(page);
    if (!state.cookie || !state.subject)
      throw new Error("Owned session prerequisite missing");
    const original = await state.owner.evaluate(() => ({
      agent: navigator.userAgent,
      language: navigator.language,
    }));
    state.copiedContext = await browser.newContext({
      locale: original.language,
      userAgent: `${original.agent} DifferentFingerprint/3060`,
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const copied = await state.copiedContext.newPage();
    // #3172: `/login` is an entry that leaves for the sign-in host now; the
    // copied cookie is replayed from an ordinary public storefront page.
    await copied.goto(`${world.hostBaseUrl}/`, { waitUntil: "load" });
    await copied.waitForLoadState("networkidle");
    await state.copiedContext.addCookies([state.cookie]);
    const fingerprint = await copied.evaluate(() => ({
      agent: navigator.userAgent,
      language: navigator.language,
    }));
    expect(
      {
        changedAgent: fingerprint.agent !== original.agent,
        sameLanguage: fingerprint.language === original.language,
        sameOrigin:
          new URL(copied.url()).origin === new URL(world.hostBaseUrl).origin,
      },
      "only deliberate browser fingerprint variation",
    ).toEqual({
      changedAgent: true,
      sameLanguage: true,
      sameOrigin: true,
    });
    for (const path of ["/v1/auth/session", "/v1/me/profile"]) {
      const pending = copied.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === path &&
          response.request().method() === "GET",
      );
      const evidence = await copied.evaluate(
        async ({ path, email, subject, cookie }) => {
          const response = await fetch(path, {
            credentials: "include",
            cache: "no-store",
          });
          const text = await response.text();
          let generic = false;
          try {
            const body = JSON.parse(text);
            generic =
              Object.keys(body).length === 3 &&
              body.statusCode === 401 &&
              body.message === "authentication required" &&
              body.error === "Unauthorized";
          } catch {
            /* Never persist a response that might contain private data. */
          }
          return {
            status: response.status,
            generic,
            noDisclosure:
              !text.includes(email) &&
              !text.includes(subject) &&
              !text.includes(cookie) &&
              !/access[_-]?token|refresh[_-]?token|eyJ[\w-]+\.[\w-]+\.[\w-]+/i.test(
                text,
              ),
          };
        },
        {
          path,
          email: state.email,
          subject: state.subject,
          cookie: state.cookie.value,
        },
      );
      const response = await pending;
      const headers = await response.request().allHeaders();
      expect(
        {
          cookieSent: (headers.cookie ?? "")
            .split(/;\s*/)
            .includes(`${SESSION}=${state.cookie.value}`),
          changedAgentSent: headers["user-agent"] === fingerprint.agent,
        },
        "actual request carried copied opaque cookie and changed user agent",
      ).toEqual({
        cookieSent: true,
        changedAgentSent: true,
      });
      expect(
        evidence,
        "generic 401 discloses no private profile or token",
      ).toEqual({
        status: 401,
        generic: true,
        noDisclosure: true,
      });
    }
  },
);

Then(
  "the original Academy browser still reads the same owner and profile with its unchanged secure session",
  async ({ page, world }) => {
    const state = journey(page);
    await ownerIdentity(state);
    await state.owner.reload({ waitUntil: "load" });
    await ownerIdentity(state);
    const cookie = (await state.context.cookies()).find(
      (item) => item.name === SESSION,
    );
    expect(
      {
        sameCookie: !!cookie && cookie.value === state.cookie?.value,
        secure: cookie?.secure,
        httpOnly: cookie?.httpOnly,
        sameSite: cookie?.sameSite,
        path: cookie?.path,
        hostOnly: cookie?.domain === new URL(world.hostBaseUrl).hostname,
      },
      "original secure opaque session remains unchanged",
    ).toEqual({
      sameCookie: true,
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      hostOnly: true,
    });
    expect(
      await state.owner
        .getByTestId("profile-email")
        .evaluate(
          (element, email) => element.textContent === email,
          state.email,
        ),
      "original account screen still belongs to its owner",
    ).toBe(true);
  },
);

After("@session-fingerprint", async ({ page, $testInfo }) => {
  const state = journeys.get(page);
  if (!state) return;
  let cleanupFailed = false;
  try {
    if (
      !state.owner.isClosed() &&
      (await state.context.cookies()).some((cookie) => cookie.name === SESSION)
    ) {
      const result = await state.owner.evaluate(async () => {
        const logout = await fetch("/v1/auth/logout", {
          method: "POST",
          credentials: "include",
        });
        const session = await fetch("/v1/auth/session", {
          credentials: "include",
          cache: "no-store",
        });
        const profile = await fetch("/v1/me/profile", {
          credentials: "include",
          cache: "no-store",
        });
        return {
          logout: logout.status,
          session: session.status,
          profile: profile.status,
        };
      });
      cleanupFailed =
        result.logout !== 200 ||
        result.session !== 401 ||
        result.profile !== 401;
    }
  } catch {
    cleanupFailed = true;
  } finally {
    for (const context of [state.copiedContext, state.context]) {
      if (context)
        await context.close().catch(() => {
          cleanupFailed = true;
        });
    }
    journeys.delete(page);
  }
  if (cleanupFailed) {
    if ($testInfo.status !== $testInfo.expectedStatus) {
      $testInfo.annotations.push({
        type: "owned-cleanup",
        description:
          "Owned session cleanup failed; lead must audit the exact fixture",
      });
    } else throw new Error("Owned fingerprint session cleanup failed");
  }
});
