"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Container } from "@ds/design-system/container";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ds/design-system/tabs";

import { FEED_COPY } from "../copy/feed-copy";
import type { FeedTense } from "../model/feed";

/**
 * The listing's frame per the canvas head (`design-source/events-feed.dc.html`
 * «events-feed · шапка»): the page title and subline on the brand band, the
 * head row, and the blocks of the selected tense below. The tense is URL state
 * (019 LD-1): a tab navigates to its href.
 *
 * The tense tabs «Прошедшие | Будущие» belong to the feed view only (019
 * «Amendment — 2026-10-12»): the month view keeps the URL tense but shows no
 * tabs, its head row carries just the right-aligned view link from 1024 px
 * and is absent below (the narrow view link sits in the main column).
 */
export function FeedFrame({
  title,
  subline,
  tense,
  view,
  hrefs,
  headAction,
  children,
}: {
  title: string;
  subline: ReactNode;
  tense: FeedTense;
  view: "feed" | "month";
  hrefs: Readonly<Record<FeedTense, string>>;
  headAction?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const header = (
    <header
      className="bg-primary-surface text-primary-surface-foreground"
      data-feed-block="head"
    >
      <Container variant="calendar">
        <div className="flex flex-col gap-5 pt-8 pb-6 layout:gap-7 layout:pt-14 layout:pb-10">
          <div className="flex flex-col gap-3">
            <h1 className="text-3xl leading-none font-extrabold tracking-tight text-balance layout:text-4xl">
              {title}
            </h1>
            <div className="text-base font-semibold text-primary-surface-soft">
              {subline}
            </div>
          </div>
          {view === "feed" ? (
            <div
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4"
              data-testid="events-head-row"
            >
              {/* The canvas lifts the segment off the brand band
                (`TabsList class-name="shadow-lg"`); the lift is the band's
                composition, so it sits on the slot, not on the primitive. */}
              <div className="w-full shadow-lg layout:w-auto">
                <TabsList
                  aria-label={FEED_COPY.tense.label}
                  data-testid="events-tense-tabs"
                >
                  <TabsTrigger value="past">{FEED_COPY.tense.past}</TabsTrigger>
                  <TabsTrigger value="upcoming">
                    {FEED_COPY.tense.upcoming}
                  </TabsTrigger>
                </TabsList>
              </div>
              {headAction}
            </div>
          ) : (
            <div
              className="hidden items-center justify-end lg:flex"
              data-testid="events-head-row"
            >
              {headAction}
            </div>
          )}
        </div>
      </Container>
    </header>
  );
  const body = (
    <Container variant="calendar">
      <div className="flex flex-col gap-10 pt-6 pb-14 layout:pt-12 layout:pb-24">
        {children}
      </div>
    </Container>
  );

  if (view === "month") {
    // No tabs ⇒ no tab panel; the body stays keyed by the URL tense.
    return (
      <div data-testid="events-feed-view">
        {header}
        <div key={tense}>{body}</div>
      </div>
    );
  }
  return (
    <Tabs
      value={tense}
      onValueChange={(value) => router.push(hrefs[value as FeedTense])}
      data-testid="events-feed-view"
    >
      {header}
      <TabsContent value={tense} className="mt-0">
        {body}
      </TabsContent>
    </Tabs>
  );
}
