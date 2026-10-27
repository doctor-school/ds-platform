import { expect, type BrowserContext, type Page } from "@playwright/test";

import { isSignInHostForm } from "./sign-in-host-api.js";

/**
 * #3172 — the return path of a sign-in journey no longer rides the form URL:
 * the storefront entry (`GET <storefront>/{login,register,reset,verify}`)
 * hands it to the API transaction and answers a `303` to the IdP, which lands
 * the browser on the sign-in host's form carrying only `authRequest`. A step
 * that used to read `returnTo` off the form URL now proves two things instead:
 *
 *   1. the ENTRY CHAIN — the document navigation that brought the page to the
 *      form entered through the storefront's own entry with that `returnTo`
 *      ({@link expectEnteredThrough});
 *   2. the LANDING — where the journey completes, the page ends on the
 *      storefront at that path (asserted by the step that completes it).
 *
 * The watcher is installed on the browser context BEFORE the page navigates
 * ({@link watchStorefrontEntries}); it records, per page, the last top-level
 * navigation into a storefront entry. A context-level listener covers every
 * page the context opens later.
 */

export interface StorefrontEntry {
  readonly origin: string;
  readonly pathname: string;
  readonly returnTo: string | null;
  readonly url: string;
}

const ENTRY_PATH = /^\/(login|register|reset|verify)$/;

const lastEntry = new WeakMap<Page, StorefrontEntry>();
const watched = new WeakMap<BrowserContext, Set<string>>();

/** Record every top-level navigation into an entry of the storefront `base`. */
export function watchStorefrontEntries(
  target: Page | BrowserContext,
  base: string,
): void {
  const context = "context" in target ? target.context() : target;
  const origin = new URL(base).origin;
  const origins = watched.get(context) ?? new Set<string>();
  if (origins.has(origin)) return;
  origins.add(origin);
  watched.set(context, origins);
  context.on("request", (req) => {
    if (!req.isNavigationRequest()) return;
    if (req.frame().parentFrame()) return;
    const url = new URL(req.url());
    if (url.origin !== origin || !ENTRY_PATH.test(url.pathname)) return;
    lastEntry.set(req.frame().page(), {
      origin: url.origin,
      pathname: url.pathname,
      returnTo: url.searchParams.get("returnTo"),
      url: url.toString(),
    });
  });
}

/** The last storefront entry the page navigated through, if any. */
export function lastStorefrontEntry(page: Page): StorefrontEntry | undefined {
  return lastEntry.get(page);
}

/**
 * The page's last navigation entered through the storefront `base`'s own
 * entry, carrying `returnTo` (and, when named, at `pathname`).
 */
export function expectEnteredThrough(
  page: Page,
  base: string,
  expected: { returnTo: string | null; pathname?: string; method?: string },
): void {
  const entry = lastEntry.get(page);
  expect(
    entry?.origin,
    "the page entered the sign-in host through the storefront's own entry (watchStorefrontEntries installed before the navigation)",
  ).toBe(new URL(base).origin);
  if (expected.pathname !== undefined)
    expect(entry?.pathname, "the storefront entry").toBe(expected.pathname);
  expect(entry?.returnTo ?? null, "the return path the entry carried").toBe(
    expected.returnTo,
  );
  if (expected.method !== undefined)
    expect(
      entry ? new URL(entry.url).searchParams.get("method") : null,
      "the sign-in method the entry carried",
    ).toBe(expected.method);
}

/**
 * A guest's code step for `email` on the sign-in host (#3172). The storefront
 * `/verify` is the REGISTRATION entry and carries no address (003 EARS-61): it
 * lands on the host's registration door. The host's own `/verify` names its
 * door itself (`doorFor`) and reads the address from its query — the route a
 * reload of the in-place code step enters (003 EARS-24) — so it is opened on
 * the same auth request. `returnTo` rides the
 * storefront entry into the transaction.
 */
export async function openHostCodeStep(
  page: Page,
  base: string,
  email: string,
  returnTo?: string,
): Promise<void> {
  watchStorefrontEntries(page, base);
  const entry = new URL("/verify", base);
  if (returnTo !== undefined) entry.searchParams.set("returnTo", returnTo);
  await page.goto(entry.toString(), { waitUntil: "load" });
  await page.waitForURL((url) => isSignInHostForm(url));
  expectEnteredThrough(page, base, {
    pathname: "/verify",
    returnTo: returnTo ?? null,
  });
  const step = new URL(page.url());
  step.pathname = "/verify";
  step.searchParams.set("email", email);
  await page.goto(step.toString(), { waitUntil: "load" });
}

/**
 * A guest bounced off a gated storefront address (or sent into a door) ends on
 * the sign-in host's form, having entered through the storefront `base`'s own
 * entry with `expected.returnTo` — the replacement for reading `returnTo` off
 * the form URL. {@link watchStorefrontEntries} must be installed before the
 * navigation that bounces.
 */
export async function expectAtSignInHostFrom(
  page: Page,
  base: string,
  expected: { returnTo: string | null; pathname?: string; method?: string },
): Promise<void> {
  await page.waitForURL((url) => isSignInHostForm(url));
  expectEnteredThrough(page, base, expected);
}
