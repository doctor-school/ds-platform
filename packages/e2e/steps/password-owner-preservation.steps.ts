import { storefrontCallbackAcknowledgement } from "../lib/owned-registration.js";
import { signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import {
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import { runGatedLoginAttempt } from "../lib/login-failure-gate.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";
import { browserOf, closeOwnedLoginWindow } from "../lib/host-sign-in.js";

const SESSION = "__Host-ds_session";
interface PasswordOwner {
  email: string;
  password: string;
  contexts: BrowserContext[];
  httpCredentials: BrowserContextOptions["httpCredentials"];
  owner?: Page;
  guest?: Page;
  cookie?: string;
  subject?: string;
  profile?: string;
}
const journeys = new WeakMap<Page, PasswordOwner>();
function journey(page: Page): PasswordOwner {
  const state = journeys.get(page);
  if (!state) throw new Error("Owned password-preservation journey missing");
  return state;
}
async function privatePage(
  browser: Browser,
  state: PasswordOwner,
  base: string,
) {
  const context = await browser.newContext({
    locale: "ru-RU",
    ...(state.httpCredentials
      ? { httpCredentials: state.httpCredentials }
      : {}),
  });
  state.contexts.push(context);
  await prepareCaptchaForJourney(
    context,
    base,
    process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
  );
  return context.newPage();
}
async function sameOwner(page: Page, state: PasswordOwner) {
  const result = await page.evaluate(
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
async function noPrivateAccess(page: Page) {
  expect(
    (await page.context().cookies()).some((c) => c.name === SESSION),
    "refusal minted no browser session",
  ).toBe(false);
  expect(
    await page.evaluate(async () => ({
      session: (
        await fetch("/v1/auth/session", {
          credentials: "include",
          cache: "no-store",
        })
      ).status,
      profile: (
        await fetch("/v1/me/profile", {
          credentials: "include",
          cache: "no-store",
        })
      ).status,
    })),
    "guest cannot access private owner data",
  ).toEqual({ session: 401, profile: 401 });
}

async function preparePassword(
  page: Page,
  base: string,
  state: PasswordOwner,
  password: string,
) {
  await page.goto(base + "/login?returnTo=%2Faccount", { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  await inputSecret(
    page.locator('input[autocomplete="username"]'),
    state.email,
  );
  await inputSecret(
    page.locator('input[autocomplete="current-password"]'),
    password,
  );
}

async function gated<T>(
  state: PasswordOwner,
  base: string,
  attempt: () => Promise<T>,
) {
  let failed = false;
  return runGatedLoginAttempt(
    {
      close: () => {
        if (!state.owner) throw new Error("Owned password owner page missing");
        return closeOwnedLoginWindow(
          browserOf(state.owner),
          base,
          { email: state.email, password: state.password },
          failed,
        );
      },
    },
    async () => {
      try {
        return await attempt();
      } catch (error) {
        failed = true;
        throw error;
      }
    },
  );
}

Given(
  "a uniquely owned verified Academy password account keeps its original private session",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const state: PasswordOwner = {
      email: "wave-p-3084-" + randomUUID() + "@example.test",
      password: "Owned-" + randomUUID() + "-aA1!",
      contexts: [],
      httpCredentials,
    };
    journeys.set(page, state);
    const owner = await privatePage(browser, state, world.hostBaseUrl);
    state.owner = owner;
    const { code } = await registerOwnedCredentials(
      owner,
      world.hostBaseUrl,
      state,
      "/account",
    );
    const verifying = captureResponse(
      owner,
      signInHostApiPath("/v1/auth/verify"),
    );
    await inputSecret(
      owner.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const verified = await verifying;
    expect(verified.response.status(), "owned registration verified").toBe(200);
    await owner.waitForURL((url) => url.pathname === "/account");
    await sameOwner(owner, state);
    await assertSecureSession(owner, verified.response, world.hostBaseUrl);
    const cookie = (await owner.context().cookies()).find(
      (c) => c.name === SESSION,
    );
    state.cookie = cookie!.value;
  },
);

When(
  "an independent Academy guest submits one wrong password while that owner remains signed in",
  async ({ page, browser, world }) => {
    const state = journey(page);
    const guest = await privatePage(browser, state, world.hostBaseUrl);
    state.guest = guest;
    const wrong = "Wrong-" + randomUUID() + "-aA1!";
    expect(
      wrong !== state.password,
      "wrong password differs from owned credential",
    ).toBe(true);
    await preparePassword(guest, world.hostBaseUrl, state, wrong);
    await noPrivateAccess(guest);
    await gated(state, world.hostBaseUrl, async () => {
      const pending = captureResponse(
        guest,
        signInHostApiPath("/v1/auth/login"),
      );
      await guest.getByTestId("password-login-submit").click();
      const refused = await pending;
      expect(refused.response.status(), "wrong password refused").toBe(401);
      let generic = false;
      try {
        const body = JSON.parse(refused.body);
        generic =
          Object.keys(body).length === 3 &&
          body.statusCode === 401 &&
          body.message === "invalid credentials" &&
          body.error === "Unauthorized";
      } catch {
        /* Keep potentially secret-bearing bodies out of diagnostics. */
      }
      expect(generic, "exact generic password refusal").toBe(true);
      expect(
        (await refused.response.headerValue("set-cookie")) === null,
        "wrong password mints no session",
      ).toBe(true);
      await expect(
        guest.getByRole("alert").filter({
          hasText: "Не удалось войти. Проверьте данные и попробуйте снова.",
        }),
      ).toBeVisible();
      await noPrivateAccess(guest);
      // Prove continuity before the successful closure makes any further login.
      const owner = state.owner!;
      await owner.reload({ waitUntil: "load" });
      await sameOwner(owner, state);
      expect(
        (await owner.context().cookies()).find((c) => c.name === SESSION)
          ?.value === state.cookie,
        "refusal alone preserves owner's original cookie",
      ).toBe(true);
      expect(
        await owner
          .getByTestId("profile-email")
          .evaluate((el, email) => el.textContent === email, state.email),
        "original account screen still belongs to owner",
      ).toBe(true);
    });
  },
);

Then(
  "the correct owned password still signs in that guest as the same Academy doctor",
  async ({ page, world }) => {
    const state = journey(page);
    const guest = state.guest!;
    await preparePassword(guest, world.hostBaseUrl, state, state.password);
    const accepted = await gated(state, world.hostBaseUrl, async () => {
      const pending = captureResponse(
        guest,
        signInHostApiPath("/v1/auth/login"),
      );
      await guest.getByTestId("password-login-submit").click();
      const response = await pending;
      expect(
        response.response.status(),
        "correct owned password accepted",
      ).toBe(200);
      expect(
        storefrontCallbackAcknowledgement(response.body, world.hostBaseUrl),
        "token-free successful login acknowledgement",
      ).toBe(true);
      return response;
    });
    await guest.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await assertSecureSession(guest, accepted.response, world.hostBaseUrl, [
      state.cookie!,
    ]);
    await sameOwner(guest, state);
    await guest.reload({ waitUntil: "load" });
    await sameOwner(guest, state);
    await state.owner!.reload({ waitUntil: "load" });
    await sameOwner(state.owner!, state);
    expect(
      (await state.owner!.context().cookies()).find((c) => c.name === SESSION)
        ?.value === state.cookie,
      "independent successful login preserves owner's cookie",
    ).toBe(true);
  },
);

After("@password-owner-preservation", async ({ page, world }) => {
  const state = journeys.get(page);
  if (!state) return;
  const failures: string[] = [];
  const origin = new URL(world.hostBaseUrl).origin;
  try {
    for (const [index, context] of state.contexts.entries()) {
      let operation = "cookies";
      let statuses:
        { logout: number; session: number; profile: number } | undefined;
      try {
        if ((await context.cookies()).some((c) => c.name === SESSION)) {
          operation = "same-origin-page";
          const active = context
            .pages()
            .find((p) => new URL(p.url()).origin === origin);
          if (!active)
            throw new Error("Owned password-owner session has no cleanup page");
          operation = "logout-and-private-refusal";
          statuses = await active.evaluate(async () => {
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
          expect(
            statuses,
            "exact owned password-owner session revoked",
          ).toEqual({
            logout: 200,
            session: 401,
            profile: 401,
          });
        }
      } catch (error) {
        failures.push(
          JSON.stringify({
            context: index,
            operation,
            statuses,
            failure:
              error instanceof Error && error.name === "TimeoutError"
                ? "timeout"
                : "operation-failed",
          }),
        );
      } finally {
        await context.close().catch(() => {
          failures.push(
            JSON.stringify({
              context: index,
              operation: "close-context",
              failure: "operation-failed",
            }),
          );
        });
      }
    }
  } finally {
    journeys.delete(page);
  }
  if (failures.length > 0) {
    if (test.info().status === test.info().expectedStatus)
      throw new Error(
        `Owned password-owner session cleanup failed: ${failures.join("; ")}`,
      );
    test.info().annotations.push({
      type: "cleanup-failed",
      description: `Owned password-owner cleanup failed; original scenario failure retained: ${failures.join("; ")}`,
    });
  }
});
