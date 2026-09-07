import { LegalDocument } from "@ds/design-system/legal-document";

/**
 * 028 EARS-12 (028-design §dataState) — an unresolved document slug lands inside
 * the SAME shared block shell, never a bare host 404: a stale or mistyped link
 * still puts the visitor on a recognizable Academy surface with one way back to
 * the documents list. The HTTP status stays 404 — this segment is what Next.js
 * renders for the `notFound()` the route throws.
 */
export default function DocumentNotFound() {
  return <LegalDocument state="not-found" backHref="/documents" />;
}
