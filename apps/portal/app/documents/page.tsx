import type { Metadata } from "next";

import { ContactChip } from "@ds/design-system/contact-chip";
import { Link } from "@ds/design-system/link";
import {
  LEGAL_DOCUMENT_COPY,
  LegalDocumentList,
  formatEditionLine,
  type LegalDocumentNeighbour,
} from "@ds/design-system/legal-document";
import { listDocuments } from "@ds/legal-content";

import {
  ACADEMY_CONTACT_CAPTION,
  ACADEMY_CONTACT_CHANNELS,
  ACADEMY_CONTACT_EMAIL,
  ACADEMY_REQUISITES,
} from "@/lib/contacts";

/**
 * 028 EARS-2/3/4/5 — the Academy's «Документы и контакты» index, inside the 008
 * shell (the `@chrome` parallel slot mounts the app-shell header for any route
 * under `app/`, so this page adds only its own content).
 *
 * The Academy is the SECOND host of one shared document set: the rows come from
 * `@ds/legal-content` and are drawn by the design system's row unit
 * (`LegalDocumentList`). This file is the thin projection 028-design allows a
 * host — which slugs appear, the contacts copy, the requisites line — and nothing
 * else. It holds no document content and no second copy of the row markup.
 *
 * EARS-3 (slice 1): the list is exactly the `policy` documents, which today is
 * the personal-data policy alone. The licence, «Пользовательское соглашение» and
 * «Правила начисления очков» rows the canvas draws have no published document, so
 * they are not rendered — a row for a document that does not exist is the
 * placeholder EARS-12 forbids, and there is no «готовится» state in slice 1.
 * Consent documents (`kind: consent`) are reachable by their own `/documents/:slug`
 * route from the 021 checkboxes, never as an extra index row (spec «Canvas fork
 * 2»), so they are filtered out here rather than at the loader.
 *
 * The hero carries no lede paragraph: the canvas line promises «чем подтверждено
 * обучение, по каким договорам мы работаем», and slice 1 publishes none of those
 * documents. Copy is added back when the documents behind it exist.
 *
 * `force-static` is deliberate — the documents are files in a workspace package,
 * fixed at build time, so there is nothing per-request to read.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Документы и контакты — Академия Doctor.School",
  description:
    "Документы Академии Doctor.School и контакты команды: политика персональных данных, почта поддержки, каналы и реквизиты.",
};

export default async function DocumentsIndexPage() {
  const rows: LegalDocumentNeighbour[] = listDocuments("policy").map(
    (entry) => ({
      slug: entry.slug,
      title: entry.frontmatter.title,
      href: `/documents/${entry.slug}`,
      editionLabel: formatEditionLine(
        entry.frontmatter.edition,
        LEGAL_DOCUMENT_COPY.editionPrefix,
      ),
      // EARS-11: the «обновлено» chip is host-fed and means "re-published since
      // you last saw it". Nothing has been re-published in slice 1, so no row
      // claims it — a chip on a first publication would be a lie.
      updated: false,
    }),
  );

  return (
    <div className="flex flex-col">
      <div className="bg-hero px-4 pt-9 pb-10 sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-content">
          <p className="mb-4.5 text-xs font-extrabold tracking-wide text-hero-muted uppercase">
            Академия
          </p>
          <h1 className="text-2xl leading-tight font-extrabold tracking-tight text-balance text-hero-foreground sm:text-4xl sm:leading-none">
            Документы и контакты
          </h1>
        </div>
      </div>

      <div className="mx-auto my-10 flex w-full max-w-content flex-col gap-12 px-4 sm:px-8 lg:px-12">
        <section aria-labelledby="documents-heading" id="documents">
          <h2
            id="documents-heading"
            className="mb-3.5 text-2xs font-extrabold tracking-micro text-muted-foreground uppercase"
          >
            Документы
          </h2>
          <LegalDocumentList items={rows} data-testid="documents-list" />
        </section>

        <section
          aria-labelledby="contacts-heading"
          id="contacts"
          data-testid="documents-contacts"
        >
          <h2
            id="contacts-heading"
            className="mb-3.5 text-2xs font-extrabold tracking-micro text-muted-foreground uppercase"
          >
            Контакты
          </h2>
          <p className="mb-5">
            <Link
              variant="inline"
              href={`mailto:${ACADEMY_CONTACT_EMAIL}`}
              className="text-base tracking-tight"
            >
              {ACADEMY_CONTACT_EMAIL}
            </Link>
          </p>
          {ACADEMY_CONTACT_CHANNELS.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-2.5">
                {ACADEMY_CONTACT_CHANNELS.map((channel) => (
                  <ContactChip
                    key={channel.id}
                    href={channel.href}
                    label={channel.label}
                  />
                ))}
              </div>
              <p className="mt-2.5 text-sm leading-relaxed font-semibold text-muted-foreground">
                {ACADEMY_CONTACT_CAPTION}
              </p>
            </>
          ) : null}
        </section>

        <p
          id="requisites"
          data-testid="documents-requisites"
          className="text-xs leading-relaxed font-semibold tabular-nums text-faint"
        >
          {ACADEMY_REQUISITES}
        </p>
      </div>
    </div>
  );
}
