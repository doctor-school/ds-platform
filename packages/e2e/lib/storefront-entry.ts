import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * 003 EARS-61 (#3172) — the storefront entry's answer as a backend-free tier
 * sees it: a `303` to the authorize URL the API's internal transaction
 * endpoint built, `Cache-Control: no-store`, and the host-only interactive
 * transaction cookie `__Host-ds_oidc_tx` (HttpOnly, Secure, SameSite=Lax,
 * 60 minutes). The tiers boot `packages/e2e/doubles/storefront-internal-api.mjs`
 * as that endpoint; `transactionsUrl` is its `/__transactions` read, so the
 * spec also pins what the entry ASKED for (door, return path, intent).
 */
export const OIDC_TX_COOKIE = "__Host-ds_oidc_tx";

/**
 * The fetch metadata a browser sends on a top-level document navigation. The
 * entry acts only on such a request (`isTopLevelNavigation`, 003 EARS-61): a
 * router prefetch or any other fetch gets a `204` that mints nothing. A request
 * context addresses the entry AS a navigation by sending these headers.
 */
export const TOP_LEVEL_NAVIGATION_HEADERS: Readonly<Record<string, string>> = {
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
};

export interface StorefrontEntryExpectation {
  /** The transaction body the entry must send, as a partial match. */
  readonly transaction: Readonly<Record<string, unknown>>;
}

export async function expectStorefrontEntry(
  request: APIRequestContext,
  path: string,
  transactionsUrl: string,
  expected: StorefrontEntryExpectation,
): Promise<URL> {
  const res = await request.get(path, {
    maxRedirects: 0,
    headers: TOP_LEVEL_NAVIGATION_HEADERS,
  });
  expect(res.status(), `${path} answers a 303`).toBe(303);
  expect(res.headers()["cache-control"], `${path} is no-store`).toBe(
    "no-store",
  );
  const location = new URL(res.headers()["location"] ?? "");
  expect(
    location.searchParams.get("state"),
    `${path} names its transaction`,
  ).toMatch(/^tx-\d+$/);

  const cookie = res
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value)
    .find((v) => v.startsWith(`${OIDC_TX_COOKIE}=`));
  expect(cookie, `${path} sets ${OIDC_TX_COOKIE}`).toBeDefined();
  const attrs = (cookie ?? "").split(";").map((a) => a.trim().toLowerCase());
  expect(attrs[0]).toBe(
    `${OIDC_TX_COOKIE}=${location.searchParams.get("state")}`.toLowerCase(),
  );
  expect(attrs).toEqual(
    expect.arrayContaining([
      "path=/",
      "httponly",
      "secure",
      "samesite=lax",
      "max-age=3600",
    ]),
  );
  expect(attrs.some((a) => a.startsWith("domain="))).toBe(false);

  // The double numbers its transactions `tx-<n>`; read this entry's own one
  // (parallel workers share the double).
  const n = Number(location.searchParams.get("state")?.slice(3));
  const all = (await (await request.get(transactionsUrl)).json()) as unknown[];
  expect(all[n - 1], `${path} sent its transaction`).toMatchObject(
    expected.transaction,
  );
  return location;
}

/**
 * 003 EARS-72 (#3379) — a refused storefront entry, as a backend-free tier
 * sees it: the shared double refuses a transaction naming `refuse-429`,
 * `refuse-429-bare` or `refuse-503`, and the door answers the storefront's
 * refusal page at that status, the address left on the door URL.
 */
export const REFUSED_ENTRIES = {
  /** Event page origin: the way out goes back to the эфир. */
  rateLimitedFromEvent: "/login?returnTo=%2Fwebinars%2Frefuse-429",
  rateLimitedBare: "/login?returnTo=%2Faccount%2Frefuse-429-bare",
  unavailable: "/register?returnTo=%2Faccount%2Frefuse-503",
} as const;

/** The stage fixture runs the real storefront with an unreachable transaction dependency. */
export function stageEntryUnavailableOrigin(
  storefront: "academy" | "doctor",
  baseUrl: string | undefined,
  loopback?: string,
): string | undefined {
  const base = baseUrl && URL.parse(baseUrl);
  if (
    !base ||
    base.protocol !== "https:" ||
    base.port ||
    base.origin !== baseUrl?.replace(/\/$/, "")
  ) {
    return undefined;
  }
  const stage = new RegExp(
    `^${storefront}-(main|pr-[1-9]\\d{0,9})\\.[a-z0-9.-]+$`,
  ).exec(base.hostname);
  if (!stage) return undefined;
  if (!loopback) {
    return base.origin.replace(
      `https://${storefront}-`,
      `https://${storefront}-entry-unavailable-`,
    );
  }
  const tunnel = URL.parse(loopback);
  if (
    stage[1] === "main" ||
    !tunnel ||
    tunnel.protocol !== "http:" ||
    tunnel.hostname !== "127.0.0.1" ||
    !tunnel.port ||
    tunnel.origin !== loopback.replace(/\/$/, "")
  ) {
    throw new Error(
      "The entry refusal fixture tunnel requires a PR slot and a plain IPv4 loopback origin",
    );
  }
  return tunnel.origin;
}

export async function expectUnavailableStorefrontEntry(
  page: Page,
  origin: string,
  copy: {
    retry: string;
    home: string;
    variants: { unavailable: readonly { title: string }[] };
  },
): Promise<void> {
  const door = new URL("/login?returnTo=%2Faccount", origin).href;
  const answer = await page.goto(door);
  expect(answer?.status()).toBe(503);
  expect(answer?.headers()["retry-after"]).toBeUndefined();
  expect(answer?.headers()["location"]).toBeUndefined();
  await expect(page).toHaveURL(door);

  const main = page.getByRole("main");
  const heading = main.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  expect(copy.variants.unavailable.map(({ title }) => title)).toContain(
    await heading.textContent(),
  );
  await expect(main.locator("form")).toHaveCount(0);
  await expect(page.getByRole("banner").first()).toBeVisible();

  const retry = main.getByRole("button", { name: copy.retry, exact: true });
  await expect(retry).toBeEnabled();
  const [again] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().isNavigationRequest() && response.url() === door,
    ),
    retry.click(),
  ]);
  expect(again.status()).toBe(503);
  await expect(page).toHaveURL(door);

  const wayOut = main.getByRole("link", { name: copy.home, exact: true });
  await expect(wayOut).toHaveAttribute("href", "/");
  await wayOut.click();
  await expect(page).toHaveURL(new URL("/", origin).href);
}
