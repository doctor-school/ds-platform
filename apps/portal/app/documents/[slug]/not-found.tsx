import { LegalDocument } from "@ds/design-system/legal-document";

/**
 * 028 EARS-12 (028-design §dataState) — an unresolved document slug lands inside
 * the SAME shared block shell, never a bare host 404: a stale or mistyped link
 * still puts the visitor on a recognizable Academy surface with one way back to
 * the documents list. The HTTP status stays 404 — this segment is what Next.js
 * renders for the `notFound()` the route throws.
 */
export default function DocumentNotFound() {
  // EARS-15: this segment's pages own their content landmark — the Academy root
  // layout renders `{children}` straight into `<body>` and the shared block owns
  // only its own container, so the served 404 shell would otherwise expose no
  // `main` at all.
  return (
    <main>
      <LegalDocument state="not-found" backHref="/documents" />
    </main>
  );
}
