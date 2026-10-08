import {
  DoctorEventsFeedSchema,
  type DoctorEventCard,
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
export const adaptPublicEventListing: EventsStorefrontAdapter = (dto): EventsFeedPage => {
  const page = PublicEventListingPageSchema.parse(dto);
  const cards = page.data.map(
    (card): EventsFeedCard => ({
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
    }),
  );
  // The feed always reads the horizon form (D2); a cursor page carries none.
  const horizon = page.horizon ?? {
    from: "",
    to: "",
    nextTo: null,
    nextFrom: null,
    remaining: 0,
  };
  return {
    cards,
    horizon: {
      from: horizon.from,
      to: horizon.to,
      nextTo: horizon.nextTo,
      nextFrom: horizon.nextFrom,
    },
    remaining: horizon.remaining,
    summary: { events: page.counts.upcoming, schools: page.counts.upcomingSchools },
  };
};

function doctorState(card: DoctorEventCard): EventsFeedCard["state"] {
  if (card.state === "live") return "live";
  if (card.state === "recorded") return "past";
  return "upcoming";
}

/** The doctor read `GET /v1/storefront/doctor/events?tense=…&from=&to=&…facets`. */
export const adaptDoctorEventsFeed: EventsStorefrontAdapter = (dto) => {
  const feed = DoctorEventsFeedSchema.parse(dto);
  const cards = feed.days.flatMap((day) =>
    day.items.map(
      (card): EventsFeedCard => ({
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
      }),
    ),
  );
  return {
    cards,
    horizon: {
      from: feed.from,
      to: feed.to,
      nextTo: feed.nextTo,
      nextFrom: feed.nextFrom,
    },
    remaining: feed.remaining,
  };
};
