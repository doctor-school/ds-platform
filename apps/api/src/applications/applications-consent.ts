import { createHash } from "node:crypto";

import {
  LegalContentError,
  loadDocument,
  type LoaderOptions,
} from "@ds/legal-content";

/**
 * 033 EARS-6 — the current version tag of a queue kind's consent: the
 * `@ds/legal-content` document's `edition` plus the sha256 of its text
 * (ADR-0009 §2.1), the shape 046 EARS-16 stamps on the congress submission
 * consent. Derived from the published file, so any change to the text asks
 * every applicant again without a second value to bump.
 *
 * A missing or malformed document is reported, never thrown: the intake
 * answers `503` and stores nothing.
 */
export function resolveApplicationConsentVersion(
  slug: string,
  options?: LoaderOptions,
): { ok: true; version: string } | { ok: false } {
  let document: ReturnType<typeof loadDocument>;
  try {
    document = loadDocument(slug, options);
  } catch (error) {
    if (error instanceof LegalContentError) return { ok: false };
    throw error;
  }
  if (!document) return { ok: false };
  const digest = createHash("sha256").update(document.body).digest("hex");
  return {
    ok: true,
    version: `${document.frontmatter.edition}.sha256-${digest}`,
  };
}
