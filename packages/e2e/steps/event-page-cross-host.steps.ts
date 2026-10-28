import { golden } from "@ds/db/seed/golden";
import { expect, type Page, type Response } from "@playwright/test";

import { HOSTS, baseUrlFor, type HostId } from "../hosts.js";
import { signInGoldenDoctor } from "../lib/sign-in.js";
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
    const session = await page.request.get(`${base(id)}/v1/auth/session`);
    expect(session.status(), "the storefront session is live").toBe(200);
    // No credential step ran: nothing was typed, and no sign-in-host page
    // stopped the chain — the last document is the event page itself.
    const last = recorded(page).at(-1);
    expect(new URL(last!.url()).origin).toBe(origin(id));
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  },
);

Then(
  "no guest render of the event page reached the browser before the signed-in one",
  async ({ page }, hostName: string) => {
    const id = hostNamed(hostName);
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
