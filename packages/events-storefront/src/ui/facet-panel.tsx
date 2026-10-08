"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  EventsFilter,
  type EventsFilterHost,
  type EventsFilterLabels,
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
  appliedFacetsOf,
  resetFacetsHref,
  withAppliedFacets,
} from "../model/facets";
import { pageHref } from "../model/feed-url";

export interface FacetPanelProps {
  filterSet: EventsFilterHost;
  listing: string;
  raw: RawQueryRecord;
  options: EventsFilterOptions;
  /** The host set's labels; a control the data cannot distinguish has none (`filterLabelsOf`). */
  labels: EventsFilterLabels;
}

/**
 * The host's facet panel bound to the page URL (wave-2 gate row 58): the
 * design-system `EventsFilter` at the host's `filterSet`; every change is a
 * soft push of the page's canonical URL (019 LD-1), so the server re-reads the
 * feed or the month under the new facets; «Сбросить» is a real link.
 */
export function FacetPanel({
  filterSet,
  listing,
  raw,
  options,
  labels,
  showHeader = true,
}: FacetPanelProps & { showHeader?: boolean }) {
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
      labels={labels}
      showHeader={showHeader}
      resetHref={resetFacetsHref(listing, raw, filterSet)}
      onChange={(next) =>
        router.push(pageHref(listing, withAppliedFacets(raw, next, filterSet)), {
          scroll: false,
        })
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
          {matching === null ? null : (
            <SheetClose asChild>
              <Button data-testid="events-filter-show">
                {FILTER_COPY.showN(matching, noun)}
              </Button>
            </SheetClose>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
