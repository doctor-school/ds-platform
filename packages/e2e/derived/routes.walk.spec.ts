import { expect, test } from "@playwright/test";

import {
  HOSTS,
  HOST_IDS,
  HostConfigError,
  MANIFEST_PATH,
  baseUrlFor,
  type HostConfig,
} from "../hosts.js";
import { isDynamic, pageRoutesFrom } from "../lib/routes.js";
import type { AppPathsManifest } from "../lib/routes.js";
import { resolveRoute } from "../route-params.js";

/**
 * The DERIVED ROUTE WALK — staging/regression-contour tech spec §6.3, second
 * bullet (Issue #2067).
 *
 * It contains no list of routes either. Each SLOT image publishes its own Next
 * route manifest at {@link MANIFEST_PATH} (both Dockerfiles copy
 * `.next/server/app-paths-manifest.json` into the image's `public/` tree when the
 * `CONTOUR_MANIFEST` build arg is on — slot compose only, so production serves no
 * `/__contour/*`), and this walk fetches that file FROM THE SLOT, filters it to
 * the page addresses a visitor can type (`lib/routes.ts`), resolves dynamic
 * segments from `route-params.ts`, and asserts 200 + the landed PATHNAME (or the
 * lawful login redirect, `returnTo` intact) + a non-empty `h1` on every one.
 *
 * Reading the manifest from the SLOT rather than from the repo is the whole
 * point: the repo says what the source declares, the slot says what the image
 * actually serves. That difference is #2012 — `/documents/[slug]` 200-ed in dev
 * and broke in the standalone image — and only a walk driven by the built
 * artifact can see it.
 *
 * ── Failure, never skip ──────────────────────────────────────────────────────
 * Three conditions that a lesser suite would skip are FAILING tests here, each
 * titled with the thing that is missing:
 *   • the host's base URL is unconfigured — the run would otherwise report green
 *     against nothing;
 *   • the manifest is not served — an image built without the export is exactly
 *     the blind spot this walk closes, so it must be loud;
 *   • a dynamic route has no `route-params.ts` entry — §6.3: «adding a route
 *     forces the author to say which golden entity renders it».
 *
 * Both hosts run inside one Playwright project, parameterised by data; see the
 * note in `navigation.walk.spec.ts`.
 */

/** What collection produced for a host: its routes, or the reason there are none. */
type HostRoutes =
  | { readonly kind: "routes"; readonly base: string; readonly routes: string[] }
  | { readonly kind: "unavailable"; readonly reason: string };

const FETCH_TIMEOUT_MS = 30_000;

/**
 * Basic auth for the staging hostnames. Playwright's `httpCredentials` covers
 * the BROWSER; this manifest fetch happens at collection time in Node, before any
 * browser exists, so it carries the same pair as an explicit header.
 */
function authHeaders(): Record<string, string> {
  const user = process.env.E2E_HTTP_USER;
  const pass = process.env.E2E_HTTP_PASS;
  if (!user || !pass) return {};
  const token = Buffer.from(`${user}:${pass}`).toString("base64");
  return { authorization: `Basic ${token}` };
}

async function routesFor(host: HostConfig): Promise<HostRoutes> {
  let base: string;
  try {
    base = baseUrlFor(host);
  } catch (error) {
    if (error instanceof HostConfigError) {
      return { kind: "unavailable", reason: error.message };
    }
    throw error;
  }

  const url = `${base}${MANIFEST_PATH}`;
  try {
    const response = await fetch(url, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        kind: "unavailable",
        reason:
          `${url} answered ${response.status}. The image serves no route manifest, ` +
          `so the route walk cannot know what this slot mounts — rebuild the slot ` +
          `from a branch whose Dockerfile exports ${MANIFEST_PATH}.`,
      };
    }
    const manifest = (await response.json()) as AppPathsManifest;
    return { kind: "routes", base, routes: pageRoutesFrom(manifest) };
  } catch (error) {
    return {
      kind: "unavailable",
      reason: `${url} could not be read: ${(error as Error).message}`,
    };
  }
}

// Top-level await: the route list exists only after the slot answers. This
// package is ESM, so the spec can await the manifest at collection time and
// declare ONE TEST PER ROUTE — which is what makes a failure name the route that
// broke instead of collapsing every address into one red line.
for (const hostId of HOST_IDS) {
  const host = HOSTS[hostId];
  const resolved = await routesFor(host);

  test.describe(`${hostId} routes`, () => {
    if (resolved.kind === "unavailable") {
      test(`${hostId} route manifest is unavailable`, () => {
        throw new Error(resolved.reason);
      });
      return;
    }

    for (const pattern of resolved.routes) {
      const address = isDynamic(pattern)
        ? resolveRoute(hostId, pattern)
        : pattern;

      if (address === undefined) {
        test(`${hostId} no route-params entry for ${pattern}`, () => {
          throw new Error(
            `${pattern} is a dynamic route of the ${hostId} host with no entry in ` +
              `packages/e2e/route-params.ts, so the walk has no address to open. ` +
              `Add the golden entity that renders it (tech spec §6.3).`,
          );
        });
        continue;
      }

      test(`${hostId} ${pattern} → ${address}`, async ({ page }) => {
        const response = await page.goto(`${resolved.base}${address}`, {
          waitUntil: "domcontentloaded",
        });
        expect(response, `no response for ${address}`).not.toBeNull();
        expect(response!.status(), `status of ${address} (${pattern})`).toBe(200);

        // A 200 alone does not say WHICH page answered (#2012). Assert the landed
        // pathname, with the one lawful exception the navigation walk already
        // encodes: a gated address sends the anonymous walker to the host's login
        // surface, which must render its own `h1` AND keep the original address in
        // `returnTo`. Anything else is «200 on the wrong page» and stays red.
        const landed = new URL(page.url()).pathname;
        if (landed === host.loginPath && address !== host.loginPath) {
          await expect(
            page.getByRole("heading", {
              level: 1,
              name: host.loginHeading,
              exact: true,
            }),
            `the h1 of ${host.loginPath} after the ${address} redirect`,
          ).toBeVisible();
          expect(
            new URL(page.url()).searchParams.get("returnTo"),
            `returnTo after the ${address} (${pattern}) redirect`,
          ).toBe(address);
          return;
        }

        expect(landed, `pathname after opening ${address} (${pattern})`).toBe(
          address,
        );
        const h1 = page.locator("h1").first();
        await expect(h1, `the h1 of ${address} (${pattern})`).toBeVisible();
        expect(
          (await h1.innerText()).trim(),
          `the h1 text of ${address} (${pattern})`,
        ).not.toBe("");
      });
    }
  });
}
