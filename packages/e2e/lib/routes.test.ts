import { describe, expect, it } from "vitest";

import { isDynamic, pageRoutesFrom } from "./routes.js";

/**
 * The route-manifest filter (staging/regression-contour tech spec §6.3). The
 * fixtures below are shaped exactly like the `app-paths-manifest.json` Next 15
 * writes for the two storefronts — keys are app-router paths carrying route
 * groups, parallel slots and `/page` | `/route` suffixes.
 */
describe("pageRoutesFrom", () => {
  it("keeps page routes and drops route handlers", () => {
    expect(
      pageRoutesFrom({
        "/webinars/page": "app/webinars/page.js",
        "/v1/health/route": "app/v1/health/route.js",
      }),
    ).toEqual(["/webinars"]);
  });

  it("drops API, _not-found, _global-error and _next internals", () => {
    expect(
      pageRoutesFrom({
        "/api/preview/page": "x.js",
        "/_not-found/page": "x.js",
        "/_global-error/page": "x.js",
        "/_next/thing/page": "x.js",
        "/account/page": "app/account/page.js",
      }),
    ).toEqual(["/account"]);
  });

  it("drops parallel slots and intercepting routes", () => {
    expect(
      pageRoutesFrom({
        "/@chrome/[...catchAll]/page": "x.js",
        "/@chrome/page": "x.js",
        "/feed/(.)photo/[id]/page": "x.js",
        "/feed/page": "app/feed/page.js",
      }),
    ).toEqual(["/feed"]);
  });

  it("strips route groups from the address", () => {
    expect(
      pageRoutesFrom({
        "/(storefront)/documents/[slug]/page": "x.js",
        "/(auth)/login/page": "x.js",
      }),
    ).toEqual(["/documents/[slug]", "/login"]);
  });

  it("resolves the root page to /", () => {
    expect(pageRoutesFrom({ "/(storefront)/page": "x.js" })).toEqual(["/"]);
  });

  it("deduplicates two route groups that resolve to one address", () => {
    expect(
      pageRoutesFrom({
        "/(room)/events/[slug]/room/page": "x.js",
        "/(storefront)/events/[slug]/room/page": "x.js",
      }),
    ).toEqual(["/events/[slug]/room"]);
  });
});

describe("isDynamic", () => {
  it("recognises a dynamic segment anywhere in the address", () => {
    expect(isDynamic("/webinars/[slug]")).toBe(true);
    expect(isDynamic("/events/[slug]/room")).toBe(true);
    expect(isDynamic("/documents")).toBe(false);
  });
});
