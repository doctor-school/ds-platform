import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { listDocuments, loadDocument } from "@ds/legal-content";
import {
  formatEditionLine,
  LEGAL_DOCUMENT_COPY,
  LegalDocument,
  type LegalDocumentNeighbour,
} from "@ds/design-system/blocks";

interface DocumentRouteProps {
  params: Promise<{ slug: string }>;
}

/**
 * 028 EARS-7/EARS-10/EARS-12 (#1967) — `doctor.school/documents/:slug`, one
 * legal document on the doctor storefront.
 *
 * The route is deliberately thin: resolve the slug through `@ds/legal-content`,
 * hand the raw body to the shared `<LegalDocument>` block, and say which other
 * published documents the «Другие документы» list shows. Every question of
 * layout — the poster, the ToC variant, the back links, the four data states —
 * belongs to the block and is answered identically on the Academy host (#1968).
 * Markdown is parsed INSIDE the block; this file never touches the text.
 *
 * A DOCUMENT IS ITS SLUG (EARS-10). The URL never carries a title or an edition,
 * so correcting a text and bumping its `edition` leaves every consent link, every
 * registration-form link and every stored consent reference resolving to the same
 * page.
 *
 * WHY `notFound()` AND A ROUTE-LOCAL `not-found.tsx` BOTH. An unresolved slug
 * must stay a real HTTP 404 — a stale link that answers 200 is invisible to
 * every crawler and monitor — while the visitor must still land inside the
 * storefront shell on the block own «Такого документа нет.» state rather than a
 * bare host error page (028-design.md → dataState). Calling `notFound()` gives
 * the status; the sibling `not-found.tsx` gives the surface. Neither alone does.
 */
type Resolved =
  | { readonly status: "found"; readonly title: string; readonly edition: string; readonly body: string }
  | { readonly status: "missing" }
  | { readonly status: "error" };

/**
 * `loadDocument` answers `undefined` for a slug that has no file — that is the
 * EARS-12 no-placeholder guarantee, not a failure — and THROWS only when a file
 * exists but cannot be read or is malformed. The two are different surfaces
 * («не найден» vs «ошибка»), so they are separated here, once, and both callers
 * (the page and its metadata) read the same answer.
 */
function resolve(slug: string): Resolved {
  try {
    const document = loadDocument(slug);
    if (!document) return { status: "missing" };
    return {
      status: "found",
      title: document.frontmatter.title,
      edition: document.frontmatter.edition,
      body: document.body,
    };
  } catch {
    return { status: "error" };
  }
}

/** The remaining published documents, of every `kind` — the block «Другие документы». */
function neighbours(slug: string): LegalDocumentNeighbour[] {
  try {
    return listDocuments()
      .filter((doc) => doc.slug !== slug)
      .map((doc) => ({
        slug: doc.slug,
        title: doc.frontmatter.title,
        href: `/documents/${doc.slug}`,
        editionLabel: formatEditionLine(
          doc.frontmatter.edition,
          LEGAL_DOCUMENT_COPY.editionPrefix,
        ),
        // EARS-11: R1 is every document first publication (see the index route).
        updated: false,
      }));
  } catch {
    // The document itself rendered; a broken NEIGHBOUR must not take the page
    // down with it — the reader still has the text and the back link.
    return [];
  }
}

export async function generateMetadata({
  params,
}: DocumentRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const resolved = resolve(slug);

  return resolved.status === "found"
    ? {
        title: `${resolved.title} — Doctor.School`,
        description: `${resolved.title}: ${formatEditionLine(resolved.edition, LEGAL_DOCUMENT_COPY.editionPrefix)}.`,
      }
    : { title: "Документ не найден — Doctor.School" };
}

export default async function DoctorDocumentPage({ params }: DocumentRouteProps) {
  const { slug } = await params;
  const resolved = resolve(slug);

  // Outside any `try`, on purpose: `notFound()` signals by throwing, and a
  // catch around it would swallow the 404 into the error state.
  if (resolved.status === "missing") notFound();

  if (resolved.status === "error") {
    return <LegalDocument state="error" backHref="/documents" />;
  }

  return (
    <LegalDocument
      document={{
        title: resolved.title,
        edition: resolved.edition,
        body: resolved.body,
      }}
      backHref="/documents"
      others={neighbours(slug)}
    />
  );
}
