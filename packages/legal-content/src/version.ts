import { createHash } from "node:crypto";

import type { LegalDocument } from "./loader.js";

/**
 * The version tag of a published document (ADR-0009 §2.1): its `edition` plus
 * the sha256 of its text, `<edition>.sha256-<hex>`. Derived from the file, so
 * any change to the text is a new version without a second value to bump. One
 * definition for every side that stamps or checks a consent: the api checks a
 * submitted tag against it, and the page that renders the consent sends it
 * (033 EARS-6).
 */
export function documentVersionTag(document: LegalDocument): string {
  const digest = createHash("sha256").update(document.body).digest("hex");
  return `${document.frontmatter.edition}.sha256-${digest}`;
}
