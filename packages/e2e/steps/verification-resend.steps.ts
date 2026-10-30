import {
  hostCommand,
  isAuthCommandPath,
  signInHostApiPath,
} from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import { STOREFRONT_SIGN_OUT_PATH } from "../lib/storefront-sign-out.js";
import {
  assertNoAddressedMail,
  captureAddressedMailCheckpoint,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
  type AddressedMailCheckpoint,
} from "../lib/mailpit.js";
import {
  assertNoPrivateRegistrationAccess,
  inputSecret,
  registerOwnedCredentials,
  registrationEvidence,
  verificationEvidence,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { openHostCodeStep } from "../lib/storefront-entry-watch.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

interface ResendVisitor extends OwnedCredentials {
  kind: "unknown" | "unverified" | "verified";
  context: BrowserContext;
  page: Page;
  authPosts: string[];
  checkpoint?: AddressedMailCheckpoint;
  response?: {
    status: number;
    neutralBody: boolean;
    identifierOnly: boolean;
    setCookie: string;
  };
}
interface ResendComparison {
  contexts: BrowserContext[];
  visitors: ResendVisitor[];
}
const comparisons = new WeakMap<Page, ResendComparison>();
function comparison(key: Page): ResendComparison {
  const state = comparisons.get(key);
  if (!state) throw new Error("Owned verification-resend comparison absent");
  return state;
}

Given(
  "three guest Academy code screens for unique unknown, unverified and verified owned addresses",
  async ({ page, browser, httpCredentials, world }) => {
    // 003 EARS-25: real screen cooldown plus registration/mail setup
    // and the full negative delivery horizon need a per-case budget only.
    test.setTimeout(180_000);
    expect(world.host.id).toBe("academy");
    const state: ResendComparison = { contexts: [], visitors: [] };
    comparisons.set(page, state);
    const options = {
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    };
    for (const kind of ["unknown", "unverified", "verified"] as const) {
      const context = await browser.newContext(options);
      state.contexts.push(context);
      const visitor: ResendVisitor = {
        kind,
        context,
        page: await context.newPage(),
        authPosts: [],
        email: `resend-${kind}-2988-${randomUUID()}@example.test`,
        password: `Resend-${randomUUID()}-aA1!`,
      };
      state.visitors.push(visitor);
      await prepareCaptchaForJourney(
        context,
        world.hostBaseUrl,
        process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
      );
      expect(await context.cookies(), "clean guest browser").toEqual([]);
    }
    // Setup in independent contexts keeps all normal cooldowns real.
    await Promise.all(
      state.visitors
        .filter((visitor) => visitor.kind !== "unknown")
        .map(async (visitor) => {
          const { response, body, code } = await registerOwnedCredentials(
            visitor.page,
            world.hostBaseUrl,
            visitor,
            "/account",
          );
          expect(
            registrationEvidence(
              response.request().postData() ?? "",
              body,
              visitor,
            ),
          ).toEqual({
            credentialsMatch: true,
            consentMatches: true,
            acknowledgementMatches: true,
          });
          await assertNoPrivateRegistrationAccess(
            visitor.page,
            (await response.headerValue("set-cookie")) ?? "",
            visitor,
          );
          if (visitor.kind === "verified") {
            const pending = captureResponse(
              visitor.page,
              signInHostApiPath("/v1/auth/verify"),
            );
            await inputSecret(
              visitor.page.locator('input[autocomplete="one-time-code"]'),
              code,
            );
            const accepted = await pending;
            expect(
              accepted.response.status(),
              "real prerequisite verification accepted",
            ).toBe(200);
            expect(
              verificationEvidence(
                accepted.response.request().postData() ?? "",
                accepted.body,
                visitor,
                code,
                world.hostBaseUrl,
              ),
            ).toEqual({
              credentialsMatch: true,
              acknowledgementMatches: true,
            });
            await visitor.page.waitForURL((url) => url.pathname === "/account");
            await visitor.page.waitForLoadState("networkidle");
            await assertSecureSession(
              visitor.page,
              accepted.response,
              world.hostBaseUrl,
            );
            const identity = await visitor.page.evaluate(async (email) => {
              const response = await fetch("/v1/me/profile", {
                credentials: "include",
              });
              const profile = await response.json().catch(() => ({}));
              return {
                status: response.status,
                sameAccount: profile.email === email,
                verified: profile.emailVerified === true,
              };
            }, visitor.email);
            expect(identity, "owned prerequisite really verified").toEqual({
              status: 200,
              sameAccount: true,
              verified: true,
            });
            const logout = captureResponse(
              visitor.page,
              STOREFRONT_SIGN_OUT_PATH,
            );
            await visitor.page.getByTestId("logout").click();
            expect(
              (await logout).response.status(),
              "prerequisite session revoked",
            ).toBe(200);
            await visitor.page.waitForURL((url) => url.pathname === "/");
            await assertNoPrivateRegistrationAccess(visitor.page, "", visitor);
            expect(
              await visitor.page.evaluate(
                async () =>
                  (await fetch("/v1/auth/session", { credentials: "include" }))
                    .status,
              ),
            ).toBe(401);
          }
        }),
    );
    await Promise.all(
      state.visitors.map(async (visitor) => {
        visitor.page.on("request", (request) => {
          const path = new URL(request.url()).pathname;
          if (request.method() === "POST" && isAuthCommandPath(path))
            visitor.authPosts.push(path);
        });
        // #3172 — the code step is the sign-in host's /verify door.
        await openHostCodeStep(
          visitor.page,
          world.hostBaseUrl,
          visitor.email,
          "/account",
        );
        await visitor.page.waitForLoadState("networkidle");
        const card = visitor.page.getByTestId("verify-card");
        await expect(card).toBeVisible();
        expect(
          (await card.locator("strong").innerText()) === visitor.email,
          "same owned code destination",
        ).toBe(true);
        await expect(card.getByTestId("verify-resend")).toBeDisabled();
        await expect(card.getByTestId("verify-resend")).toHaveText(
          /^Отправить снова · [1-9]\d* с$/,
        );
        await expect(
          card.locator('input[autocomplete="one-time-code"]'),
        ).toHaveAttribute("maxlength", "6");
        await assertNoPrivateRegistrationAccess(visitor.page, "", visitor);
      }),
    );
  },
);

When(
  "each guest waits for the real cooldown and clicks the actual Academy verification resend control",
  async ({ page, world }) => {
    await Promise.all(
      comparison(page).visitors.map(async (visitor) => {
        const resend = visitor.page.getByTestId("verify-resend");
        await expect(resend).toBeEnabled({ timeout: 70_000 });
        const mail = nativeRecoveryMail();
        const mailpit =
          process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl);
        visitor.checkpoint = await captureAddressedMailCheckpoint(
          mail,
          mailpit,
          visitor.email,
        );
        const pending = captureResponse(
          visitor.page,
          signInHostApiPath("/v1/auth/verify/resend"),
        );
        await resend.click();
        const captured = await pending;
        let neutralBody = false;
        let identifierOnly = false;
        try {
          const body = JSON.parse(captured.body);
          neutralBody =
            body !== null &&
            typeof body === "object" &&
            !Array.isArray(body) &&
            Object.keys(body).length === 1 &&
            body.status === "resend_requested";
          const submitted = hostCommand(
            captured.response.request().postDataJSON(),
          );
          identifierOnly =
            submitted !== null &&
            typeof submitted === "object" &&
            !Array.isArray(submitted) &&
            Object.keys(submitted).length === 1 &&
            submitted.identifier === visitor.email;
        } catch {
          // Discard parser diagnostics that could quote addresses or provider tokens.
        }
        visitor.response = {
          status: captured.response.status(),
          neutralBody,
          identifierOnly,
          setCookie: (await captured.response.headerValue("set-cookie")) ?? "",
        };
      }),
    );
  },
);

Then(
  "all three resends return the identical neutral acknowledgement and keep the six-digit guest code screen",
  async ({ page }) => {
    for (const visitor of comparison(page).visitors) {
      if (!visitor.response) throw new Error("Owned resend response absent");
      const { status, neutralBody, identifierOnly } = visitor.response;
      expect(
        { status, neutralBody, identifierOnly },
        `${visitor.kind} exact neutral response and addressed command`,
      ).toEqual({
        status: 200,
        neutralBody: true,
        identifierOnly: true,
      });
      const notice = visitor.page.getByTestId("verify-resend-notice");
      await expect(notice).toBeVisible();
      expect(
        (await notice.innerText()) ===
          `Мы отправили новый код на ${visitor.email}.`,
        "approved destination acknowledgement",
      ).toBe(true);
      expect(new URL(visitor.page.url()).pathname).toBe("/verify");
      const field = visitor.page.locator('input[autocomplete="one-time-code"]');
      await expect(field).toBeVisible();
      expect(
        (await field.inputValue()) === "",
        "reissued code remains unentered",
      ).toBe(true);
      await expect(field).toHaveAttribute("maxlength", "6");
      await expect(visitor.page.getByTestId("verify-error")).toHaveCount(0);
      await expect(visitor.page.getByTestId("verify-resend")).toBeDisabled();
      expect(
        visitor.authPosts,
        "one real resend and no code acceptance or registration replay",
      ).toEqual([signInHostApiPath("/v1/auth/verify/resend")]);
    }
  },
);

Then(
  "fresh verification and login mail reach only the respective owned accounts while the unknown mailbox stays silent for 15 seconds",
  async ({ page, world }) => {
    const mail = nativeRecoveryMail();
    const mailpit =
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl);
    await Promise.all(
      comparison(page).visitors.map(async (visitor) => {
        if (!visitor.checkpoint)
          throw new Error("Owned resend mail boundary absent");
        if (visitor.kind === "unknown") {
          await assertNoAddressedMail(
            mail,
            mailpit,
            visitor.email,
            visitor.checkpoint,
          );
        } else {
          // 003 EARS-25: use the pre-click inbox boundary, not clocks on two
          // machines; canonical mail parsing still validates purpose and detail.
          const oldIds = new Set(visitor.checkpoint.messageIds);
          const sinceCheckpoint = {
            async get(url: string) {
              const response = await mail.get(url);
              if (!new URL(url).pathname.endsWith("/api/v1/search"))
                return response;
              return {
                ok: () => response.ok(),
                status: () => response.status(),
                async json() {
                  let payload;
                  try {
                    payload = await response.json();
                  } catch {
                    throw new Error("Malformed owned resend mailbox payload");
                  }
                  if (
                    !payload ||
                    typeof payload !== "object" ||
                    !("messages" in payload) ||
                    !Array.isArray(payload.messages) ||
                    !("messages_count" in payload) ||
                    payload.messages_count !== payload.messages.length ||
                    !("start" in payload) ||
                    payload.start !== 0
                  )
                    throw new Error("Incomplete owned resend mailbox payload");
                  const messages = payload.messages.filter(
                    (message: unknown) => {
                      if (
                        !message ||
                        typeof message !== "object" ||
                        !("ID" in message) ||
                        typeof message.ID !== "string" ||
                        !message.ID
                      )
                        throw new Error("Invalid owned resend mailbox message");
                      return !oldIds.has(message.ID);
                    },
                  );
                  return {
                    ...payload,
                    messages,
                    messages_count: messages.length,
                  };
                },
              };
            },
          };
          const code = await fetchRecoveryCode(
            sinceCheckpoint,
            mailpit,
            visitor.email,
            visitor.checkpoint,
            visitor.kind === "unverified" ? "register" : "login",
          );
          expect(
            /^\d{6}$/.test(code),
            `${visitor.kind} fresh addressed six-digit delivery`,
          ).toBe(true);
        }
      }),
    );
  },
);

Then(
  "all three resend browsers retain no private session or profile access without consuming their reissued codes",
  async ({ page }) => {
    for (const visitor of comparison(page).visitors) {
      if (!visitor.response) throw new Error("Owned resend response absent");
      await assertNoPrivateRegistrationAccess(
        visitor.page,
        visitor.response.setCookie,
        visitor,
      );
      expect(
        await visitor.page.evaluate(
          async () =>
            (await fetch("/v1/auth/session", { credentials: "include" }))
              .status,
        ),
        `${visitor.kind} remains a guest`,
      ).toBe(401);
      expect(
        (await visitor.page
          .locator('input[autocomplete="one-time-code"]')
          .inputValue()) === "",
        "no reissued code submitted",
      ).toBe(true);
      expect(visitor.authPosts).toEqual([
        signInHostApiPath("/v1/auth/verify/resend"),
      ]);
    }
  },
);

After("@verification-resend", async ({ page }) => {
  const state = comparisons.get(page);
  if (!state) return;
  try {
    for (const context of state.contexts) {
      if (
        (await context.cookies()).some(
          (cookie) => cookie.name === "__Host-ds_session",
        )
      ) {
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
        expect(result, "owned prerequisite session revoked on failure").toEqual(
          { logout: 200, profile: 401 },
        );
      }
    }
  } finally {
    for (const context of state.contexts) {
      await Promise.all(context.pages().map((owned) => owned.close()));
      await context.close();
    }
    comparisons.delete(page);
  }
});
