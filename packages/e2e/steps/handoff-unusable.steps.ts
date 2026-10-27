import { handoffCommandWithoutReference,
  AUTH_REQUEST_PARAM,
  isAuthCommandPath,
  isSignInHostForm,
  signInHostApiPath,
} from "../lib/sign-in-host-api.js";
import {
  expectEnteredThrough,
  watchStorefrontEntries,
} from "../lib/storefront-entry-watch.js";
import { randomBytes } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { captureResponse } from "../lib/captured-response.js";
import {
  assertNoAddressedMail,
  captureAddressedMailCheckpoint,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "../lib/mailpit.js";
import { createOwnedCongressSignup } from "../lib/owned-congress-signup.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

const ENDPOINT = signInHostApiPath("/v1/auth/login/otp/handoff");
interface Journey {
  context: BrowserContext;
  email: string;
  reference: string;
  fallbackPages: Page[];
  refusedBodies: string[];
}
const journeys = new WeakMap<Page, Journey>();
function journey(key: Page): Journey {
  const state = journeys.get(key);
  if (!state) throw new Error("Owned unusable-handoff prerequisite is missing");
  return state;
}
function target(base: string, reference: string): string {
  const url = new URL("/login", base);
  url.search = new URLSearchParams({
    method: "code",
    handoff: reference,
    returnTo: "/account",
  }).toString();
  return url.toString();
}
async function assertGuest(page: Page): Promise<void> {
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === "__Host-ds_session",
    ),
    "handoff creates no private session cookie",
  ).toBe(false);
  expect(
    await page.evaluate(async () => {
      const profile = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const session = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      return { profile: profile.status, session: session.status };
    }),
    "handoff leaves profile and session private",
  ).toEqual({ profile: 401, session: 401 });
}

Given(
  "an owned Academy congress reference has sent three fresh addressed code mails through three legitimate guest page loads",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const state: Journey = {
      context,
      email: "",
      reference: "",
      fallbackPages: [],
      refusedBodies: [],
    };
    journeys.set(page, state);
    const intake = await context.newPage();
    const signup = await createOwnedCongressSignup(
      intake,
      world.hostBaseUrl,
      "unusable-3026",
    );
    state.email = signup.email;
    state.reference = signup.reference;
    await intake.close();
    const mail = nativeRecoveryMail();
    const mailpit =
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl);
    let checkpoint = signup.notice;
    for (let redemption = 0; redemption < 3; redemption++) {
      const guest = await context.newPage();
      const posts: string[] = [];
      guest.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (request.method() === "POST" && isAuthCommandPath(path))
          posts.push(path);
      });
      const requested = await captureAddressedMailCheckpoint(
        mail,
        mailpit,
        state.email,
      );
      const pending = captureResponse(guest, ENDPOINT);
      await guest.goto(target(world.hostBaseUrl, state.reference), {
        waitUntil: "load",
      });
      const captured = await pending;
      let exact = false;
      try {
        const command = captured.response.request().postDataJSON();
        const answer = JSON.parse(captured.body);
        // 003 EARS-44 (host): the body names no reference (the form state
        // holds it); the answer still names the hand-off account.
        exact =
          handoffCommandWithoutReference(command, state.reference) &&
          Object.keys(answer).length === 2 &&
          answer.status === "otp_sent" &&
          answer.identifier === state.email;
      } catch {
        /* Reference and address must not enter parse diagnostics. */
      }
      expect(
        { status: captured.response.status(), exact },
        "each real page load legitimately redeems the owned reference",
      ).toEqual({ status: 200, exact: true });
      await expect(guest.getByTestId("otp-verify")).toBeVisible();
      const code = await fetchRecoveryCode(
        mail,
        mailpit,
        state.email,
        requested,
        "login",
      );
      expect(
        /^\d{6}$/.test(code),
        "each redemption delivers an addressed login code",
      ).toBe(true);
      const delivered = await captureAddressedMailCheckpoint(
        mail,
        mailpit,
        state.email,
      );
      expect(
        {
          added: delivered.messageIds.filter(
            (id) => !checkpoint.messageIds.includes(id),
          ).length,
          retained: checkpoint.messageIds.every((id) =>
            delivered.messageIds.includes(id),
          ),
          unique:
            new Set(delivered.messageIds).size === delivered.messageIds.length,
        },
        "one fresh message per redemption without replacing previous deliveries",
      ).toEqual({ added: 1, retained: true, unique: true });
      checkpoint = delivered;
      await assertGuest(guest);
      expect(posts, "exactly one handoff command per guest page load").toEqual([
        ENDPOINT,
      ]);
      await guest.close();
    }
  },
);

When(
  "Academy guests open a unique unknown reference, a malformed reference and the exhausted reference with the account return target",
  async ({ page, world }) => {
    const state = journey(page);
    const mail = nativeRecoveryMail();
    const mailpit =
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl);
    for (const [kind, reference] of [
      ["unknown", randomBytes(32).toString("base64url")],
      ["malformed", "not-a-reference"],
      ["exhausted", state.reference],
    ] as const) {
      const guest = await state.context.newPage();
      watchStorefrontEntries(guest, world.hostBaseUrl);
      state.fallbackPages.push(guest);
      const posts: string[] = [];
      guest.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (request.method() === "POST" && isAuthCommandPath(path))
          posts.push(path);
      });
      const checkpoint = await captureAddressedMailCheckpoint(
        mail,
        mailpit,
        state.email,
      );
      const pending =
        kind === "malformed" ? undefined : captureResponse(guest, ENDPOINT);
      await guest.goto(target(world.hostBaseUrl, reference), {
        waitUntil: "load",
      });
      if (pending) {
        const captured = await pending;
        let exactCommand = false;
        try {
          const command = captured.response.request().postDataJSON();
          // 003 EARS-44 (host): the reference rides the form state only.
          exactCommand = handoffCommandWithoutReference(command, reference);
        } catch {
          /* Do not retain reference-bearing parser diagnostics. */
        }
        expect(
          {
            status: captured.response.status(),
            exactCommand,
            neutral: captured.body === '{"status":"handoff_refused"}',
            noSession: !(
              (await captured.response.headerValue("set-cookie")) ?? ""
            ).includes("__Host-ds_session="),
          },
          "well-formed unusable references return only the ordinary neutral refusal",
        ).toEqual({
          status: 200,
          exactCommand: true,
          neutral: true,
          noSession: true,
        });
        state.refusedBodies.push(captured.body);
      }
      await expect(guest.getByTestId("login-method-otp")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(guest.getByTestId("otp-channel-email")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(guest.getByTestId("otp-identifier")).toHaveValue("");
      await expect(guest.getByTestId("login-method-password")).toBeVisible();
      await expect(guest.getByTestId("otp-send")).toBeVisible();
      await expect(guest.getByTestId("otp-verify")).toHaveCount(0);
      await expect(guest.getByRole("main").getByRole("alert")).toHaveCount(0);
      await expect(guest.getByTestId("profile-email")).toHaveCount(0);
      expect(
        await guest.evaluate(
          (email) => document.body.textContent?.includes(email) ?? false,
          state.email,
        ),
        "fallback discloses no owned account address",
      ).toBe(false);
      await guest.waitForLoadState("networkidle");
      await assertNoAddressedMail(mail, mailpit, state.email, checkpoint);
      await assertGuest(guest);
      expect(
        posts,
        "malformed input makes zero endpoint calls; each well-formed input makes one",
      ).toEqual(kind === "malformed" ? [] : [ENDPOINT]);
      // #3172 — the fallback is the sign-in host's code door, whose URL
      // carries only the IdP's auth request (no reference); the account return
      // target rode the storefront entry into the transaction.
      const url = new URL(guest.url());
      expect(
        isSignInHostForm(url) &&
          url.pathname === "/login" &&
          [...url.searchParams.keys()].join() === AUTH_REQUEST_PARAM,
        "fallback removes the reference",
      ).toBe(true);
      expectEnteredThrough(guest, world.hostBaseUrl, {
        pathname: "/login",
        method: "code",
        returnTo: "/account",
      });
      const history = await state.context.newCDPSession(guest);
      try {
        const entries = await history.send("Page.getNavigationHistory");
        expect(
          entries.entries.some(
            (entry) =>
              new URL(entry.url).searchParams.has("handoff") ||
              entry.url.includes(reference),
          ),
          "history replacement removes the unusable reference",
        ).toBe(false);
      } finally {
        await history.detach();
      }
    }
  },
);

Then(
  "all three unusable handoffs leave ordinary empty email-code entry with a password option and no mail, private access or reference in history",
  async ({ page }) => {
    const state = journey(page);
    expect(
      state.fallbackPages.length,
      "all three guest fallback paths were exercised",
    ).toBe(3);
    expect(
      state.refusedBodies.length,
      "unknown and exhausted replies were observed",
    ).toBe(2);
    expect(
      state.refusedBodies[0] === state.refusedBodies[1],
      "unknown and exhausted replies are byte-identical without an address",
    ).toBe(true);
    await state.fallbackPages[2]!.screenshot({
      path: test.info().outputPath("unusable-handoff-fallback.png"),
    });
  },
);

After("@handoff-unusable", async ({ page }) => {
  const state = journeys.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      )
    ) {
      const owned = state.context.pages()[0] ?? (await state.context.newPage());
      const revoked = await owned.evaluate(
        async () =>
          (
            await fetch("/v1/auth/logout", {
              method: "POST",
              credentials: "include",
            })
          ).status,
      );
      expect(revoked, "unexpected owned session revoked during cleanup").toBe(
        200,
      );
    }
  } finally {
    await state.context.close();
    journeys.delete(page);
  }
});
