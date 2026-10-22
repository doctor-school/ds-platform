// Plain ESM on purpose (no build step): every Next host reads this from its
// `next.config.ts`, which `next dev` loads before any workspace package is built.

/**
 * ADR-0015 §4 req 2 — the API's storefront-server-only endpoints live under this
 * prefix (S4's redeem endpoint, #3172). Only the compose network reaches it; the
 * public edges and every same-origin BFF refuse it.
 */
export const INTERNAL_API_PREFIX = "/v1/internal";

/**
 * The one `/v1` BFF rewrite source every Next host forwards to the API with
 * (ADR-0015 §4 req 2). Next compiles it case-insensitively, so the lookahead
 * refuses `/v1/internal` in any case, and refuses every path a normalising
 * upstream could fold back onto it: a dot segment, an empty segment, an encoded
 * `.` `/` `\`, or any percent-escape in the first segment.
 */
export const BFF_API_REWRITE_SOURCE = String.raw`/v1/:path((?!(?:internal|\.\.?)(?:/|$)|/|[^/]*%|.*(?://|/\.\.?(?:/|$)|%2[ef]|%5c)).*)`;

/** The destination for `BFF_API_REWRITE_SOURCE` against an API origin. */
export function bffApiRewrite(apiOrigin) {
  return {
    source: BFF_API_REWRITE_SOURCE,
    destination: `${String(apiOrigin).replace(/\/$/, "")}/v1/:path`,
  };
}
