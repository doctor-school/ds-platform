import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, relative } from "node:path";
import { createDrizzle, type DrizzleHandle } from "@ds/db";
import { expect, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  assertNoPrivateRegistrationAccess,
  inputSecret,
} from "../lib/owned-registration.js";
import {
  freshConfirmablePhone,
  smsSinkMessages,
  smsSinkUrl,
} from "../lib/sms-sink.js";
import { Given, Then, When, test } from "./support/auth-fixtures.js";

const SMS_HINT =
  "Код по SMS придёт, только если телефон подтверждён в профиле. Если нет — выберите «Эл.\u00a0почта».";
interface SmsVisitor {
  phone: string;
  sink: string;
  email: string;
  password: string;
  requestedAt?: string;
  setCookie?: string;
}
const visitors = new WeakMap<Page, SmsVisitor>();
function visitor(page: Page): SmsVisitor {
  const state = visitors.get(page);
  if (!state) throw new Error("SMS sign-in visitor was not prepared");
  return state;
}

async function assertUnconfirmedPhone(page: Page, phone: string) {
  const failure = "Owned SMS sign-in mirror observation failed";
  let pool: DrizzleHandle["pool"] | undefined;
  const connect = (ownedPool: DrizzleHandle["pool"]) => ownedPool.connect();
  let client: Awaited<ReturnType<typeof connect>> | undefined;
  let failed = false;
  let absent = false;
  let started = false;
  const log = process.env.E2E_STAND_COMMAND_LOG ?? "";
  const id = randomUUID();
  const record = (status: string) =>
    appendFileSync(
      log,
      `${JSON.stringify({
        at: new Date().toISOString(),
        id,
        operation: "signin-sms-hint-mirror-read",
        status,
        readOnly: true,
        ...(status === "completed"
          ? { ok: !failed && absent, nativeExit: failed ? 1 : 0 }
          : {}),
      })}\n`,
      "utf8",
    );
  try {
    const part = relative(tmpdir(), log);
    if (!isAbsolute(log) || part.startsWith("..") || isAbsolute(part))
      throw new Error();
    const database = new URL(process.env.E2E_AUTH_DATABASE_URL ?? "");
    const academy = new URL(page.url());
    const api = new URL(process.env.E2E_API_URL ?? "");
    const host = process.env.E2E_AUTH_DATABASE_HOST;
    const port = Number(process.env.E2E_AUTH_DATABASE_PORT);
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(academy.hostname) ||
      academy.hostname !== api.hostname ||
      academy.protocol !== api.protocol ||
      api.origin !== process.env.E2E_API_URL?.replace(/\/$/, "") ||
      api.username ||
      api.password ||
      !academy.port ||
      !api.port ||
      academy.port === api.port ||
      !["http:", "https:"].includes(academy.protocol) ||
      !["postgres:", "postgresql:"].includes(database.protocol) ||
      !host ||
      /(?:^|\.)doctor\.school$/.test(host) ||
      database.hostname !== host ||
      !Number.isSafeInteger(port) ||
      port < 1 ||
      port > 65535 ||
      database.port !== String(port) ||
      process.env.E2E_AUTH_DATABASE_NAME !== "ds_dev_2250" ||
      database.pathname !== "/ds_dev_2250" ||
      database.search ||
      database.hash ||
      !/^\+7999[0-9]{7}$/.test(phone)
    )
      throw new Error();
    record("started");
    started = true;
    pool = createDrizzle(database.toString(), {
      max: 1,
      statement_timeout: 5_000,
    }).pool;
    pool.removeAllListeners("error");
    pool.on("error", () => {
      failed = true;
    });
    client = await connect(pool);
    await client.query("BEGIN READ ONLY");
    const result = await client.query(
      "SELECT current_database() = $2 AS database_matches, current_setting('transaction_read_only') = 'on' AS read_only, NOT EXISTS (SELECT 1 FROM users WHERE phone = $1 AND phone_verified = true) AS unconfirmed",
      [phone, "ds_dev_2250"],
    );
    absent =
      result.rows.length === 1 &&
      result.rows[0].database_matches === true &&
      result.rows[0].read_only === true &&
      result.rows[0].unconfirmed === true;
  } catch {
    failed = true;
  } finally {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        failed = true;
      }
      try {
        client.release();
      } catch {
        failed = true;
      }
    }
    if (pool) {
      try {
        await pool.end();
      } catch {
        failed = true;
      }
    }
    try {
      if (started) record("completed");
    } catch {
      failed = true;
    }
  }
  if (failed || !absent) throw new Error(failure);
}

async function noPrivateAccess(page: Page, state: SmsVisitor) {
  await assertNoPrivateRegistrationAccess(page, state.setCookie ?? "", state);
  expect(
    await page.evaluate(
      async () =>
        (await fetch("/v1/auth/session", { credentials: "include" })).status,
    ),
    "SMS request creates no private principal",
  ).toBe(401);
}

Given(
  "a fresh Academy guest opens login by code with a unique unconfirmed phone",
  async ({ page, world }) => {
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink) throw new Error("SMS sign-in requires E2E_SMS_SINK_URL");
    const state: SmsVisitor = {
      phone: freshConfirmablePhone(),
      sink,
      email: `sms-hint-2990-${randomUUID()}@example.test`,
      password: `Unsubmitted-${randomUUID()}-aA1!`,
    };
    visitors.set(page, state);
    await test.info().attach("owned-fixture", {
      body: JSON.stringify({ issue: 2990, phone: state.phone }),
      contentType: "application/json",
    });
    // A missing or unreadable sink must fail before it can prove absence.
    expect(
      (await smsSinkMessages(sink, state.phone, new Date().toISOString()))
        .length,
    ).toBe(0);
    const target = new URL(
      "/login?method=code&returnTo=%2Faccount",
      world.hostBaseUrl,
    );
    await prepareCaptchaForJourney(
      page.context(),
      world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    await page.goto(target.toString(), { waitUntil: "load" });
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("login-method-otp")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await noPrivateAccess(page, state);
    await assertUnconfirmedPhone(page, state.phone);
  },
);

When(
  "the Academy guest selects the real SMS sign-in channel",
  async ({ page }) => {
    await expect(page.getByText(SMS_HINT, { exact: true })).toHaveCount(0);
    await page.getByTestId("otp-channel-sms").click();
  },
);

Then(
  "Academy shows the exact static SMS eligibility hint associated with the channel switch",
  async ({ page }) => {
    const hint = page.getByText(SMS_HINT, { exact: true });
    const field = page.getByTestId("otp-identifier");
    await expect(page.getByTestId("otp-channel-sms")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(field).toHaveAttribute("type", "tel");
    await expect(hint).toBeVisible();
    expect(
      await hint.textContent(),
      "approved sentence including its non-breaking space",
    ).toBe(SMS_HINT);
    const id = await hint.getAttribute("id");
    expect(Boolean(id), "hint has an accessible description id").toBe(true);
    expect(
      (
        await page
          .getByRole("radiogroup", { name: "Канал кода" })
          .getAttribute("aria-describedby")
      )?.split(/\s+/),
      "channel switch describes its SMS eligibility hint",
    ).toContain(id);
    await inputSecret(field, visitor(page).phone);
    expect(
      await hint.textContent(),
      "typing never changes the eligibility hint",
    ).toBe(SMS_HINT);
    await page.getByTestId("otp-channel-email").click();
    await expect(hint).toHaveCount(0);
    await page.getByTestId("otp-channel-sms").click();
    await expect(hint).toBeVisible();
    await inputSecret(field, visitor(page).phone);
  },
);

When(
  "the Academy guest requests an SMS sign-in code for that phone",
  async ({ page }) => {
    const state = visitor(page);
    state.requestedAt = new Date().toISOString();
    const pending = captureResponse(page, "/v1/auth/login/otp/request");
    await page.getByTestId("otp-send").click();
    const captured = await pending;
    let requestMatches = false;
    let neutral = false;
    try {
      const submitted = captured.response.request().postDataJSON();
      requestMatches =
        Object.keys(submitted).sort().join(",") === "channel,identifier" &&
        submitted.channel === "sms" &&
        submitted.identifier === state.phone;
      const body = JSON.parse(captured.body);
      neutral = Object.keys(body).length === 1 && body.status === "otp_sent";
    } catch {
      // Project only booleans so parser diagnostics cannot expose provider tokens.
    }
    expect({
      status: captured.response.status(),
      requestMatches,
      neutral,
    }).toEqual({ status: 200, requestMatches: true, neutral: true });
    state.setCookie = (await captured.response.headerValue("set-cookie")) ?? "";
  },
);

Then(
  "Academy offers the unchanged SMS code step without a private session or addressed SMS for twenty seconds",
  async ({ page }) => {
    const state = visitor(page);
    if (!state.requestedAt) throw new Error("SMS request was not observed");
    const code = page.locator('input[autocomplete="one-time-code"]');
    await expect(code).toBeVisible();
    await expect(code).toHaveAttribute("maxlength", "6");
    await expect(code).toHaveAttribute("inputmode", "numeric");
    expect((await code.inputValue()) === "", "no code is submitted").toBe(true);
    await expect(page.getByTestId("otp-verify")).toBeVisible();
    await expect(page.getByTestId("otp-change-method")).toBeEnabled();
    await expect(page.getByTestId("otp-resend")).toBeDisabled();
    await expect(
      page.getByTestId("login-screen").getByRole("alert"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Проверьте телефон" }),
    ).toBeVisible();
    await expect(
      page.getByText("Код действует 5 минут.", { exact: true }),
    ).toBeVisible();
    const deadline = Date.now() + 20_000;
    while (true) {
      const finalObservation = Date.now() >= deadline;
      expect(
        (await smsSinkMessages(state.sink, state.phone, state.requestedAt))
          .length,
        "no addressed SMS throughout the complete delivery horizon",
      ).toBe(0);
      if (finalObservation) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await noPrivateAccess(page, state);
  },
);
