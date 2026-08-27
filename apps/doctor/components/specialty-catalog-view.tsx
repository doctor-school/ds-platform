import { Button, FilterChip, Input, Skeleton } from "@ds/design-system";
import type { SpecialtyRef } from "@ds/schemas";

/**
 * 017 EARS-4 / EARS-5 — the home-page specialty catalog in Stage-A variant Б
 * (`design-source/doctor-home.dc.html` L118-132), PRESENTATIONAL and total over
 * the §3 catalog state machine.
 *
 * The state union is the whole point, exactly as in `hero-counters.tsx`: design
 * §3 names the renders (Loading · Open · Filtered · NoMatch · Expanded) and §6
 * row «Specialty catalog» calls an unresolving spinner and an empty labelled box
 * defects, so this component takes the state as DATA and has no other way to
 * draw. The reads that produce it live one layer up in
 * `components/specialty-catalog.tsx`, which keeps this file renderable to static
 * markup and every state assertable without a jsdom tier.
 *
 * Three rules this file exists to hold:
 *
 *  1. **N is never a literal.** «Показать весь список — N» binds to `total`,
 *     which is `SpecialtyBook.total` as the read served it. The canvas's `118`
 *     is a placeholder in a mockup, not copy (EARS-4).
 *  2. **No gate.** There is no modal, interstitial, scroll lock or backdrop in
 *     ANY state — the section is ordinary page flow, and the rest of the home
 *     page stays readable and scrollable with no choice made (EARS-4). The
 *     expanded list is a wrapping cloud in flow, never a bare full-length scroll
 *     and never an inner scroll box.
 *  3. **Verbatim official names.** A book entry renders the nomenclature string
 *     as served, temporal qualifiers included («… (сохраняется до 1 сентября
 *     2028 г.)»); it is a legal reference book, and shortening an entry would
 *     make the doctor pick something the platform does not call by that name.
 *
 * Choosing a specialty is #1482's deliverable, not this slice's: `onSelect` is
 * the seam it will fill. Until then a chip activation changes NOTHING on screen —
 * deliberately, because a toast or a collapsed row would tell a doctor their
 * choice was remembered when nothing recorded it.
 */
export type SpecialtyCatalogState =
  | { kind: "loading" }
  | { kind: "error" }
  | {
      kind: "ready";
      /** `SpecialtyBook.total` — the ONE source of every count on this surface. */
      total: number;
      /** The entries this render shows: frequent, matches, or the whole book. */
      entries: SpecialtyRef[];
      /**
       * Which §3 state the catalog is in.
       *
       * `searching` and `searchfailed` are the two renders a narrowing can be in
       * before it has an answer. They exist because the alternative — falling
       * back to the frequent set — would present entries that are NOT the
       * matches for the query still sitting in the field: a confidently wrong
       * answer, which §6 calls a defect. The book itself is fine in both, so the
       * field, the typed query and the expand route to «Другое» all stay.
       */
      view:
        | "open"
        | "filtered"
        | "nomatch"
        | "expanded"
        | "searching"
        | "searchfailed";
      /**
       * A search read is in flight over what is currently drawn. The entries
       * stay on screen (a wholesale flicker back to a skeleton on every
       * keystroke would be worse), but the region announces itself busy so a
       * screen-reader user is not told a stale set is the answer.
       */
      busy: boolean;
    };

export interface SpecialtyCatalogViewProps {
  state: SpecialtyCatalogState;
  query: string;
  onQueryChange: (query: string) => void;
  onToggleExpand: () => void;
  onRetry: () => void;
  onSelect: (entry: SpecialtyRef) => void;
}

/** Canvas copy, transcribed — never re-worded here. */
const HEADING = "Ваша специальность";
const PLACEHOLDER = "Начните вводить название";
const FREQUENT_LABEL = "Частые специальности";
const NO_MATCH = "Ничего не найдено. Проверьте написание или выберите «Другое».";
const ERROR_COPY = "Не удалось загрузить список специальностей.";
const RETRY = "Обновить";
/** The narrowing failed — the BOOK did not. Says which, and offers both routes
 * out: repeat the search, or open the whole list below. */
const SEARCH_ERROR_COPY = "Не удалось выполнить поиск. Повторите попытку или откройте весь список.";
const SEARCH_RETRY = "Повторить поиск";
const SEARCHING_COPY = "Ищем совпадения…";

/**
 * The field's accessible name. The canvas gives the input a placeholder and no
 * visible label (L121), and the canvas is the look SoT — so the label is present
 * in the accessibility tree and visually hidden, rather than invented on screen.
 * A placeholder is not a label: it disappears on the first keystroke, which is
 * precisely when a screen-reader user needs the field named.
 */
const SEARCH_LABEL = "Поиск специальности";

const SECTION = "mt-11 px-4 layout:mt-20 layout:px-12";
/**
 * The home container, from the SAME token the hero one section above uses
 * (`storefront-hero.tsx`): `--container-content` is 69rem = 1104px, which is the
 * canvas's `max-width:1104px` for both sections (`doctor-home.dc.html` L57, L75).
 * A Tailwind scale step near it (`max-w-6xl` = 1152px) is token-safe but 48px
 * wider, which puts this section's heading and rule line visibly outside the
 * hero's edges at a wide viewport — two sections of one page out of alignment.
 */
const INNER = "mx-auto w-full max-w-container-content";
const CHIP_ROW = "flex flex-wrap justify-center gap-2";

function Heading() {
  // The canvas's title + rule line (L77-80): the rule is decorative, so it is a
  // presentational span, not an <hr> a screen reader would announce.
  return (
    <div className="mb-5 flex items-baseline gap-4 layout:mb-6">
      <h2 className="whitespace-nowrap text-2xl font-extrabold leading-none tracking-tight text-foreground layout:text-4xl">
        {HEADING}
      </h2>
      <span aria-hidden="true" className="-translate-y-1.5 flex-1 border-t-2 border-foreground" />
    </div>
  );
}

export function SpecialtyCatalogView({
  state,
  query,
  onQueryChange,
  onToggleExpand,
  onRetry,
  onSelect,
}: SpecialtyCatalogViewProps) {
  if (state.kind === "loading") {
    return (
      <section
        data-testid="specialty-catalog"
        data-state="loading"
        aria-busy="true"
        aria-label="Загружаем список специальностей"
        className={SECTION}
      >
        <div className={INNER}>
          <Heading />
          <div className="mx-auto max-w-3xl">
            {/* A skeleton FIELD and skeleton chips, not a spinner: the section
                claims nothing until the reads resolve, and it reserves the
                height so the blocks below do not jump when they land. */}
            <Skeleton className="h-16 w-full" />
            <div className={`mt-8 ${CHIP_ROW}`}>
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-36" />
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section
        data-testid="specialty-catalog"
        data-state="error"
        className={SECTION}
      >
        <div className={INNER}>
          <Heading />
          {/* An explicit Russian-language statement with a working retry. It
              explains nothing about the backend, and the rest of the page is
              untouched — the catalog failing is not the page failing. */}
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-4">
            <p
              data-testid="specialty-catalog-error"
              role="status"
              className="text-center text-sm font-semibold text-muted-foreground"
            >
              {ERROR_COPY}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetry}
              data-testid="specialty-catalog-retry"
            >
              {RETRY}
            </Button>
          </div>
        </div>
      </section>
    );
  }

  const { total, entries, view, busy } = state;
  const expandLabel =
    view === "expanded"
      ? "Свернуть список"
      : `Показать весь список — ${total}`;

  return (
    <section
      data-testid="specialty-catalog"
      data-state={view}
      data-total={total}
      aria-busy={busy || undefined}
      className={SECTION}
    >
      <div className={INNER}>
        <Heading />
        <div className="mx-auto max-w-3xl text-center">
          <label htmlFor="specialty-search" className="sr-only">
            {SEARCH_LABEL}
          </label>
          <Input
            id="specialty-search"
            data-testid="specialty-search"
            type="search"
            autoComplete="off"
            value={query}
            placeholder={PLACEHOLDER}
            onChange={(event) => onQueryChange(event.target.value)}
            // The canvas field is the page's primary action: tall, larger type
            // than a form input (L121). Token utilities only.
            className="h-auto py-5 text-center text-base font-semibold layout:text-lg"
          />

          {/* The «Частые специальности» caption belongs to the frequent set and
              disappears with it: over a filtered result it would label rows that
              are not the frequent set. */}
          {view === "open" ? (
            <p className="mb-3 mt-5 text-xs font-extrabold uppercase tracking-widest text-muted-foreground">
              {FREQUENT_LABEL}
            </p>
          ) : null}

          {view === "nomatch" ? (
            <p
              data-testid="specialty-no-match"
              role="status"
              className="py-6 text-sm font-semibold text-muted-foreground"
            >
              {NO_MATCH}
            </p>
          ) : view === "searching" ? (
            /* The narrowing has no answer YET. Showing the frequent set here
               would label it as the matches for the query in the field. */
            <p
              data-testid="specialty-searching"
              role="status"
              className="py-6 text-sm font-semibold text-muted-foreground"
            >
              {SEARCHING_COPY}
            </p>
          ) : view === "searchfailed" ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <p
                data-testid="specialty-search-error"
                role="status"
                className="text-sm font-semibold text-muted-foreground"
              >
                {SEARCH_ERROR_COPY}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetry}
                data-testid="specialty-search-retry"
              >
                {SEARCH_RETRY}
              </Button>
            </div>
          ) : (
            <ul
              data-testid="specialty-entries"
              className={`${view === "open" ? "" : "mt-6 "}${CHIP_ROW} list-none p-0`}
            >
              {entries.map((entry) => (
                <li key={entry.id}>
                  <FilterChip
                    data-testid="specialty-entry"
                    data-code={entry.code}
                    onClick={() => onSelect(entry)}
                  >
                    {entry.name}
                  </FilterChip>
                </li>
              ))}
            </ul>
          )}

          {/*
            The expand control stays available in EVERY ready state, NoMatch
            included: EARS-5 requires the search to stay recoverable and «Другое»
            reachable, and expanding is the second way to reach every entry. It
            is hidden only when the current render already shows the whole book.
          */}
          {view === "expanded" || entries.length < total ? (
            <Button
              type="button"
              variant="link"
              data-testid="specialty-expand"
              aria-expanded={view === "expanded"}
              onClick={onToggleExpand}
              className="mt-6"
            >
              {expandLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
