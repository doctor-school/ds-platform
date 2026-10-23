import { hostCommand, signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import type { OwnedAuthContour } from "../lib/owned-auth-observation.js";
import {
  assertNoPrivateRegistrationAccess,
  differentVerificationCode,
  inputSecret,
  registerOwnedCredentials,
  registrationEvidence,
  verificationEvidence,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { openHostCodeStep } from "../lib/storefront-entry-watch.js";
import { assertSecureSession } from "../lib/secure-session.js";
import {
  readWrongVerificationSnapshot,
  type WrongVerificationSnapshot,
} from "../lib/wrong-verification-observation.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
type AccountClass = "unknown" | "verified" | "unverified";
interface Probe extends OwnedCredentials {
  kind: AccountClass;
  context: BrowserContext;
  page: Page;
  before?: WrongVerificationSnapshot;
}
interface Refusal {
  status: number;
  body: string;
  noSession: boolean;
  ms: number;
}
interface WrongVerification {
  probes: Probe[];
  contour: OwnedAuthContour;
  wrongCode?: string;
  warmup: Refusal[];
  samples: Refusal[][];
}
const states = new WeakMap<Page, WrongVerification>();
function state(key: Page): WrongVerification {
  const value = states.get(key);
  if (!value) throw new Error("Owned wrong-verification triad not prepared");
  return value;
}

function sameRefusal(result: Refusal, reference: Refusal): void {
  // Only booleans reach assertion diagnostics if an endpoint unexpectedly echoes credentials.
  expect(
    {
      status: result.status,
      sameBody: result.body === reference.body,
      noSession: result.noSession,
    },
    "identical complete refusal and no minted session",
  ).toEqual({ status: 400, sameBody: true, noSession: true });
}

async function noPrivateAccess(probe: Probe): Promise<void> {
  await assertNoPrivateRegistrationAccess(probe.page, "", probe);
  expect(
    await probe.page.evaluate(
      async () =>
        (
          await fetch("/v1/auth/session", {
            credentials: "include",
            cache: "no-store",
          })
        ).status,
    ),
    "refused browser has no session principal",
  ).toBe(401);
}

Given(
  "a verified account, an unverified account and an unknown identifier",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const value: WrongVerification = {
      probes: [],
      warmup: [],
      samples: [],
      contour: {
        academyBaseUrl: world.hostBaseUrl,
        apiBaseUrl: process.env.E2E_API_URL ?? "",
        databaseUrl: process.env.E2E_AUTH_DATABASE_URL ?? "",
        expectedDatabase: process.env.E2E_AUTH_DATABASE_NAME ?? "",
        expectedDatabaseHost: process.env.E2E_AUTH_DATABASE_HOST ?? "",
        expectedDatabasePort: Number(process.env.E2E_AUTH_DATABASE_PORT),
      },
    };
    states.set(page, value);
    // 003 EARS-41: preserve the native oracle's unknown/verified/unverified round order.
    for (const kind of ["unknown", "verified", "unverified"] as const) {
      const context = await browser.newContext({
        locale: "ru-RU",
        ...(httpCredentials ? { httpCredentials } : {}),
      });
      const owned = await context.newPage();
      const probe: Probe = {
        kind,
        context,
        page: owned,
        email: `wrong-2928-${kind}-${randomUUID()}@example.test`,
        password: `Wrong-${randomUUID()}-aA1!`,
      };
      value.probes.push(probe);
      await prepareCaptchaForJourney(
        context,
        baseURL ?? world.hostBaseUrl,
        process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
      );
      if (kind !== "unknown") {
        const { response, body, code } = await registerOwnedCredentials(
          owned,
          world.hostBaseUrl,
          probe,
          "/account",
        );
        expect(
          registrationEvidence(
            response.request().postData() ?? "",
            body,
            probe,
          ),
        ).toEqual({
          credentialsMatch: true,
          consentMatches: true,
          acknowledgementMatches: true,
        });
        await assertNoPrivateRegistrationAccess(
          owned,
          (await response.headerValue("set-cookie")) ?? "",
          probe,
        );
        if (kind === "verified") {
          const pending = captureResponse(
            owned,
            signInHostApiPath("/v1/auth/verify"),
          );
          await inputSecret(
            owned.locator('input[autocomplete="one-time-code"]'),
            code,
          );
          const accepted = await pending;
          expect(
            accepted.response.status(),
            "verified fixture confirmed with its delivered code",
          ).toBe(200);
          expect(
            verificationEvidence(
              accepted.response.request().postData() ?? "",
              accepted.body,
              probe,
              code,
              world.hostBaseUrl,
            ),
          ).toEqual({ credentialsMatch: true, acknowledgementMatches: true });
          await owned.waitForURL((url) => url.pathname === "/account");
          await owned.waitForLoadState("networkidle");
          await assertSecureSession(
            owned,
            accepted.response,
            world.hostBaseUrl,
          );
          const logout = captureResponse(owned, "/v1/auth/logout");
          await owned.getByTestId("logout").click();
          expect(
            (await logout).response.status(),
            "fixture's prerequisite session revoked",
          ).toBe(200);
          await owned.waitForURL((url) => url.pathname === "/");
        } else value.wrongCode = differentVerificationCode(code);
      }
      // A fresh document drops held registration credentials: every class submits the same code-only contract.
      // #3172 — the code step is the sign-in host's /verify door.
      await openHostCodeStep(owned, world.hostBaseUrl, probe.email, "/account");
      await owned.waitForLoadState("networkidle");
      await expect(
        owned.locator('input[autocomplete="one-time-code"]'),
      ).toBeVisible();
      await noPrivateAccess(probe);
      probe.before = await readWrongVerificationSnapshot(
        value.contour,
        probe.email,
      );
      expect(
        {
          users: probe.before.users,
          verified: probe.before.verified,
          consents: probe.before.consents,
        },
        `real ${kind} account class before refusal`,
      ).toEqual({
        users: kind === "unknown" ? 0 : 1,
        verified: kind === "verified",
        consents: kind === "unknown" ? 0 : 1,
      });
    }
    expect(
      typeof value.wrongCode === "string" && /^\d{6}$/.test(value.wrongCode),
      "well-formed code differs from the pending issued code",
    ).toBe(true);
  },
);

When(
  "a wrong six-digit code is submitted for each",
  async ({ page, $testInfo: testInfo }) => {
    const value = state(page);
    for (const probe of value.probes) {
      const pending = captureResponse(
        probe.page,
        signInHostApiPath("/v1/auth/verify"),
      );
      await inputSecret(
        probe.page.locator('input[autocomplete="one-time-code"]'),
        value.wrongCode!,
      );
      const captured = await pending;
      let codeOnly = false;
      try {
        const request: unknown = hostCommand(JSON.parse(
          captured.response.request().postData() ?? "",
        ));
        codeOnly =
          request !== null &&
          typeof request === "object" &&
          Object.keys(request).length === 2 &&
          "email" in request &&
          "code" in request &&
          request.email === probe.email &&
          request.code === value.wrongCode;
      } catch {
        /* Discard private request parser diagnostics. */
      }
      expect(
        codeOnly,
        "UI submitted the exact owned identifier and a complete wrong code only",
      ).toBe(true);
      value.warmup.push({
        status: captured.response.status(),
        body: captured.body,
        noSession: !(
          (await captured.response.headerValue("set-cookie")) ?? ""
        ).includes(`${SESSION}=`),
        ms: 0,
      });
      expect(
        captured.response.status(),
        "wrong code refused by actual UI command",
      ).toBe(400);
      const error = probe.page.getByTestId("verify-error");
      await expect(error).toBeVisible();
      await expect
        .poll(
          async () =>
            (await error.ariaSnapshot()) ===
            "- alert: Код не подошёл. Проверьте его или запросите новый.",
        )
        .toBe(true);
      expect(new URL(probe.page.url()).pathname).toBe("/verify");
      await noPrivateAccess(probe);
      await probe.page.screenshot({
        path: testInfo.outputPath(`${probe.kind}-wrong-code.png`),
        fullPage: true,
        mask: [
          probe.page.getByText(probe.email, { exact: true }),
          probe.page.locator('input[autocomplete="one-time-code"]'),
        ],
      });
    }
    // Five measured round-robin rounds follow the discarded UI warm-up round.
    // 18 refusals + one prerequisite confirmation fit ADR-0001's 20/IP budget.
    value.samples = value.probes.map(() => []);
    for (let round = 0; round < 5; round += 1) {
      for (const [index, probe] of value.probes.entries()) {
        const observed = await probe.page.evaluate(
          async ({ email, code }) => {
            const started = performance.now();
            const response = await fetch("/v1/auth/verify", {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ email, code }),
            });
            const body = await response.text();
            return {
              status: response.status,
              body,
              ms: performance.now() - started,
            };
          },
          { email: probe.email, code: value.wrongCode! },
        );
        value.samples[index]!.push({
          ...observed,
          noSession: !(await probe.context.cookies()).some(
            (cookie) => cookie.name === SESSION,
          ),
        });
      }
    }
  },
);

Then(
  "each response is the same generic failure in status, body, and timing within 50 ms",
  async ({ page, $testInfo: testInfo }) => {
    const value = state(page);
    const reference = value.warmup[0]!;
    let generic = false;
    try {
      const body = JSON.parse(reference.body);
      generic =
        Object.keys(body).length === 3 &&
        body.statusCode === 400 &&
        body.message === "the request could not be completed" &&
        body.error === "Bad Request";
    } catch {
      /* Discard private response parser diagnostics. */
    }
    expect(generic, "complete approved generic failure body").toBe(true);
    for (const result of [...value.warmup, ...value.samples.flat()])
      sameRefusal(result, reference);
    const medians = value.samples.map((samples) => {
      expect(samples.length, "five measured rounds per class").toBe(5);
      const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b);
      return sorted[2]!;
    });
    const spread = Math.max(...medians) - Math.min(...medians);
    await testInfo.attach("EARS-41 interleaved timing and refusal evidence", {
      body: JSON.stringify({
        classOrder: value.probes.map((probe) => probe.kind),
        discardedUiWarmupRounds: 1,
        measuredRounds: 5,
        samplesMs: value.samples.map((samples) =>
          samples.map((sample) => sample.ms),
        ),
        mediansMs: medians,
        medianSpreadMs: spread,
        budgetMs: 50,
        status: reference.status,
        exactBodiesEqual: true,
        noSessionCookies: true,
      }),
      contentType: "application/json",
    });
    expect(
      spread,
      "interleaved class medians remain within the exact native 50ms budget",
    ).toBeLessThanOrEqual(50);
    for (const result of value.samples.flat())
      expect(
        result.ms,
        "native timing-equalization floor allows scheduling jitter below40ms",
      ).toBeGreaterThanOrEqual(30);
  },
);

Then("no account state changes", async ({ page, $testInfo: testInfo }) => {
  const value = state(page);
  const evidence = [];
  for (const probe of value.probes) {
    const after = await readWrongVerificationSnapshot(
      value.contour,
      probe.email,
    );
    const unchanged = JSON.stringify(after) === JSON.stringify(probe.before);
    expect(
      unchanged,
      `${probe.kind} complete user and consent rows unchanged`,
    ).toBe(true);
    await noPrivateAccess(probe);
    evidence.push({
      kind: probe.kind,
      users: after.users,
      emailVerified: after.verified,
      consents: after.consents,
      completeRowsUnchanged: unchanged,
      noSessionPrincipal: true,
    });
  }
  await testInfo.attach("EARS-41 unchanged owned accounts", {
    body: JSON.stringify(evidence),
    contentType: "application/json",
  });
});

After("@wrong-verification-code", async ({ page }) => {
  const value = states.get(page);
  if (!value) return;
  try {
    for (const probe of value.probes) {
      if (
        (await probe.context.cookies()).some(
          (cookie) => cookie.name === SESSION,
        )
      ) {
        expect(
          await probe.page.evaluate(
            async () =>
              (
                await fetch("/v1/auth/logout", {
                  method: "POST",
                  credentials: "include",
                })
              ).status,
          ),
          "revoke only an owned fixture session after failure",
        ).toBe(200);
      }
    }
  } finally {
    for (const probe of value.probes) {
      await Promise.all(probe.context.pages().map((owned) => owned.close()));
      await probe.context.close();
    }
    states.delete(page);
  }
});
