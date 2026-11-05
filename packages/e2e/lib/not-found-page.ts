import { expect, type Locator, type Page } from "@playwright/test";
import { NOT_FOUND_COPY } from "@ds/storefront-shell/not-found-copy";

/**
 * #2478 — the storefront not-found page as a browser sees it: the not-found
 * state of the platform's one error page, whose heading and line are one of the
 * owner's variants picked at random per render.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const TITLE = new RegExp(
  `^(?:${NOT_FOUND_COPY.variants.map((v) => escapeRegExp(v.title)).join("|")})$`,
  "u",
);

/** The page's `h1` — any of the not-found variants' headings. */
export function notFoundHeading(page: Page): Locator {
  return page.getByRole("heading", { level: 1, name: TITLE });
}

/**
 * The text with the render's variant (heading and line) masked out, so two
 * not-found renders compare equal whichever variant each one picked.
 */
export function maskNotFoundVariant(text: string): string {
  let masked = text;
  for (const { title, text: line } of NOT_FOUND_COPY.variants) {
    masked = masked.split(title).join("<not-found title>");
    masked = masked.split(line).join("<not-found line>");
  }
  return masked;
}

export const NOT_FOUND_HOME_LABEL = NOT_FOUND_COPY.home;

/** The session cookie the storefront tiers' session doubles answer as a doctor. */
export const SIGNED_IN_COOKIE = "__Host-ds_session=e2e-doctor";

/**
 * #2478 — one unknown address on a storefront: HTTP 404, the not-found state
 * (one of the variants' headings, a line, one «На главную» → `/`) inside the
 * storefront shell — exactly one header (with the viewer's cluster) and one
 * footer — never Next's English default, no horizontal scroll at the current
 * viewport. `streamed`: the address's route streams (a loading boundary), so
 * its status and title are not the not-found page's — the body is asserted.
 */
export async function expectStorefrontNotFound(
  page: Page,
  path: string,
  viewer: "guest" | "doctor",
  { streamed = false }: { streamed?: boolean } = {},
): Promise<void> {
  const response = await page.goto(path);
  // A route with a loading boundary commits its status and head before its
  // `notFound()` runs, so such an address is asserted by its body only.
  if (!streamed) {
    expect(response?.status(), `HTTP status of ${path}`).toBe(404);
    await expect(page).toHaveTitle(NOT_FOUND_COPY.pageTitle);
    await expect(
      page.locator('meta[name="robots"][content*="noindex"]').first(),
    ).toHaveAttribute("content", /noindex/u);
  }
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(notFoundHeading(page)).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByRole("link")).toHaveCount(1);
  await expect(
    main.getByRole("link", { name: NOT_FOUND_COPY.home, exact: true }),
  ).toHaveAttribute("href", "/");
  await expect(page.locator("body")).not.toContainText("could not be found");
  // Exactly one shell: a not-found inside a framed route group must not add a
  // second frame around the one its layout already draws.
  await expect(page.getByTestId("storefront-header")).toHaveCount(1);
  await expect(page.getByTestId("storefront-header")).toBeVisible();
  await expect(page.getByTestId("storefront-footer")).toHaveCount(1);
  await expect(page.getByTestId("storefront-footer")).toBeVisible();
  await expect(page.getByTestId("shell-auth-cluster").first()).toHaveAttribute(
    "data-cluster",
    viewer,
  );
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
}
