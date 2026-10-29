import { ACADEMY_AUTH_FLOW } from "@ds/auth-flow/hosts";
import { storefrontDoorGate } from "@ds/auth-flow/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
  checkStorefrontEntry,
  checkStorefrontPrefetch,
  STOREFRONT_ENTRY_PROBE_PATHS,
  TOP_LEVEL_NAVIGATION_HEADERS,
} from "../../deploy/smoke-prod.mjs";

/**
 * #3438 — the prod smoke's storefront entry probes, pinned to the shipped
 * entry contract. The smoke runs only inside a prod release (after the
 * container swap), so before this spec a change to the entry answer that
 * left the smoke behind surfaced first as a red PROD release (#3265: `/login`
 * and `/verify` became 303/204 entries, the smoke still expected a page).
 *
 * Here the real storefront gate (`storefrontDoorGate`, the answer the portal
 * middleware serves for the door paths) is driven with exactly the requests
 * the smoke sends — its probe paths and its navigation headers, on a cold
 * browser — and its answer is fed to the smoke's own classifiers. A contract
 * change without a smoke change (or the reverse) goes red on the PR.
 *
 * The authorize URL itself is the API's answer (`/v1/internal/oidc/transaction`);
 * the fake API returns the shape the smoke expects of it, so this spec pins
 * the storefront half: status, absolute Location, prefetch answer, door paths.
 * The IdP's answer to that URL is the smoke's live `authorize` hop.
 */

const PORTAL_HOST = "academy.doctor.school";
const ID_HOST = "id.doctor.school";
const AUTHORIZE_URL =
  `https://${ID_HOST}/oauth/v2/authorize?` +
  new URLSearchParams({
    client_id: "1",
    redirect_uri: `https://${PORTAL_HOST}/auth/callback`,
    response_type: "code",
    code_challenge_method: "S256",
  });
const ENV = {
  INTERNAL_API_URL: "http://api:3000/",
  INTERNAL_API_TOKEN: "t".repeat(40),
};

/** The API a cold (cookie-less) browser meets: no session, a granted transaction. */
const coldApi = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/v1/auth/session"))
    return new Response(null, { status: 401 });
  if (url.endsWith("/v1/internal/oidc/transaction"))
    return Response.json({ txId: "T".repeat(43), authorizeUrl: AUTHORIZE_URL });
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;

/** What node's `https.request` hands the smoke: status + lower-cased header map. */
async function asSmokeResponse(res: Response | undefined) {
  if (!res) throw new Error("the storefront gate does not answer this path");
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: await res.text(),
  };
}

async function gate(path: string, headers: Record<string, string>) {
  const res = await storefrontDoorGate(
    new NextRequest(`https://${PORTAL_HOST}${path}`, {
      headers: { "User-Agent": "ds-smoke-prod", ...headers },
    }),
    { client: "academy", config: ACADEMY_AUTH_FLOW },
    { fetchImpl: coldApi, env: ENV },
  );
  return asSmokeResponse(res);
}

describe("prod smoke storefront entry probes ↔ the shipped entry contract (#3438)", () => {
  it("probes exactly the Academy sign-in and verification doors", () => {
    expect([...STOREFRONT_ENTRY_PROBE_PATHS]).toEqual([
      ACADEMY_AUTH_FLOW.routes.login,
      ACADEMY_AUTH_FLOW.routes.verify,
    ]);
  });

  for (const path of STOREFRONT_ENTRY_PROBE_PATHS) {
    it(`003 EARS-61: the smoke's cold navigation to ${path} passes its entry check against the real gate`, async () => {
      const res = await gate(path, TOP_LEVEL_NAVIGATION_HEADERS);
      expect(
        checkStorefrontEntry(res, { portalHost: PORTAL_HOST, idHost: ID_HOST }),
      ).toContain(`${ID_HOST}/oauth/v2/authorize`);
    });

    it(`003 EARS-61: the smoke's non-navigation GET of ${path} passes its prefetch check against the real gate`, async () => {
      const res = await gate(path, {});
      expect(checkStorefrontPrefetch(res)).toContain("204");
    });
  }
});
