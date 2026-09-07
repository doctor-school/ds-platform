import * as React from "react";

import { cn } from "../lib/utils";
import {
  parseLegalDocument,
  type LegalDocumentTocEntry,
} from "../lib/markdown-document";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { EmptyState } from "./empty-state";

/**
 * `LegalDocument` (028 EARS-7/11/14, #1966) — the ONE reading surface every legal
 * document renders through, on both storefronts (028-design.md → «Shared
 * component, thin host projection»). Canvas: `design-source/document.dc.html`
 * (owner-drawn, vendored by PR #1956), `tocVariant: А`.
 *
 * The hosts (`apps/doctor` #1968, `apps/portal` #1967) add ONLY a route, the
 * `slug → document` load through `@ds/legal-content`, and which neighbours the
 * «Другие документы» list shows. Neither host owns a copy of this layout, and
 * neither imports from the other (AGENTS.md §6 cross-front reuse).
 *
 * PRESENTATION ONLY — three consequences worth naming:
 *
 *  • `state` is HOST-RESOLVED. The block never fetches, never decides that a slug
 *    is missing and never derives «is this edition new». All four canvas states
 *    (`обычно | загрузка | ошибка | не найден`) render INSIDE this same shell —
 *    header, back link and the way out survive — so a stale or mistyped document
 *    link never drops the reader onto a bare host 404/500 (028-design.md →
 *    dataState).
 *  • `updated` is a BOOLEAN the host feeds per «Другие документы» row (EARS-11).
 *    No date arithmetic and no visibility window live here: how long the chip
 *    stays after a re-publication is an open product decision (DEBT.md, #1971),
 *    and baking a window in would make the design system own a product rule.
 *  • NO NUMERIC VERSION is rendered anywhere (EARS-11). The only version marker a
 *    reader sees is «редакция от <дата>», formatted from the ISO `edition`.
 */

/** The four canvas data states, verbatim (`document.dc.html` L335-338). */
export type LegalDocumentState = "normal" | "loading" | "error" | "not-found";

export interface LegalDocumentNeighbour {
  /** Stable document slug — the React key and the row's identity. */
  slug: string;
  title: string;
  href: string;
  /** One line of context under the title («Какие данные мы храним…»). */
  note?: React.ReactNode;
  /** Already-formatted edition line for the row, e.g. «редакция от 3 июня 2026». */
  editionLabel?: React.ReactNode;
  /** EARS-11: host-fed re-publication flag → the «обновлено» chip. Never a version. */
  updated?: boolean;
}

export interface LegalDocumentContent {
  title: string;
  /** ISO `YYYY-MM-DD` from the document frontmatter. */
  edition: string;
  /** Markdown body as authored in `@ds/legal-content`. */
  body: string;
}

export interface LegalDocumentCopy {
  backToList: string;
  backToListLong: string;
  tocTitle: string;
  otherDocuments: string;
  updatedChip: string;
  loading: string;
  errorTitle: string;
  errorRetry: string;
  notFoundTitle: string;
  notFoundDescription: string;
  notFoundAction: string;
  editionPrefix: string;
}

/**
 * Default RU copy. Both storefronts are RU-only on this surface today; a host
 * that localizes overrides the strings it needs rather than forking the block.
 */
export const LEGAL_DOCUMENT_COPY: LegalDocumentCopy = {
  backToList: "← Документы",
  backToListLong: "← Документы и контакты",
  tocTitle: "Содержание",
  otherDocuments: "Другие документы",
  updatedChip: "обновлено",
  loading: "Документ загружается",
  errorTitle: "Не удалось загрузить документ.",
  errorRetry: "Повторить",
  notFoundTitle: "Такого документа нет.",
  notFoundDescription:
    "Возможно, ссылка устарела или документ переименован. Все действующие документы платформы собраны в одном разделе.",
  notFoundAction: "Все документы платформы →",
  editionPrefix: "редакция от",
};

const RU_MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

/**
 * «редакция от 12 августа 2026» from the ISO `edition`, the canvas's own wording
 * (`document.dc.html` L463). Parsed by field, not by `new Date(...)`: an ISO date
 * string is a CALENDAR date, and letting the runtime interpret it as an instant
 * shifts the printed day by one for anybody east or west of UTC. A string that is
 * not a plain ISO date is passed through untouched rather than printed as
 * «Invalid Date».
 */
export function formatEditionLine(edition: string, prefix: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(edition);
  if (!match) return edition;
  const [, year, month, day] = match;
  const monthName = RU_MONTHS_GENITIVE[Number(month) - 1];
  if (!monthName) return edition;
  return `${prefix} ${Number(day)} ${monthName} ${year}`;
}

export interface LegalDocumentProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "children" | "content"> {
  /** The document itself. Absent for every state except `normal`. */
  document?: LegalDocumentContent;
  /** Where the back link and the not-found way-out lead — the documents list. */
  backHref: string;
  /** The remaining published documents, host-ordered. Empty list → no section. */
  others?: LegalDocumentNeighbour[];
  /** Host-resolved data state; the shell is identical in all four. */
  state?: LegalDocumentState;
  /** EARS-11 flag for THIS document's own header chip. */
  updated?: boolean;
  /** `error` retry — host-owned (a re-fetch, a router refresh). Omitted → no button. */
  onRetry?: () => void;
  copy?: Partial<LegalDocumentCopy>;
  className?: string;
}

function TocList({
  entries,
  title,
  variant,
}: {
  entries: LegalDocumentTocEntry[];
  title: string;
  variant: "aside" | "collapsed";
}) {
  const items = entries.map((entry) => (
    <li key={entry.id}>
      <a
        href={`#${entry.id}`}
        className={cn(
          "block py-2 text-sm leading-snug font-bold text-muted-foreground hover:text-primary-action focus-visible:text-primary-action",
          entry.depth === 3 ? "pl-4" : undefined,
        )}
      >
        {entry.text}
      </a>
    </li>
  ));

  if (variant === "aside") {
    // Вариант А: the sticky left column, desktop only. Below `xl` the same
    // entries are the collapsed list above the body — ONE ToC data source,
    // two projections, never two hand-kept lists (028 V-2).
    return (
      <nav
        aria-label={title}
        data-testid="legal-document-toc-aside"
        className="hidden xl:sticky xl:top-6 xl:col-span-1 xl:block xl:self-start xl:border-2 xl:border-border xl:bg-card xl:p-5 xl:shadow-lg"
      >
        <p className="mb-3.5 text-2xs font-extrabold tracking-micro text-muted-foreground uppercase">
          {title}
        </p>
        <ol className="flex list-none flex-col gap-0.5">{items}</ol>
      </nav>
    );
  }

  return (
    <details
      data-testid="legal-document-toc-collapsed"
      className="mb-7 bg-section xl:hidden"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-3 p-4 text-2xs font-extrabold tracking-micro text-foreground uppercase">
        <span>{title}</span>
        <span aria-hidden="true" className="text-primary-action">
          ▾
        </span>
      </summary>
      <ol className="flex list-none flex-col px-4 pb-3.5">{items}</ol>
    </details>
  );
}

function OtherDocuments({
  items,
  title,
  updatedChip,
}: {
  items: LegalDocumentNeighbour[];
  title: string;
  updatedChip: string;
}) {
  return (
    <section
      aria-labelledby="legal-document-others"
      data-testid="legal-document-others"
      className="mt-8"
    >
      <p
        id="legal-document-others"
        className="mb-3.5 text-2xs font-extrabold tracking-micro text-muted-foreground uppercase"
      >
        {title}
      </p>
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <a
            key={item.slug}
            href={item.href}
            data-testid={`legal-document-other-${item.slug}`}
            className="grid items-center gap-1.5 border-2 border-border bg-card p-5 shadow-md hover:shadow-sm focus-visible:shadow-sm sm:flex sm:items-center sm:justify-between sm:gap-5"
          >
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2.5">
                <span className="text-base leading-snug font-extrabold tracking-tight text-card-foreground">
                  {item.title}
                </span>
                {item.updated ? (
                  <Badge variant="updated" className="flex-none">
                    {updatedChip}
                  </Badge>
                ) : null}
              </span>
              {item.note ? (
                <span className="mt-1.5 block text-sm leading-snug font-semibold text-muted-foreground">
                  {item.note}
                </span>
              ) : null}
            </span>
            {item.editionLabel ? (
              <span className="text-xs font-bold whitespace-nowrap text-faint">
                {item.editionLabel}
              </span>
            ) : null}
          </a>
        ))}
      </div>
    </section>
  );
}

const LegalDocument = React.forwardRef<HTMLElement, LegalDocumentProps>(
  (
    {
      document,
      backHref,
      others = [],
      state = "normal",
      updated = false,
      onRetry,
      copy,
      className,
      ...rest
    },
    ref,
  ) => {
    const t = { ...LEGAL_DOCUMENT_COPY, ...copy };
    const isContent = state === "normal" && document !== undefined;
    // Parsed inline rather than memoised: `parseLegalDocument` is pure and
    // synchronous, and a hook here would forbid the block in a server component —
    // which is exactly where both hosts render it (the loader is Node-only).
    const parsed = isContent ? parseLegalDocument(document.body) : undefined;

    return (
      <article
        ref={ref}
        data-testid="legal-document"
        data-state={state}
        className={cn("flex flex-col", className)}
        {...rest}
      >
        {/* Постер-шапка — the same poster the documents list carries, so a
            document opened from anywhere lands on a recognizable surface. */}
        <div className="bg-hero px-4 pt-9 pb-10 sm:px-8 lg:px-12">
          <div className="mx-auto w-full max-w-content">
            <a
              href={backHref}
              data-testid="legal-document-back-top"
              className="mb-4.5 inline-block text-xs font-extrabold tracking-wide text-hero-muted uppercase hover:text-hero-foreground focus-visible:text-hero-foreground"
            >
              {t.backToList}
            </a>
            {isContent ? (
              <>
                <h1 className="text-3xl leading-none font-extrabold tracking-tight text-hero-foreground sm:text-4xl">
                  {document.title}
                </h1>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <span
                    data-testid="legal-document-edition"
                    className="text-sm font-bold text-hero-muted"
                  >
                    {formatEditionLine(document.edition, t.editionPrefix)}
                  </span>
                  {updated ? (
                    <Badge variant="updated" data-testid="legal-document-header-chip">
                      {t.updatedChip}
                    </Badge>
                  ) : null}
                </div>
              </>
            ) : null}
            {state === "loading" ? (
              <div aria-hidden="true" className="flex flex-col gap-4">
                <span className="block h-9 w-3/5 animate-live-pulse bg-hero-muted" />
                <span className="block h-3.5 w-50 animate-live-pulse bg-hero-muted" />
              </div>
            ) : null}
            {state === "not-found" ? (
              <h1 className="text-3xl leading-none font-extrabold tracking-tight text-hero-foreground sm:text-4xl">
                {t.notFoundTitle}
              </h1>
            ) : null}
          </div>
        </div>

        <div className="mx-auto my-10 w-full max-w-content px-4 sm:px-8 lg:px-12">
          {state === "loading" ? (
            <EmptyState variant="loading" title={t.loading} />
          ) : null}
          {state === "error" ? (
            <EmptyState
              variant="error"
              title={t.errorTitle}
              action={
                onRetry ? (
                  <Button type="button" variant="secondary" onClick={onRetry}>
                    {t.errorRetry}
                  </Button>
                ) : undefined
              }
            />
          ) : null}
          {state === "not-found" ? (
            <EmptyState
              variant="not-found"
              title={t.notFoundTitle}
              description={t.notFoundDescription}
              action={
                <Button asChild>
                  <a href={backHref}>{t.notFoundAction}</a>
                </Button>
              }
            />
          ) : null}

          {isContent && parsed ? (
            <div className="gap-8 xl:grid xl:grid-cols-4 xl:items-start">
              {parsed.toc.length > 0 ? (
                <TocList
                  entries={parsed.toc}
                  title={t.tocTitle}
                  variant="aside"
                />
              ) : null}
              <div className="min-w-0 xl:col-span-3">
                {parsed.toc.length > 0 ? (
                  <TocList
                    entries={parsed.toc}
                    title={t.tocTitle}
                    variant="collapsed"
                  />
                ) : null}
                <div data-testid="legal-document-body">{parsed.content}</div>
                <div className="mt-10">
                  <a
                    href={backHref}
                    data-testid="legal-document-back-bottom"
                    className="text-sm font-extrabold text-primary-action underline underline-offset-4"
                  >
                    {t.backToListLong}
                  </a>
                </div>
                {others.length > 0 ? (
                  <OtherDocuments
                    items={others}
                    title={t.otherDocuments}
                    updatedChip={t.updatedChip}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </article>
    );
  },
);
LegalDocument.displayName = "LegalDocument";

export { LegalDocument };
