import { randomUUID } from "node:crypto";

import { golden } from "@ds/db/seed/golden";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { HOSTS, baseUrlFor } from "../hosts.js";
import {
  captureAddressedMailCheckpoint,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "../lib/mailpit.js";
import {
  inputSecret,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import {
  isSignInHostForm,
  signInHostApiPath,
} from "../lib/sign-in-host-api.js";
import { chooseGuestSpecialty } from "../lib/specialty-choice.js";
import {
  expectEnteredThrough,
  watchStorefrontEntries,
} from "../lib/storefront-entry-watch.js";

/**
 * WHERE a doctor lands on the doctor storefront once the sign-in host is done
 * with them (#3172, ADR-0015 §4) — the landing checks of the doctor tiers that
 * a backend-free tier can no longer observe, restored here with their original
 * titles and assertions.
 *
 * Since #3172 the storefront's `/register` and `/login` are ENTRIES: they hand
 * the carried target to the API transaction and send the browser to the
 * sign-in host's form; the code or password is accepted THERE, and the
 * storefront callback (003 EARS-62, 005 EARS-2, 021 EARS-10/20) decides the
 * landing and relays the session. The form-level halves of these checks (the
 * carried auth request, the code command body, the refused code) live on the
 * sign-in host tier (`apps/login/e2e/doctor-register-*.e2e.spec.ts`,
 * `doctor-login-return-context.e2e.spec.ts`); what only a real stand shows —
 * the callback's landing on a real эфир, signed in — is proven here.
 *
 * Needs the golden dataset (the doctors-audience live эфир, past эфиры on the
 * doctor feed, the golden specialty book) and the slot's Mailpit; each journey
 * registers its own uniquely owned account, so no golden credential is used.
 */

/** The golden doctors-audience эфир on air relative to the pin. */
const LIVE = golden.events.live.slug;

/** The two LD-4 destinations, spelled out: the suite is the outside view. */
const EVENTS_FEED = "/events";
const HOME = "/";

/** A golden specialty name the guest catalog can remember (017 EARS-6). */
const CARDIOLOGY = "Кардиология";

const doctorBase = () => baseUrlFor(HOSTS.doctor);
const mailbox = () =>
  process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(baseUrlFor(HOSTS.academy));

function ownedAccount(): OwnedCredentials {
  return {
    email: `doctor-landing-3172-${randomUUID()}@example.test`,
    password: `Landing-${randomUUID()}-aA1!`,
  };
}

/**
 * The canonical gate hand-off URL, built the way the producer builds it
 * (`apps/api/src/events/participation-cta.resolver.ts` → `cta.href`): the
 * ACADEMY shape under `returnTo`, on the doctor storefront's own entry.
 */
function arrival(door: "/register" | "/login", slug: string): string {
  return `${doctorBase()}${door}?${new URLSearchParams({ returnTo: `/webinars/${slug}` })}`;
}

/** A past эфир the doctor feed lists — its page still exists (021 EARS-10.3). */
async function endedEventSlug(request: APIRequestContext): Promise<string> {
  const res = await request.get(
    `${doctorBase()}/v1/storefront/doctor/events?tense=past`,
    { headers: { accept: "application/json" } },
  );
  expect(res.status(), "the doctor feed's past read").toBe(200);
  const feed = (await res.json()) as {
    days: { items: { slug: string }[] }[];
  };
  const slug = feed.days.flatMap((day) => day.items)[0]?.slug;
  expect(slug, "the golden doctor feed lists a past эфир").toBeTruthy();
  return slug!;
}

/** Put a consent into the ticked state through its label (idempotent). */
async function setConsent(page: Page, testId: string) {
  const box = page.getByTestId(testId);
  if (!(await box.isChecked())) {
    await box.locator("xpath=ancestor::label[1]").click();
  }
  await expect(box).toBeChecked({ timeout: 2_000 });
}

/**
 * Walk 021 on the sign-in host form the page ALREADY stands on: fill the door,
 * submit, read the delivered code and type it. Returns the code command the
 * accepted code sent, for the caller to inspect.
 */
async function completeRegistrationFromHere(
  page: Page,
  account: OwnedCredentials,
) {
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle");
  expect(
    isSignInHostForm(page.url()),
    "the storefront entry led to the sign-in host form",
  ).toBe(true);
  // A value typed into the pre-hydration DOM is discarded by the first client
  // render; the form is filled when the door itself agrees it is complete.
  await expect(async () => {
    await setConsent(page, "register-medworker");
    await setConsent(page, "register-partner-data");
    await inputSecret(page.getByTestId("register-email"), account.email);
    await inputSecret(page.getByTestId("register-password"), account.password);
    await expect(page.getByTestId("register-submit")).toBeEnabled({
      timeout: 2_000,
    });
  }).toPass({ timeout: 15_000 });

  const before = await captureAddressedMailCheckpoint(
    nativeRecoveryMail(),
    mailbox(),
    account.email,
  );
  await page.getByTestId("register-submit").click();
  await page.waitForURL((url) => url.pathname === "/verify");
  await expect(page.getByTestId("verify-submit")).toBeVisible();
  const code = await fetchRecoveryCode(
    nativeRecoveryMail(),
    mailbox(),
    account.email,
    before,
    "register",
  );

  const verify = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname ===
        signInHostApiPath("/v1/storefront/doctor/verify"),
  );
  // The slotted OTP field auto-submits on completion (#175): filling it IS the
  // submit.
  await inputSecret(page.locator('input[autocomplete="one-time-code"]'), code);
  const sent = (await verify).postDataJSON() as Record<string, unknown>;
  return {
    // Booleans only: the code and the address stay out of the report.
    emailMatches: sent.email === account.email,
    codeMatches: sent.code === code,
    // 003 EARS-39 (host amendment): no in-tab registration value rides with
    // the code — the host's form state holds the warm proof.
    noRegistrationValues: !Object.hasOwn(sent, "registration"),
  };
}

/** Enter through the storefront door at `url`, then walk 021 to the landing. */
async function registerAndConfirmLandingOn(
  page: Page,
  url: string,
  landing: string,
  account: OwnedCredentials = ownedAccount(),
) {
  watchStorefrontEntries(page, doctorBase());
  await page.goto(url, { waitUntil: "load" });
  const sent = await completeRegistrationFromHere(page, account);
  // The wait IS the assertion of the amended clause: there is no outcome card
  // to wait for, so the first thing observable after the code is the
  // destination itself, on the doctor storefront.
  await page.waitForURL(
    (u) => u.origin === new URL(doctorBase()).origin && u.pathname === landing,
  );
  return sent;
}

/** The landed page's header shows the signed-in cluster, not «Войти». */
async function expectSignedInHeader(page: Page) {
  const header = page.getByTestId("storefront-header");
  await expect(
    header.getByRole("link", { name: "Личный кабинет" }),
  ).toBeVisible();
  await expect(header.getByRole("link", { name: "Войти" })).toHaveCount(0);
}

test.describe("021 EARS-10: the post-confirmation landing", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("021 EARS-10.1: a live carried target IS the landing — the accepted code opens the эфир itself", async ({
    page,
  }) => {
    const sent = await registerAndConfirmLandingOn(
      page,
      arrival("/register", LIVE),
      `/events/${LIVE}`,
    );
    expectEnteredThrough(page, doctorBase(), {
      pathname: "/register",
      returnTo: `/webinars/${LIVE}`,
    });
    // 003 EARS-41/23 (#2556) — the doctor storefront's code command, on the
    // host API: the address and the code.
    expect(sent).toEqual({
      emailMatches: true,
      codeMatches: true,
      noRegistrationValues: true,
    });

    // The owner's objection, as an assertion: no acknowledgement screen stands
    // between the code and the эфир, and nothing on the way asks for a tap.
    await expect(page.getByTestId("registration-success")).toHaveCount(0);
    await expect(page.getByText("Почта подтверждена")).toHaveCount(0);
  });

  test("021 EARS-10.3: a target that already ended lands on the эфир page anyway", async ({
    page,
    request,
  }) => {
    // Owner decision Б (2026-09-29) — the эфир page still exists, so it is the
    // landing; the page itself states that the эфир has ended.
    const ended = await endedEventSlug(request);
    await registerAndConfirmLandingOn(
      page,
      arrival("/register", ended),
      `/events/${ended}`,
    );
  });

  test("021 EARS-10.5: a target whose эфир no longer exists lands on the default landing", async ({
    page,
  }) => {
    // Owner decision Б (2026-09-29) — nothing answers for the эфир, so there is
    // no page to land on: the LD-4 storefront home (no remembered specialty).
    const gone = `gone-3172-${randomUUID().slice(0, 8)}`;
    await registerAndConfirmLandingOn(page, arrival("/register", gone), HOME);
  });

  test("021 EARS-10.4: a direct arrival lands where the DOOR decided", async ({
    page,
  }) => {
    // No `returnTo` and no remembered specialty: the LD-4 storefront home.
    await registerAndConfirmLandingOn(page, `${doctorBase()}/register`, HOME);
    expectEnteredThrough(page, doctorBase(), {
      pathname: "/register",
      returnTo: null,
    });
  });

  test("021 EARS-15: the confirmed doctor lands on the эфир SIGNED IN, and is never asked to register again", async ({
    page,
  }) => {
    // The defect this test exists to catch (#1996): a doctor who typed the
    // code arriving on the эфир as a guest. The accepted code IS the sign-in
    // (003 EARS-41) — the callback relays the session, no replay follows.
    const replays: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (
        path === "/v1/auth/login" ||
        path === signInHostApiPath("/v1/auth/login")
      ) {
        replays.push(request.url());
      }
    });
    await registerAndConfirmLandingOn(
      page,
      arrival("/register", LIVE),
      `/events/${LIVE}`,
    );

    // The header of the landed page is the observable outcome.
    await expectSignedInHeader(page);
    // The session came with the code: no sign-in replay left the browser.
    expect(replays).toEqual([]);
  });
});

test.describe("021 EARS-3: LD-4 — where the direct arrival lands", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("021 EARS-3.4: with a remembered specialty the landing is the 019 events feed", async ({
    page,
  }) => {
    await chooseGuestSpecialty(
      page,
      `${doctorBase()}${EVENTS_FEED}`,
      CARDIOLOGY,
    );
    await registerAndConfirmLandingOn(
      page,
      `${doctorBase()}/register`,
      EVENTS_FEED,
    );
  });

  test("021 EARS-3.5: the landing is never the account page, on either branch", async ({
    browser,
  }) => {
    const landings: string[] = [];
    for (const remembered of [false, true]) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        if (remembered) {
          await chooseGuestSpecialty(
            page,
            `${doctorBase()}${EVENTS_FEED}`,
            CARDIOLOGY,
          );
        }
        watchStorefrontEntries(page, doctorBase());
        await page.goto(`${doctorBase()}/register`, { waitUntil: "load" });
        await completeRegistrationFromHere(page, ownedAccount());
        await page.waitForURL(
          (u) =>
            u.origin === new URL(doctorBase()).origin &&
            !/^\/(register|verify|auth\/callback)$/.test(u.pathname),
        );
        landings.push(new URL(page.url()).pathname);
      } finally {
        await context.close();
      }
    }

    for (const landing of landings) {
      expect(landing).not.toBe("/account");
      expect(landing).not.toContain("account");
      // A closed union of exactly the two LD-4 destinations.
      expect([HOME, EVENTS_FEED]).toContain(landing);
    }
  });
});

test.describe("021 #1945: the doctor host's sign-in landing", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("021 #1945: a successful sign-in lands on the эфир, not on a 404", async ({
    page,
    context,
  }) => {
    // An owned account to sign in with, then a fresh guest browser state.
    const account = ownedAccount();
    await registerAndConfirmLandingOn(
      page,
      `${doctorBase()}/register`,
      HOME,
      account,
    );
    await context.clearCookies();

    watchStorefrontEntries(page, doctorBase());
    await page.goto(arrival("/login", LIVE), { waitUntil: "load" });
    await page.waitForLoadState("networkidle");
    expect(isSignInHostForm(page.url())).toBe(true);
    expectEnteredThrough(page, doctorBase(), {
      pathname: "/login",
      returnTo: `/webinars/${LIVE}`,
    });
    await inputSecret(
      page.locator('input[autocomplete="username"]'),
      account.email,
    );
    await inputSecret(
      page.locator('input[autocomplete="current-password"]'),
      account.password,
    );
    await page.getByRole("button", { name: /войти|продолжить/i }).click();

    await page.waitForURL(
      (u) =>
        u.origin === new URL(doctorBase()).origin &&
        u.pathname === `/events/${LIVE}`,
    );
    // The landing genuinely RENDERS — a 404 page also has a URL, so the page's
    // own shell is what proves the doctor arrived at the эфир.
    await expect(page.getByTestId("event-page-shell")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("020 EARS-5: the guest hand-off into 021 and the exact return", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("020 EARS-5.2: completing 021 returns the doctor to exactly the event page they left, signed in", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    watchStorefrontEntries(page, doctorBase());
    await page.goto(`${doctorBase()}/events/${LIVE}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByTestId("event-signup-cta").click();
    await page.waitForURL((u) => isSignInHostForm(u));
    expectEnteredThrough(page, doctorBase(), {
      pathname: "/register",
      returnTo: `/events/${LIVE}`,
    });

    await completeRegistrationFromHere(page, ownedAccount());

    // EXACTLY that page: the confirmation lands the doctor on the page the
    // journey started on, not the storefront home and not the cabinet — and
    // it lands them there itself, with no tap in between (021 EARS-10).
    await page.waitForURL(
      (u) =>
        u.origin === new URL(doctorBase()).origin &&
        u.pathname === `/events/${LIVE}`,
    );

    // 021 EARS-15 parity: the doctor lands SIGNED IN.
    await expectSignedInHeader(page);
  });
});
