import { golden } from "@ds/db/seed/golden";
import { expect, type Page, type Request } from "@playwright/test";

import { HOSTS, baseUrlFor, type HostId } from "../hosts.js";
import { waitForClientReady } from "../lib/page-ready.js";
import { signInGoldenDoctor } from "../lib/sign-in.js";
import { isSignInHostForm } from "../lib/sign-in-host-api.js";
import { STOREFRONT_SIGN_OUT_PATH } from "../lib/storefront-sign-out.js";
import { Given, Then, When } from "./support/fixtures.js";

/**
 * 003 EARS-73 / EARS-74 (production amendment 2026-11-05, #3748, implementation
 * #3749) — a signed-in storefront tab that is returned to re-checks its
 * session, and the signed-in links into the cabinet navigate by document.
 *
 * `@host:both`: each scenario runs in both storefront projects; the two
 * storefronts it crosses are the outline's own, addressed through `baseUrlFor`,
 * so a run drives the two storefronts of the same slot (the pattern of
 * `event-page-cross-host.steps.ts`). One browser = one context: the fixture
 * `page` is the tab the doctor signs out in, a second page of the same context
 * is the other storefront's tab.
 *
 * HIDE / SHOW MECHANISM (named per the brief): `page.evaluate` overrides
 * `document.visibilityState` / `document.hidden` on the watched tab and
 * dispatches `visibilitychange`. Bringing another page to front does not change
 * visibility in a headless browser, so it cannot make a tab hidden on a slot;
 * the override drives exactly the event the shell's re-check listens to.
 *
 * Every assertion reads the REQUEST SEQUENCE (documents, `_rsc` fetches,
 * session reads), never frames.
 */

const SEED = "verified-cardiologist";
const SESSION_COOKIE = "__Host-ds_session";
const SESSION_READ_PATH = "/v1/auth/session";

/** The outline names the storefronts «Academy» / «doctor». */
function storefront(name: string): HostId {
  if (name === "Academy") return "academy";
  if (name === "doctor") return "doctor";
  throw new Error(`003 EARS-73: unknown storefront "${name}"`);
}

const base = (id: HostId) => baseUrlFor(HOSTS[id]);
const origin = (id: HostId) => new URL(base(id)).origin;
const eventPath = (id: HostId) =>
  `${HOSTS[id].eventsPath}/${golden.events.upcoming.slug}`;

/** `an эфир page` → the golden event page; `"/account"` → that path. */
function pathFor(id: HostId, raw: string): string {
  if (raw === "an эфир page") return eventPath(id);
  const quoted = /^"(\/[^"]*)"$/.exec(raw);
  if (!quoted) throw new Error(`003 EARS-73: unknown path ${raw}`);
  return quoted[1]!;
}

interface WatchedTab {
  tab: Page;
  id: HostId;
  path: string;
  /** Every request of the tab, in issue order, since it was opened. */
  requests: Request[];
  /** `requests.length` at the moment the tab became visible again. */
  returnedAt: number;
}

/** The fixture page → the tab the scenario watches (the other storefront's). */
const watched = new WeakMap<Page, WatchedTab>();

function watchedTab(page: Page): WatchedTab {
  const w = watched.get(page);
  if (!w) throw new Error("003 EARS-73: no watched tab was opened");
  return w;
}

function record(tab: Page): Request[] {
  const seen: Request[] = [];
  tab.on("request", (request) => seen.push(request));
  return seen;
}

async function hasSession(page: Page, id: HostId): Promise<boolean> {
  const cookies = await page.context().cookies(base(id));
  return cookies.some((c) => c.name === SESSION_COOKIE);
}

/** One doctor, both storefronts, one browser: sign in on the doctor storefront,
 *  then the Academy's silent check signs it in from the shared sign-in host
 *  session (020 EARS-18 / 003 EARS-63). */
async function signInOnBoth(page: Page): Promise<void> {
  await page.context().clearCookies();
  await signInGoldenDoctor(page, HOSTS.doctor, SEED, base("doctor"));
  await page.goto(`${base("academy")}${eventPath("academy")}`, {
    waitUntil: "load",
  });
  for (const id of ["doctor", "academy"] as const) {
    expect(await hasSession(page, id), `signed in on ${id}`).toBe(true);
  }
}

async function openTab(
  page: Page,
  id: HostId,
  path: string,
  tab?: Page,
): Promise<WatchedTab> {
  const target = tab ?? (await page.context().newPage());
  const requests = record(target);
  const response = await target.goto(`${base(id)}${path}`, {
    waitUntil: "load",
  });
  expect(response?.status(), `${path} renders`).toBe(200);
  await waitForClientReady(target);
  await expect(
    target.getByTestId("shell-auth-cluster"),
    "the tab renders signed in",
  ).toHaveAttribute("data-cluster", "doctor");
  const w: WatchedTab = { tab: target, id, path, requests, returnedAt: 0 };
  watched.set(page, w);
  return w;
}

/** The hide / show mechanism named in the header. */
async function setVisibility(
  tab: Page,
  state: "hidden" | "visible",
): Promise<void> {
  await tab.evaluate((next) => {
    const w = window as unknown as { __dsVisibility?: string };
    if (w.__dsVisibility === undefined) {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => w.__dsVisibility,
      });
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => w.__dsVisibility === "hidden",
      });
    }
    w.__dsVisibility = next;
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

async function becomeVisible(w: WatchedTab): Promise<void> {
  w.returnedAt = w.requests.length;
  await setVisibility(w.tab, "visible");
}

/** The storefront «Выйти» on the account page (003 EARS-10 amended). */
async function signOutOn(page: Page, id: HostId): Promise<void> {
  await page.goto(`${base(id)}/account`, { waitUntil: "load" });
  await waitForClientReady(page);
  const signedOut = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === STOREFRONT_SIGN_OUT_PATH &&
      response.request().method() === "POST",
  );
  await page.getByTestId("logout").click();
  expect((await signedOut).status(), "sign-out succeeded").toBe(200);
}

const sinceReturn = (w: WatchedTab) => w.requests.slice(w.returnedAt);

const isSessionRead = (w: WatchedTab) => (r: Request) => {
  const url = new URL(r.url());
  return url.origin === origin(w.id) && url.pathname === SESSION_READ_PATH;
};

const isDocument = (w: WatchedTab) => (r: Request) =>
  r.resourceType() === "document" && r.frame() === w.tab.mainFrame();

/** Exactly one read for this return, and it stays one. */
async function expectOneRead(w: WatchedTab): Promise<void> {
  await expect
    .poll(() => sinceReturn(w).filter(isSessionRead(w)).length, {
      message: "one session read for the return",
    })
    .toBe(1);
  // The answer may be acted on (refresh / bounce); no second read follows.
  await w.tab.waitForTimeout(1_500);
  expect(
    w.requests.slice(w.returnedAt).filter(isSessionRead(w)).length,
    "no second read for the same return",
  ).toBe(1);
}

// ── @return-recheck-signed-out ────────────────────────────────────────────

Given(
  "a doctor signed in on the Academy and on the doctor storefront in one browser",
  async ({ page }) => signInOnBoth(page),
);

Given(
  "the {word} storefront's tab on {} is open and hidden",
  async ({ page }, name: string, rawPath: string) => {
    const id = storefront(name);
    const w = await openTab(page, id, pathFor(id, rawPath));
    await setVisibility(w.tab, "hidden");
  },
);

When(
  "the doctor signs out on the {word} storefront",
  async ({ page }, name: string) => {
    await signOutOn(page, storefront(name));
    // The hidden tab was not touched: it still shows its signed-in render.
    await expect(
      watchedTab(page).tab.getByTestId("shell-auth-cluster"),
    ).toHaveAttribute("data-cluster", "doctor");
  },
);

When(
  "the {word} storefront's tab becomes visible again",
  async ({ page }, name: string) => {
    const w = watchedTab(page);
    expect(w.id).toBe(storefront(name));
    await becomeVisible(w);
  },
);

Then("that tab makes exactly one session read", async ({ page }) => {
  await expectOneRead(watchedTab(page));
});

Then("without user action it shows {}", async ({ page }, outcome: string) => {
  const w = watchedTab(page);
  if (outcome === "that page's guest render") {
    await expect(w.tab.getByTestId("shell-auth-cluster")).toHaveAttribute(
      "data-cluster",
      "guest",
    );
    // In place: a router refresh, no document request and the same URL.
    expect(sinceReturn(w).filter(isDocument(w)), "no document load").toEqual(
      [],
    );
    expect(new URL(w.tab.url()).pathname).toBe(w.path);
    return;
  }
  const bounce =
    /^the sign-in host, by a document navigation(?:, returning to "([^"]+)")?$/.exec(
      outcome,
    );
  if (!bounce) throw new Error(`003 EARS-73: unknown outcome ${outcome}`);
  await expect(w.tab).toHaveURL((url) => isSignInHostForm(url));
  const entry = sinceReturn(w)
    .filter(isDocument(w))
    .find((r) => {
      const url = new URL(r.url());
      return url.origin === origin(w.id) && url.pathname === "/login";
    });
  expect(
    entry,
    "a document request to the storefront /login entry",
  ).toBeDefined();
  expect(new URL(entry!.url()).searchParams.get("returnTo")).toBe(
    bounce[1] ?? w.path,
  );
});

Then("no silent check runs", async ({ page }) => {
  const w = watchedTab(page);
  for (const request of sinceReturn(w).filter(isDocument(w))) {
    const response = await request.response();
    const location = response?.headers()["location"];
    if (!location) continue;
    expect(
      new URL(location, request.url()).searchParams.get("prompt"),
      `no silent authorize after ${request.url()}`,
    ).not.toBe("none");
  }
});

// ── @return-recheck-session-holds ─────────────────────────────────────────

Given(
  "a doctor signed in on the {word} storefront with its tab hidden",
  async ({ page }, name: string) => {
    const id = storefront(name);
    await page.context().clearCookies();
    await signInGoldenDoctor(page, HOSTS[id], SEED, base(id));
    const w = await openTab(page, id, eventPath(id), page);
    await setVisibility(w.tab, "hidden");
  },
);

When("the tab becomes visible again", async ({ page }) => {
  await becomeVisible(watchedTab(page));
});

Then("the page and its header are unchanged", async ({ page }) => {
  const w = watchedTab(page);
  await expect(w.tab.getByTestId("shell-auth-cluster")).toHaveAttribute(
    "data-cluster",
    "doctor",
  );
  expect(new URL(w.tab.url()).pathname).toBe(w.path);
  const rerenders = sinceReturn(w).filter(
    (r) => isDocument(w)(r) || new URL(r.url()).searchParams.has("_rsc"),
  );
  expect(rerenders, "no reload and no router refresh").toEqual([]);
});

When("the tab stays visible for a minute", async ({ page, $testInfo }) => {
  $testInfo.setTimeout($testInfo.timeout + 70_000);
  await watchedTab(page).tab.waitForTimeout(60_000);
});

Then("no further session read is made", async ({ page }) => {
  const w = watchedTab(page);
  expect(sinceReturn(w).filter(isSessionRead(w)), "no polling").toHaveLength(1);
});

// ── @cabinet-chip-document ────────────────────────────────────────────────

Given(
  "a doctor signed in on both storefronts in one browser",
  async ({ page }) => signInOnBoth(page),
);

Given(
  "the {word} storefront's tab still shows its signed-in render after a sign-out on the {word} storefront",
  async ({ page }, otherName: string, signingOutName: string) => {
    const id = storefront(otherName);
    const w = await openTab(page, id, eventPath(id));
    await signOutOn(page, storefront(signingOutName));
    // No visibility change reached the tab: no re-check has run.
    await expect(w.tab.getByTestId("shell-auth-cluster")).toHaveAttribute(
      "data-cluster",
      "doctor",
    );
    w.returnedAt = w.requests.length;
  },
);

When(
  "the doctor activates {} in that tab before any re-check",
  async ({ page }, link: string) => {
    const w = watchedTab(page);
    if (link === "the profile chip") {
      await w.tab.getByTestId("shell-avatar").click();
    } else if (link === "«Мои события» in the header") {
      await w.tab.getByTestId("shell-auth-link").click();
    } else if (link === "«Мои события» in the mobile menu") {
      await w.tab.setViewportSize({ width: 390, height: 844 });
      await w.tab.getByTestId("shell-mobile-menu").locator("summary").click();
      await w.tab.getByTestId("shell-auth-link-mobile").click();
    } else {
      throw new Error(`003 EARS-74: unknown link ${link}`);
    }
  },
);

Then(
  'the request sequence shows a document navigation to {string} and no "_rsc" fetch of {string}',
  async ({ page }, target: string, sameTarget: string) => {
    const w = watchedTab(page);
    expect(sameTarget).toBe(target);
    await expect
      .poll(() =>
        sinceReturn(w).some((r) => {
          const url = new URL(r.url());
          return (
            isDocument(w)(r) &&
            url.origin === origin(w.id) &&
            url.pathname === target
          );
        }),
      )
      .toBe(true);
    const rsc = sinceReturn(w).filter((r) => {
      const url = new URL(r.url());
      return (
        url.pathname === target &&
        (url.searchParams.has("_rsc") || r.headers()["rsc"] === "1")
      );
    });
    expect(rsc, `no router fetch of ${target}`).toEqual([]);
  },
);

Then("the sign-in host renders", async ({ page }) => {
  await expect(watchedTab(page).tab).toHaveURL((url) => isSignInHostForm(url));
});
