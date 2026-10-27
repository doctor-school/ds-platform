import { expect, type APIRequestContext } from "@playwright/test";

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
