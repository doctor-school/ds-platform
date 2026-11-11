import { waitForClientReady } from "../lib/page-ready.js";
import { randomUUID } from "node:crypto";

import { golden } from "@ds/db/seed/golden";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { HOSTS, baseUrlFor } from "../hosts.js";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
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
import { goldenDoctorPassword } from "../lib/golden.js";
import { signInPageThroughHost, tickConsent } from "../lib/host-sign-in.js";
import { resolveWorkerGoldenDoctor } from "../lib/worker-golden.js";

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

/**
 * The two LD-4 destinations, spelled out: the suite is the outside view. The
 * feed is the remembered specialty's own 018 feed, `/feed/<code>`.
 */
const EVENTS_FEED = "/events";
const HOME = "/";
const specialtyFeed = (code: string) => `/feed/${encodeURIComponent(code)}`;

/** A golden specialty name the guest catalog can remember (017 EARS-6). */
const CARDIOLOGY = "Кардиология";

const doctorBase = () => baseUrlFor(HOSTS.doctor);

/**
 * The host's forms are captcha-gated: the stub on a slot (the real invisible
 * widget yields no token headless), nothing on a local stand booted with bot
 * protection off (`captcha-stub.ts`). Installed before the first navigation.
 */
const prepareCaptcha = (target: BrowserContext, baseURL: string) =>
  prepareCaptchaForJourney(
    target,
    baseURL,
    process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
  );

test.beforeEach(({ context }) => prepareCaptcha(context, doctorBase()));
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

/**
 * 003 EARS-41/23 on the doctor door (DoctorVerifyRegistrationSchema): the warm
 * code step's `registration` is exactly the typed password, the medical-worker
 * declaration and the one ticked consent, partner-data sharing (021 EARS-5).
 * A boolean, so the password never reaches a report.
 */
function heldDoctorRegistration(
  registration: unknown,
  account: OwnedCredentials,
): boolean {
  if (
    registration === null ||
    typeof registration !== "object" ||
    Array.isArray(registration)
  )
    return false;
  const held = registration as Record<string, unknown>;
  const consent = held.consent;
  return (
    Object.keys(held).length === 3 &&
    held.password === account.password &&
    held.medicalWorkerDeclaration === true &&
    Array.isArray(consent) &&
    consent.length === 1 &&
    typeof consent[0] === "object" &&
    consent[0] !== null &&
    (consent[0] as Record<string, unknown>).purpose === "partner-data-sharing"
  );
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
  await waitForClientReady(page);
  expect(
    isSignInHostForm(page.url()),
    "the storefront entry led to the sign-in host form",
  ).toBe(true);
  // A value typed into the pre-hydration DOM is discarded by the first client
  // render; the form is filled when the door itself agrees it is complete.
  await expect(async () => {
    await tickConsent(page, "register-medworker");
    await tickConsent(page, "register-partner-data");
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
    // 003 EARS-24/41, 021 EARS-5: the warm in-place step sends the typed
    // values with the code — the password, the declaration and the ticked
    // partner-data consent, nothing else.
    heldRegistrationValues: heldDoctorRegistration(sent.registration, account),
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

/** 021 EARS-10.5 — the event-gone line lies wholly inside the first viewport. */
async function expectInFirstViewport(page: Page) {
  const box = await page.getByTestId("event-gone-notice").boundingBox();
  const viewport = page.viewportSize();
  expect(box, "the line has a box").not.toBeNull();
  expect(viewport, "the page has a viewport").not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
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
    // host API: the address, the code and the held registration values.
    expect(sent).toEqual({
      emailMatches: true,
      codeMatches: true,
      heldRegistrationValues: true,
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

  test("021 EARS-10.5: a target whose эфир no longer exists, with no remembered specialty, lands on the events feed, which says why on the first screen — once", async ({
    page,
  }) => {
    // Owner decision Б (2026-09-29) — nothing answers for the эфир, so there is
    // no page to land on; with no remembered specialty the landing is the
    // events feed, not the home whose hero fills the first screen (#3956).
    const gone = `gone-3172-${randomUUID().slice(0, 8)}`;
    await registerAndConfirmLandingOn(
      page,
      arrival("/register", gone),
      EVENTS_FEED,
    );
    // Amendment 2026-11-11 (#2272, owner pick «А») — the landing carries a
    // one-time notice line; the marker then leaves the address bar, so a
    // reload does not repeat it.
    const notice = page.getByTestId("event-gone-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toHaveCount(1);
    await expect(notice).toContainText("больше недоступен");
    await expectInFirstViewport(page);
    await expect
      .poll(() => new URL(page.url()).search)
      .not.toContain("notice=");
    await page.reload({ waitUntil: "load" });
    await expect(page.getByTestId("storefront-header")).toBeVisible();
    await expect(page.getByTestId("event-gone-notice")).toHaveCount(0);
  });

  test("021 EARS-10.5: the line opens the content column below the hero band, never between the header and the band", async ({
    page,
  }) => {
    // Owner Stage-B finding (#2272): mounted above the hero, the line split
    // the one blue top (site header + hero band) with a white strip.
    const isBetween = (before: string, after: string) =>
      page.evaluate(
        ([beforeSelector, afterSelector]) => {
          const line = document.querySelector(
            '[data-testid="event-gone-notice"]',
          );
          const head = document.querySelector(beforeSelector!);
          const next = document.querySelector(afterSelector!);
          if (!line || !head || !next) return false;
          return (
            (head.compareDocumentPosition(line) &
              Node.DOCUMENT_POSITION_FOLLOWING) !==
              0 &&
            (line.compareDocumentPosition(next) &
              Node.DOCUMENT_POSITION_FOLLOWING) !==
              0
          );
        },
        [before, after],
      );
    const code = await chooseGuestSpecialty(
      page,
      `${doctorBase()}${EVENTS_FEED}`,
      CARDIOLOGY,
    );
    await page.goto(`${doctorBase()}${specialtyFeed(code)}?notice=event-gone`, {
      waitUntil: "load",
    });
    await expect(page.getByTestId("event-gone-notice")).toBeVisible();
    // After the feed header, before the first feed block.
    expect(
      await isBetween(
        '[data-testid="specialty-feed-header"]',
        "[data-feed-block-slot]",
      ),
    ).toBe(true);
    // The events feed: the leading slot opens its main column, and the line
    // stands inside the first viewport on desktop and on mobile (#3956).
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`${doctorBase()}${EVENTS_FEED}?notice=event-gone`, {
        waitUntil: "load",
      });
      await expect(page.getByTestId("event-gone-notice")).toHaveCount(1);
      expect(
        await page.evaluate(() => {
          const line = document.querySelector(
            '[data-testid="event-gone-notice"]',
          );
          const column = document.querySelector(
            '[data-testid="events-main-column"]',
          );
          return Boolean(line && column?.firstElementChild?.contains(line));
        }),
        `${viewport.width}: the line opens the main column`,
      ).toBe(true);
      await expectInFirstViewport(page);
    }
  });

  test("021 EARS-10.5: a live landing and an arbitrary notice value render no event-gone line", async ({
    page,
  }) => {
    await registerAndConfirmLandingOn(
      page,
      arrival("/register", LIVE),
      `/events/${LIVE}`,
    );
    await expect(page.getByTestId("event-gone-notice")).toHaveCount(0);
    for (const value of ["x", "event-gone-x"]) {
      await page.goto(`${doctorBase()}${EVENTS_FEED}?notice=${value}`, {
        waitUntil: "load",
      });
      await expect(page.getByTestId("storefront-header")).toBeVisible();
      await expect(page.getByTestId("event-gone-notice")).toHaveCount(0);
    }
    // The home is no landing of a gone эфир any more (#3956): it mounts no line.
    await page.goto(`${doctorBase()}${HOME}?notice=event-gone`, {
      waitUntil: "load",
    });
    await expect(page.getByTestId("storefront-hero")).toBeVisible();
    await expect(page.getByTestId("event-gone-notice")).toHaveCount(0);
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

  test("021 EARS-3.4: with a remembered specialty the landing is that specialty's 018 feed", async ({
    page,
  }) => {
    const code = await chooseGuestSpecialty(
      page,
      `${doctorBase()}${EVENTS_FEED}`,
      CARDIOLOGY,
    );
    await registerAndConfirmLandingOn(
      page,
      `${doctorBase()}/register`,
      specialtyFeed(code),
    );
  });

  test("021 EARS-3.4: a specialty held only in the profile lands the bare «Войти» on that specialty's 018 feed", async ({
    page,
    context,
  }) => {
    // The golden verified doctor's Кардиология lives in the PROFILE; a fresh
    // browser with no guest store signs in through the bare `/login`, so only
    // the session the callback mints can tell the landing what was chosen.
    await context.clearCookies();
    const doctor = resolveWorkerGoldenDoctor("verified-cardiologist");
    await signInPageThroughHost(page, doctorBase(), {
      email: doctor.email,
      password: goldenDoctorPassword(doctor),
    });
    // The read goes out FROM THE PAGE, as the storefront's own read does: the
    // session is device-bound (003 EARS-64 fingerprint: UA + IP /24 +
    // accept-language), and a `page.request` read carries neither the
    // browser's `accept-language` nor its `origin`, so a stand that enforces
    // the fingerprint answers it 401 while the browser is signed in.
    expect(
      new URL(page.url()).origin,
      "the landing is on the doctor storefront",
    ).toBe(new URL(doctorBase()).origin);
    const read = await page.evaluate(async () => {
      const res = await fetch("/v1/me/specialty", {
        credentials: "include",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      return { status: res.status, body: res.ok ? await res.json() : null };
    });
    expect(read.status, "the signed-in specialty read").toBe(200);
    const choice = read.body as {
      specialty: { code: string } | null;
      storedIn: string;
    };
    expect(choice.storedIn, "the golden doctor's choice is the profile's").toBe(
      "profile",
    );
    expect(
      choice.specialty,
      "the golden doctor has a specialty",
    ).not.toBeNull();
    expect(new URL(page.url()).pathname).toBe(
      specialtyFeed(choice.specialty!.code),
    );
  });

  test("021 EARS-3.5: the landing is never the account page, on either branch", async ({
    browser,
  }) => {
    const landings: string[] = [];
    let feed = "";
    for (const remembered of [false, true]) {
      const context = await browser.newContext();
      try {
        await prepareCaptcha(context, doctorBase());
        const page = await context.newPage();
        if (remembered) {
          feed = specialtyFeed(
            await chooseGuestSpecialty(
              page,
              `${doctorBase()}${EVENTS_FEED}`,
              CARDIOLOGY,
            ),
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
      expect([HOME, feed]).toContain(landing);
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
    await waitForClientReady(page);
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
