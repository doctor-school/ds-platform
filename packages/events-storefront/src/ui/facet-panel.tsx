"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  EventsFilter,
  type EventsFilterHost,
  type EventsFilterOptions,
  countAppliedFacets,
} from "@ds/design-system/blocks";
import { Button } from "@ds/design-system/button";
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@ds/design-system/sheet";
import type { RawQueryRecord } from "@ds/schemas";

import { FILTER_COPY } from "../copy/filter-copy";
import type { PluralNoun } from "../model/event-count";
import {
  type SpecialtyChoice,
  appliedFacetsOf,
  filterOptionsOf,
  resetFacetsHref,
  filterLabelsOf,
  withAppliedFacets,
} from "../model/facets";
import type { FeedFacetOptions } from "../model/feed";
import { pageHref } from "../model/feed-url";
import { useRecoveredFeedRead } from "./feed-read-scope";

export interface FacetPanelProps {
  filterSet: EventsFilterHost;
  listing: string;
  raw: RawQueryRecord;
  options: EventsFilterOptions;
  /** The feed read's option block: it decides which controls render (`filterLabelsOf`). */
  optionBlock: FeedFacetOptions;
  /** The specialty book the options were named from. */
  specialties: readonly SpecialtyChoice[];
}

/**
 * The panel's options and option block: the page's own feed read, or — when
 * that read failed and the feed's «Повторить» recovered it (019 EARS-9, #2832)
 * — the retried read, so the panel ends as a full load would draw it.
 */
function useFacetSource({
  filterSet,
  options,
  optionBlock,
  specialties,
}: FacetPanelProps): Pick<FacetPanelProps, "options" | "optionBlock"> & {
  recoveredMatching: number | null;
} {
  const recovered = useRecoveredFeedRead();
  if (recovered === null)
    return { options, optionBlock, recoveredMatching: null };
  return {
    options: filterOptionsOf(filterSet, recovered.facetOptions, specialties),
    optionBlock: recovered.facetOptions,
    recoveredMatching: recovered.matching,
  };
}

/**
 * The host's facet panel bound to the page URL (wave-2 gate row 58): the
 * design-system `EventsFilter` at the host's `filterSet`; every change is a
 * soft push of the page's canonical URL (019 LD-1), so the server re-reads the
 * feed or the month under the new facets; «Сбросить» is a real link.
 */
export function FacetPanel({
  showHeader = true,
  ...panel
}: FacetPanelProps & { showHeader?: boolean }) {
  const { filterSet, listing, raw } = panel;
  const { options, optionBlock } = useFacetSource(panel);
  const router = useRouter();
  const specialty = options.specialty ?? [];
  const applied = appliedFacetsOf(
    raw,
    (id) => specialty.find((option) => option.id === id)?.label,
  );
  return (
    <EventsFilter
      host={filterSet}
      applied={applied}
      options={options}
      labels={filterLabelsOf(filterSet, optionBlock)}
      showHeader={showHeader}
      resetHref={resetFacetsHref(listing, raw, filterSet)}
      onChange={(next) =>
        router.push(
          pageHref(listing, withAppliedFacets(raw, next, filterSet)),
          {
            scroll: false,
          },
        )
      }
    />
  );
}

/**
 * Below 1024 px (row 60, the canvas sheet): «Фильтры (N)» opens the panel as a
 * right-side sheet; the footer resets, or closes on «Показать N событий» —
 * the live count of the reading the facets already applied.
 */
export function FacetSheet({
  matching,
  noun,
  ...panel
}: FacetPanelProps & { matching: number | null; noun: PluralNoun }) {
  const applied = countAppliedFacets(
    appliedFacetsOf(panel.raw),
    panel.filterSet,
  );
  const shown = useFacetSource(panel).recoveredMatching ?? matching;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" data-testid="events-filter-open">
          {FILTER_COPY.openSheet(applied)}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" data-testid="events-filter-sheet">
        <SheetHeader>
          <SheetTitle>{FILTER_COPY[panel.filterSet].title}</SheetTitle>
          <SheetDescription className="sr-only">
            {FILTER_COPY.sheetDescription}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <FacetPanel {...panel} showHeader={false} />
        </SheetBody>
        <SheetFooter>
          <Button asChild variant="outline">
            <Link
              href={resetFacetsHref(panel.listing, panel.raw, panel.filterSet)}
              scroll={false}
            >
              {FILTER_COPY[panel.filterSet].reset}
            </Link>
          </Button>
          {shown === null ? null : (
            <SheetClose asChild>
              <Button data-testid="events-filter-show">
                {FILTER_COPY.showN(shown, noun)}
              </Button>
            </SheetClose>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
