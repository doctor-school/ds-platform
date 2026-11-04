import type { ReactNode } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { FeedBlock, FeedBlockKind } from "@ds/schemas";
import { SpecialtyEventsBlock } from "@ds/events-storefront/feed";

import { SpecialtyFeedHeader } from "@/components/specialty-feed-header";
import { DOCTOR_EVENTS_STOREFRONT } from "@/lib/events-storefront.host-config";
import { fetchSpecialtyFeed } from "@/lib/specialty-feed";
import { resolveRememberedSpecialty } from "@/lib/specialty-choice";
import { retryDoctorEventsBlock } from "../../events/retry-block-action";

/**
 * 018 EARS-1 (#1496) — `doctor.school/feed/<specialty>`, the specialty feed: a
 * PAGE inside 017's shell layout (`app/(storefront)/layout.tsx`), which renders
 * the header, navigation and footer; the feed defines none of its own.
 *
 * The page renders the breadcrumbs and the specialty heading, then exactly the
 * blocks the api's `SpecialtyFeed` envelope lists, in its order (LD-1): a
 * content type that is not connected is not in the envelope, so there is no
 * heading, placeholder or empty shell for it here. Release 1 connects the
 * nearest events (EARS-4); every further block plugs into
 * {@link BLOCK_RENDERERS} — the record is exhaustive over the connected kinds,
 * so connecting a kind in `@ds/schemas` without its renderer fails the build.
 *
 * The specialty is the PATH: the page is about that specialty whatever this
 * visitor remembers. A path naming no member of the book is the route's
 * not-found state.
 */
export const dynamic = "force-dynamic";

const BLOCK_RENDERERS: Record<
  FeedBlockKind,
  (specialtyCode: string, block: FeedBlock) => ReactNode
> = {
  events: (specialtyCode) => (
    <SpecialtyEventsBlock
      config={DOCTOR_EVENTS_STOREFRONT}
      retry={retryDoctorEventsBlock}
      specialtyCode={specialtyCode}
    />
  ),
};

export default async function SpecialtyFeedPage({
  params,
}: {
  params: Promise<{ specialty: string }>;
}) {
  const { specialty } = await params;
  const requestHeaders = await headers();
  const [read, remembered] = await Promise.all([
    fetchSpecialtyFeed(specialty, requestHeaders),
    resolveRememberedSpecialty(requestHeaders),
  ]);
  if (read.kind === "not-found") notFound();
  const { feed } = read;

  return (
    <div
      className="pb-16 layout:pb-24"
      data-surface="specialty-feed"
      data-testid="specialty-feed"
    >
      <SpecialtyFeedHeader
        actor={remembered.actor}
        initialChoice={remembered.choice}
        specialty={feed.specialty}
      />
      {feed.blocks.map((block) => (
        <div data-feed-block-slot={block.kind} key={block.kind}>
          {BLOCK_RENDERERS[block.kind](feed.specialty.code, block)}
        </div>
      ))}
    </div>
  );
}
