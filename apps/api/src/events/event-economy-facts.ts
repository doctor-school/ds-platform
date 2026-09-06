/**
 * ## The ONE reading of an event's economy facts
 *
 * `nmo` and `pulCost` are read from what the 007 aggregate actually authors
 * today: 007 authors WEBINAR broadcasts and has no НМО column and no Pul-cost
 * column at all. So this states the truth of the current authoring model rather
 * than inventing values — `nmo: false` and `pulCost: 0` («бесплатно для
 * врача»). Widening 007's authoring to carry these fields is tracked as
 * decision-debt in `DEBT.md`; the contracts already carry them, so that
 * widening is a change to THIS function and not a reshape.
 *
 * It lives in one module because two surfaces read it — the 019 doctor feed
 * card (`DoctorEventCardSchema`) and the 020 public event page
 * (`EventPageViewBaseSchema`, #1766). A doctor sees the same event as a card in
 * the feed and as a page one click later; if each surface mapped these facts
 * itself, the two could disagree about whether an event credits НМО or costs
 * Pul, which is exactly the divergence the cross-front reuse rule forbids.
 */
export interface EventEconomyFacts {
  /** НМО is a chip and a facet only — never a heading or the primary filter. */
  nmo: boolean;
  /** Cost in Pul attention points; `0` is the free-for-the-doctor reading. */
  pulCost: number;
}

/**
 * The economy facts of one event. It takes no argument today because 007
 * authors no per-event source for either fact — the parameter arrives together
 * with the columns, and this signature is where that change is made once.
 */
export function eventEconomyFacts(): EventEconomyFacts {
  return { nmo: false, pulCost: 0 };
}
