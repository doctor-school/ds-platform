"use client";

import { useEffect } from "react";

/**
 * 019 EARS-12 (#1527) — «the doctor is returned to that exact URL, with the
 * action resumed on the same card».
 *
 * The return target 021 hands back is the feed URL the guest activated
 * «Участвовать ↗» from, plus one extra key: `resume=<event slug>`. The URL half
 * of the promise («exactly where they were») is already kept by the feed codec
 * — facets, horizon and selected day come back verbatim. This component keeps
 * the second half: the CARD half.
 *
 * «Resumed on the same card» is deliberately NOT a re-fired action. 019
 * introduces no participation COMMAND of its own (020 owns that policy), so
 * auto-navigating the returning doctor into the event page would be inventing
 * one — and would strand them if they came back for another reason. What the
 * doctor gets instead is the card brought into view and its action FOCUSED: the
 * same card, the same control, one Enter away, with the browser's own focus
 * ring saying which one.
 *
 * The card is addressed through its title link (`a[href="/events/<slug>"]`) —
 * the shared `WebinarCard` renders no id and no slug attribute of its own, and
 * widening the design-system item type for a host-local anchor would be the
 * EARS-15 failure in miniature.
 *
 * `resume` is ONE-SHOT by design: it lives OUTSIDE the feed query codec, so
 * «Показать ещё», a day cell and every facet link drop it on the next
 * navigation. A returning doctor is anchored once; from then on the URL is a
 * plain feed URL again.
 *
 * `resume` wins over `?day=`: both may ride the same restored URL and the card
 * is the more specific target — which is why this effect is mounted AFTER
 * `DoctorEventsDayAnchorScroll` and therefore scrolls last.
 */
export function DoctorEventsResumeScroll({ slug }: { slug: string | null }) {
  useEffect(() => {
    if (slug === null) return;

    let frame = 0;
    let attempts = 0;

    const run = () => {
      const link = document.querySelector<HTMLAnchorElement>(
        `[data-webinar-card] a[href="/events/${CSS.escape(slug)}"]`,
      );
      const card = link?.closest<HTMLElement>("[data-webinar-card]") ?? null;
      if (card === null || link === null) {
        // The card may still be painting; retry for ~1s, then give up. A slug
        // the current horizon does not serve is NOT an error state — the feed
        // stays exactly as it was read, with nothing to explain away.
        if (attempts++ < 60) frame = requestAnimationFrame(run);
        return;
      }

      card.scrollIntoView({ behavior: "auto", block: "center" });
      // The card's LAST anchor is its action: the shared unit renders the CTA
      // after the whole body. A card that carries none (registered, sold out,
      // a recording) falls back to its title link, so focus always lands on
      // the resumed card rather than nowhere.
      const anchors = card.querySelectorAll<HTMLAnchorElement>("a[href]");
      const action = anchors[anchors.length - 1] ?? link;
      action.focus({ preventScroll: true });
    };

    frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
  }, [slug]);

  return null;
}
