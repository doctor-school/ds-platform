import type { Metadata } from "next";
import NextLink from "next/link";

import { listDocuments } from "@ds/legal-content";
import {
  EmptyState,
  formatEditionLine,
  LEGAL_DOCUMENT_COPY,
  type LegalDocumentNeighbour,
} from "@ds/design-system/blocks";
import { LegalDocumentList } from "@ds/design-system/legal-document";
import { ContactChip } from "@ds/design-system/contact-chip";

import { SectionHeading } from "@/components/section-heading";
import { academyHref } from "@/lib/academy";
import {
  CONTACT_CHANNELS,
  REQUISITES_LINE,
  SUPPORT_CAPTION,
  SUPPORT_EMAIL,
} from "@/lib/contacts";

/**
 * 028 EARS-1/3/4/5/6 (#1967) — `doctor.school/documents`, the storefront
 * «Документы и контакты» page. Canvas: `design-source/doctor-docs.dc.html`
 * (owner-approved, `docsVariant: Б проекция витрины`).
 *
 * It is a THIN PROJECTION, in the exact sense 028-design.md → «Shared component,
 * thin host projection» means it: this page owns which slugs appear and the
 * host-specific contact copy, and nothing else. The rows come from the exported
 * `<LegalDocumentList>` of the shared block — the same row unit the «Другие
 * документы» section under a document renders — so the two lists cannot drift,
 * and the Academy list (#1968) composes that same unit rather than this page
 * (no app-to-app imports, AGENTS.md §6).
 */
export const metadata: Metadata = {
  title: "Документы и контакты — Doctor.School",
  description:
    "Документы платформы Doctor.School: политика персональных данных и согласия, контакты поддержки и реквизиты.",
};

/**
 * EARS-6, verbatim from the canvas (L139). It is the THIRD and last placement
 * REQ-24 allows for an Academy crossing on this storefront (the footer link,
 * «Стать экспертом», this caption) — which is also why the canvas third contacts
 * card «Клиникам и организациям», a fourth Academy link, is not rendered below.
 * The destination is the Academy documents list shipping in #1968, this wave.
 */
const ACADEMY_CAPTION =
  "Полный набор документов платформы — на странице документов Академии.";

const ACADEMY_DOCUMENTS_HREF = academyHref("/documents");

interface PolicyRows {
  readonly rows: LegalDocumentNeighbour[];
  readonly failed: boolean;
}

/**
 * EARS-3 — EXACTLY ONE ROW in slice 1. The canvas also draws «лицензия»,
 * «Пользовательское соглашение» and «Правила начисления очков», some in a
 * «готовится» state. None of them ships: those documents have no owner-approved
 * text, and EARS-12 makes a document with no content have no row and no page at
 * all — not a disabled row, not a «скоро здесь» caption. It is enforced upstream
 * of this file rather than by a list here: `listDocuments` enumerates the files
 * that EXIST in `@ds/legal-content`, so a row appears the day its document is
 * published and never a day before.
 *
 * The loader is Node-only (synchronous `fs`), so it runs HERE, in the server
 * component. The page takes no api read at all, which is what lets the
 * backend-free Playwright tier drive it.
 */
function readPolicyRows(): PolicyRows {
  try {
    // `kind: "policy"` is this index scope: the 021 consent documents are their
    // own pages, reached from the registration checkboxes, never index rows
    // (EARS-9, canvas fork 2 «doc: короткий»).
    const rows = listDocuments("policy").map((doc) => ({
      slug: doc.slug,
      title: doc.frontmatter.title,
      href: `/documents/${doc.slug}`,
      editionLabel: formatEditionLine(
        doc.frontmatter.edition,
        LEGAL_DOCUMENT_COPY.editionPrefix,
      ),
      // EARS-11: a host-fed boolean. R1 is every document first publication, so
      // nothing is «обновлено» yet; how long the chip stays after a
      // re-publication is an open product decision (DEBT.md, #1971).
      updated: false,
    }));
    return { rows, failed: false };
  } catch {
    // A malformed document file throws rather than being silently skipped
    // (`@ds/legal-content` loader). The canvas draws that as the list own error
    // state — the page keeps its shell, its contacts and its requisites.
    return { rows: [], failed: true };
  }
}

export default function DoctorDocumentsPage() {
  const { rows, failed } = readPolicyRows();

  return (
    <div data-testid="documents-page" className="flex flex-col">
      {/* Постер-шапка — the same plate the document page carries, so arriving
          from the footer and arriving from a document look like one surface. */}
      <div className="bg-hero px-4 pt-9 pb-10 sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-content">
          <p className="mb-4.5 text-xs font-extrabold tracking-wide text-hero-muted uppercase">
            Doctor.School
          </p>
          <h1 className="text-2xl leading-tight font-extrabold tracking-tight text-balance break-words hyphens-auto text-hero-foreground sm:text-4xl sm:leading-none">
            Документы и контакты
          </h1>
          {/* The canvas lead also promises «чем подтверждено обучение» — that is
              the licence document, unpublished in R1, so that half is not
              stated here for the same reason its row is absent (EARS-12). */}
          <p className="mt-5 max-w-prose text-base leading-relaxed font-medium text-hero-muted">
            Здесь основания, на которых работает платформа: что происходит с
            вашими данными.
          </p>
        </div>
      </div>

      <div className="mx-auto my-10 flex w-full max-w-content flex-col gap-12 px-4 sm:px-8 lg:px-12">
        <section aria-labelledby="documents-heading">
          <SectionHeading id="documents-heading">Документы</SectionHeading>

          {failed ? (
            <EmptyState
              variant="error"
              title="Не удалось загрузить список документов."
            />
          ) : (
            <LegalDocumentList items={rows} data-testid="documents-list" />
          )}

          <p className="mt-4 text-sm font-semibold text-faint">
            <a
              data-testid="documents-academy-caption"
              href={ACADEMY_DOCUMENTS_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-primary-action focus-visible:text-primary-action"
            >
              {ACADEMY_CAPTION}
            </a>
          </p>

          {/* «Про согласия» — an explanation, not a control (canvas
              `d-docs · согласия`): this surface never toggles a consent. */}
          <div
            data-testid="documents-consents-note"
            className="mt-6 bg-section p-5"
          >
            {/* `text-muted-foreground`, not the canvas `inkFaint`: on the grey
                plate that faint tone fails WCAG AA contrast (axe
                `color-contrast`), and the fix belongs to the surface, not to
                the scan (EARS-15). */}
            <p className="mb-2.5 text-2xs font-extrabold tracking-micro text-muted-foreground uppercase">
              Про согласия
            </p>
            <p className="max-w-prose text-sm leading-relaxed font-semibold text-muted-foreground">
              Согласия отдельные по целям: передача данных партнёрам, публичное
              отображение, рассылка. Какие согласия вы дали и когда — видно в{" "}
              <NextLink
                href="/account"
                className="font-bold text-primary-action underline underline-offset-4"
              >
                личном кабинете
              </NextLink>
              . Чтобы отозвать согласие, напишите в поддержку — мы обработаем
              обращение вручную.
            </p>
          </div>
        </section>

        <section id="contacts" aria-labelledby="contacts-heading">
          <SectionHeading id="contacts-heading">Контакты</SectionHeading>

          <div className="grid gap-3 sm:grid-cols-2">
            <div
              data-testid="documents-support"
              className="border-2 border-border bg-card p-5 shadow-md"
            >
              <p className="mb-3 text-2xs font-extrabold tracking-micro text-faint uppercase">
                Поддержка
              </p>
              <ContactChip
                href={`mailto:${SUPPORT_EMAIL}`}
                label={SUPPORT_EMAIL}
                data-testid="documents-support-mail"
              />
              <p className="mt-2.5 text-sm leading-relaxed font-semibold text-muted-foreground">
                {SUPPORT_CAPTION}
              </p>
            </div>

            {/* The chips carry no per-channel captions — the label names the
                channel and the canvas draws nothing else (L167-169). The card
                disappears entirely rather than standing empty: a section header
                over nothing is the placeholder EARS-12 forbids. */}
            {CONTACT_CHANNELS.length > 0 ? (
              <div
                data-testid="documents-channels"
                className="border-2 border-border bg-card p-5 shadow-md"
              >
                <p className="mb-3 text-2xs font-extrabold tracking-micro text-faint uppercase">
                  Сообщества и соцсети
                </p>
                <div className="flex flex-wrap gap-2">
                  {CONTACT_CHANNELS.map((channel) => (
                    <ContactChip
                      key={channel.key}
                      href={channel.href}
                      label={channel.label}
                      data-testid={`documents-channel-${channel.key}`}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* EARS-5 — one faint tabular line at the foot of the page, no licence
              number in R1 (the canvas line carries placeholder values). */}
          <p
            id="requisites"
            data-testid="documents-requisites"
            className="mt-5 text-xs leading-relaxed font-semibold tabular-nums text-faint"
          >
            {REQUISITES_LINE}
          </p>
        </section>
      </div>
    </div>
  );
}
