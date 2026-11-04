import {
  DoctorEventsFeedSchema,
  type DoctorEventCard,
  FeedEventsSchema,
  PublicEventListingPageSchema,
} from "@ds/schemas";

import type {
  EventsFeedCard,
  EventsFeedPage,
  EventsStorefrontAdapter,
} from "./model/feed";

/**
 * The closed adapter list of wave-2 entry gate §4.5 — one adapter per host read,
 * each a pure mapping of that read's DTO onto the one feed page model. A host's
 * config names its adapter (`contentSet.adapt`); it writes none of its own.
 */

/** The Academy read `GET /v1/public/events?timeframe=…&from=&to=`. */
export const adaptPublicEventListing: EventsStorefrontAdapter = (
  dto,
  { tense },
): EventsFeedPage => {
  const page = PublicEventListingPageSchema.parse(dto);
  const cards = page.data.map((card): EventsFeedCard => ({
    id: card.id,
    slug: card.slug,
    startsAt: card.startsAt,
    format: card.format,
    kindTitle: card.kind.title,
    title: card.title,
    school: card.school,
    speakers: card.speakers.map((speaker) => speaker.name),
    specialties: card.specialties,
    state:
      card.state === "ended"
        ? "past"
        : card.state === "live"
          ? "live"
          : "upcoming",
    signUpCount: card.signUpCount,
    recording: "recording" in card ? card.recording : null,
  }));
  // The feed always reads the horizon form (D2, `feedReadQuery`). A page
  // without one is a cursor page — a read the feed never makes — and rendering
  // it would silently drop «Показать ещё», so it is refused: the block shows
  // its error state (019 EARS-9) instead.
  const horizon = page.horizon;
  if (horizon === undefined) {
    throw new Error("The Academy feed read answered without its horizon");
  }
  // The head subline counts the tab it heads (#2768): «Прошедшие» its past
  // эфиры and their schools, «Будущие» the upcoming ones; a tab with none
  // carries no summary, so no «0 эфиров · 0 школ» line renders.
  const summary =
    tense === "past"
      ? { events: page.counts.past, schools: page.counts.pastSchools }
      : { events: page.counts.upcoming, schools: page.counts.upcomingSchools };
  return {
    today: horizon.today,
    cards,
    horizon: {
      from: horizon.from,
      to: horizon.to,
      nextCount: horizon.nextCount,
      nextFrom: horizon.nextFrom,
    },
    remaining: horizon.remaining,
    nextBatch: horizon.nextBatch,
    ...(summary.events > 0 ? { summary } : {}),
    facetOptions: page.facets ?? {},
    matching: cards.length + horizon.remaining,
  };
};

function doctorState(card: DoctorEventCard): EventsFeedCard["state"] {
  if (card.state === "live") return "live";
  if (card.state === "recorded") return "past";
  return "upcoming";
}

/**
 * One doctor card payload (019's `PublicEventSummary`) onto the feed card
 * model — the ONE mapping every doctor read that carries event cards uses, so
 * the events page and the specialty feed's nearest-events block (018 EARS-4)
 * cannot render the same event differently.
 */
export function adaptDoctorEventCard(card: DoctorEventCard): EventsFeedCard {
  return {
    id: card.id,
    slug: card.slug,
    startsAt: card.startsAt,
    format: card.format,
    kindTitle: card.kind.title,
    title: card.title,
    school: card.source,
    speakers: card.speaker ? [card.speaker] : [],
    state: doctorState(card),
    signUpCount: card.signUpCount,
    nmo: card.nmo,
    pulCost: card.pulCost,
    ...(card.city ? { city: card.city } : {}),
    ...(card.seatsLeft !== undefined ? { seatsLeft: card.seatsLeft } : {}),
    recording: card.recording ?? null,
  };
}

/** The doctor read `GET /v1/storefront/doctor/events?tense=…&from=&to=&…facets`. */
export const adaptDoctorEventsFeed: EventsStorefrontAdapter = (dto) => {
  const feed = DoctorEventsFeedSchema.parse(dto);
  const cards = feed.days.flatMap((day) => day.items.map(adaptDoctorEventCard));
  return {
    today: feed.today,
    cards,
    horizon: {
      from: feed.from,
      to: feed.to,
      nextCount: feed.nextCount,
      nextFrom: feed.nextFrom,
    },
    remaining: feed.remaining,
    nextBatch: feed.nextBatch,
    facetOptions: feed.facets ?? {},
    matching: cards.length + feed.remaining,
    defaultScopeEmpty: feed.targeting.defaultScopeEmpty,
  };
};

/**
 * 018 EARS-4 — the specialty feed's nearest-events read
 * `GET /v1/storefront/feed/{specialty}/events`: the same cards, plus the
 * link-out into the 019 events feed scoped to the specialty.
 */
export function adaptFeedEvents(dto: unknown): {
  cards: EventsFeedCard[];
  allEventsHref: string;
} {
  const block = FeedEventsSchema.parse(dto);
  return {
    cards: block.items.map(adaptDoctorEventCard),
    allEventsHref: block.allEventsHref,
  };
}
