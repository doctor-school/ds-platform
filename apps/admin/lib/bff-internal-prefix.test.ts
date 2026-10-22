import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination";
import { describe, expect, it } from "vitest";

import config from "../next.config";

/**
 * ADR-0015 §4 req 2 — the admin same-origin BFF never forwards the API's
 * storefront-server-only prefix. Matched with Next's own route matcher (the one
 * `rewrites()` runs through), so case folding and the normalisation-evading
 * spellings are judged exactly as the running host judges them.
 */
async function forwardedTo(pathname: string): Promise<string | null> {
  const rewrites = await config.rewrites!();
  const rules = Array.isArray(rewrites)
    ? rewrites
    : [
        ...(rewrites.beforeFiles ?? []),
        ...(rewrites.afterFiles ?? []),
        ...(rewrites.fallback ?? []),
      ];
  for (const rule of rules) {
    const params = getPathMatch(rule.source, {
      removeUnnamedParams: true,
      strict: true,
    })(pathname);
    if (params) {
      return prepareDestination({
        appendParamsToQuery: false,
        destination: rule.destination,
        params,
        query: {},
      }).newUrl;
    }
  }
  return null;
}

describe("ADR-0015 §4 req 2: the admin BFF refuses the internal API prefix", () => {
  it("ADR-0015 §4 req 2: the internal prefix is not forwarded to the api in any spelling", async () => {
    for (const path of [
      "/v1/internal",
      "/v1/internal/sign-in/redeem",
      "/v1/Internal/sign-in/redeem",
      "/V1/INTERNAL",
      "/v1//internal/x",
      "/v1/./internal/x",
      "/v1/auth/../internal/x",
      "/v1/internal%2Fx",
      "/v1/%69nternal/x",
      "/v1/auth%2F..%2Finternal",
    ]) {
      expect(await forwardedTo(path), path).toBeNull();
    }
  });

  it("ADR-0015 §4 req 2: the public api surface still forwards, path intact (EARS-44 hand-off included)", async () => {
    expect(await forwardedTo("/v1/auth/login/otp/handoff")).toMatch(
      /\/v1\/auth\/login\/otp\/handoff$/,
    );
    expect(await forwardedTo("/v1/internals")).toMatch(/\/v1\/internals$/);
  });
});
