import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import {
  captureAddressedMailCheckpoint,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "../lib/mailpit.js";
import { assertSecureSession } from "../lib/secure-session.js";
import {
  assertStaffProfileFixtureScope,
  setOwnedStaffProfileRoles,
  type StaffProfileRoles,
} from "../lib/staff-profile-fixture.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

interface Owner {
  context: BrowserContext;
  page: Page;
  email: string;
  password: string;
  sub: string;
  initialName?: string | null;
}
interface StaffProfile {
  owners: Owner[];
  base: string;
}
const states = new WeakMap<Page, StaffProfile>();
function state(key: Page) {
  const value = states.get(key);
  if (!value) throw new Error("Owned staff-profile fixture was not prepared");
  return value;
}
async function logout(owner: Owner) {
  const response = await owner.page.evaluate(
    async () =>
      (
        await fetch("/v1/auth/logout", {
          method: "POST",
          credentials: "include",
        })
      ).status,
  );
  expect(response, "fixture session logout accepted").toBe(200);
  expect(
    (await owner.context.cookies()).some(
      (cookie) => cookie.name === "__Host-ds_session",
    ),
  ).toBe(false);
}
async function login(
  owner: Owner,
  base: string,
  roles: StaffProfileRoles,
  method: "password" | "email-code" = "password",
) {
  const previousCookies = (await owner.context.cookies())
    .filter((cookie) => cookie.name === "__Host-ds_session")
    .map((cookie) => cookie.value);
  if (method === "email-code") expect(previousCookies.length).toBe(1);
  await owner.page.goto(`${base}/login?returnTo=%2Faccount`, {
    waitUntil: "load",
  });
  await owner.page.waitForLoadState("networkidle");
  let response;
  if (method === "password") {
    await inputSecret(
      owner.page.locator('input[autocomplete="username"]'),
      owner.email,
    );
    await inputSecret(
      owner.page.locator('input[autocomplete="current-password"]'),
      owner.password,
    );
    const accepted = captureResponse(owner.page, "/v1/auth/login");
    await owner.page.getByTestId("password-login-submit").click();
    response = await accepted;
  } else {
    await owner.page.getByTestId("login-method-otp").click();
    await owner.page.getByTestId("otp-channel-email").click();
    await inputSecret(owner.page.getByTestId("otp-identifier"), owner.email);
    const mail = nativeRecoveryMail();
    const mailbox = process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(base);
    const before = await captureAddressedMailCheckpoint(
      mail,
      mailbox,
      owner.email,
    );
    const requested = captureResponse(owner.page, "/v1/auth/login/otp/request");
    await owner.page.getByTestId("otp-send").click();
    const sent = await requested;
    expect(sent.response.status()).toBe(200);
    expect(sent.body === '{"status":"otp_sent"}').toBe(true);
    const code = await fetchRecoveryCode(
      mail,
      mailbox,
      owner.email,
      before,
      "login",
    );
    const accepted = captureResponse(owner.page, "/v1/auth/login/otp");
    await inputSecret(
      owner.page.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    response = await accepted;
    const command = response.response.request().postDataJSON();
    expect(
      command.identifier === owner.email &&
        command.code === code &&
        command.channel === "email",
    ).toBe(true);
  }
  expect(
    response.response.status(),
    "owned role principal sign-in accepted",
  ).toBe(200);
  expect(response.body === '{"status":"authenticated"}').toBe(true);
  await assertSecureSession(
    owner.page,
    response.response,
    base,
    previousCookies,
  );
  await owner.page.waitForURL((url) => url.pathname === "/account");
  const registrarOnly = roles.length === 1 && roles[0] === "event-registrar";
  const claims = await owner.page.evaluate(
    async ({ sub, roles, registrarOnly }) => {
      const response = await fetch("/v1/auth/session", {
        credentials: "include",
      });
      const body = await response.json();
      return {
        status: response.status,
        sameSubject: body.sub === sub,
        exactRoles:
          Array.isArray(body.roles) &&
          JSON.stringify([...body.roles].sort()) ===
            JSON.stringify([...roles].sort()),
        claimsAbsent:
          !Object.hasOwn(body, "sub") &&
          !Object.hasOwn(body, "roles") &&
          !Object.hasOwn(body, "mfa"),
        expectedRefusal: registrarOnly && body.statusCode === 403,
      };
    },
    { sub: owner.sub, roles, registrarOnly },
  );
  expect(claims).toEqual(
    registrarOnly
      ? {
          status: 403,
          sameSubject: false,
          exactRoles: false,
          claimsAbsent: true,
          expectedRefusal: true,
        }
      : {
          status: 200,
          sameSubject: true,
          exactRoles: true,
          claimsAbsent: false,
          expectedRefusal: false,
        },
  );
}
async function ownProfile(owner: Owner, name?: string | null) {
  const result = await owner.page.evaluate(
    async ({ email, name }) => {
      const response = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const body = await response.json();
      return {
        status: response.status,
        sameEmail: body.email === email,
        verified: body.emailVerified === true,
        nameMatches: name === undefined || body.displayName === name,
      };
    },
    { email: owner.email, name },
  );
  expect(result).toEqual({
    status: 200,
    sameEmail: true,
    verified: true,
    nameMatches: true,
  });
  await expect(owner.page.getByTestId("profile-email")).toBeVisible();
  expect(
    await owner.page
      .getByTestId("profile-email")
      .evaluate((element, email) => element.textContent === email, owner.email),
  ).toBe(true);
}
Given(
  "two uniquely owned verified Academy users are prepared for staff-profile role checks",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    assertStaffProfileFixtureScope(world.hostBaseUrl);
    const current: StaffProfile = { owners: [], base: world.hostBaseUrl };
    states.set(page, current);
    for (let index = 0; index < 2; index++) {
      const context = await browser.newContext({
        locale: "ru-RU",
        ...(httpCredentials ? { httpCredentials } : {}),
      });
      const owned = await context.newPage();
      const owner: Owner = {
        context,
        page: owned,
        email: `staff-profile-3256-${randomUUID()}@example.test`,
        password: `Staff-${randomUUID()}-aA1!`,
        sub: "",
      };
      current.owners.push(owner);
      await prepareCaptchaForJourney(
        context,
        current.base,
        process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
      );
      const { code } = await registerOwnedCredentials(
        owned,
        current.base,
        owner,
        "/account",
      );
      const verified = captureResponse(owned, "/v1/auth/verify");
      await inputSecret(
        owned.locator('input[autocomplete="one-time-code"]'),
        code,
      );
      const accepted = await verified;
      expect(accepted.response.status()).toBe(200);
      await owned.waitForURL((url) => url.pathname === "/account");
      await assertSecureSession(owned, accepted.response, current.base);
      const session = await owned.evaluate(async () => {
        const response = await fetch("/v1/auth/session", {
          credentials: "include",
        });
        const body = await response.json();
        return {
          status: response.status,
          sub: body.sub as unknown,
          roles: body.roles as unknown,
        };
      });
      expect(session.status).toBe(200);
      expect(typeof session.sub === "string" && session.sub.length > 0).toBe(
        true,
      );
      expect(session.roles).toEqual(["doctor_guest"]);
      owner.sub = session.sub as string;
      owner.initialName = await owned.evaluate(async () => {
        const response = await fetch("/v1/me/profile", {
          credentials: "include",
        });
        const body = await response.json();
        return body.displayName as string | null;
      });
      expect(
        owner.initialName === null || typeof owner.initialName === "string",
      ).toBe(true);
      await ownProfile(owner);
      await logout(owner);
    }
  },
);
When(
  "the platform-admin-only Academy owner opens and edits their own profile then signs out",
  async ({ page }) => {
    const current = state(page);
    const owner = current.owners[0]!;
    await setOwnedStaffProfileRoles(
      owner.email,
      owner.sub,
      ["doctor_guest"],
      ["platform_admin"],
    );
    await login(owner, current.base, ["platform_admin"]);
    await ownProfile(owner);
    await owner.page.getByTestId("profile-name-edit").click();
    const name = "Служебная Учётка";
    await owner.page.getByTestId("profile-name-input").fill(name);
    const saved = owner.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/me/display-name" &&
        response.request().method() === "PUT",
    );
    await owner.page.getByTestId("profile-name-save").click();
    expect((await saved).status()).toBe(200);
    await expect(owner.page.getByTestId("profile-name")).toHaveText(name);
    await owner.page.reload({ waitUntil: "load" });
    await expect(owner.page.getByTestId("profile-name")).toHaveText(name);
    await ownProfile(owner, name);
    const disclosure = await owner.page.evaluate(async () => {
      const response = await fetch("/v1/auth/session", {
        credentials: "include",
      });
      const claims = await response.json();
      const visible = document.body.innerText;
      return {
        subjectVisible: visible.includes(claims.sub),
        roleVisible: claims.roles.some((role: string) =>
          visible.includes(role),
        ),
        labelVisible: /\b(?:sub|roles|mfa|true|false)\b/i.test(visible),
      };
    });
    expect(disclosure).toEqual({
      subjectVisible: false,
      roleVisible: false,
      labelVisible: false,
    });
    const out = captureResponse(owner.page, "/v1/auth/logout");
    await owner.page.getByTestId("logout").click();
    expect((await out).response.status()).toBe(200);
    expect(
      (await owner.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      ),
    ).toBe(false);
    expect(
      await owner.page.evaluate(
        async () =>
          (await fetch("/v1/me/profile", { credentials: "include" })).status,
      ),
    ).toBe(401);
  },
);
Then(
  "Academy refuses the registrar-only profile but admits the same owner after a doctor-guest grant and fresh sign-in",
  async ({ page }) => {
    const current = state(page);
    const owner = current.owners[1]!;
    await setOwnedStaffProfileRoles(
      owner.email,
      owner.sub,
      ["doctor_guest"],
      ["event-registrar"],
    );
    await login(owner, current.base, ["event-registrar"]);
    const refused = await owner.page.evaluate(async () => {
      const profile = await fetch("/v1/me/profile", { credentials: "include" });
      const name = await fetch("/v1/me/display-name", {
        credentials: "include",
      });
      const write = await fetch("/v1/me/display-name", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Запрещённое Имя" }),
      });
      return {
        profile: profile.status,
        name: name.status,
        write: write.status,
      };
    });
    expect(refused).toEqual({ profile: 403, name: 403, write: 403 });
    await expect(owner.page.getByTestId("profile-email")).toHaveCount(0);
    await expect(owner.page.getByTestId("profile-name-edit")).toHaveCount(0);
    expect(
      await owner.page.evaluate(
        async () =>
          (
            await fetch("/v1/auth/logout", {
              method: "POST",
              credentials: "include",
            })
          ).status,
      ),
    ).toBe(403);
    await setOwnedStaffProfileRoles(
      owner.email,
      owner.sub,
      ["event-registrar"],
      ["event-registrar", "doctor_guest"],
    );
    await login(
      owner,
      current.base,
      ["event-registrar", "doctor_guest"],
      "email-code",
    );
    await ownProfile(owner, owner.initialName);
    await expect(owner.page.getByTestId("profile-name-edit")).toBeVisible();
    await expect(owner.page.getByTestId("logout")).toBeEnabled();
    const out = captureResponse(owner.page, "/v1/auth/logout");
    await owner.page.getByTestId("logout").click();
    expect((await out).response.status()).toBe(200);
    expect(
      (await owner.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      ),
    ).toBe(false);
  },
);
After("@staff-own-profile", async ({ page }) => {
  const current = states.get(page);
  if (!current) return;
  let cleanupFailed = false;
  for (const owner of current.owners) {
    try {
      if (
        (await owner.context.cookies()).some(
          (cookie) => cookie.name === "__Host-ds_session",
        )
      ) {
        await logout(owner);
      }
    } catch {
      cleanupFailed = true;
    } finally {
      await owner.context.close();
    }
  }
  states.delete(page);
  if (cleanupFailed) {
    if (test.info().status === test.info().expectedStatus)
      throw new Error("Owned staff-profile logout failed during cleanup");
    test.info().annotations.push({
      type: "cleanup-failed",
      description:
        "Owned staff-profile logout failed; original scenario failure retained; lead must inspect scoped cleanup.",
    });
  }
});
