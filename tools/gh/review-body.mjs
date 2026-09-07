/** PowerShell UTF-8 body files can prefix native GitHub reviews with a BOM. */
export function normalizeReviewBody(body) {
  return typeof body === "string" ? body.replace(/^\uFEFF/, "") : "";
}
