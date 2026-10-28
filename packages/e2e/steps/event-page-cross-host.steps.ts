import { randomUUID } from "node:crypto";

import { golden } from "@ds/db/seed/golden";
import {
  expect,
  type APIResponse,
  type Page,
  type Response,
} from "@playwright/test";

import { HOSTS, baseUrlFor, type HostId } from "../hosts.js";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import {
  inputSecret,
  submitOwnedRegistration,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { signInGoldenDoctor } from "../lib/sign-in.js";
import { isSignInHostForm } from "../lib/sign-in-host-api.js";
import {
  OIDC_TX_COOKIE,
  TOP_LEVEL_NAVIGATION_HEADERS,
} from "../lib/storefront-entry.js";
import { Given, Then, When } from "./support/fixtures.js";

/**
 * 020 EARS-18 / EARS-22 (with 003 EARS-63, ADR-0015 §4 step 4) — a doctor
 * signed in on one storefront opens the event page on the other already
 * signed in, through that storefront's server-side silent check: the first
 * response is the check's redirect, no guest render precedes the signed-in
 * page, and no form is shown. Without a shared session the page is the guest
 * page after one round trip, and the next navigation makes no check.
 *
 * The feature is `@host:both`, so each scenario runs in both storefront
 * projects; the hosts it crosses are the outline's own (named by their
 * production host names), addressed through `baseUrlFor`, so a run drives the
 * two storefronts of the same slot whichever project it is in.
 */

const SEED = "verified-cardiologist";
const SESSION_COOKIE = "__Host-ds_session";
const GUEST_MARKER_COOKIE = "__Host-ds_guest";

/** The outline names the storefronts by their production host names. */
const HOST_BY_NAME: Readonly<Record<string, HostId>> = {
  "doctor.school": "doctor",
  "academy.doctor.school": "academy",
};

function hostNamed(name: string): HostId {
  const id = HOST_BY_NAME[name];
  if (!id) throw new Error(`020 EARS-22: unknown storefront "${name}"`);
  return id;
}

const base = (id: HostId) => baseUrlFor(HOSTS[id]);
const origin = (id: HostId) => new URL(base(id)).origin;
/** The one golden published event both storefronts serve (020 EARS-1). */
const eventPath = (id: HostId) =>
  `${HOSTS[id].eventsPath}/${golden.events.upcoming.slug}`;

/** The storefront the outline's document request went to. */
const requested = new WeakMap<Page, HostId>();

/** The main-frame document responses of the page, in arrival order. */
const documents = new WeakMap<Page, Response[]>();

function recordDocuments(page: Page): Response[] {
  const seen: Response[] = [];
  documents.set(page, seen);
  page.on("response", (response) => {
    const request = response.request();
    if (
      request.resourceType() === "document" &&
      request.frame() === page.mainFrame()
    ) {
      seen.push(response);
    }
  });
  return seen;
}

function recorded(page: Page): Response[] {
  const seen = documents.get(page);
  if (!seen) throw new Error("020 EARS-22: no document navigation recorded");
  return seen;
}

/** Responses from `id`'s origin for its event page (path match, query ignored). */
function eventResponses(page: Page, id: HostId): Response[] {
  return recorded(page).filter((r) => {
    const url = new URL(r.url());
    return url.origin === origin(id) && url.pathname === eventPath(id);
  });
}

async function hasSession(page: Page, id: HostId): Promise<boolean> {
  const cookies = await page.context().cookies(base(id));
  return cookies.some((c) => c.name === SESSION_COOKIE);
}

/**
 * The storefront session as the page itself reads it — an in-page `fetch`, as
 * every other step of the suite reads `/v1/auth/session`. The session is
 * device-bound (003 EARS-64 fingerprint: UA + IP /24 + accept-language), so a
 * `page.request` read, which carries neither the browser's `accept-language`
 * nor its `origin`, is answered 401 while the browser is signed in.
 */
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

async function openAsDocument(page: Page, id: HostId): Promise<void> {
  recordDocuments(page);
  const response = await page.goto(`${base(id)}${eventPath(id)}`, {
    waitUntil: "load",
  });
  expect(response?.status(), "the event page document").toBe(200);
  await expect(page).toHaveURL(
    (url) => url.origin === origin(id) && url.pathname === eventPath(id),
  );
}

Given(
  "a doctor signed in on {string} in this browser",
  async ({ page }, hostName: string) => {
    const id = hostNamed(hostName);
    await page.context().clearCookies();
    await signInGoldenDoctor(page, HOSTS[id], SEED, base(id));
    expect(await hasSession(page, id), `signed in on ${hostName}`).toBe(true);
  },
);

When(
  "the doctor's browser requests the same event page on {string} as a document",
  async ({ page }, hostName: string) => {
    const id = hostNamed(hostName);
    expect(
      await hasSession(page, id),
      `no ${hostName} session before the navigation`,
    ).toBe(false);
    requested.set(page, id);
    await openAsDocument(page, id);
  },
);

Then(
  "the first response from {string} is a redirect into its silent check, before any page renders",
  async ({ page }, hostName: string) => {
    const id = hostNamed(hostName);
    const first = recorded(page).find(
      (r) => new URL(r.url()).origin === origin(id),
    );
    expect(first, `a document response from ${hostName}`).toBeDefined();
    expect(first!.status(), "the check redirect").toBe(303);
    expect(new URL(first!.url()).pathname).toBe(eventPath(id));
    const location = new URL(first!.headers()["location"] ?? "", first!.url());
    expect(location.searchParams.get("prompt"), "a silent authorize").toBe(
      "none",
    );
    expect(first!.headers()["cache-control"]).toBe("no-store");
  },
);

Then(
  "the event page on {string} renders signed in with no form and no second sign-in",
  async ({ page }, hostName: string) => {
    const id = hostNamed(hostName);
    expect(await hasSession(page, id), `signed in on ${hostName}`).toBe(true);
    expect(await sessionStatus(page), "the storefront session is live").toBe(
      200,
    );
    // No credential step ran: nothing was typed, and no sign-in-host page
    // stopped the chain — the last document is the event page itself.
    const last = recorded(page).at(-1);
    expect(new URL(last!.url()).origin).toBe(origin(id));
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  },
);

Then(
  "no guest render of the event page reached the browser before the signed-in one",
  async ({ page }) => {
    const id = requested.get(page);
    if (!id) throw new Error("020 EARS-22: no cross-host request was made");
    const rendered = eventResponses(page, id).filter((r) => r.status() === 200);
    expect(rendered, "exactly one render of the event page").toHaveLength(1);
    expect(rendered[0]).toBe(recorded(page).at(-1));
  },
);

Given("a browser with no session on either storefront", async ({ page }) => {
  await page.context().clearCookies();
  for (const id of ["doctor", "academy"] as const) {
    expect(await hasSession(page, id)).toBe(false);
  }
});

When(
  "the browser requests an event page on academy.doctor.school as a document",
  async ({ page }) => {
    await openAsDocument(page, "academy");
  },
);

Then(
  "the event page renders as a guest with the participation path",
  async ({ page }) => {
    expect(await hasSession(page, "academy")).toBe(false);
    const cookies = await page.context().cookies(base("academy"));
    expect(
      cookies.some((c) => c.name === GUEST_MARKER_COOKIE),
      "the guest marker holds the next check back",
    ).toBe(true);
    await expect(page.getByText("Участвовать").first()).toBeVisible();
  },
);

Then(
  "no sign-in form is shown and no second redirect follows",
  async ({ page }) => {
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    const checks = recorded(page).filter(
      (r) =>
        new URL(r.url()).origin === origin("academy") && r.status() === 303,
    );
    // One check redirect and one callback answer — one round trip.
    expect(
      checks.filter((r) => new URL(r.url()).pathname === eventPath("academy")),
    ).toHaveLength(1);
    // The next navigation: the marker holds the check back.
    const again = await page.goto(`${base("academy")}${eventPath("academy")}`, {
      waitUntil: "load",
    });
    expect(again?.status()).toBe(200);
    expect(again?.request().redirectedFrom(), "no second check").toBeNull();
  },
);

// --- 020 EARS-18: the one-account journeys across the two storefronts ---------

/** The event a cross-host journey chose (its slug is the same on both hosts). */
const journeys = new WeakMap<Page, { slug: string }>();

function journeySlug(page: Page): string {
  const journey = journeys.get(page);
  if (!journey) throw new Error("020 EARS-18: no event was chosen");
  return journey.slug;
}

const pathOf = (id: HostId, slug: string) => `${HOSTS[id].eventsPath}/${slug}`;
/** Each storefront's public event read (its BFF `pagePath`). */
const READ_PATH: Readonly<Record<HostId, string>> = {
  academy: "/v1/public/events",
  doctor: "/v1/storefront/doctor/events",
};

/**
 * An upcoming published event both storefronts serve — hybrid when asked —
 * whose server-resolved CTA is still `register` for the browser's viewer on
 * `ctaHost` (a guest, or the doctor signed in there), so the journey can start
 * a registration whatever earlier runs left on the stand.
 */
async function chooseEvent(
  page: Page,
  hybrid: boolean,
  ctaHost: HostId,
): Promise<string> {
  const list = await page.request.get(
    `${base("academy")}${READ_PATH.academy}?timeframe=upcoming&limit=50`,
  );
  expect(list.status(), "the upcoming events read").toBe(200);
  const { data } = (await list.json()) as { data: { slug: string }[] };
  for (const { slug } of data) {
    const academy = await page.request.get(
      `${base("academy")}${READ_PATH.academy}/${slug}`,
    );
    if (academy.status() !== 200) continue;
    const event = (await academy.json()) as { state: string; format: string };
    if (event.state !== "published") continue;
    if (hybrid && event.format !== "hybrid") continue;
    const doctor = await page.request.get(
      `${base("doctor")}${READ_PATH.doctor}/${slug}`,
    );
    if (doctor.status() !== 200) continue;
    const participation = await page.request.get(
      `${base(ctaHost)}${READ_PATH[ctaHost]}/${slug}/participation`,
    );
    if (participation.status() !== 200) continue;
    const cta = (await participation.json()) as { action: string };
    if (cta.action === "register") return slug;
  }
  throw new Error(
    `020 EARS-18: no upcoming ${hybrid ? "hybrid " : ""}event served by both storefronts with a register CTA`,
  );
}

async function openEventAsDocument(
  page: Page,
  id: HostId,
  query = "",
): Promise<void> {
  recordDocuments(page);
  const path = pathOf(id, journeySlug(page));
  const response = await page.goto(`${base(id)}${path}${query}`, {
    waitUntil: "load",
  });
  expect(response?.status(), `the ${id} event page document`).toBe(200);
  await expect(page).toHaveURL(
    (url) => url.origin === origin(id) && url.pathname === path,
  );
}

/** Every document the browser received off the two storefronts was a redirect. */
function noSignInHostPageRendered(page: Page): void {
  const offStorefront = recorded(page).filter((r) => {
    const from = new URL(r.url()).origin;
    return from !== origin("academy") && from !== origin("doctor");
  });
  for (const response of offStorefront) {
    const status = response.status();
    expect(
      status >= 300 && status < 400,
      `${new URL(response.url()).origin} only redirected (no page, no form)`,
    ).toBe(true);
  }
}

Given("a doctor signed in on doctor.school", async ({ page }) => {
  await page.context().clearCookies();
  await signInGoldenDoctor(page, HOSTS.doctor, SEED, base("doctor"));
  expect(await hasSession(page, "doctor"), "signed in on doctor.school").toBe(
    true,
  );
  journeys.set(page, { slug: await chooseEvent(page, false, "doctor") });
});

When(
  "the doctor opens the same event on academy.doctor.school",
  async ({ page }) => {
    expect(
      await hasSession(page, "academy"),
      "no academy.doctor.school session before the navigation",
    ).toBe(false);
    await openEventAsDocument(page, "academy");
  },
);

Then(
  "the doctor is already signed in through the one-account cross-host sign-in",
  async ({ page }) => {
    const first = recorded(page).find(
      (r) => new URL(r.url()).origin === origin("academy"),
    );
    expect(first?.status(), "the silent check answered first").toBe(303);
    const location = new URL(first!.headers()["location"] ?? "", first!.url());
    expect(location.searchParams.get("prompt")).toBe("none");
    expect(await hasSession(page, "academy")).toBe(true);
    expect(await sessionStatus(page), "the Academy session is live").toBe(200);
  },
);

Then("the doctor is never asked for a second sign-in", async ({ page }) => {
  noSignInHostPageRendered(page);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  const path = pathOf("academy", journeySlug(page));
  const rendered = recorded(page).filter((r) => {
    const url = new URL(r.url());
    return (
      url.origin === origin("academy") &&
      url.pathname === path &&
      r.status() === 200
    );
  });
  expect(rendered, "one render of the page, signed in").toHaveLength(1);
});

When(
  "the doctor starts a registration from academy.doctor.school",
  async ({ page }) => {
    // 005 EARS-4 — the signed-in doctor's one-tap command; the page swaps to
    // the registered state in place.
    await page.getByTestId("event-register-one-tap").click();
    await expect(page.getByText("Вы записаны").first()).toBeVisible();
  },
);

Then(
  "the return after registration lands on the academy.doctor.school page it started on",
  async ({ page }) => {
    const path = pathOf("academy", journeySlug(page));
    await expect(page).toHaveURL(
      (url) => url.origin === origin("academy") && url.pathname === path,
    );
    expect(await hasSession(page, "academy")).toBe(true);
    await page.reload({ waitUntil: "load" });
    await expect(page.getByText("Вы записаны").first()).toBeVisible();
  },
);

Then(
  "no link, string or navigation element on «#d-event» leads into the Academy backstage",
  async ({ page }) => {
    await openEventAsDocument(page, "doctor");
    // ADR-0015 §4: the shell's one recorded «Academy.Doctor.School ↗» entry
    // is the only Academy trace; the event page body leads nowhere into it.
    const main = page.getByRole("main");
    const hrefs = await main
      .locator("a[href]")
      .evaluateAll((links) =>
        links.map((link) => (link as HTMLAnchorElement).href),
      );
    expect(
      hrefs.filter((href) => new URL(href).origin === origin("academy")),
    ).toEqual([]);
    await expect(main.getByText(/academy\.doctor\.school/iu)).toHaveCount(0);
  },
);

Given(
  "a guest on the Academy event page of an upcoming hybrid event with the «онлайн» tab selected",
  async ({ page }) => {
    await page.context().clearCookies();
    await prepareCaptchaForJourney(
      page.context(),
      base("academy"),
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    journeys.set(page, { slug: await chooseEvent(page, true, "academy") });
    await openEventAsDocument(page, "academy", "?mode=online");
    await expect(page.getByTestId("event-format-tabs")).toHaveAttribute(
      "data-mode",
      "online",
    );
    expect(await hasSession(page, "academy"), "a guest").toBe(false);
  },
);

When("the guest activates «Участвовать»", async ({ page }) => {
  recordDocuments(page);
  await page
    .getByRole("main")
    .getByRole("link", { name: "Участвовать", exact: true })
    .first()
    .click();
});

Then(
  "the Academy renders no form and the browser reaches the sign-in host's registration form",
  async ({ page }) => {
    await page.waitForURL(
      (url) =>
        url.origin !== origin("academy") && url.origin !== origin("doctor"),
    );
    await expect(page.getByTestId("register-submit")).toBeVisible();
    // The storefront's door only redirected: no Academy page rendered a form.
    for (const response of recorded(page).filter(
      (r) => new URL(r.url()).origin === origin("academy"),
    )) {
      expect(response.status(), response.url()).toBe(303);
    }
  },
);

When(
  "the guest completes the registration and its code step there",
  async ({ page }) => {
    const account: OwnedCredentials = {
      email: `cross-host-3173-${randomUUID()}@example.test`,
      password: `Cross-${randomUUID()}-aA1!`,
    };
    const { code } = await submitOwnedRegistration(
      page,
      base("academy"),
      account,
    );
    await inputSecret(
      page.locator('input[autocomplete="one-time-code"]'),
      code,
    );
  },
);

Then(
  "the browser lands on the same Academy event page with the «онлайн» tab, signed in",
  async ({ page }) => {
    const path = pathOf("academy", journeySlug(page));
    await page.waitForURL(
      (url) =>
        url.origin === origin("academy") &&
        url.pathname === path &&
        url.searchParams.get("mode") === "online",
    );
    expect(await hasSession(page, "academy")).toBe(true);
    await expect(page.getByTestId("event-format-tabs")).toHaveAttribute(
      "data-mode",
      "online",
    );
  },
);

Then(
  "the doctor storefront's event page for the same event also renders signed in on its next document request",
  async ({ page }) => {
    expect(
      await hasSession(page, "doctor"),
      "no doctor.school session before the request",
    ).toBe(false);
    await openEventAsDocument(page, "doctor");
    const first = recorded(page).find(
      (r) => new URL(r.url()).origin === origin("doctor"),
    );
    expect(first?.status(), "the doctor storefront's silent check").toBe(303);
    expect(await hasSession(page, "doctor")).toBe(true);
    noSignInHostPageRendered(page);
  },
);

// --- 003 EARS-63: the silent check, as the 003 scenarios state it -------------

const CHECK_GUARD_COOKIE = "__Host-ds_check";
const CALLBACK_PATH = "/auth/callback";

/** The Academy document responses whose path is the storefront callback. */
function academyCallbacks(page: Page): Response[] {
  return recorded(page).filter((r) => {
    const url = new URL(r.url());
    return url.origin === origin("academy") && url.pathname === CALLBACK_PATH;
  });
}

/** The cookie names one response sets (`Set-Cookie`, every header line). */
async function cookiesSetBy(response: Response): Promise<string[]> {
  return (await response.headersArray())
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .flatMap((h) => h.value.split("\n"))
    .map((line) => line.split("=")[0]!.trim());
}

/** The first Academy answer is the check's `303` into a `prompt=none` authorize. */
function expectSilentCheckFirst(page: Page): Response {
  const first = recorded(page).find(
    (r) => new URL(r.url()).origin === origin("academy"),
  );
  expect(first, "a document response from the Academy").toBeDefined();
  expect(first!.status(), "the check redirect").toBe(303);
  expect(first!.headers()["cache-control"]).toBe("no-store");
  const location = new URL(first!.headers()["location"] ?? "", first!.url());
  expect(location.searchParams.get("prompt"), "a silent authorize").toBe(
    "none",
  );
  return first!;
}

Given(
  "a doctor signed in on the doctor storefront in this browser",
  async ({ page }) => {
    await page.context().clearCookies();
    await signInGoldenDoctor(page, HOSTS.doctor, SEED, base("doctor"));
    expect(await hasSession(page, "doctor"), "signed in on doctor.school").toBe(
      true,
    );
  },
);

When(
  "the doctor's browser requests an Academy event page as a document",
  async ({ page }) => {
    expect(
      await hasSession(page, "academy"),
      "no Academy session before the navigation",
    ).toBe(false);
    requested.set(page, "academy");
    await openAsDocument(page, "academy");
  },
);

Then(
  "the first Academy response is a redirect into a silent transaction with prompt=none",
  async ({ page }) => {
    expectSilentCheckFirst(page);
  },
);

Then(
  "the sign-in host finalises it with the shared session and shows no form",
  async ({ page }) => {
    noSignInHostPageRendered(page);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  },
);

Then(
  "the Academy callback mints a session and the event page renders signed in",
  async ({ page }) => {
    const callbacks = academyCallbacks(page);
    expect(callbacks, "one Academy callback").toHaveLength(1);
    expect(callbacks[0]!.status()).toBe(303);
    expect(new URL(callbacks[0]!.url()).searchParams.has("code")).toBe(true);
    expect(await cookiesSetBy(callbacks[0]!)).toContain(SESSION_COOKIE);
    expect(await hasSession(page, "academy")).toBe(true);
    expect(await sessionStatus(page), "the Academy session is live").toBe(200);
    const last = recorded(page).at(-1)!;
    expect(new URL(last.url()).pathname).toBe(eventPath("academy"));
  },
);

Then(
  "no guest render of the page reaches the browser before the signed-in one",
  async ({ page }) => {
    const rendered = eventResponses(page, "academy").filter(
      (r) => r.status() === 200,
    );
    expect(rendered, "exactly one render of the event page").toHaveLength(1);
    expect(rendered[0]).toBe(recorded(page).at(-1));
  },
);

When("the browser requests an Academy page as a document", async ({ page }) => {
  await openAsDocument(page, "academy");
});

Then(
  "the silent check ends in login_required and the page renders as a guest",
  async ({ page }) => {
    expectSilentCheckFirst(page);
    const callbacks = academyCallbacks(page);
    expect(callbacks, "one Academy callback").toHaveLength(1);
    expect(
      new URL(callbacks[0]!.url()).searchParams.get("error"),
      "the sign-in host found no shared session",
    ).toBe("login_required");
    expect(await hasSession(page, "academy")).toBe(false);
    expect(await sessionStatus(page), "a guest").toBe(401);
    await expect(page.getByTestId("shell-login")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  },
);

Then(
  "the signed __Host-ds_guest marker and the one-shot __Host-ds_check guard are set",
  async ({ page }) => {
    const [callback] = academyCallbacks(page);
    const set = await cookiesSetBy(callback!);
    expect(set, "the callback sets the marker").toContain(GUEST_MARKER_COOKIE);
    expect(set, "the callback sets the loop guard").toContain(
      CHECK_GUARD_COOKIE,
    );
    const cookies = await page.context().cookies(base("academy"));
    const marker = cookies.find((c) => c.name === GUEST_MARKER_COOKIE);
    expect(marker, "the marker is held").toBeDefined();
    expect(marker!.value, "issue time and HMAC").not.toBe("");
    expect(marker).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
    });
    // One-shot: the page request that followed the callback consumed it.
    expect(
      cookies.some((c) => c.name === CHECK_GUARD_COOKIE),
      "the guard is consumed by the first document request carrying it",
    ).toBe(false);
  },
);

When(
  "the browser requests another Academy page as a document",
  async ({ page }) => {
    recordDocuments(page);
    const response = await page.goto(
      `${base("academy")}${HOSTS.academy.eventsPath}`,
      { waitUntil: "load" },
    );
    expect(response?.status()).toBe(200);
  },
);

Then(
  "no silent check starts and the page renders as a guest",
  async ({ page }) => {
    expect(
      recorded(page).map((r) => [new URL(r.url()).origin, r.status()]),
      "the page is served directly, no check redirect",
    ).toEqual([[origin("academy"), 200]]);
    expect(await hasSession(page, "academy")).toBe(false);
    await expect(page.getByTestId("shell-login")).toBeVisible();
  },
);

/** The answers the exempt-request step collected, by label. */
const exemptAnswers = new WeakMap<Page, Map<string, number>>();
/** The Academy's answer to the document request after the bucket ran out. */
const limitedAnswer = new WeakMap<
  Page,
  { status: number; location: string | undefined; body: string }
>();

Given("a browser with no Academy session", async ({ page }) => {
  await page.context().clearCookies();
  expect(await hasSession(page, "academy")).toBe(false);
});

When(
  /^the Academy receives a crawler request, a request without fetch metadata, a prefetch, a POST, a "\/v1" call, a static asset, a "\.well-known" file and the health route$/,
  async ({ page }) => {
    const academy = base("academy");
    const nav = TOP_LEVEL_NAVIGATION_HEADERS;
    const get = (path: string, headers: Record<string, string> = {}) =>
      page.request.get(`${academy}${path}`, { maxRedirects: 0, headers });
    const probes: readonly [string, () => Promise<APIResponse>][] = [
      [
        "crawler",
        () =>
          get("/", {
            ...nav,
            "user-agent":
              "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
          }),
      ],
      ["no fetch metadata", () => get("/")],
      ["prefetch", () => get("/", { ...nav, "sec-purpose": "prefetch" })],
      [
        "POST",
        () =>
          page.request.post(`${academy}/`, { maxRedirects: 0, headers: nav }),
      ],
      ["/v1 call", () => get("/v1/public/events?limit=1", nav)],
      ["static asset", () => get("/favicon.ico", nav)],
      [".well-known file", () => get("/.well-known/security.txt", nav)],
      ["health route", () => get("/healthz", nav)],
    ];
    const answers = new Map<string, number>();
    for (const [label, probe] of probes) {
      // Each probe is its own first visit: no marker, guard or transaction.
      await page.context().clearCookies();
      answers.set(label, (await probe()).status());
    }
    exemptAnswers.set(page, answers);
  },
);

Then("none of them is answered with a redirect", async ({ page }) => {
  const answers = exemptAnswers.get(page);
  if (!answers) throw new Error("003 EARS-63: no exempt request was made");
  for (const [label, status] of answers) {
    expect(status >= 300 && status < 400, `${label} answered ${status}`).toBe(
      false,
    );
  }
});

When(
  "the silent-check bucket for the client address is exhausted and a document request arrives",
  async ({ page }) => {
    // 1200 starts per 15 minutes per IP (EARS-63 (f)). Every request is a
    // first visit — a held silent transaction suppresses the check and counts
    // nothing — so the jar is cleared before each one; the first answer that
    // is not the check's redirect is the limited start.
    const SILENT_CHECK_LIMIT = 1200;
    for (let start = 0; start <= SILENT_CHECK_LIMIT; start++) {
      await page.context().clearCookies();
      const res = await page.request.get(`${base("academy")}/`, {
        maxRedirects: 0,
        headers: TOP_LEVEL_NAVIGATION_HEADERS,
      });
      if (res.status() === 303) continue;
      limitedAnswer.set(page, {
        status: res.status(),
        location: res.headers()["location"],
        body: await res.text(),
      });
      return;
    }
    throw new Error(
      `003 EARS-63: ${SILENT_CHECK_LIMIT + 1} silent-check starts were all redirected`,
    );
  },
);

Then(
  "the Academy answers HTTP 200 with the guest render and no redirect",
  async ({ page }) => {
    const answer = limitedAnswer.get(page);
    if (!answer) throw new Error("003 EARS-63: the bucket was not exhausted");
    expect(answer.status, "the limited start renders the page").toBe(200);
    expect(answer.location, "no redirect").toBeUndefined();
    expect(answer.body, "the guest shell").toContain(
      'data-testid="shell-login"',
    );
  },
);

/** The interactive transaction id the abandoned form left in the Academy jar. */
const abandonedTx = new WeakMap<Page, string>();

async function academyTx(page: Page): Promise<string | undefined> {
  const cookies = await page.context().cookies(base("academy"));
  return cookies.find((c) => c.name === OIDC_TX_COOKIE)?.value;
}

Given(
  "a guest started the Academy sign-in entry and left the sign-in host form unfinished",
  async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`${base("academy")}/login`, { waitUntil: "load" });
    await page.waitForURL((url) => isSignInHostForm(url));
    const tx = await academyTx(page);
    expect(tx, "the entry minted an interactive transaction").toBeDefined();
    abandonedTx.set(page, tx!);
  },
);

Given(
  "the same person then signed in on the doctor storefront in another tab",
  async ({ page }) => {
    const tab = await page.context().newPage();
    await signInGoldenDoctor(tab, HOSTS.doctor, SEED, base("doctor"));
    expect(await hasSession(tab, "doctor"), "signed in on doctor.school").toBe(
      true,
    );
    await tab.close();
    expect(
      await academyTx(page),
      "the abandoned Academy transaction is still held",
    ).toBe(abandonedTx.get(page));
  },
);

When("the guest requests an Academy page as a document", async ({ page }) => {
  await openAsDocument(page, "academy");
});

Then(
  "the silent check starts and replaces the abandoned interactive transaction",
  async ({ page }) => {
    // The abandoned interactive transaction did not hold the check back: the
    // check answered first and its cookie names a NEW (silent) transaction.
    const check = expectSilentCheckFirst(page);
    const silentTx = (await check.headersArray())
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .flatMap((h) => h.value.split("\n"))
      .find((line) => line.startsWith(`${OIDC_TX_COOKIE}=`))
      ?.split(";")[0]!
      .slice(OIDC_TX_COOKIE.length + 1);
    expect(silentTx, "the check names its own silent transaction").toBeTruthy();
    expect(silentTx, "a fresh transaction, not the abandoned one").not.toBe(
      abandonedTx.get(page),
    );
  },
);

Then("the Academy page renders signed in", async ({ page }) => {
  expect(await hasSession(page, "academy")).toBe(true);
  expect(await sessionStatus(page), "the Academy session is live").toBe(200);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  const last = recorded(page).at(-1)!;
  expect(last.status()).toBe(200);
  expect(new URL(last.url()).pathname).toBe(eventPath("academy"));
});
