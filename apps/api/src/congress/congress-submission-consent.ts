import { createHash } from "node:crypto";

import {
  LegalContentError,
  loadDocument,
  type LoaderOptions,
} from "@ds/legal-content";
import { CONGRESS_SUBMISSION_CONSENT_DOCUMENT_SLUG } from "@ds/schemas";

/**
 * 046 EARS-16 — the server-stamped version of the congress submission
 * personal-data consent.
 *
 * The consent's text is the `@ds/legal-content` document
 * {@link CONGRESS_SUBMISSION_CONSENT_DOCUMENT_SLUG} (published at
 * `/documents/<slug>`, feature 028), so the version is stamped FROM that file:
 * its `edition` plus the sha256 of its text (ADR-0009 §2.1) — the same
 * `<edition>.sha256-<hex>` shape 044 EARS-9 stamps on the registration
 * consent. Deriving it from the published file, rather than from an operator
 * setting, makes a new edition (or any change to the text) ask every author
 * again at the next send without a second value anyone has to remember to
 * bump. It is deliberately independent of `CONGRESS_SIGNUP_CONSENT_VERSION`:
 * that setting versions the congress site policy 044 records, a different text.
 *
 * A missing or malformed document is reported, never thrown: the section read
 * treats either as «consent asked» and only the send refuses (503).
 *
 * `options.documentsDir` exists for tests; production reads the package's own
 * `documents/` directory, which the api image ships with the package.
 */
export function resolveCongressSubmissionConsentVersion(
  options?: LoaderOptions,
):
  | { ok: true; version: string }
  | {
      ok: false;
      reason: "consent-document-missing" | "consent-document-malformed";
    } {
  let document: ReturnType<typeof loadDocument>;
  try {
    document = loadDocument(CONGRESS_SUBMISSION_CONSENT_DOCUMENT_SLUG, options);
  } catch (error) {
    if (error instanceof LegalContentError) {
      return { ok: false, reason: "consent-document-malformed" };
    }
    throw error;
  }
  if (!document) return { ok: false, reason: "consent-document-missing" };
  const digest = createHash("sha256").update(document.body).digest("hex");
  return {
    ok: true,
    version: `${document.frontmatter.edition}.sha256-${digest}`,
  };
}
