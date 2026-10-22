import { signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import { confirmOwnedPhone } from "../lib/owned-phone-confirmation.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import {
  captureSmsCheckpoint,
  freshConfirmablePhone,
  smsOrigin,
  smsSinkMessages,
  smsSinkUrl,
  type SmsCheckpoint,
} from "../lib/sms-sink.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

interface Owner {
  context: BrowserContext;
  page: Page;
  email: string;
  phone: string;
  subject?: string;
}
interface Collision {
  owners: Owner[];
  sink: string;
  requestedAt?: SmsCheckpoint;
}
const collisions = new WeakMap<Page, Collision>();
function collision(page: Page): Collision {
  const state = collisions.get(page);
  if (!state || state.owners.length !== 2)
    throw new Error("Both owned phone-collision accounts are required");
  return state;
}

async function profile(owner: Owner) {
  return owner.page.evaluate(
    async ({ email, phone, subject }) => {
      const response = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const sessionResponse = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const data = await response.json();
      const session = await sessionResponse.json();
      return {
        status: response.status,
        sessionStatus: sessionResponse.status,
        sameEmail: data.email === email,
        emailVerified: data.emailVerified,
        samePhone: data.phone === phone,
        phoneAbsent: data.phone === null,
        phoneVerified: data.phoneVerified,
        sameSubject:
          subject === undefined
            ? typeof session.sub === "string" && !!session.sub
            : session.sub === subject,
        subject: session.sub as string,
      };
    },
    { email: owner.email, phone: owner.phone, subject: owner.subject },
  );
}

async function assertProfile(owner: Owner, confirmed: boolean) {
  const { subject, ...evidence } = await profile(owner);
  expect(
    evidence,
    "owned identity has exactly its expected confirmed-phone state",
  ).toEqual({
    status: 200,
    sessionStatus: 200,
    sameEmail: true,
    emailVerified: true,
    samePhone: confirmed,
    phoneAbsent: !confirmed,
    phoneVerified: confirmed ? true : null,
    sameSubject: true,
  });
  return subject;
}

Given(
  "two uniquely owned verified Academy accounts have confirmed distinct fresh phones with their actual SMS codes",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink) throw new Error("Phone collision requires E2E_SMS_SINK_URL");
    const state: Collision = { owners: [], sink };
    collisions.set(page, state);
    for (let index = 0; index < 2; index++) {
      const context = await browser.newContext({
        locale: "ru-RU",
        ...(httpCredentials ? { httpCredentials } : {}),
      });
      let phone = freshConfirmablePhone();
      while (state.owners.some((owner) => owner.phone === phone))
        phone = freshConfirmablePhone();
      const owner: Owner = {
        context,
        page: await context.newPage(),
        email: `phone-collision-3017-${randomUUID()}@example.test`,
        phone,
      };
      state.owners.push(owner);
      expect(
        (await smsSinkMessages(sink, phone, smsOrigin(phone))).length,
        "fresh owned phone has no previous SMS",
      ).toBe(0);
      await prepareCaptchaForJourney(
        context,
        world.hostBaseUrl,
        process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
      );
      const { code } = await registerOwnedCredentials(
        owner.page,
        world.hostBaseUrl,
        { email: owner.email, password: `Owned-${randomUUID()}-aA1!` },
        "/account",
      );
      const verifying = captureResponse(
        owner.page,
        signInHostApiPath("/v1/auth/verify"),
      );
      await inputSecret(
        owner.page.locator('input[autocomplete="one-time-code"]'),
        code,
      );
      const verified = await verifying;
      expect(
        verified.response.status(),
        "owned email verification accepted",
      ).toBe(200);
      await owner.page.waitForURL((url) => url.pathname === "/account");
      await owner.page.waitForLoadState("networkidle");
      await assertSecureSession(
        owner.page,
        verified.response,
        world.hostBaseUrl,
      );
      await confirmOwnedPhone(owner.page, { phone, sink });
      owner.subject = await assertProfile(owner, true);
    }
    expect(
      state.owners[0]!.subject !== state.owners[1]!.subject,
      "separate owned identities",
    ).toBe(true);
  },
);

When(
  "the second Academy account requests the first account's confirmed phone through its real phone row",
  async ({ page }) => {
    const state = collision(page);
    const [holder, requester] = state.owners as [Owner, Owner];
    await requester.page.getByTestId("profile-phone-action").click();
    await requester.page
      .getByTestId("profile-phone-input")
      .pressSequentially(holder.phone.slice(1));
    state.requestedAt = await captureSmsCheckpoint(state.sink, holder.phone);
    const requesting = captureResponse(requester.page, "/v1/me/phone");
    await requester.page.getByTestId("profile-phone-send").click();
    const response = await requesting;
    expect(
      {
        status: response.response.status(),
        ordinaryAcknowledgement: response.body === '{"status":"code_sent"}',
      },
      "ordinary code-free request acknowledgement",
    ).toEqual({ status: 200, ordinaryAcknowledgement: true });
  },
);

Then(
  "Academy shows the ordinary pending code state, clears only the requester's confirmed phone and sends no SMS to the holder for twenty seconds",
  async ({ page }) => {
    const state = collision(page);
    const [holder, requester] = state.owners as [Owner, Owner];
    if (!state.requestedAt)
      throw new Error("Collision delivery boundary is absent");
    await expect(
      requester.page.getByTestId("profile-phone-code"),
    ).toBeVisible();
    await expect(
      requester.page.getByTestId("profile-phone-code-sent"),
    ).toBeVisible();
    await expect(
      requester.page.getByTestId("profile-phone-verified"),
    ).toHaveCount(0);
    await assertProfile(requester, false);
    await assertProfile(holder, true);
    const deadline = Date.now() + 20_000;
    while (true) {
      const finalObservation = Date.now() >= deadline;
      expect(
        (await smsSinkMessages(state.sink, holder.phone, state.requestedAt))
          .length,
        "no SMS to the owned holder",
      ).toBe(0);
      if (finalObservation) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(500, Math.max(0, deadline - Date.now()))),
      );
    }
    await assertProfile(requester, false);
    await assertProfile(holder, true);
  },
);

When(
  "the displaced requester submits six digits for that unavailable phone confirmation",
  async ({ page }) => {
    const [, requester] = collision(page).owners as [Owner, Owner];
    // 003 EARS-51: any six digits exercise the no-pending-phone refusal.
    const confirming = captureResponse(requester.page, "/v1/me/phone/confirm");
    await inputSecret(
      requester.page.getByTestId("profile-phone-code"),
      "000000",
    );
    const refused = await confirming;
    let genericFailure = false;
    try {
      const body = JSON.parse(refused.body);
      genericFailure =
        body.statusCode === 400 &&
        body.message === "the request could not be completed" &&
        body.error === "Bad Request" &&
        Object.keys(body).length === 3;
    } catch {
      /* Avoid logging a response that could contain submitted digits. */
    }
    expect({ status: refused.response.status(), genericFailure }).toEqual({
      status: 400,
      genericFailure: true,
    });
  },
);

Then(
  "Academy refuses that code generically while both owned profiles retain their post-request phone states",
  async ({ page }) => {
    const [holder, requester] = collision(page).owners as [Owner, Owner];
    await expect(
      requester.page.locator("#profile-phone-code-error"),
    ).toHaveText(/^⚠?\s*Неверный код$/);
    await expect(
      requester.page.getByTestId("profile-phone-code"),
    ).toBeVisible();
    await expect(
      requester.page.getByTestId("profile-phone-verified"),
    ).toHaveCount(0);
    await assertProfile(requester, false);
    await assertProfile(holder, true);
  },
);

After("@phone-collision", async ({ page }) => {
  const state = collisions.get(page);
  if (!state) return;
  const results = await Promise.allSettled(
    state.owners.map(async (owner) => {
      try {
        if (
          (await owner.context.cookies()).some(
            (cookie) => cookie.name === "__Host-ds_session",
          )
        ) {
          expect(
            await owner.page.evaluate(async () => {
              const logout = await fetch("/v1/auth/logout", {
                method: "POST",
                credentials: "include",
              });
              const profile = await fetch("/v1/me/profile", {
                credentials: "include",
              });
              return { logout: logout.status, profile: profile.status };
            }),
            "owned collision session revoked",
          ).toEqual({ logout: 200, profile: 401 });
        }
      } finally {
        await owner.context.close();
      }
    }),
  );
  collisions.delete(page);
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
});
