import { LegalDocument } from "@ds/design-system/blocks";

/**
 * 028 EARS-12 (#1967) — the «не найден» surface for `/documents/:slug`.
 *
 * Next.js renders this file for the `notFound()` the route throws, WITH the
 * `(storefront)` layout still around it, and answers HTTP 404. So the visitor
 * who followed a stale or mistyped document link keeps the storefront header,
 * footer and theme, meets the block own «Такого документа нет.» state with its
 * way back to the documents list, and search engines and monitors still see a
 * 404 (028-design.md → dataState).
 */
export default function DocumentNotFound() {
  return <LegalDocument state="not-found" backHref="/documents" />;
}
