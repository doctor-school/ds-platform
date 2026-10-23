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
import {
  freshConfirmablePhone,
  PHONE_CODE_EVENT,
  phoneConfirmationCode,
  smsOrigin,
  smsSinkMessages,
  smsSinkUrl,
} from "../lib/sms-sink.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

interface ResentPhone {
  context: BrowserContext;
  page: Page;
  email: string;
  phone: string;
  sink: string;
  code: string;
  firstMessageId?: number;
  initialMessageIds: number[];
  requests: number;
  subject?: string;
  cookie?: string;
  profile?: string;
}
const journeys = new WeakMap<Page, ResentPhone>();
function journey(page: Page): ResentPhone {
  const state = journeys.get(page);
  if (!state) throw new Error("Owned phone-resend journey missing");
  return state;
}

async function deliveryCheckpoint(state: ResentPhone) {
  // Sink and runner clocks differ. Stable IDs observed before the request
  // establish causality without comparing timestamps from different machines.
  const messages = await smsSinkMessages(
    state.sink,
    state.phone,
    smsOrigin(state.phone),
    PHONE_CODE_EVENT,
  );
  return messages.map((message) => {
    const { id, receivedAt } = message;
    if (
      !Number.isSafeInteger(id) ||
      Number(id) <= 0 ||
      typeof receivedAt !== "string" ||
      !Number.isFinite(Date.parse(receivedAt)) ||
      message.json?.contextInfo?.eventType !== PHONE_CODE_EVENT
    )
      throw new Error("Invalid owned SMS delivery metadata");
    return { id: Number(id), message };
  });
}

async function actualDelivery(state: ResentPhone, before: readonly number[]) {
  let code = "";
  let id = 0;
  await expect
    .poll(
      async () => {
        const delivered = (await deliveryCheckpoint(state)).filter(
          (entry) => !before.includes(entry.id),
        );
        if (delivered.length !== 1) return false;
        code = phoneConfirmationCode(delivered[0]!.message) ?? "";
        id = delivered[0]!.id;
        return /^\d{6}$/.test(code);
      },
      {
        message:
          "one actual recipient/event-bound SMS beyond the pre-request delivery-ID checkpoint",
        timeout: 20_000,
      },
    )
    .toBe(true);
  return { code, id };
}

async function assertIdentity(
  state: ResentPhone,
  base: string,
  confirmed = false,
) {
  const result = await state.page.evaluate(
    async ({ email, phone, subject, previous, confirmed }) => {
      const profileResponse = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const sessionResponse = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const profile = await profileResponse.json().catch(() => ({}));
      const session = await sessionResponse.json().catch(() => ({}));
      return {
        profile: JSON.stringify(profile),
        subject: session.sub as string | undefined,
        evidence: {
          profileStatus: profileResponse.status,
          sessionStatus: sessionResponse.status,
          sameEmail: profile.email === email,
          emailVerified: profile.emailVerified === true,
          expectedPhone: profile.phone === (confirmed ? phone : null),
          expectedVerification:
            profile.phoneVerified === (confirmed ? true : null),
          sameSubject:
            subject === undefined
              ? typeof session.sub === "string" && !!session.sub
              : subject === session.sub,
          unchangedProfile:
            confirmed ||
            previous === undefined ||
            previous === JSON.stringify(profile),
        },
      };
    },
    {
      email: state.email,
      phone: state.phone,
      subject: state.subject,
      previous: state.profile,
      confirmed,
    },
  );
  expect(
    result.evidence,
    "owned profile and subject have the expected confirmation state",
  ).toEqual({
    profileStatus: 200,
    sessionStatus: 200,
    sameEmail: true,
    emailVerified: true,
    expectedPhone: true,
    expectedVerification: true,
    sameSubject: true,
    unchangedProfile: true,
  });
  if (!result.subject) throw new Error("Owned resend subject missing");
  state.subject ??= result.subject;
  state.profile ??= result.profile;
  const cookie = (await state.context.cookies()).find(
    (item) => item.name === "__Host-ds_session",
  );
  expect(
    {
      present: Boolean(cookie),
      same: state.cookie === undefined || cookie?.value === state.cookie,
      secure: cookie?.secure,
      httpOnly: cookie?.httpOnly,
      sameSite: cookie?.sameSite,
      path: cookie?.path,
      host: cookie?.domain === new URL(base).hostname,
    },
    "the same secure host-only session remains",
  ).toEqual({
    present: true,
    same: true,
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    host: true,
  });
  if (!cookie) throw new Error("Owned resend cookie missing");
  state.cookie ??= cookie.value;
}

Given(
  "an owned verified Academy account receives its initial actual phone SMS and has disabled resend",
  async ({ page, browser, httpCredentials, world }) => {
    test.setTimeout(180_000);
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink) throw new Error("Phone resend requires E2E_SMS_SINK_URL");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const state: ResentPhone = {
      context,
      page: await context.newPage(),
      email: `phone-resend-3035-${randomUUID()}@example.test`,
      phone: freshConfirmablePhone(),
      sink,
      code: "",
      initialMessageIds: [],
      requests: 0,
    };
    journeys.set(page, state);
    await prepareCaptchaForJourney(
      context,
      world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const { code } = await registerOwnedCredentials(
      state.page,
      world.hostBaseUrl,
      { email: state.email, password: `Owned-${randomUUID()}-aA1!` },
      "/account",
    );
    const verifying = captureResponse(
      state.page,
      signInHostApiPath("/v1/auth/verify"),
    );
    await inputSecret(
      state.page.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const verified = await verifying;
    expect(verified.response.status(), "owned email verified").toBe(200);
    await state.page.waitForURL((url) => url.pathname === "/account");
    await state.page.waitForLoadState("networkidle");
    await assertSecureSession(state.page, verified.response, world.hostBaseUrl);
    await assertIdentity(state, world.hostBaseUrl);
    await state.page.clock.install();
    // Sample the controlled page clock, with headroom for protocol latency,
    // before any phone countdown starts. Node's clock is independent of it.
    const pausePoint = await state.page.evaluate(() => Date.now() + 60_000);
    await state.page.clock.pauseAt(new Date(pausePoint));
    state.page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/v1/me/phone"
      )
        state.requests += 1;
    });
    await state.page.getByTestId("profile-phone-action").click();
    await state.page
      .getByTestId("profile-phone-input")
      .pressSequentially(state.phone.slice(1));
    const before = (await deliveryCheckpoint(state)).map((entry) => entry.id);
    state.initialMessageIds = before;
    const pending = captureResponse(state.page, "/v1/me/phone");
    await state.page.getByTestId("profile-phone-send").click();
    const requested = await pending;
    expect({
      status: requested.response.status(),
      body: requested.body,
    }).toEqual({ status: 200, body: '{"status":"code_sent"}' });
    const delivery = await actualDelivery(state, before);
    state.firstMessageId = delivery.id;
    await expect(state.page.getByTestId("profile-phone-resend")).toBeDisabled();
    expect(state.requests, "only the initial real phone request").toBe(1);
  },
);

When(
  "only the browser's thirty-second resend cooldown is advanced and the owner clicks the actual resend control",
  async ({ page, world }) => {
    const state = journey(page);
    const resend = state.page.getByTestId("profile-phone-resend");
    await expect(resend).toBeDisabled();
    // The shared countdown decrements once per interval and React render. Only
    // this page's clock advances; server/IdP clocks and code lifetimes are real.
    for (let second = 0; second < 30; second++) {
      await state.page.clock.runFor(1000);
      await state.page.evaluate(
        () => new Promise<void>((resolve) => queueMicrotask(resolve)),
      );
    }
    await expect(resend).toBeEnabled();
    expect(state.requests, "advancing the UI timer sends nothing").toBe(1);
    await assertIdentity(state, world.hostBaseUrl);
    const before = (await deliveryCheckpoint(state)).map((entry) => entry.id);
    expect(
      before.filter((id) => !state.initialMessageIds.includes(id)).length ===
        1 && before.includes(state.firstMessageId!),
      "only the first actual SMS precedes resend",
    ).toBe(true);
    const pending = captureResponse(state.page, "/v1/me/phone");
    await resend.click();
    const requested = await pending;
    let samePhone = false;
    try {
      samePhone =
        JSON.parse(requested.response.request().postData() ?? "{}").phone ===
        state.phone;
    } catch {
      /* Discard private body diagnostics. */
    }
    expect({
      status: requested.response.status(),
      body: requested.body,
      samePhone,
      requests: state.requests,
    }).toEqual({
      status: 200,
      body: '{"status":"code_sent"}',
      samePhone: true,
      requests: 2,
    });
    const delivery = await actualDelivery(state, before);
    expect(
      delivery.id !== state.firstMessageId,
      "resend is a new actual SMS even when random code digits coincide",
    ).toBe(true);
    state.code = delivery.code;
    await expect(resend).toBeDisabled();
    await expect(state.page.getByTestId("profile-phone-code")).toHaveValue("");
    await assertIdentity(state, world.hostBaseUrl);
    await state.page.clock.resume();
  },
);

Then(
  "the newest actual resend SMS confirms that same Academy phone with the original secure owner session",
  async ({ page, world }) => {
    const state = journey(page);
    const pending = captureResponse(state.page, "/v1/me/phone/confirm");
    await inputSecret(state.page.getByTestId("profile-phone-code"), state.code);
    const confirmed = await pending;
    let samePhone = false;
    try {
      const body = JSON.parse(confirmed.body);
      samePhone =
        body.status === "confirmed" &&
        body.phone === state.phone &&
        Object.keys(body).length === 2;
    } catch {
      /* Discard private body diagnostics. */
    }
    expect({ status: confirmed.response.status(), samePhone }).toEqual({
      status: 200,
      samePhone: true,
    });
    await expect(
      state.page.getByTestId("profile-phone-verified"),
    ).toBeVisible();
    await assertIdentity(state, world.hostBaseUrl, true);
    await state.page.reload({ waitUntil: "load" });
    await state.page.waitForLoadState("networkidle");
    await assertIdentity(state, world.hostBaseUrl, true);
    expect(state.requests, "exactly initial request and real resend").toBe(2);
  },
);

After("@phone-code-resend", async ({ page }) => {
  const state = journeys.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some(
        (item) => item.name === "__Host-ds_session",
      )
    ) {
      expect(
        await state.page.evaluate(async () => {
          const logout = await fetch("/v1/auth/logout", {
            method: "POST",
            credentials: "include",
          });
          const profile = await fetch("/v1/me/profile", {
            credentials: "include",
            cache: "no-store",
          });
          const session = await fetch("/v1/auth/session", {
            credentials: "include",
            cache: "no-store",
          });
          return {
            logout: logout.status,
            profile: profile.status,
            session: session.status,
          };
        }),
        "owned phone-resend session revoked",
      ).toEqual({ logout: 200, profile: 401, session: 401 });
    }
  } finally {
    state.code = "";
    await state.context.close();
    journeys.delete(page);
  }
});
