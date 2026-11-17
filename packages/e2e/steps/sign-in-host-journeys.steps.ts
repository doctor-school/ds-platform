import { randomUUID } from "node:crypto";

import { golden } from "@ds/db/seed/golden";
import {
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type Response,
} from "@playwright/test";

import { HOSTS, baseUrlFor, type HostId } from "../hosts.js";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import { gatedPasswordLogin } from "../lib/gated-password-login.js";
import { provisionConfirmedAccount } from "../lib/host-sign-in.js";
import {
  inputSecret,
  submitOwnedRegistration,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { waitForClientReady } from "../lib/page-ready.js";
import { assertSecureSession } from "../lib/secure-session.js";
import {
  isSignInHostForm,
  signInHostApiPath,
} from "../lib/sign-in-host-api.js";
import { OIDC_TX_COOKIE } from "../lib/storefront-entry.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

/**
 * 003 EARS-61/62/5/8 · EARS-24/41 · EARS-71 (#3771) — the three sign-in-host
 * journeys a guest starts on an Academy page: a sign-in from an эфир page's
 * own sign-in link that ends on that page, a registration that ends signed in
 * on both storefronts, and the эфир's return-context card on the host's form.
 *
 * Everything asserted is what the browser itself receives: the documents of
 * the main frame (statuses, `Location`, `Set-Cookie`), the rendered pages and
 * the cookie jar. The эфир is the golden published recorded one: its page
 * carries the recording gate's sign-in link `/login?returnTo=<page>` — the
 * header «Войти» carries the land-only marker instead (014 EARS-6), which is a
 * different return target than these journeys name.
 */

const SESSION_COOKIE = "__Host-ds_session";
const ACADEMY_FORM_MARK = "auth-wordmark";
const EVENT = golden.events.pastWithRecording;
const UPCOMING = golden.events.upcoming;
const base = (id: HostId) => baseUrlFor(HOSTS[id]);
const origin = (id: HostId) => new URL(base(id)).origin;
const eventPathOf = (id: HostId, slug: string) =>
  `${HOSTS[id].eventsPath}/${slug}`;

interface Journey {
  context: BrowserContext;
  page: Page;
  documents: Response[];
  eventPath?: string;
  eventTitle?: string;
  entry?: Response | undefined;
  entryFrom?: number;
  account?: OwnedCredentials;
}
const journeys = new WeakMap<Page, Journey>();
function journeyOf(page: Page): Journey {
  const journey = journeys.get(page);
  if (!journey) throw new Error("003 #3771: the guest browser was not opened");
  return journey;
}

/** A fresh guest browser whose main-frame documents are recorded in order. */
async function openGuest(
  key: Page,
  browser: Browser,
  httpCredentials: BrowserContextOptions["httpCredentials"],
): Promise<Journey> {
  const context = await browser.newContext({
    locale: "ru-RU",
    ...(httpCredentials ? { httpCredentials } : {}),
  });
  await prepareCaptchaForJourney(
    context,
    base("academy"),
    process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
  );
  const guest = await context.newPage();
  const journey: Journey = { context, page: guest, documents: [] };
  guest.on("response", (response) => {
    const request = response.request();
    if (
      request.resourceType() === "document" &&
      request.frame() === guest.mainFrame()
    )
      journey.documents.push(response);
  });
  journeys.set(key, journey);
  return journey;
}

/** The documents recorded after `from` (an index into the journey's list). */
const since = (journey: Journey, from: number) => journey.documents.slice(from);

/** The path + query + fragment a `Location` names, origin dropped. */
function locationPath(response: Response): string {
  const raw = response.headers()["location"] ?? "";
  if (raw.startsWith("/")) return raw;
  return raw.slice(new URL(raw).origin.length);
}

async function setCookies(response: Response): Promise<string[]> {
  return (await response.headersArray())
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .flatMap((h) => h.value.split("\n"));
}

async function hasSession(page: Page, id: HostId): Promise<boolean> {
  const cookies = await page.context().cookies(base(id));
  return cookies.some((c) => c.name === SESSION_COOKIE);
}

/** The storefront session as the page itself reads it (device-bound, EARS-64). */
async function sessionStatus(page: Page): Promise<number> {
  return page.evaluate(
    async () =>
      (
        await fetch("/v1/auth/session", {
          credentials: "include",
          cache: "no-store",
        })
      ).status,
  );
}

/** The sign-in host renders the Academy's own form (its host config). */
async function expectAcademyForm(guest: Page): Promise<void> {
  await expect(guest.getByTestId(ACADEMY_FORM_MARK)).toBeVisible();
}

/** The guest on the golden recorded эфир's Academy page, its title kept. */
async function openEventPage(journey: Journey, path: string): Promise<void> {
  expect(path, "the golden published эфир's Academy page").toBe(
    eventPathOf("academy", EVENT.slug),
  );
  const response = await journey.page.goto(`${base("academy")}${path}`, {
    waitUntil: "load",
  });
  expect(response?.status(), "the эфир page document").toBe(200);
  await waitForClientReady(journey.page);
  journey.eventPath = path;
  journey.eventTitle = (
    await journey.page.getByRole("heading", { level: 1 }).first().innerText()
  ).trim();
  expect(journey.eventTitle.length, "the page names its эфир").toBeGreaterThan(
    0,
  );
}

/**
 * Follows the эфир page's own sign-in link (the recording gate's «Войти»),
 * whose address is `expected`, and waits for the sign-in host's form.
 */
async function followSignInLink(
  journey: Journey,
  expected: string,
): Promise<void> {
  const link = journey.page.getByTestId("recording-gate-signin");
  await expect(link).toBeVisible();
  const href = new URL(
    (await link.getAttribute("href")) ?? "",
    base("academy"),
  );
  const wanted = new URL(expected, base("academy"));
  expect(
    {
      origin: href.origin,
      pathname: href.pathname,
      returnTo: href.searchParams.get("returnTo"),
    },
    "the sign-in link's address",
  ).toEqual({
    origin: origin("academy"),
    pathname: wanted.pathname,
    returnTo: wanted.searchParams.get("returnTo"),
  });
  const from = journey.documents.length;
  const atForm = journey.page.waitForURL((url) => isSignInHostForm(url));
  await link.click();
  await atForm;
  await waitForClientReady(journey.page);
  journey.entry = since(journey, from).find(
    (r) =>
      new URL(r.url()).origin === origin("academy") &&
      new URL(r.url()).pathname === "/login",
  );
  journey.entryFrom = from;
}

/** The storefront `/login` entry rendered nothing: one `303` into an interactive authorize. */
async function expectInteractiveAuthorize(journey: Journey): Promise<URL> {
  const entry = journey.entry;
  expect(entry, "the Academy sign-in entry answered the link").toBeDefined();
  expect(entry!.status(), "the entry renders no form").toBe(303);
  const authorize = new URL(entry!.headers()["location"] ?? "", entry!.url());
  expect(
    authorize.origin,
    "the authorize endpoint is off the storefront",
  ).not.toBe(origin("academy"));
  expect(authorize.pathname, "the authorize endpoint").toMatch(/\/authorize$/);
  expect(
    authorize.searchParams.get("prompt"),
    "an interactive transaction",
  ).not.toBe("none");
  expect(
    authorize.searchParams.get("state"),
    "a named transaction",
  ).toBeTruthy();
  const tx = (await setCookies(entry!)).find((c) =>
    c.startsWith(`${OIDC_TX_COOKIE}=`),
  );
  expect(
    tx,
    `the entry opens a new ${OIDC_TX_COOKIE} transaction`,
  ).toBeDefined();
  // Between the link and the form, the Academy rendered no page.
  const academy = since(journey, journey.entryFrom ?? 0).filter(
    (r) => new URL(r.url()).origin === origin("academy"),
  );
  for (const response of academy)
    expect(response.status(), response.url()).toBe(303);
  return authorize;
}

/** A confirmed Academy password account, provisioned in its own browser. */
async function verifiedAccount(
  journey: Journey,
  browser: Browser,
): Promise<OwnedCredentials> {
  const account: OwnedCredentials = {
    email: `sign-in-host-3771-${randomUUID()}@example.test`,
    password: `Host-${randomUUID()}-aA1!`,
  };
  await provisionConfirmedAccount(browser, "academy", base("academy"), account);
  journey.account = account;
  return account;
}

/** Signs in on the host's password form already open in the guest browser. */
async function signInOnHostForm(
  journey: Journey,
  account: OwnedCredentials,
): Promise<number> {
  const page = journey.page;
  await inputSecret(
    page.locator('input[autocomplete="username"]'),
    account.email,
  );
  await inputSecret(
    page.locator('input[autocomplete="current-password"]'),
    account.password,
  );
  const from = journey.documents.length;
  const submitted = await gatedPasswordLogin(
    page,
    base("academy"),
    async () => {
      const pending = captureResponse(
        page,
        signInHostApiPath("/v1/auth/login"),
      );
      await page.getByTestId("password-login-submit").click();
      return pending;
    },
  );
  expect(submitted.response.status(), "the password sign-in is accepted").toBe(
    200,
  );
  return from;
}

const signedInFrom = new WeakMap<Page, number>();
function signInMark(page: Page): number {
  const from = signedInFrom.get(page);
  if (from === undefined)
    throw new Error("003 #3771: the guest never signed in");
  return from;
}

/** The Academy `/auth/callback` answer among the documents after `from`. */
async function callbackOf(journey: Journey, from: number): Promise<Response> {
  await journey.page.waitForURL(
    (url) =>
      url.origin === origin("academy") && url.pathname !== "/auth/callback",
  );
  await journey.page.waitForLoadState("load");
  const callback = since(journey, from).find(
    (r) =>
      new URL(r.url()).origin === origin("academy") &&
      new URL(r.url()).pathname === "/auth/callback",
  );
  expect(callback, "the Academy callback answered the sign-in").toBeDefined();
  return callback!;
}

/** Signed in on the Academy at `path`, through a fresh session the callback minted. */
async function expectSignedInAt(
  journey: Journey,
  from: number,
  path: string,
): Promise<Response> {
  const callback = await callbackOf(journey, from);
  expect(callback.status(), "the callback answers a redirect").toBe(303);
  expect(locationPath(callback), "the callback's target").toBe(`${path}#`);
  const minted = (await setCookies(callback)).find((c) =>
    c.startsWith(`${SESSION_COOKIE}=`),
  );
  expect(minted, "the callback itself mints the session").toBeDefined();
  await journey.page.waitForURL(
    (url) => url.origin === origin("academy") && url.pathname === path,
  );
  await waitForClientReady(journey.page);
  await assertSecureSession(journey.page, callback, base("academy"));
  expect(await sessionStatus(journey.page), "the Academy session is live").toBe(
    200,
  );
  return callback;
}

// ── 003 EARS-61/62/5/8: a sign-in from an эфир page ends on that page ───────

Given(
  "a signed-out browser on the Academy with no shared sign-in-host session",
  async ({ page, browser, httpCredentials }) => {
    const journey = await openGuest(page, browser, httpCredentials);
    expect(
      await journey.context.cookies(),
      "a browser holding nothing",
    ).toEqual([]);
  },
);

When(
  "the guest follows the Academy sign-in entry from {string}",
  async ({ page }, path: string) => {
    const journey = journeyOf(page);
    await openEventPage(journey, path);
    expect(await hasSession(journey.page, "academy"), "signed out").toBe(false);
    await followSignInLink(
      journey,
      `/login?returnTo=${encodeURIComponent(path)}`,
    );
  },
);

Then(
  "the Academy renders no form and redirects to the authorize endpoint with a new interactive transaction",
  async ({ page }) => {
    await expectInteractiveAuthorize(journeyOf(page));
  },
);

Then(
  "the sign-in host shows the Academy's own sign-in form",
  async ({ page }) => {
    const guest = journeyOf(page).page;
    expect(isSignInHostForm(guest.url()), "on the sign-in host").toBe(true);
    await expectAcademyForm(guest);
    await expect(guest.getByTestId("password-login-submit")).toBeVisible();
  },
);

When(
  "the guest signs in there with a verified password account",
  async ({ page, browser }) => {
    const journey = journeyOf(page);
    const account = await verifiedAccount(journey, browser);
    signedInFrom.set(page, await signInOnHostForm(journey, account));
  },
);

Then(
  "the Academy callback mints a fresh session and answers 303 to {string}",
  async ({ page }, target: string) => {
    const journey = journeyOf(page);
    expect(target.endsWith("#"), "the target keeps the fragment guard").toBe(
      true,
    );
    const path = target.slice(0, -1);
    expect(path, "the page the guest came from").toBe(journey.eventPath);
    await expectSignedInAt(journey, signInMark(page), path);
  },
);

Then(
  "the authorization code never appears in a rendered document",
  async ({ page }) => {
    const journey = journeyOf(page);
    const callback = await callbackOf(journey, signInMark(page));
    const code = new URL(callback.url()).searchParams.get("code");
    expect(code, "the callback carried an authorization code").toBeTruthy();
    for (const response of journey.documents) {
      if (!response.url().includes(code!)) continue;
      const status = response.status();
      expect(
        status >= 300 && status < 400,
        `a document carrying the code is only a redirect (${new URL(response.url()).pathname})`,
      ).toBe(true);
    }
    expect(journey.page.url().includes(code!), "not in the final address").toBe(
      false,
    );
    expect(
      (await journey.page.content()).includes(code!),
      "not in the page",
    ).toBe(false);
  },
);

// ── 003 EARS-24/41: a registration on the sign-in host, both storefronts ────

Given(
  "a guest on the Academy with no account",
  async ({ page, browser, httpCredentials }) => {
    const journey = await openGuest(page, browser, httpCredentials);
    const path = eventPathOf("academy", UPCOMING.slug);
    const response = await journey.page.goto(`${base("academy")}${path}`, {
      waitUntil: "load",
    });
    expect(response?.status(), "an Academy page").toBe(200);
    await waitForClientReady(journey.page);
    expect(
      await hasSession(journey.page, "academy"),
      "no Academy session",
    ).toBe(false);
    expect(await hasSession(journey.page, "doctor"), "no doctor session").toBe(
      false,
    );
  },
);

const storedReturn = new WeakMap<Page, string>();

When("the guest follows the Academy registration entry", async ({ page }) => {
  const journey = journeyOf(page);
  const entry = journey.page.locator('main a[href^="/register"]').first();
  await expect(entry).toBeVisible();
  const href = new URL(
    (await entry.getAttribute("href")) ?? "",
    base("academy"),
  );
  const returnTo = href.searchParams.get("returnTo");
  expect(returnTo, "the registration entry carries the page to return to").toBe(
    eventPathOf("academy", UPCOMING.slug),
  );
  storedReturn.set(page, returnTo!);
  const from = journey.documents.length;
  const atForm = journey.page.waitForURL((url) => isSignInHostForm(url));
  await entry.click();
  await atForm;
  await waitForClientReady(journey.page);
  const storefront = since(journey, from).filter(
    (r) => new URL(r.url()).origin === origin("academy"),
  );
  expect(
    storefront.length,
    "the Academy's own /register entry",
  ).toBeGreaterThan(0);
  for (const response of storefront) {
    expect(new URL(response.url()).pathname).toBe("/register");
    expect(response.status(), "the entry renders no form").toBe(303);
  }
});

Then(
  "the sign-in host shows the Academy registration form with the Academy consents",
  async ({ page }) => {
    const guest = journeyOf(page).page;
    expect(isSignInHostForm(guest.url()), "on the sign-in host").toBe(true);
    await expectAcademyForm(guest);
    await expect(guest.getByTestId("register-submit")).toBeVisible();
    // The Academy door's consent is its read-only statement; the doctor
    // door's two access-condition checkboxes are not on it.
    await expect(
      guest
        .getByTestId("registration-form")
        .getByText(/^Продолжая, вы соглашаетесь/),
    ).toBeVisible();
    await expect(guest.getByRole("checkbox")).toHaveCount(0);
    await expect(guest.getByTestId("register-medworker")).toHaveCount(0);
    await expect(guest.getByTestId("register-partner-data")).toHaveCount(0);
  },
);

When(
  "the guest registers and enters the six-digit code from the mail",
  async ({ page }) => {
    const journey = journeyOf(page);
    const account: OwnedCredentials = {
      email: `register-host-3771-${randomUUID()}@example.test`,
      password: `Reg-${randomUUID()}-aA1!`,
    };
    journey.account = account;
    const { code } = await submitOwnedRegistration(
      journey.page,
      base("academy"),
      account,
    );
    expect(/^\d{6}$/.test(code), "the mail carries six digits").toBe(true);
    signedInFrom.set(page, journey.documents.length);
    await inputSecret(
      journey.page.locator('input[autocomplete="one-time-code"]'),
      code,
    );
  },
);

Then(
  "the guest is signed in on the Academy at the stored return path",
  async ({ page }) => {
    const stored = storedReturn.get(page);
    if (!stored) throw new Error("003 #3771: no return path was stored");
    await expectSignedInAt(journeyOf(page), signInMark(page), stored);
  },
);

Then(
  "a later document navigation on the doctor storefront is signed in through the silent check",
  async ({ page }) => {
    const journey = journeyOf(page);
    expect(
      await hasSession(journey.page, "doctor"),
      "no doctor session yet",
    ).toBe(false);
    const from = journey.documents.length;
    const path = eventPathOf("doctor", UPCOMING.slug);
    const response = await journey.page.goto(`${base("doctor")}${path}`, {
      waitUntil: "load",
    });
    expect(response?.status(), "the doctor page document").toBe(200);
    const doctor = since(journey, from).filter(
      (r) => new URL(r.url()).origin === origin("doctor"),
    );
    const first = doctor[0];
    expect(
      first,
      "a document response from the doctor storefront",
    ).toBeDefined();
    expect(first!.status(), "the silent check's redirect").toBe(303);
    const authorize = new URL(first!.headers()["location"] ?? "", first!.url());
    expect(authorize.searchParams.get("prompt"), "a silent authorize").toBe(
      "none",
    );
    const rendered = since(journey, from).filter((r) => r.status() === 200);
    expect(rendered, "one render: the signed-in page").toHaveLength(1);
    expect(new URL(rendered[0]!.url()).pathname).toBe(path);
    expect(await hasSession(journey.page, "doctor"), "a doctor session").toBe(
      true,
    );
    expect(
      await sessionStatus(journey.page),
      "the doctor session is live",
    ).toBe(200);
    await expect(journey.page.locator('input[type="password"]')).toHaveCount(0);
  },
);

// ── 003 EARS-71: the эфир's card on the host's sign-in form ────────────────

const withSlug = (text: string) => text.replaceAll("<slug>", EVENT.slug);

Given(
  "a guest on the page of a published эфир on the Academy",
  async ({ page, browser, httpCredentials }) => {
    const journey = await openGuest(page, browser, httpCredentials);
    await openEventPage(journey, eventPathOf("academy", EVENT.slug));
    expect(await hasSession(journey.page, "academy"), "a guest").toBe(false);
  },
);

When(
  "the guest follows the sign-in link to {string}",
  async ({ page }, address: string) => {
    await followSignInLink(journeyOf(page), withSlug(address));
  },
);

Then(
  "the sign-in host shows the Academy sign-in form with the login variant of that эфир's return-context card",
  async ({ page }) => {
    const journey = journeyOf(page);
    const guest = journey.page;
    expect(isSignInHostForm(guest.url()), "on the sign-in host").toBe(true);
    await expectAcademyForm(guest);
    await expect(guest.getByTestId("password-login-submit")).toBeVisible();
    const panel = guest.getByTestId("return-context-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("return-context-card")).toContainText(
      journey.eventTitle!,
    );
    await expect(panel).toContainText("После входа вы вернётесь сюда же.");
    await expect(panel).not.toContainText("После подтверждения почты");
  },
);

Then(
  "the authorize request carries only the entry-intent id, with no slug and no return path",
  async ({ page }) => {
    const journey = journeyOf(page);
    const authorize = await expectInteractiveAuthorize(journey);
    expect(
      authorize.searchParams.get("login_hint"),
      "the entry-intent id",
    ).toBeTruthy();
    const decoded = decodeURIComponent(authorize.href);
    expect(
      decoded.includes(EVENT.slug),
      "no slug in the authorize request",
    ).toBe(false);
    expect(decoded.includes(HOSTS.academy.eventsPath), "no return path").toBe(
      false,
    );
    expect(authorize.searchParams.has("returnTo"), "no returnTo").toBe(false);
  },
);

When("the guest signs in", async ({ page, browser }) => {
  const journey = journeyOf(page);
  const account = await verifiedAccount(journey, browser);
  signedInFrom.set(page, await signInOnHostForm(journey, account));
});

Then(
  "the guest lands signed in on {string}",
  async ({ page }, address: string) => {
    await expectSignedInAt(
      journeyOf(page),
      signInMark(page),
      withSlug(address),
    );
  },
);

After(
  "@sign-in-host or @register-on-sign-in-host or @entry-intent-event-target",
  async ({ page }) => {
    const journey = journeys.get(page);
    if (!journey) return;
    try {
      if (
        (await journey.context.cookies()).some((c) => c.name === SESSION_COOKIE)
      ) {
        await journey.page.goto(`${base("academy")}/`, { waitUntil: "load" });
        const status = await journey.page.evaluate(
          async () =>
            (
              await fetch("/v1/auth/logout", {
                method: "POST",
                credentials: "include",
              })
            ).status,
        );
        expect(status, "the journey's session is ended").toBe(200);
      }
    } finally {
      await journey.context.close();
      journeys.delete(page);
    }
  },
);
