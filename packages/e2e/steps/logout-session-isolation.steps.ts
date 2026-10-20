import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface OwnedSession {
  context: BrowserContext;
  page: Page;
  cookie?: string;
  revoked?: boolean;
}
interface IsolationJourney {
  base: string;
  email: string;
  password: string;
  sessions: OwnedSession[];
  subject?: string;
  profile?: string;
}
const journeys = new WeakMap<Page, IsolationJourney>();
function journey(page: Page) {
  const state = journeys.get(page);
  if (!state) throw new Error("Owned logout-isolation journey missing");
  return state;
}

async function privateOwner(state: IsolationJourney, owned: OwnedSession) {
  const result = await owned.page.evaluate(
    async ({ email, subject, previous }) => {
      const session = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const profile = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const claims = await session.json().catch(() => ({}));
      const body = await profile.json().catch(() => ({}));
      return {
        subject: typeof claims.sub === "string" ? claims.sub : undefined,
        profile: JSON.stringify(body),
        evidence: {
          session: session.status,
          profile: profile.status,
          sameEmail: body.email === email,
          verified: body.emailVerified === true,
          sameSubject:
            typeof claims.sub === "string" &&
            claims.sub.length > 0 &&
            (subject === undefined || subject === claims.sub),
          sameProfile:
            previous === undefined || previous === JSON.stringify(body),
        },
      };
    },
    { email: state.email, subject: state.subject, previous: state.profile },
  );
  expect(
    result.evidence,
    "independent session retains the same private owner",
  ).toEqual({
    session: 200,
    profile: 200,
    sameEmail: true,
    verified: true,
    sameSubject: true,
    sameProfile: true,
  });
  state.subject ??= result.subject;
  state.profile ??= result.profile;
}

async function refusedPrivateAccess(
  state: IsolationJourney,
  owned: OwnedSession,
) {
  const evidence = await owned.page.evaluate(
    async ({ email, subject, cookie }) => {
      const results = [];
      for (const path of ["/v1/auth/session", "/v1/me/profile"]) {
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
            body.error === "Unauthorized" &&
            body.message === "authentication required";
        } catch {
          /* Retain only safe refusal evidence. */
        }
        results.push({
          status: response.status,
          generic,
          noDisclosure:
            !text.includes(email) &&
            !(subject && text.includes(subject)) &&
            !(cookie && text.includes(cookie)) &&
            !/access[_-]?token|refresh[_-]?token|eyJ[\w-]+\.[\w-]+\.[\w-]+/i.test(
              text,
            ),
        });
      }
      return results;
    },
    { email: state.email, subject: state.subject, cookie: owned.cookie },
  );
  expect(
    evidence,
    "revoked session cannot disclose private owner data",
  ).toEqual([
    { status: 401, generic: true, noDisclosure: true },
    { status: 401, generic: true, noDisclosure: true },
  ]);
}

async function logout(owned: OwnedSession) {
  const status = await owned.page.evaluate(
    async () =>
      (
        await fetch("/v1/auth/logout", {
          method: "POST",
          credentials: "include",
        })
      ).status,
  );
  expect(status, "requested owned session logout accepted").toBe(200);
  expect(
    (await owned.context.cookies()).some((cookie) => cookie.name === SESSION),
    "logout clears the requested browser cookie",
  ).toBe(false);
}

async function passwordLogin(state: IsolationJourney, owned: OwnedSession) {
  const login = new URL("/login", state.base);
  login.searchParams.set("method", "password");
  login.searchParams.set("returnTo", "/account");
  await owned.page.goto(login.toString(), { waitUntil: "load" });
  await owned.page.waitForLoadState("networkidle");
  expect(
    (await owned.context.cookies()).some((cookie) => cookie.name === SESSION),
    "independent login begins without a session cookie",
  ).toBe(false);
  await inputSecret(
    owned.page.locator('input[autocomplete="username"]'),
    state.email,
  );
  await inputSecret(
    owned.page.locator('input[autocomplete="current-password"]'),
    state.password,
  );
  const pending = captureResponse(owned.page, "/v1/auth/login");
  await owned.page.getByRole("button", { name: /Войти|Продолжить/i }).click();
  const accepted = await pending;
  expect(
    {
      status: accepted.response.status(),
      acknowledgement: accepted.body === '{"status":"authenticated"}',
    },
    "actual independent password login accepted",
  ).toEqual({ status: 200, acknowledgement: true });
  await owned.page.waitForURL((url) => url.pathname === "/account");
  await owned.page.waitForLoadState("networkidle");
  await assertSecureSession(owned.page, accepted.response, state.base);
  const cookie = (await owned.context.cookies()).find(
    (item) => item.name === SESSION,
  );
  expect(Boolean(cookie), "independently minted opaque cookie exists").toBe(
    true,
  );
  if (!cookie) throw new Error("Owned independent session cookie missing");
  expect(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      cookie.value,
    ),
    "independently minted session is an opaque UUID handle",
  ).toBe(true);
  owned.cookie = cookie.value;
  owned.revoked = false;
  await privateOwner(state, owned);
}

Given(
  "a uniquely owned verified Academy account has two independently password-authenticated browser sessions",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const state: IsolationJourney = {
      base: world.hostBaseUrl,
      email: `logout-isolation-3071-${randomUUID()}@example.test`,
      password: `Owned-${randomUUID()}-aA1!`,
      sessions: [],
    };
    journeys.set(page, state);
    const firstContext = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const first: OwnedSession = {
      context: firstContext,
      page: await firstContext.newPage(),
    };
    state.sessions.push(first);
    await prepareCaptchaForJourney(
      firstContext,
      state.base,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const { code } = await registerOwnedCredentials(
      first.page,
      state.base,
      state,
      "/account",
    );
    const pending = captureResponse(first.page, "/v1/auth/verify");
    await inputSecret(
      first.page.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const verified = await pending;
    expect(verified.response.status(), "owned account verified").toBe(200);
    await first.page.waitForURL((url) => url.pathname === "/account");
    await privateOwner(state, first);
    await logout(first);
    await passwordLogin(state, first);
    const secondContext = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const second: OwnedSession = {
      context: secondContext,
      page: await secondContext.newPage(),
    };
    state.sessions.push(second);
    await prepareCaptchaForJourney(
      secondContext,
      state.base,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    await passwordLogin(state, second);
    expect(
      Boolean(first.cookie && second.cookie && first.cookie !== second.cookie),
      "two actual password logins minted distinct opaque sessions",
    ).toBe(true);
    await privateOwner(state, first);
  },
);

When(
  "the first Academy session logs out and its retained cookie is replayed from that same browser",
  async ({ page }) => {
    const state = journey(page);
    const first = state.sessions[0];
    if (!first) throw new Error("Owned first session prerequisite missing");
    const retained = (await first.context.cookies()).find(
      (cookie) => cookie.name === SESSION,
    );
    if (!retained) throw new Error("Owned first cookie prerequisite missing");
    await logout(first);
    await refusedPrivateAccess(state, first);
    await first.context.addCookies([retained]);
    const sent = first.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/auth/session" &&
        response.request().method() === "GET",
    );
    await refusedPrivateAccess(state, first);
    const response = await sent;
    const headers = await response.request().allHeaders();
    expect(
      (headers.cookie ?? "")
        .split(/;\s*/)
        .includes(`${SESSION}=${retained.value}`),
      "actual revoked-cookie replay was sent with its original browser fingerprint",
    ).toBe(true);
    await first.context.clearCookies({ name: SESSION });
    first.revoked = true;
  },
);

Then(
  "only that first session is revoked while the second unchanged Academy session and private account survive reload",
  async ({ page }) => {
    const state = journey(page);
    const second = state.sessions[1];
    if (!second) throw new Error("Owned second session prerequisite missing");
    await privateOwner(state, second);
    await second.page.reload({ waitUntil: "load" });
    await second.page.waitForLoadState("networkidle");
    await privateOwner(state, second);
    expect(
      await second.page
        .getByTestId("profile-email")
        .evaluate(
          (element, email) => element.textContent === email,
          state.email,
        ),
      "second browser renders its unchanged private owner",
    ).toBe(true);
    const cookies = (await second.context.cookies()).filter(
      (cookie) => cookie.name === SESSION,
    );
    const cookie = cookies[0];
    expect(
      {
        count: cookies.length,
        sameCookie: Boolean(cookie && cookie.value === second.cookie),
        secure: cookie?.secure,
        httpOnly: cookie?.httpOnly,
        sameSite: cookie?.sameSite,
        path: cookie?.path,
        host: cookie?.domain === new URL(state.base).hostname,
      },
      "second secure opaque session survives first-session logout unchanged",
    ).toEqual({
      count: 1,
      sameCookie: true,
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      host: true,
    });
    await logout(second);
    await refusedPrivateAccess(state, second);
    second.revoked = true;
  },
);

After("@logout-session-isolation", async ({ page, $testInfo }) => {
  const state = journeys.get(page);
  if (!state) return;
  let cleanupFailed = false;
  for (const owned of state.sessions) {
    try {
      if (
        owned.cookie &&
        !owned.revoked &&
        !(await owned.context.cookies()).some(
          (cookie) => cookie.name === SESSION,
        )
      ) {
        await owned.context.addCookies([
          {
            name: SESSION,
            value: owned.cookie,
            url: state.base,
            secure: true,
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
      }
      if (
        (await owned.context.cookies()).some(
          (cookie) => cookie.name === SESSION,
        )
      ) {
        if (owned.page.isClosed()) owned.page = await owned.context.newPage();
        if (!owned.page.url().startsWith(`${state.base}/`))
          await owned.page.goto(new URL("/login", state.base).toString());
        await logout(owned);
        await refusedPrivateAccess(state, owned);
      }
    } catch {
      cleanupFailed = true;
    } finally {
      await owned.context.close().catch(() => {
        cleanupFailed = true;
      });
    }
  }
  state.password = "";
  journeys.delete(page);
  if (cleanupFailed) {
    if ($testInfo.status !== $testInfo.expectedStatus)
      $testInfo.annotations.push({
        type: "owned-cleanup",
        description:
          "Owned logout-isolation session cleanup failed; lead must audit the exact fixture",
      });
    else throw new Error("Owned logout-isolation session cleanup failed");
  }
});
