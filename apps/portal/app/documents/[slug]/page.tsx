import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  LEGAL_DOCUMENT_COPY,
  LegalDocument,
  formatEditionLine,
  type LegalDocumentNeighbour,
} from "@ds/design-system/legal-document";
import { listDocuments, loadDocument } from "@ds/legal-content";

/**
 * 028 EARS-2 / EARS-10 / EARS-12 — the Academy's `/documents/:slug` projection.
 *
 * The host resolves the slug and hands the raw document to the shared reading
 * component; the Markdown parsing, the ToC, the edition line and all four data
 * states live in `@ds/design-system/legal-document`, so the doctor storefront and
 * the Academy render byte-identical document bodies from one implementation
 * (028-design «Shared component, thin host projection»).
 *
 * An unresolved slug calls `notFound()` so the response really is HTTP 404 — the
 * on-brand not-found SHELL is `not-found.tsx` in this segment, which renders the
 * same block with `state="not-found"`. Rendering the state without the status
 * would hand crawlers a 200 for a document that does not exist.
 *
 * `generateStaticParams` enumerates the published set: the documents are files in
 * a workspace package, so every published page is prerendered at build time.
 * `dynamicParams` deliberately stays at its permissive default — with it off, Next
 * answers an unknown slug from the ROOT `not-found` before this segment ever runs,
 * and the visitor gets a bare host 404 instead of the on-brand shell 028-design
 * requires. Letting the unknown slug render on demand routes it through the
 * `notFound()` below, whose nearest boundary is this segment's `not-found.tsx`.
 */

export function generateStaticParams(): { slug: string }[] {
  return listDocuments().map((entry) => ({ slug: entry.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const document = loadDocument(slug);
  if (!document)
    return { title: "Документ не найден — Академия Doctor.School" };
  return {
    title: `${document.frontmatter.title} — Академия Doctor.School`,
    description: formatEditionLine(
      document.frontmatter.edition,
      LEGAL_DOCUMENT_COPY.editionPrefix,
    ),
  };
}

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const document = loadDocument(slug);
  if (!document) notFound();

  // Every OTHER published document, whatever its kind: a reader who reached a
  // consent document from a 021 checkbox still needs a way to the policy, and
  // vice versa. The INDEX narrowing (policy only) is a list decision, not a
  // neighbour decision.
  const others: LegalDocumentNeighbour[] = listDocuments()
    .filter((entry) => entry.slug !== slug)
    .map((entry) => ({
      slug: entry.slug,
      title: entry.frontmatter.title,
      href: `/documents/${entry.slug}`,
      editionLabel: formatEditionLine(
        entry.frontmatter.edition,
        LEGAL_DOCUMENT_COPY.editionPrefix,
      ),
      updated: false,
    }));

  // EARS-15: the root layout renders `{children}` straight into `<body>` and the
  // shared block owns only its own container, so the content landmark is
  // page-owned on the Academy host (`app/account/page.tsx`, `academy-home-view`).
  return (
    <main>
      <LegalDocument
        document={{
          title: document.frontmatter.title,
          edition: document.frontmatter.edition,
          body: document.body,
        }}
        backHref="/documents"
        others={others}
        // EARS-11: nothing has been re-published in slice 1.
        updated={false}
      />
    </main>
  );
}
