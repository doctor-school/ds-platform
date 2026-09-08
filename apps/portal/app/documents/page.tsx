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
  ACADEMY_MAILBOX_CAPTION,
  ACADEMY_REQUISITES,
} from "@/lib/contacts";

/**
 * 028 EARS-2/3/4/5 — the Academy «Документы и контакты» index, inside the 008
 * shell (the `@chrome` parallel slot mounts the app-shell header for any route
 * under `app/`, so this page adds only its own content).
 *
 * The Academy is the SECOND host of one shared document set: the rows come from
 * `@ds/legal-content` and are drawn by the design-system row unit
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

/**
 * Card shell of the canvas contacts unit — the same border, plate and shadow the
 * document row carries (`rowBorder` / `surface` / `rowShadow`,
 * academy-docs.dc.html L162 and L167), so a contacts card and a document row read
 * as one family.
 */
const CONTACT_CARD = "border-2 border-border bg-card p-5 shadow-md";
/** Uppercase card eyebrow (canvas L163, L168). */
const CONTACT_EYEBROW =
  "mb-3 text-2xs font-extrabold tracking-micro text-faint uppercase";
/** Card caption under the mailbox / chip row (canvas L165, L175). */
const CONTACT_CAPTION =
  "mt-2.5 text-sm leading-relaxed font-semibold text-muted-foreground";

/**
 * The canvas section title: a nowrap h2 at clamp(24px,3.6vw,36px)/800 followed by
 * a 2px rule running to the column edge (academy-docs.dc.html L60-64 and
 * L156-159). `EventSectionHeading` is the design-system rule for the micro-label
 * variant of this idiom and renders a span, so it cannot carry heading semantics
 * for the section; this mirrors the existing repo precedent for the large variant
 * (`apps/doctor/components/specialty-catalog-view.tsx` `Heading`) and its token
 * choices — tokens only, no arbitrary values, and the rule is a presentational
 * span rather than an `<hr>` a screen reader would announce.
 */
function SectionHeading({ id, children }: { id: string; children: string }) {
  return (
    <div className="mb-4.5 flex items-baseline gap-4 layout:mb-6">
      <h2
        id={id}
        className="text-2xl leading-none font-extrabold tracking-tight whitespace-nowrap text-foreground layout:text-4xl"
      >
        {children}
      </h2>
      <span
        aria-hidden="true"
        className="flex-1 -translate-y-1.5 border-t-2 border-foreground"
      />
    </div>
  );
}

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
      // EARS-11: the «обновлено» chip is host-fed and means re-published since
      // you last saw it. Nothing has been re-published in slice 1, so no row
      // claims it — a chip on a first publication would be a lie. The missing
      // first-publication datum in `@ds/legal-content` frontmatter is tracked
      // decision-debt (DEBT.md), not a silent gap.
      updated: false,
    }),
  );

  return (
    <main className="flex flex-col">
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
          <SectionHeading id="documents-heading">Документы</SectionHeading>
          <LegalDocumentList items={rows} data-testid="documents-list" />
        </section>

        <section
          aria-labelledby="contacts-heading"
          id="contacts"
          data-testid="documents-contacts"
        >
          <SectionHeading id="contacts-heading">Контакты</SectionHeading>
          {/* The canvas draws the contacts unit as TWO bordered cards side by
              side on the list plate (L160-177) — the mailbox card and the
              channels card, each with its own eyebrow and its own caption. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div data-testid="documents-contacts-team" className={CONTACT_CARD}>
              <p className={CONTACT_EYEBROW}>Команда Академии</p>
              <Link
                variant="inline"
                href={`mailto:${ACADEMY_CONTACT_EMAIL}`}
                className="text-base tracking-tight"
              >
                {ACADEMY_CONTACT_EMAIL}
              </Link>
              <p className={CONTACT_CAPTION}>{ACADEMY_MAILBOX_CAPTION}</p>
            </div>

            {/* Hide-until-content applies to the CARD as well as to a chip: with
                no channel URL recorded at all, an eyebrow over an empty row is
                the placeholder EARS-12 forbids. Telegram is recorded today, so
                the card is drawn. */}
            {ACADEMY_CONTACT_CHANNELS.length > 0 ? (
              <div
                data-testid="documents-contacts-channels"
                className={CONTACT_CARD}
              >
                <p className={CONTACT_EYEBROW}>Сообщества и соцсети</p>
                <div className="flex flex-wrap gap-2.5">
                  {ACADEMY_CONTACT_CHANNELS.map((channel) => (
                    <ContactChip
                      key={channel.id}
                      href={channel.href}
                      label={channel.label}
                    />
                  ))}
                </div>
                <p className={CONTACT_CAPTION}>{ACADEMY_CONTACT_CAPTION}</p>
              </div>
            ) : null}
          </div>
        </section>

        <p
          id="requisites"
          data-testid="documents-requisites"
          className="text-xs leading-relaxed font-semibold tabular-nums text-faint"
        >
          {ACADEMY_REQUISITES}
        </p>
      </div>
    </main>
  );
}
